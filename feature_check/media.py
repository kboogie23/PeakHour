"""Generated media for feature checks: tones, a short video, embedded artwork, a fake VirtualDJ home.
Everything is made with the ffmpeg that ships with the app (imageio_ffmpeg); nothing of the owner's is read."""
import os
import time
import pathlib
import subprocess

_FFMPEG = []


def ffmpeg():
    if not _FFMPEG:
        import imageio_ffmpeg
        _FFMPEG.append(imageio_ffmpeg.get_ffmpeg_exe())
    return _FFMPEG[0]


def run_ffmpeg(*args, timeout=120):
    cmd = [ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y'] + [str(a) for a in args]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if done.returncode != 0:
        raise RuntimeError('ffmpeg failed: %s\n%s' % (' '.join(cmd[-6:]), done.stderr[-600:]))


CODECS = {
    'mp3': ['-c:a', 'libmp3lame', '-b:a', '128k'],
    'wav': ['-c:a', 'pcm_s16le'],
    'flac': ['-c:a', 'flac'],
    'm4a': ['-c:a', 'aac', '-b:a', '128k'],
}


def make_tone(path, fmt=None, seconds=3.0, freq=440, tags=None):
    """A sine tone. fmt defaults to the file extension (mp3, wav, flac, m4a). tags: {'artist': .., 'title': ..}."""
    path = pathlib.Path(path)
    fmt = (fmt or path.suffix.lstrip('.')).lower()
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = []
    for key, value in (tags or {}).items():
        meta += ['-metadata', '%s=%s' % (key, value)]
    run_ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=%s:duration=%s:sample_rate=44100' % (freq, seconds), '-ac', '2',
               *CODECS[fmt], *meta, path)
    return path


def make_mp4(path, seconds=3):
    """A small H.264 + AAC video (colour bars and a tone)."""
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=%s' % seconds,
               '-f', 'lavfi', '-i', 'sine=frequency=330:duration=%s:sample_rate=44100' % seconds,
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path)
    return path


def make_cover(path, colour='0x2266cc', size=300):
    path = pathlib.Path(path)
    run_ffmpeg('-f', 'lavfi', '-i', 'color=c=%s:s=%dx%d' % (colour, size, size), '-frames:v', '1', path)
    return path


def make_mp3_with_art(path, seconds=3.0, tags=None):
    """An mp3 with an embedded JPEG cover (ID3 APIC)."""
    path = pathlib.Path(path)
    plain = path.with_name(path.stem + '.plain.mp3')
    cover = path.with_name(path.stem + '.cover.jpg')
    make_tone(plain, 'mp3', seconds, tags=tags)
    make_cover(cover)
    run_ffmpeg('-i', plain, '-i', cover, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-id3v2_version', '3',
               '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', path)
    plain.unlink()
    cover.unlink()
    return path


def make_all(folder, seconds=3.0):
    """One of each kind in folder; returns {name: path}."""
    folder = pathlib.Path(folder)
    out = {}
    for fmt in ('mp3', 'wav', 'flac', 'm4a'):
        out[fmt] = make_tone(folder / ('tone.' + fmt), fmt, seconds, tags={'artist': 'Check Artist', 'title': 'Tone ' + fmt})
    out['mp4'] = make_mp4(folder / 'clip.mp4', 3)
    out['art_mp3'] = make_mp3_with_art(folder / 'with-art.mp3', seconds, tags={'artist': 'Check Artist', 'title': 'With Art'})
    return out


def make_vdj_home(local_appdata, history_tracks=None, running_seconds_ago=60):
    """A fake VirtualDJ home under <LOCALAPPDATA>\\VirtualDJ: settings.xml + History\\<today>.m3u.
    history_tracks: list of (artist, title, path); the last one is the 'now playing' entry."""
    home = pathlib.Path(local_appdata) / 'VirtualDJ'
    (home / 'History').mkdir(parents=True, exist_ok=True)
    (home / 'settings.xml').write_text('<?xml version="1.0"?><VirtualDJ_Settings/>', encoding='utf-8')
    history = home / 'History' / (time.strftime('%Y-%m-%d') + '.m3u')
    lines = []
    count = len(history_tracks or [])
    for index, (artist, title, path) in enumerate(history_tracks or []):
        when = int(time.time()) - running_seconds_ago * (count - index)
        lines.append('#EXTVDJ:<time>%s</time><lastplaytime>%d</lastplaytime><artist>%s</artist><title>%s</title><songlength>180.0</songlength>\n%s\n'
                     % (time.strftime('%H:%M', time.localtime(when)), when, artist, title, path))
    history.write_text(''.join(lines), encoding='utf-8')
    return home, history


def append_vdj_history(history, artist, title, path):
    when = int(time.time())
    with open(history, 'a', encoding='utf-8') as handle:
        handle.write('#EXTVDJ:<time>%s</time><lastplaytime>%d</lastplaytime><artist>%s</artist><title>%s</title><songlength>180.0</songlength>\n%s\n'
                     % (time.strftime('%H:%M'), when, artist, title, path))
