"""Experimental Windows capture primitive; no input device opens until start()."""
import ctypes
import logging
import math
import os
import queue
import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

log = logging.getLogger('windows_capture')

# A WAV written with the wave module cannot hold more than 4 GiB (about 6.2 hours of 16-bit/48 kHz stereo).
# Stop writing a little short of that limit instead of letting the header overflow and spoil the file.
MAX_WAV_DATA_BYTES = 0xFFFFFFFF - 36 - 1024 * 1024

class CaptureError(RuntimeError):
    pass

_ole32 = ctypes.OleDLL('ole32')

def ensure_com():
    """Initialise COM (multithreaded) on the calling thread.

    PortAudio's WASAPI host opens streams through COM. Flask request threads
    have no COM, so opening a WASAPI input there failed with PortAudio's
    "Unanticipated host error" (whose text names WDM-KS, the last host that
    reported anything). Repeated calls are harmless; a thread already in
    another COM mode can use COM as it is.
    """
    try:
        _ole32.CoInitializeEx(None, 0)
    except OSError:
        pass

def sample_peak(*, device, samplerate, channels, input_channels, seconds=3.0, gain_db=0.0,
                stream_factory=sd.InputStream, sleep=None):
    """Listen to an input for a few seconds without writing a file; returns the peak in dBFS."""
    import time
    if not channels or any(not isinstance(c, int) or c < 0 or c >= input_channels for c in channels):
        raise ValueError('Selected input channels are unavailable.')
    gain = 10 ** (float(gain_db) / 20)
    state = {'peak': 0.0, 'frames': 0, 'error': None}

    def callback(data, frames, time_info, status):
        samples = np.asarray(data[:, list(channels)], dtype=np.float32)
        if samples.size and np.isfinite(samples).all():
            state['peak'] = max(state['peak'], float(np.max(np.abs(samples))) * gain)
        state['frames'] += frames
        if status and state['error'] is None:
            state['error'] = str(status)

    ensure_com()
    stream = stream_factory(device=device, samplerate=samplerate, channels=input_channels,
                            dtype='float32', callback=callback)
    try:
        stream.start()
        (sleep or time.sleep)(seconds)
    finally:
        try:
            ensure_com()
            stream.stop()
        finally:
            stream.close()
    if not state['frames']:
        raise CaptureError('The input delivered no audio during the test.')
    return 20 * math.log10(state['peak']) if state['peak'] > 0 else -math.inf


