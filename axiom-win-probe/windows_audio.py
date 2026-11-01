"""Experimental Windows replacement for AXIOM's macOS preview-audio deck."""
import os
import threading
from pathlib import Path
import numpy as np
import soundfile as sf
import sounddevice as sd

class NoAudioDeck:
    """Stands in for the deck in a laptop's engine: nothing plays on this PC's speakers."""

    def _refuse(self, *args, **kwargs):
        raise PermissionError('Audio playback on the PEAK HOUR PC is not available from another laptop.')

    play = pause = resume = stop = seek = seek_relative = set_volume = _refuse

    def status(self):
        return dict(success=False, available=False, playing=False, has_track=False, error='Not available on this library.')


# Containers libsndfile cannot read; PyAV (FFmpeg) decodes them while they play.
STREAMED_SUFFIXES = {'.m4a', '.aac', '.mp4', '.m4v', '.mov', '.avi', '.vob', '.mpg', '.mpeg'}
RING_SECONDS = 2.0       # decoded audio the reader keeps ahead of the speakers
PREBUFFER_SECONDS = 0.1  # the callback stays silent until this much is ready (or the file ended)
READ_FRAMES = 4096


class _FileSource:
    """libsndfile source (WAV, FLAC, AIFF, MP3, Ogg). Used only by the reader thread."""

    def __init__(self, path):
        self._file = sf.SoundFile(path, 'r')
        self.samplerate, self.channels = self._file.samplerate, self._file.channels
        self.length = len(self._file)
        self.duration = self.length / self.samplerate

    def read(self, frames):
        return self._file.read(frames, dtype='float32', always_2d=True)

    def seek(self, frame):
        self._file.seek(min(self.length, max(0, frame)))

    def close(self):
        self._file.close()


class _StreamSource:
    """PyAV source: decodes AAC/M4A/MP4 as it is read instead of converting the whole file first."""

    def __init__(self, path, samplerate=None):
        import av
        self._av = av
        try:
            self._container = av.open(os.fspath(path), options={'protocol_whitelist': 'file'})
        except Exception as exc:
            raise RuntimeError('Could not decode this audio file') from exc
        try:
            if not self._container.streams.audio:
                raise RuntimeError('Could not decode this audio file')
            self._stream = self._container.streams.audio[0]
            self.samplerate = int(samplerate or self._stream.rate or self._stream.codec_context.sample_rate or 44100)  # PyAV resamples to this
            self.channels = 2
            seconds = None
            if self._stream.duration is not None and self._stream.time_base:
                seconds = float(self._stream.duration * self._stream.time_base)
            elif self._container.duration:
                seconds = self._container.duration / av.time_base
            self.duration = max(0.0, seconds or 0.0)
            self.length = int(self.duration * self.samplerate)
            self._skip, self._target, self._started = 0, None, False
            self._reset()
        except BaseException:
            self._container.close()
            raise

    def _reset(self):
        self._resampler = self._av.AudioResampler(format='flt', layout='stereo', rate=self.samplerate)
        self._frames = self._container.decode(self._stream)
        self._flushed = False

    def _next(self):
        """Next block of decoded float32 stereo samples, or None at the end of the file."""
        while not self._flushed:
            frame = None
            try:
                frame = next(self._frames)
                out = self._resampler.resample(frame)
            except StopIteration:
                self._flushed = True
                out = self._resampler.resample(None)
            for item in out:
                data = item.to_ndarray().reshape(-1, 2).astype('float32', copy=False)
                if self._target is not None:  # first block after a seek: drop what comes before the wanted position
                    if frame is not None and frame.pts is not None and frame.time_base:
                        self._skip = max(0, self._target - int(round(float(frame.pts * frame.time_base) * self.samplerate)))
                    self._target = None
                if self._skip:
                    drop = min(self._skip, len(data))
                    data, self._skip = data[drop:], self._skip - drop
                if len(data):
                    return data
        return None

    def read(self, frames):
        self._started = True
        block = self._next()
        return np.zeros((0, 2), dtype='float32') if block is None else block

    def seek(self, frame):
        frame = max(0, frame)
        if self.length: frame = min(self.length, frame)
        if frame == 0 and not self._started:
            return
        self._container.seek(int(frame * 1000000 / self.samplerate), backward=True, any_frame=False)
        self._reset()
        self._skip, self._target, self._started = 0, frame, True

    def close(self):
        self._container.close()


