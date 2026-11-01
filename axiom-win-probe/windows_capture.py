"""Experimental Windows capture primitive; no input device opens until start()."""
import ctypes
import math
import os
import queue
import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

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
    def __init__(self, stream_factory=sd.InputStream, queue_blocks=256):
        self._factory = stream_factory
        self._queue_blocks = queue_blocks
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

    def _callback(self, data, frames, time_info, status):
        if status:
            self._fail('Audio input reported a buffer error: ' + str(status))
        try:
            samples = np.asarray(data[:, self._channels], dtype=np.float32).copy()
            samples *= self._gain
            if not np.isfinite(samples).all():
                raise ValueError('Input contains non-finite samples')
            peak = float(np.max(np.abs(samples))) if samples.size else 0.0
            with self._lock:
                self._peak = peak
            self._queue.put_nowait(samples)
            feed = self.feed
            if feed is not None:
                try:
                    feed(samples)
                except Exception:
                    self.feed = None  # a feed problem never stops the recording
        except queue.Full:
            self._fail('Audio capture could not keep up; the take is incomplete')
        except Exception as exc:
            self._fail(exc)

    def _write(self, file_obj):
        try:
            with wave.open(file_obj, 'wb') as output:
                output.setnchannels(len(self._channels)); output.setsampwidth(2); output.setframerate(self._samplerate)
                while True:
                    block = self._queue.get()
                    if block is None:
                        break
                    pcm = (np.clip(block, -1.0, 1.0) * 32767.0).astype('<i2')
                    output.writeframesraw(pcm.tobytes())
                    with self._lock:
                        self._frames += len(block)
        except Exception as exc:
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
        self._writer.join()
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
        self._failure = None; self._frames = 0; self._peak = 0.0
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
            failure, frames = self._failure, self._frames
        if failure:
            raise CaptureError(failure + '; partial recording retained at ' + str(self._partial))
        if not frames:
            raise CaptureError('No audio was captured; partial recording retained at ' + str(self._partial))
        try:
            os.rename(self._partial, self._target)
        except OSError as exc:
            raise CaptureError('Could not finalize recording; partial retained at ' + str(self._partial)) from exc
        return str(self._target)