class WindowsInputCapture:
    def __init__(self, stream_factory=sd.InputStream, queue_blocks=None, queue_seconds=30.0):
        self._factory = stream_factory
        self._queue_blocks = queue_blocks or 0  # optional extra cap on the number of blocks (0 = none)
        self._queue_seconds = queue_seconds  # how much audio may wait for the writer before blocks are dropped
        self._queue_limit = self._queued_frames = 0
        self._dropouts = self._dropped_frames = self._gap = 0
        self._dropping = self._write_failed = self._limit_reached = False
        self._lock = threading.Lock()
        self._stream = self._writer = self._queue = None
        self._failure = None
        self._frames = 0
        self._peak = 0.0
        self._partial = self._target = None
        self._samplerate = 0
        self._channels = ()
        self._gain = 1.0
        self.feed = None  # optional callable given each captured block (windows_feed streaming feed)

    def _fail(self, message):
        with self._lock:
            if self._failure is None:
                self._failure = str(message)

    def add_gap(self, frames):
        """A stretch of silence the source reports as a frame count (a paused program in process loopback):
        the writer inserts it before the next block. It is not a dropout and needs no memory."""
        with self._lock:
            self._gap += int(frames)

    def _callback(self, data, frames, time_info, status):
        if isinstance(status, str):
            # A stream that cannot continue (the program closed, the read failed) reports its reason as text.
            self._fail(status)
            return
        if status:
            # An input overflow or underflow means PortAudio lost a little audio; the stream goes on.
            # The block in hand is still good, so it is recorded and the event is only counted.
            with self._lock:
                self._dropouts += 1
        try:
            samples = np.asarray(data[:, self._channels], dtype=np.float32).copy()
            samples *= self._gain
            if not np.isfinite(samples).all():
                samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)  # a bad block becomes silence
                with self._lock:
                    self._dropouts += 1
            peak = float(np.max(np.abs(samples))) if samples.size else 0.0
            gap = 0
            if len(samples) > self._queue_limit and not samples.any():
                self.add_gap(len(samples))  # a long pause delivered as one silent block: not a dropout
                return
            with self._lock:
                self._peak = peak
                room = self._queued_frames + len(samples) <= self._queue_limit
                if room:
                    gap, self._gap = self._gap, 0
                    self._queued_frames += len(samples)
            if room:
                try:
                    self._queue.put_nowait((gap, samples))
                except queue.Full:
                    room = False
                    with self._lock:
                        self._queued_frames -= len(samples)
            if not room:
                # The writer is behind by about queue_seconds. Drop this block; the writer puts the same
                # number of silent frames in its place so the rest of the take keeps its timing.
                with self._lock:
                    if not self._dropping:
                        self._dropouts += 1
                        self._dropping = True
                    self._dropped_frames += len(samples)
                    self._gap += gap + len(samples)
                return
            self._dropping = False
            feed = self.feed
            if feed is not None:
                try:
                    feed(samples)
                except Exception:
                    self.feed = None  # a feed problem never stops the recording
        except Exception as exc:
            self._fail(exc)

    def _write(self, file_obj):
        try:
            width, written = 2 * len(self._channels), 0
            with wave.open(file_obj, 'wb') as output:
                output.setnchannels(len(self._channels)); output.setsampwidth(2); output.setframerate(self._samplerate)
                while True:
                    item = self._queue.get()
                    if item is None:
                        break
                    gap, block = item
                    with self._lock:
                        self._queued_frames -= len(block)
                    if self._limit_reached:
                        continue  # the file is full; keep draining so the stream is never blocked
                    if written + (gap + len(block)) * width > MAX_WAV_DATA_BYTES:
                        self._limit_reached = True
                        continue
                    while gap:  # silence in place of blocks that were dropped before this one
                        step = min(gap, 65536)
                        output.writeframesraw(bytes(step * width)); gap -= step; written += step * width
                        with self._lock:
                            self._frames += step
                    pcm = (np.clip(block, -1.0, 1.0) * 32767.0).astype('<i2').tobytes()
                    output.writeframesraw(pcm); written += len(pcm)
                    with self._lock:
                        self._frames += len(block)
        except Exception as exc:
            self._write_failed = True
            self._fail('Could not write recording: ' + str(exc))
        finally:
            file_obj.close()

    def _finish_writer(self):
        # A failed writer may leave a full queue behind. Never wait forever
        # attempting to enqueue a sentinel after the consumer has exited.
        while self._writer.is_alive():
            try:
                self._queue.put(None, timeout=0.1)
                break
            except queue.Full:
                continue
        self._writer.join(60)  # a stalled disk must not hold the app open forever
        if self._writer.is_alive():
            self._fail('Could not write recording: the file writer did not finish')
            self._write_failed = True
        self._writer = None

    def start(self, target, *, device, samplerate=48000, channels=(0, 1), input_channels=None, gain_db=0.0):
        if self._stream is not None:
            raise CaptureError('A recording is already active')
        if not channels or len(channels) > 2 or any(not isinstance(c, int) or c < 0 for c in channels):
            raise ValueError('Choose one or two valid input channels')
        if len(set(channels)) != len(channels):
            raise ValueError('Input channels must be distinct')
        if not isinstance(samplerate, int) or samplerate <= 0:
            raise ValueError('Invalid sample rate')
        if not math.isfinite(float(gain_db)) or not -60 <= float(gain_db) <= 24:
            raise ValueError('Invalid input gain')
        count = input_channels if input_channels is not None else max(channels) + 1
        if not isinstance(count, int) or count <= max(channels):
            raise ValueError('Selected channel is unavailable')
        target = Path(target).absolute()
        if target.suffix.lower() != '.wav' or not target.parent.is_dir():
            raise ValueError('Choose an existing output folder and a WAV filename')
        partial = target.with_name(target.name + '.partial')
        if target.exists():
            raise FileExistsError(target)
        out = open(partial, 'xb')
        self._partial, self._target = partial, target
        self._channels, self._samplerate = tuple(channels), samplerate
        self._gain = 10 ** (float(gain_db) / 20)
        self._queue = queue.Queue(self._queue_blocks)
        self._queue_limit = int(samplerate * self._queue_seconds)  # about 30 s of audio, whatever the block size
        self._queued_frames = 0
        self._failure = None; self._frames = 0; self._peak = 0.0
        self._dropouts = self._dropped_frames = self._gap = 0
        self._dropping = self._write_failed = self._limit_reached = False
        self._writer = threading.Thread(target=self._write, args=(out,), daemon=True)
        self._writer.start()
        try:
            ensure_com()
            self._stream = self._factory(device=device, samplerate=samplerate, channels=count,
                                         dtype='float32', callback=self._callback)
            self._stream.start()
        except Exception:
            if self._stream is not None:
                try: self._stream.close()
                except Exception: pass
            self._stream = None
            self._finish_writer()
            raise
        return self.status()

    def status(self):
        stream = self._stream
        if stream is not None:
            try:
                if not stream.active:
                    self._fail('Audio input stopped unexpectedly')
            except Exception as exc:
                self._fail('Audio input status is unavailable: ' + str(exc))
        with self._lock:
            return {'recording': self._stream is not None, 'frames': self._frames,
                    'seconds': self._frames / self._samplerate if self._samplerate else 0.0,
                    'peak': self._peak, 'error': self._failure,
                    'dropouts': self._dropouts, 'dropped_frames': self._dropped_frames,
                    'limit_reached': self._limit_reached,
                    'warning': ('The recording reached the 4 GiB WAV size limit (about 6 hours); stop to save it'
                                if self._limit_reached else ''),
                    'partial_path': str(self._partial) if self._partial else ''}

    def stop(self):
        if self._stream is None:
            raise CaptureError('No recording is active')
        self.status()
        stream, self._stream = self._stream, None
        try:
            ensure_com()
            stream.stop()
        except Exception as exc:
            self._fail('Audio input could not stop cleanly: ' + str(exc))
        finally:
            try: stream.close()
            except Exception as exc: self._fail('Audio input could not close cleanly: ' + str(exc))
        self._finish_writer()
        with self._lock:
            failure, frames, dropouts = self._failure, self._frames, self._dropouts
            dropped = self._dropped_frames
        if self._write_failed:  # the file itself could not be written: keep it as it is for recovery
            raise CaptureError(failure + '; partial recording retained at ' + str(self._partial))
        if not frames:
            raise CaptureError((failure + '; ' if failure else '') + 'No audio was captured; partial recording retained at ' + str(self._partial))
        try:
            os.rename(self._partial, self._target)
        except OSError as exc:
            raise CaptureError('Could not finalize recording; partial retained at ' + str(self._partial)) from exc
        # A device error or a short dropout no longer spoils the take: the audio recorded so far is saved
        # (the WAV header was finalised when the writer closed it) and the problem stays in status().
        if failure:
            log.warning('Recording %s ended early and was saved: %s', self._target, failure)
        if dropouts:
            log.warning('Recording %s: %d short dropouts (%.2f s of audio replaced by silence)',
                        self._target, dropouts, dropped / self._samplerate)
        return str(self._target)