class _Ring:
    """Single-producer/single-consumer buffer: the reader thread writes, the audio callback reads.
    Neither side takes a lock; each counter has exactly one writer."""

    def __init__(self, samplerate, channels, start):
        self.capacity = max(1024, int(samplerate * RING_SECONDS))
        self.data = np.zeros((self.capacity, channels), dtype='float32')
        self.channels, self.start = channels, start
        self.prebuffer = int(samplerate * PREBUFFER_SECONDS)
        self.written = self.read = 0  # frames since `start`
        self.eof = self.primed = False

    def write(self, block):
        count = min(len(block), self.capacity - (self.written - self.read))
        if count <= 0: return 0
        index = self.written % self.capacity
        first = min(count, self.capacity - index)
        self.data[index:index + first] = block[:first]
        if count > first: self.data[:count - first] = block[first:count]
        self.written += count
        return count

    def pull(self, output, volume):
        """Copy what is ready into `output` (already silent); returns the number of frames."""
        ready = self.written - self.read
        if not self.primed:
            if ready < self.prebuffer and not self.eof: return 0
            self.primed = True
        count = min(len(output), ready)
        if count <= 0: return 0
        index = self.read % self.capacity
        first = min(count, self.capacity - index)
        np.multiply(self.data[index:index + first], volume, out=output[:first, :self.channels])
        if count > first: np.multiply(self.data[:count - first], volume, out=output[first:count, :self.channels])
        self.read += count
        return count


