"""BPM and key analysis for files libsndfile cannot open (MP4, M4V, MOV, VOB, M4A, AAC, WMA, ...).

AXIOM's scanner reads audio with librosa.load / librosa.get_duration. On the Mac those fall back to Core Audio. The
librosa shipped with the Windows build has no fallback at all: libsndfile answers "Format not recognised" for every
video file and every M4A, so Health reported "local BPM analysis could not complete" for them on every scan.

install() puts a fallback behind the two functions. A file libsndfile can read goes exactly the way it always did. Only
when libsndfile refuses a file whose extension is on the list does PyAV (FFmpeg, already used to play these files)
decode the wanted window, and librosa itself resamples it, so the scanner receives what librosa.load would have
returned. The source file is opened read-only. Nothing is written.
"""
import io
import os

import numpy as np
import soundfile as sf

# Extensions the fallback may decode. install() adds the formats the scanner accepts into the Library.
FALLBACK_SUFFIXES = {'.m4a', '.m4b', '.aac', '.mp4', '.m4v', '.mov', '.avi', '.vob', '.mpg', '.mpeg', '.wma', '.wmv',
                     '.mkv', '.webm', '.flv', '.3gp'}
_installed = False


def _wanted(path):
    try:
        return os.path.splitext(os.fspath(path))[1].lower() in FALLBACK_SUFFIXES
    except TypeError:  # an open file object or a SoundFile: never ours
        return False


MP4_SUFFIXES = {'.mp4', '.m4v', '.mov', '.m4a', '.m4b', '.3gp'}
MP4_BOXES = (b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide', b'pnot')


def id3_prefix(path):
    """Bytes of an ID3 tag that a tagging program glued in front of an MP4-family file, else 0.

    Such a file no longer starts with its MP4 header, so FFmpeg refuses it ("Invalid data found"). Everything after the
    tag is the untouched original file, so reading from there on decodes normally."""
    try:
        if os.path.splitext(os.fspath(path))[1].lower() not in MP4_SUFFIXES:
            return 0
        with open(path, 'rb') as handle:
            head = handle.read(10)
            if len(head) < 10 or head[:3] != b'ID3' or any(byte & 0x80 for byte in head[6:10]):
                return 0
            skip = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) + (10 if head[5] & 0x10 else 0)
            handle.seek(skip)
            return skip if handle.read(8)[4:8] in MP4_BOXES else 0
    except (OSError, TypeError):
        return 0


class _Shifted(io.RawIOBase):
    """Read-only view of a file that starts `skip` bytes in."""

    def __init__(self, path, skip):
        super().__init__()
        self._file, self._skip = open(path, 'rb'), skip
        self._file.seek(skip)

    def readable(self): return True
    def seekable(self): return True
    def writable(self): return False
    def tell(self): return self._file.tell() - self._skip
    def read(self, size=-1): return self._file.read(size)

    def readinto(self, buffer):
        return self._file.readinto(buffer)

    def seek(self, offset, whence=os.SEEK_SET):
        if whence == os.SEEK_SET:
            self._file.seek(self._skip + max(0, offset))
        else:
            self._file.seek(offset, whence)
            if self._file.tell() < self._skip:
                self._file.seek(self._skip)
        return self.tell()

    def close(self):
        try:
            self._file.close()
        finally:
            super().close()


class _Opened:
    """An opened container with its first audio stream; close() releases the file."""

    def __init__(self, path):
        import av
        self.av, self._view = av, None
        skip = id3_prefix(path)
        try:
            if skip:
                self._view = _Shifted(path, skip)
                self.container = av.open(self._view, mode='r')
            else:
                self.container = av.open(os.fspath(path), options={'protocol_whitelist': 'file'})
        except BaseException:
            if self._view is not None:
                self._view.close()
            raise
        try:
            if not self.container.streams.audio:
                raise ValueError('no audio stream')
            self.stream = self.container.streams.audio[0]
        except BaseException:
            self.close()
            raise

    def close(self):
        try:
            self.container.close()
        finally:
            if self._view is not None:
                self._view.close()


def _open(path):
    opened = _Opened(path)
    return opened.av, opened, opened.stream


def _stream_seconds(av, container, stream):
    """Length the file states for its audio, or None."""
    if stream.duration is not None and stream.time_base:
        seconds = float(stream.duration * stream.time_base)
        if seconds > 0:
            return seconds
    if container.duration:
        seconds = container.duration / av.time_base
        if seconds > 0:
            return seconds
    return None


def duration_seconds(path):
    """Length of the first audio stream in seconds."""
    av, opened, stream = _open(path)
    container = opened.container
    try:
        seconds = _stream_seconds(av, container, stream)
        if seconds is not None:
            return seconds
        end = 0.0  # the file does not say: read the packet times (nothing is decoded)
        for packet in container.demux(stream):
            if packet.pts is not None and packet.time_base:
                end = max(end, float((packet.pts + (packet.duration or 0)) * packet.time_base))
        if end <= 0:
            raise ValueError('audio length unknown')
        return end
    finally:
        opened.close()


