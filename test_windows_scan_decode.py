"""BPM/key analysis of files libsndfile cannot open (windows_scan_decode).

The Windows build's librosa has no fallback decoder: librosa.load raised "Format not recognised" for every MP4, M4V, MOV,
VOB, M4A and WMA, so Health said "local BPM analysis could not complete" for them on every scan. Checked here:
  before install: librosa.load / get_duration refuse an .m4a (the bug)
  after install:  same calls return what librosa returns for the WAV the .m4a was made from (rate, shape, length, timing)
  offset / duration windows land on the right part of the song; sr=None and mono=False keep the native rate and channels
  an MP4-family file with an ID3 tag glued in front (FFmpeg refuses it) decodes the same as the clean file
  a file with a damaged stretch still decodes around the damage
  WAV still goes the original way (the fallback is not called); a non-media file and an unlisted suffix raise as before
  the scanner's own section reader works on the .m4a; the bootstrap installs the fallback; sources are not modified
Files are synthesised in a temp folder with the bundled FFmpeg. Nothing of the owner's is touched."""
import hashlib, os, pathlib, shutil, subprocess, sys, tempfile

workspace = pathlib.Path(__file__).resolve().parent
probe = workspace / 'axiom-win-probe'
sys.path.insert(0, str(probe))
os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')

try:
    import numpy as np, soundfile as sf, librosa, av, imageio_ffmpeg  # noqa: E401
except ImportError as exc:
    print('SKIP: audio libraries not installed (%s)' % exc)
    sys.exit(0)
import windows_scan_decode as D

base = pathlib.Path(tempfile.mkdtemp(prefix='phdec_'))
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()


def run(*args):
    done = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', *map(str, args)], capture_output=True,
                          creationflags=0x08000000 if os.name == 'nt' else 0)
    assert done.returncode == 0, done.stderr.decode('utf-8', 'replace')[:600]


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(), os.stat(path).st_mtime_ns


def lag_seconds(a, b, sr, span=0.25):
    """How far b is shifted against a (seconds), by cross-correlation over +-span."""
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    reach = int(span * sr)
    best = max(range(-reach, reach + 1, 4), key=lambda k: float(np.dot(a[max(0, k):n + min(0, k)], b[max(0, -k):n - max(0, k)])))
    return best / sr


def envelope(x, window=4096, hop=1024):
    """Loudness curve, coarse enough that a few milliseconds of codec delay do not matter."""
    return np.array([float(np.sqrt(np.mean(x[i:i + window] ** 2))) for i in range(0, max(1, len(x) - window), hop)])