class WindowsAudioDeck:
    # ffmpeg and cache_root are accepted for compatibility; decoding is streamed in-process and writes no files.
    def __init__(self, ffmpeg=None, cache_root=None):
        self._lock = threading.RLock()  # HTTP threads only; neither the callback nor the reader ever takes it
        self._transition = threading.RLock()
        self._pending = None
        self._stream = self._ring = self._reader = None
        self._path = self._title = self._artist = ''
        self._deck = 'main'
        self._preview_context = 'library-studio-preview'
        self._volume = 1.0
        self._playing = self._ended = False
        self._error = ''
        self._duration = 0.0
        self._samplerate = 0

    def _open_audio(self, path, cancelled):
        if cancelled.is_set():
            raise RuntimeError('Playback request cancelled')
        try:
            return _FileSource(path)
        except sf.LibsndfileError:
            if Path(path).suffix.lower() not in STREAMED_SUFFIXES:
                raise
        # Fallback is limited to known local audio containers. It is experimental and does not sandbox the decoder.
        try:
            rate = int(sd.query_devices(kind='output').get('default_samplerate') or 0) or None
        except Exception:
            rate = None
        source = _StreamSource(path, rate)
        if cancelled.is_set():
            source.close()
            raise RuntimeError('Playback request cancelled')
        return source

    def _callback(self, output, frames, time_info, status):
        # Runs on the PortAudio thread: no locks, no file or decoder access, never waits. It copies what the
        # reader thread has already buffered and plays silence for the rest (start, seek, or a slow disk).
        output.fill(0)
        ring = self._ring
        if ring is None or not self._playing:
            return
        if ring.pull(output, self._volume) < frames and ring.eof and ring.read >= ring.written:
            self._playing = False
            self._ended = True

    def _read_loop(self, source, stop):
        """Reader thread: owns the source, keeps the current ring full, re-seeks when the ring is replaced."""
        ring = block = None
        offset = 0
        finished = False
        try:
            while not stop.is_set():
                current = self._ring
                if current is None:
                    stop.wait(0.01)
                    continue
                if current is not ring:
                    ring, block, offset, finished = current, None, 0, False
                    source.seek(ring.start)
                if finished:
                    stop.wait(0.01)
                    continue
                if block is None:
                    block, offset = source.read(READ_FRAMES), 0
                    if len(block) == 0:
                        ring.eof, finished, block = True, True, None
                        continue
                offset += ring.write(block[offset:])
                if offset >= len(block):
                    block = None
                else:
                    stop.wait(0.005)
        except Exception as exc:
            if ring is not None and ring is self._ring:  # not a leftover reader of an earlier track
                self._error = str(exc)
                self._playing = False
                ring.eof = True
        finally:
            source.close()

    def play(self, path, title='', artist='', deck='main', start_time=0, preview_context='library-studio-preview'):
        if not os.path.isfile(path):
            raise FileNotFoundError('Audio file not found')
        with self._transition:
            self._stop_locked()
            cancelled = threading.Event()
            self._pending = cancelled
        source = self._open_audio(path, cancelled)
        handed_over = False
        try:
            with self._transition:
                if self._pending is not cancelled or cancelled.is_set():
                    raise RuntimeError('Playback request cancelled')
                device = sd.query_devices(kind='output')
                if source.channels > device['max_output_channels']:
                    raise ValueError('Audio channel count exceeds output device channels')
                start = max(0, int(float(start_time or 0) * source.samplerate))
                if source.length: start = min(source.length, start)  # unknown duration: no clamp
                ring = _Ring(source.samplerate, source.channels, start)
                stream = sd.OutputStream(samplerate=source.samplerate, channels=source.channels,
                                         dtype='float32', callback=self._callback)
                stop = threading.Event()
                reader = threading.Thread(target=self._read_loop, args=(source, stop), name='peakhour-audio-reader', daemon=True)
                with self._lock:
                    self._stream, self._ring, self._reader = stream, ring, (reader, stop)
                    self._samplerate = source.samplerate
                    self._path, self._title, self._artist = path, title or os.path.basename(path), artist or ''
                    self._deck, self._preview_context = deck or 'main', preview_context or 'library-studio-preview'
                    self._duration = source.duration
                    self._playing, self._ended, self._error = True, False, ''
                handed_over = True
                reader.start()  # owns (and closes) the source from here on
                try:
                    stream.start()
                except Exception:
                    self._stop_locked()
                    raise
        except Exception:
            if not handed_over: source.close()
            raise
        return self.status()

    def pause(self):
        self._playing = False
        return self.status()

    def resume(self):
        with self._lock:
            if self._ring is not None:
                self._playing, self._ended = True, False
        return self.status()

    def stop(self):
        with self._transition:
            self._stop_locked()
        return self.status()

    def _stop_locked(self):
        if self._pending is not None:
            self._pending.set()
            self._pending = None
        with self._lock:
            stream, reader = self._stream, self._reader
            self._stream = self._ring = self._reader = None
            self._playing = self._ended = False
            self._path = self._title = self._artist = ''
            self._deck, self._preview_context, self._duration = 'main', 'library-studio-preview', 0.0
        try:
            if stream is not None:
                try: stream.stop()
                finally: stream.close()
        finally:
            if reader is not None:
                reader[1].set()
                reader[0].join(5)  # the reader closes the file/decoder as it exits

    def seek(self, seconds):
        with self._lock:
            old = self._ring
            if old is not None:
                # A fresh ring tells the reader to re-seek; the callback plays silence until it has data.
                frame = max(0, int(float(seconds) * self._samplerate))
                if self._duration: frame = min(int(self._duration * self._samplerate), frame)
                self._ring = _Ring(self._samplerate, old.channels, frame)
                self._ended = False
        return self.status()

    def seek_relative(self, delta):
        with self._lock:
            return self.seek(self._position() + float(delta))

    def _position(self):
        ring = self._ring
        if ring is None or not self._samplerate: return 0.0
        seconds = (ring.start + ring.read) / self._samplerate
        return min(seconds, self._duration) if self._duration else seconds

    def set_volume(self, volume):
        with self._lock: self._volume = max(0.0, min(1.0, float(volume)))
        return self.status()

    def status(self):
        with self._lock:
            return dict(success=True, available=True, playing=self._playing, has_track=self._ring is not None,
                        path=self._path, title=self._title, artist=self._artist, deck=self._deck,
                        preview_context=self._preview_context, current_time=self._position(), duration=self._duration,
                        volume=self._volume, ended=self._ended, error=self._error)
