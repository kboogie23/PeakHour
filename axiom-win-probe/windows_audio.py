"""Experimental Windows replacement for AXIOM's macOS preview-audio deck."""
import os
import threading
import tempfile
import time
from pathlib import Path
import numpy as np
import soundfile as sf
import sounddevice as sd

class WindowsAudioDeck:
    def __init__(self, ffmpeg=None, cache_root=None):
        self._lock = threading.RLock()
        self._transition = threading.RLock()
        self._pending = None
        self._file = self._stream = None
        self._path = self._title = self._artist = ''
        self._deck = 'main'
        self._preview_context = 'library-studio-preview'
        self._volume = 1.0
        self._playing = self._ended = False
        self._error = ''
        self._duration = 0.0
        self._ffmpeg = ffmpeg
        self._cache_root = cache_root
        self._temp_dir = None

    def _open_audio(self, path, cancelled):
        if cancelled.is_set():
            raise RuntimeError('Playback request cancelled')
        try:
            return sf.SoundFile(path, 'r'), None
        except sf.LibsndfileError:
            if Path(path).suffix.lower() not in {'.m4a', '.aac', '.mp4', '.m4v', '.mov', '.avi', '.vob', '.mpg', '.mpeg'}:
                raise
        # Fallback is limited to known local audio containers and a bounded
        # output. It is experimental and does not sandbox the decoder.
        from windows_audio_process import ffmpeg_popen_factory, DEVNULL, TimeoutExpired
        if self._ffmpeg is None:
            import imageio_ffmpeg
            executable = imageio_ffmpeg.get_ffmpeg_exe()
        else:
            executable = self._ffmpeg
        runner = ffmpeg_popen_factory(executable)
        temporary = tempfile.TemporaryDirectory(prefix='axiom-preview-', dir=self._cache_root)
        try:
            before = os.stat(path)
            output = Path(temporary.name)/'decoded.wav'
            maximum = 1024 * 1024 * 1024
            args = [executable, '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file',
                    '-i', os.fspath(path), '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
                    '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', '-fs', str(maximum), str(output)]
            process = runner(args, stdin=DEVNULL, stdout=DEVNULL, stderr=DEVNULL)
            try:
                deadline = time.monotonic() + 120
                while True:
                    if cancelled.is_set() or time.monotonic() >= deadline:
                        raise RuntimeError('Playback request cancelled' if cancelled.is_set() else 'Audio decoding timed out')
                    try:
                        code = process.wait(timeout=0.1)
                        break
                    except TimeoutExpired:
                        pass
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            if code != 0 or not output.is_file():
                raise RuntimeError('Could not decode this audio file')
            after = os.stat(path)
            if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns) != (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
                raise RuntimeError('Audio file changed during decoding')
            if output.stat().st_size >= maximum - 1024*1024:
                raise RuntimeError('Audio is too large for the preview cache')
            return sf.SoundFile(str(output), 'r'), temporary
        except BaseException:
            temporary.cleanup()
            raise

    def _callback(self, output, frames, time_info, status):
        output.fill(0)
        with self._lock:
            if not self._playing or self._file is None:
                return
            try:
                samples = self._file.read(frames, dtype='float32', always_2d=True)
                output[:len(samples), :samples.shape[1]] = samples * self._volume
                if len(samples) < frames:
                    self._playing = False
                    self._ended = True
            except Exception as exc:
                self._playing = False
                self._error = str(exc)

    def play(self, path, title='', artist='', deck='main', start_time=0, preview_context='library-studio-preview'):
        if not os.path.isfile(path):
            raise FileNotFoundError('Audio file not found')
        with self._transition:
            self._stop_locked()
            cancelled = threading.Event()
            self._pending = cancelled
        audio, temporary = self._open_audio(path, cancelled)
        try:
            with self._transition:
                if self._pending is not cancelled or cancelled.is_set():
                    raise RuntimeError('Playback request cancelled')
                device = sd.query_devices(kind='output')
                if audio.channels > device['max_output_channels']:
                    raise ValueError('Audio channel count exceeds output device channels')
                audio.seek(min(len(audio), max(0, int(float(start_time or 0) * audio.samplerate))))
                stream = sd.OutputStream(samplerate=audio.samplerate, channels=audio.channels,
                                         dtype='float32', callback=self._callback)
                with self._lock:
                    self._file, self._stream = audio, stream
                    self._temp_dir = temporary
                    self._path, self._title, self._artist = path, title or os.path.basename(path), artist or ''
                    self._deck, self._preview_context = deck or 'main', preview_context or 'library-studio-preview'
                    self._duration = len(audio) / audio.samplerate
                    self._playing, self._ended, self._error = True, False, ''
                try:
                    stream.start()
                except Exception:
                    self._stop_locked()
                    raise
        except Exception:
            audio.close()
            if temporary is not None: temporary.cleanup()
            raise
        return self.status()

    def pause(self):
        with self._lock: self._playing = False
        return self.status()

    def resume(self):
        with self._lock:
            if self._file is not None:
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
            stream, audio, temporary = self._stream, self._file, self._temp_dir
            self._stream = self._file = None
            self._temp_dir = None
            self._playing = self._ended = False
            self._path = self._title = self._artist = ''
            self._deck, self._preview_context, self._duration = 'main', 'library-studio-preview', 0.0
        try:
            if stream is not None:
                try: stream.stop()
                finally: stream.close()
        finally:
            try:
                if audio is not None: audio.close()
            finally:
                if temporary is not None: temporary.cleanup()

    def seek(self, seconds):
        with self._lock:
            if self._file is not None:
                self._file.seek(min(len(self._file), max(0, int(float(seconds) * self._file.samplerate))))
                self._ended = False
        return self.status()

    def seek_relative(self, delta):
        with self._lock:
            current = self._file.tell() / self._file.samplerate if self._file else 0
            return self.seek(current + float(delta))

    def set_volume(self, volume):
        with self._lock: self._volume = max(0.0, min(1.0, float(volume)))
        return self.status()

    def status(self):
        with self._lock:
            current = self._file.tell() / self._file.samplerate if self._file else 0.0
            return dict(success=True, available=True, playing=self._playing, has_track=self._file is not None,
                        path=self._path, title=self._title, artist=self._artist, deck=self._deck,
                        preview_context=self._preview_context, current_time=current, duration=self._duration,
                        volume=self._volume, ended=self._ended, error=self._error)