try:
    # 40 s stereo: a click every 0.5 s (120 BPM) on a tone whose pitch changes every 5 s, so each window is recognisable.
    rate, seconds = 44100, 40
    t = np.arange(rate * seconds) / rate
    tone = 0.25 * np.sin(2 * np.pi * (220 + 55 * (t // 5)) * t)
    click = np.zeros_like(t)
    for beat in np.arange(0, seconds, 0.5):
        i = int(beat * rate)
        click[i:i + 400] += 0.6 * np.hanning(400)
    wav = base / 'song.wav'
    sf.write(wav, np.stack([tone + click, 0.5 * tone + click], axis=1).astype('float32'), rate)
    m4a, mp4, wma = base / 'song.m4a', base / 'video.mp4', base / 'song.wma'
    run('-i', wav, '-c:a', 'aac', '-b:a', '192k', m4a)
    run('-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=%d' % seconds, '-i', wav, '-c:v', 'mpeg4', '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4)
    run('-i', wav, '-c:a', 'wmav2', '-b:a', '192k', wma)
    before = {p: digest(p) for p in (wav, m4a, mp4, wma)}

    # --- the bug: without the fallback librosa refuses the file
    for call in (lambda: librosa.load(m4a), lambda: librosa.get_duration(path=m4a)):
        try:
            call()
            raise AssertionError('librosa read an .m4a without the fallback: this test no longer shows the bug')
        except sf.LibsndfileError:
            pass

    D.install(('.mp3', 'wav', '.M4A'))
    D.install()  # twice: harmless
    assert '.mp3' in D.FALLBACK_SUFFIXES and '.m4a' in D.FALLBACK_SUFFIXES and 'wav' not in D.FALLBACK_SUFFIXES
    from librosa.core import audio
    assert librosa.load is not audio.load and librosa.get_duration is not audio.get_duration

    # --- whole file: same rate, shape and timing as the WAV it was made from
    ref, ref_sr = librosa.load(wav)
    for name, path in (('m4a', m4a), ('mp4', mp4), ('wma', wma)):
        y, sr = librosa.load(path)
        assert sr == ref_sr == 22050 and y.ndim == 1 and y.dtype == np.float32, (name, sr, y.shape, y.dtype)
        assert abs(len(y) - len(ref)) <= 0.15 * sr, (name, len(y), len(ref))
        assert abs(lag_seconds(ref, y, sr)) <= 0.06, (name, lag_seconds(ref, y, sr))
        assert abs(librosa.get_duration(path=path) - seconds) <= 0.2, (name, librosa.get_duration(path=path))
        n = min(len(y), len(ref))
        assert float(np.corrcoef(envelope(ref[:n]), envelope(y[:n]))[0, 1]) > 0.6, name  # the same clicks in the same places

    # --- windows: the right part of the song, the right length
    for offset, duration in ((7.0, 6.0), (21.5, 10.0), (33.0, 5.0)):
        want, _ = librosa.load(wav, offset=offset, duration=duration)
        for name, path in (('m4a', m4a), ('mp4', mp4), ('wma', wma)):
            got, sr = librosa.load(path, offset=offset, duration=duration, mono=True)
            assert abs(len(got) - len(want)) <= 0.05 * sr, (name, offset, len(got), len(want))
            assert abs(lag_seconds(want, got, sr)) <= 0.06, (name, offset, lag_seconds(want, got, sr))
            n = min(len(want), len(got))
            assert float(np.corrcoef(envelope(want[:n]), envelope(got[:n]))[0, 1]) > 0.6, (name, offset)
    tail, sr = librosa.load(m4a, offset=38.0, duration=22.0)  # asks past the end: what is left, like librosa
    assert 1.5 * sr <= len(tail) <= 2.2 * sr, len(tail)
    empty, _ = librosa.load(m4a, offset=500.0, duration=5.0)
    assert len(empty) == 0
    stereo, native = librosa.load(m4a, sr=None, mono=False, offset=3.0, duration=2.0)
    assert native == rate and stereo.shape[0] == 2 and abs(stereo.shape[1] - 2 * rate) <= 64, (native, stereo.shape)
    assert float(np.abs(stereo[0]).mean()) > float(np.abs(stereo[1]).mean()) * 1.05  # left carries the louder tone: channels kept apart
    # seeking and decoding from the start give the same samples
    a, b = D._decode(m4a, 20.0, 4.0, True, True), D._decode(m4a, 20.0, 4.0, True, False)
    assert a is not None and a[0].shape == b[0].shape and float(np.abs(a[0][:, 4096:] - b[0][:, 4096:]).max()) < 1e-3

    # --- an ID3 tag glued in front of an MP4-family file
    tag_body = b'TIT2' + (17).to_bytes(4, 'big') + b'\x00\x00' + b'\x00Glued-on title\x00\x00' + b'\x00' * 1000
    size = len(tag_body)
    header = b'ID3\x03\x00\x00' + bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    glued = base / 'glued.m4v'
    glued.write_bytes(header + tag_body + mp4.read_bytes())
    assert D.id3_prefix(glued) == 10 + size and D.id3_prefix(mp4) == 0 and D.id3_prefix(wav) == 0
    try:
        av.open(str(glued)).close()
        raise AssertionError('FFmpeg opened the glued file by itself: the test file does not show the problem')
    except av.error.FFmpegError:
        pass
    clean, _ = librosa.load(mp4, offset=12.0, duration=8.0)
    fixed, _ = librosa.load(glued, offset=12.0, duration=8.0)
    assert clean.shape == fixed.shape and float(np.abs(clean - fixed).max()) < 1e-6
    assert abs(librosa.get_duration(path=glued) - seconds) <= 0.2
    mp3ish = base / 'tagged.mp4'  # "ID3" followed by something that is not an MP4: left alone
    mp3ish.write_bytes(header + tag_body + b'\xff\xfb\x90\x00' * 4000)
    assert D.id3_prefix(mp3ish) == 0
    glued_before = digest(glued)

    # --- a damaged stretch in the middle: the rest still decodes
    data = bytearray(m4a.read_bytes())
    middle = len(data) // 2
    data[middle:middle + 40000] = os.urandom(40000)
    hurt = base / 'hurt.m4a'
    hurt.write_bytes(bytes(data))
    y, sr = librosa.load(hurt)
    assert len(y) >= 0.8 * len(ref), (len(y), len(ref))
    early, _ = librosa.load(hurt, offset=2.0, duration=5.0)
    want, _ = librosa.load(wav, offset=2.0, duration=5.0)
    assert abs(lag_seconds(want, early, sr)) <= 0.06

    # --- everything else behaves as before
    calls = []
    real_load, real_duration = D.load, D.duration_seconds
    D.load = lambda *a, **k: (calls.append('load'), real_load(*a, **k))[1]
    D.duration_seconds = lambda *a, **k: (calls.append('duration'), real_duration(*a, **k))[1]
    try:
        again, sr2 = librosa.load(wav, offset=7.0, duration=6.0)
        direct, _ = audio.load(wav, offset=7.0, duration=6.0)
        assert np.array_equal(again, direct) and librosa.get_duration(path=wav) == audio.get_duration(path=wav)
        assert librosa.get_duration(y=ref, sr=ref_sr) == audio.get_duration(y=ref, sr=ref_sr)
        assert calls == [], calls  # the fallback was never asked for a file libsndfile reads
        junk = base / 'junk.mp4'
        junk.write_bytes(os.urandom(200000))
        other = base / 'song.xyz'
        shutil.copyfile(m4a, other)
        for path, expect_calls in ((junk, True), (other, False)):
            del calls[:]
            for call in (lambda: librosa.load(path), lambda: librosa.get_duration(path=path)):
                try:
                    call()
                    raise AssertionError('no error for %s' % path.name)
                except sf.LibsndfileError:  # the error the scanner has always handled
                    pass
            assert bool(calls) == expect_calls, (path.name, calls)
        with open(wav, 'rb') as handle:  # open file objects are passed straight through
            y, _ = librosa.load(handle, duration=1.0)
            assert len(y) == 22050
    finally:
        D.load, D.duration_seconds = real_load, real_duration

    # --- the scanner's own reader, and the wiring
    import scanner
    sections = scanner._decode_librosa_sections(str(m4a))
    assert sections, 'scanner returned nothing for the .m4a'
    assert scanner.LIBROSA_ENGINE is librosa and scanner.LIBROSA_ENGINE.load is librosa.load
    text = (probe / 'windows_bootstrap.py').read_text(encoding='utf-8')
    assert 'from windows_scan_decode import install as install_scan_decode' in text and 'install_scan_decode(' in text
    assert text.index('install_intake(app)') < text.index('install_scan_decode(')

    for path, was in list(before.items()) + [(glued, glued_before)]:
        assert digest(path) == was, 'source changed: %s' % path.name
finally:
    shutil.rmtree(base, ignore_errors=True)
print('PASS: BPM/key analysis decodes M4A, MP4 and WMA through PyAV when libsndfile refuses them (same rate, length and timing as librosa on the WAV), '
      'reads past a glued-on ID3 tag and around a damaged stretch, leaves WAV and unknown files exactly as before, works in the scanner, is installed by the bootstrap, sources untouched')