def _decode(path, offset, duration, mono, seek):
    """(samples shaped (channels, n) float32, native rate) for [offset, offset + duration)."""
    av, opened, stream = _open(path)
    container = opened.container
    try:
        rate = int(stream.rate or stream.codec_context.sample_rate or 0)
        if rate <= 0:
            raise ValueError('audio sample rate unknown')
        channels = 1 if mono else max(1, int(stream.codec_context.channels or 1))
        layout = 'mono' if mono else (stream.layout.name if stream.layout and stream.layout.name else 'stereo')
        resampler = av.AudioResampler(format='fltp', layout=layout, rate=rate)
        first = int(round(max(0.0, offset) * rate))                      # first wanted sample
        last = None if duration is None else first + int(round(max(0.0, duration) * rate))
        if seek:
            # Half a second early: the first packets after a seek often give no sound yet (AAC warms up).
            container.seek(int(max(0.0, offset - 0.5) * av.time_base), backward=True, any_frame=False)
        position = None  # index of the next decoded sample, counted from the start of the stream
        # A stream may start late on the file's clock (VOB): count from there. A negative start is encoder priming
        # (AAC): those samples sit before time zero and are dropped, as players do.
        start = max(0.0, float(stream.start_time * stream.time_base)) if stream.start_time is not None and stream.time_base else 0.0
        blocks, have, failure, decoded, lost = [], 0, None, False, False
        for packet in container.demux(stream):
            try:
                frames = packet.decode()
            except av.error.FFmpegError as error:
                # One damaged packet (common in DJ-pool video files) must not lose the song: skip it, as players do.
                failure, lost = failure or error, True
                continue
            for frame in frames:
                stamp = None
                if frame.pts is not None and frame.time_base:
                    stamp = int(round((float(frame.pts * frame.time_base) - start) * rate))
                if position is None:
                    if not seek:
                        position = stamp if stamp is not None else 0
                    elif stamp is None:
                        return None  # no timestamps after a seek: the caller decodes from the start instead
                    elif stamp > first:
                        return None  # the seek landed after the wanted position
                    else:
                        position = stamp
                elif lost and stamp is not None and stamp > position:
                    position = stamp  # samples were lost in a skipped packet: stay in step with the file's clock
                decoded, lost = True, False
                for out in resampler.resample(frame):
                    data = out.to_ndarray()
                    if data.ndim == 1:
                        data = data.reshape(1, -1)
                    begin, end = position, position + data.shape[1]
                    position = end
                    if end <= first:
                        continue
                    lo = max(0, first - begin)
                    hi = data.shape[1] if last is None else min(data.shape[1], last - begin)
                    if hi > lo:
                        blocks.append(np.array(data[:, lo:hi], dtype=np.float32))
                        have += hi - lo
            if last is not None and position is not None and position >= last:
                break
        if not decoded and failure is not None:
            raise failure  # nothing in this file could be decoded
        if not blocks:
            return np.zeros((channels, 0), dtype=np.float32), rate
        return np.concatenate(blocks, axis=1), rate
    finally:
        opened.close()


def load(path, *, sr=22050, mono=True, offset=0.0, duration=None, dtype=np.float32, res_type='soxr_hq'):
    """What librosa.load returns, decoded with PyAV."""
    from librosa.core import audio
    offset = float(offset or 0.0)
    result = _decode(path, offset, duration, mono, seek=True) if offset > 0 else None
    if result is None:
        result = _decode(path, offset, duration, mono, seek=False)
    y, native = result
    if mono:
        y = y[0] if y.shape[0] == 1 else y.mean(axis=0)
    if sr is not None and native != sr:
        y = audio.resample(y, orig_sr=native, target_sr=sr, res_type=res_type)
    else:
        sr = native
    return np.ascontiguousarray(y, dtype=dtype), sr


def install(extra_suffixes=()):
    """Give librosa.load and librosa.get_duration the PyAV fallback. Safe to call more than once."""
    global _installed
    FALLBACK_SUFFIXES.update(str(s).lower() for s in extra_suffixes if str(s).startswith('.'))
    if _installed:
        return
    import librosa  # light: librosa loads its heavy parts only when a function is first used

    def fallback_load(path, *args, **kwargs):
        from librosa.core import audio
        try:
            return audio.load(path, *args, **kwargs)
        except sf.LibsndfileError as error:
            if args or not _wanted(path):
                raise
            try:
                return load(path, **kwargs)
            except Exception:
                raise error from None  # the caller sees the error it always saw

    def fallback_get_duration(*args, **kwargs):
        from librosa.core import audio
        try:
            return audio.get_duration(*args, **kwargs)
        except sf.LibsndfileError as error:
            path = kwargs.get('path')
            if args or path is None or not _wanted(path):
                raise
            try:
                return duration_seconds(path)
            except Exception:
                raise error from None

    librosa.load, librosa.get_duration = fallback_load, fallback_get_duration
    _installed = True
