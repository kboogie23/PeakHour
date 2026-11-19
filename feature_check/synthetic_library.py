"""A synthetic big library for the scale checks: ~49,000 songs shaped like the owner's (a 50k-song external-drive
library made the Track Information window hang for minutes), plus a matching VirtualDJ database and history.

  * 1,000 songs point at real (tiny) files in <sandbox>\\synthetic\\Music, so play / source checks have something to open;
  * the rest sit on a drive letter that does not exist on this PC (an unplugged external drive);
  * some names are very long, some are Unicode (accents, CJK, Cyrillic, decomposed forms).

Everything is made inside the sandbox. The same (count, real_files, seed) always gives the same songs.
"""
import json
import os
import random
import shutil
import time
import unicodedata
import uuid
from pathlib import Path
from xml.sax.saxutils import quoteattr

DEFAULT_COUNT = 49000
DEFAULT_REAL = 1000
LABEL_FILE = 'scale.json'   # {"library": "synthetic" | "real copy", "tracks": n, ...} in the sandbox root

WORDS = ('love night fever summer dance groove soul fire heart rain baby money party light dream city blue gold '
         'river midnight honey thunder velvet ocean neon shadow paradise rhythm engine garden silver').split()
UNICODE_WORDS = ['Café del Mar', 'Beyoncé', 'Sigur Rós', 'Motörhead', 'Niño', '宇多田ヒカリ',
                 'Цой', 'Björk', 'Señorita', 'Ångström', 'Zürich', 'ヤマシタ']
GENRES = ['House', 'Funk', 'Disco', 'Hip Hop', 'Pop', 'Rock', 'Techno', 'Soul', 'Latin', 'R&B', 'Reggae', 'Dance']
KEYS = [('Am', '8A'), ('Cm', '5A'), ('F#m', '11A'), ('C', '8B'), ('G', '9B'), ('Dm', '7A'), ('Bb', '6B'), ('Em', '9A')]
ERAS = [(1980, 'Retro 1'), (1990, 'Retro 2'), (2000, 'Retro 3'), (2100, '2k Era')]
LONG_SUFFIX = ' (Extended Club Mix with a very long descriptive name that keeps going and going for the path length test)'
ENERGY = ['Low', 'Mid', 'High']


def missing_drive():
    """A drive letter with nothing behind it (Q: first, then backwards)."""
    for letter in 'QPOKJIHGFEDCBA':
        if not os.path.exists(letter + ':\\'):
            return letter + ':'
    raise RuntimeError('every drive letter is in use')


def _root(sandbox):
    """The sandbox folder, given a Sandbox object (has .root) or the folder itself (a Path also has a .root: the drive)."""
    if isinstance(sandbox, (str, os.PathLike)):
        return Path(sandbox)
    return Path(sandbox.root)


def music_dir(sandbox):
    return Path(sandbox) / 'synthetic' / 'Music'


def make_real_files(sandbox, count=DEFAULT_REAL, names=None):
    """count tiny playable mp3 files (hard links to one generated tone). Returns their paths in order."""
    sandbox = _root(sandbox)
    folder = music_dir(sandbox)
    folder.mkdir(parents=True, exist_ok=True)
    seed = folder.parent / 'seed.mp3'
    if not seed.is_file():
        try:
            from feature_check import media
            media.make_tone(seed, 'mp3', seconds=8.0, tags={'artist': 'Check Artist', 'title': 'Seed'})
        except Exception:  # no ffmpeg here: a file of frame headers is enough for "the file exists" checks
            seed.write_bytes((b'\xff\xfb\x90\x00' + bytes(413)) * 40)
    paths = []
    for index in range(count):
        target = folder / f'{index // 100:03d}' / (names[index] if names else f'real-{index:04d}.mp3')
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            try:
                os.link(seed, target)
            except OSError:
                shutil.copyfile(seed, target)
        paths.append(str(target))
    return paths


def make_named_files(sandbox, folder, filenames):
    """Tiny music files with exactly these names in folder (a music folder 'where the music is now'). Returns the count."""
    sandbox = _root(sandbox)
    make_real_files(sandbox, 0)                       # makes the seed file
    seed = music_dir(sandbox).parent / 'seed.mp3'
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    made = 0
    for name in filenames:
        target = folder / name
        if target.exists():
            continue
        try:
            os.link(seed, target)
        except OSError:
            shutil.copyfile(seed, target)
        made += 1
    return made


def _name_parts(index, rng):
    """(artist, title) for song number index: plain, long or Unicode."""
    artist = f'{rng.choice(WORDS).title()} {rng.choice(WORDS).title()} {index % 997}'
    title = f'{rng.choice(WORDS).title()} {rng.choice(WORDS).title()} {index}'
    if index % 53 == 7:
        artist = rng.choice(UNICODE_WORDS)
        title = f'{rng.choice(UNICODE_WORDS)} {index}'
        if index % 2:
            title = unicodedata.normalize('NFD', title)   # decomposed accents, as macOS-made files have them
    if index % 97 == 11:
        title += LONG_SUFFIX
    return artist, title


def make_tracks(count=DEFAULT_COUNT, real_paths=(), drive=None, seed=7):
    """The library rows. The first len(real_paths) songs are real files (titled 'Real Song 0001', artist
    'Check Artist', findable by searching 'real song'); the others live on <drive>\\Music\\...
    """
    rng = random.Random(seed)
    drive = drive or missing_drive()
    batch = uuid.UUID(int=rng.getrandbits(128)).hex
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    tracks = []
    for index in range(count):
        real = index < len(real_paths)
        if real:
            path = real_paths[index]
            artist, title = 'Check Artist', f'Real Song {index + 1:04d}'
        else:
            artist, title = _name_parts(index, rng)
            path = f'{drive}\\Music\\{GENRES[index % len(GENRES)]}\\{index // 500:03d}\\{artist} - {title}.mp3'
        key_raw, camelot = KEYS[index % len(KEYS)]
        bpm = round(rng.uniform(70, 150), 1) if index % 11 else None          # some songs have no BPM yet
        year = rng.choice([None, None] + list(range(1965, 2026)))
        era = 'Unknown'
        if year:
            era = next(name for limit, name in ERAS if year < limit)
        tracks.append({
            'path': path, 'filename': path.rsplit('\\', 1)[-1], 'folder': path.rsplit('\\', 2)[-2],
            'title': title, 'artist': artist, 'album': f'Album {index % 3000}', 'genre': GENRES[index % len(GENRES)],
            'comments': '', 'label': '', 'bpm': bpm, 'camelot': camelot if index % 7 else None,
            'key_raw': key_raw if index % 7 else '', 'energy': ENERGY[index % 3] if bpm else 'Unknown',
            'year': year, 'era': era, 'playlist_names': [], 'cue_count': index % 4, 'beatgrid_locked': False,
            'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': not real,
            'axiom_first_seen_at': stamp, 'axiom_import_batch_id': batch, 'axiom_import_source': 'virtualdj',
            'file_size': 4000000 + index,
        })
    return tracks


def write_library(runtime, tracks):
    """<runtime>\\data\\library_cache.json, written whole then renamed."""
    data = Path(runtime) / 'data'
    data.mkdir(parents=True, exist_ok=True)
    target = data / 'library_cache.json'
    temp = data / 'library_cache.json.writing'
    temp.write_text(json.dumps({'tracks': tracks, 'total_tracks': len(tracks), 'folder_structure': {}}, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, target)
    return target


def write_database(path, tracks):
    """A VirtualDJ database.xml with the same songs (one <Song> per track) - 49k of them parse like the owner's."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as out:
        out.write('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="2024">\n')
        for track in tracks:
            bpm = track.get('bpm') or 120.0
            out.write('<Song FilePath=%s FileSize=%s><Tags Author=%s Title=%s Genre=%s Year=%s/><Infos SongLength="200.0"/>'
                      '<Scan Bpm="%.6f" Key=%s/><Poi Pos="0.1" Type="beatgrid"/></Song>\n'
                      % (quoteattr(track['path']), quoteattr(str(track.get('file_size', 9000000))), quoteattr(track['artist']),
                         quoteattr(track['title']), quoteattr(track.get('genre', '')), quoteattr(str(track.get('year') or '')),
                         60.0 / bpm, quoteattr(track.get('key_raw') or 'Am')))
        out.write('</VirtualDJ_Database>\n')
    return path


def vdj_home(sandbox_local):
    return Path(sandbox_local) / 'VirtualDJ'


def install(sandbox, count=DEFAULT_COUNT, real=DEFAULT_REAL, seed=7, label='synthetic'):
    """Make the real files and the library cache inside the sandbox; returns a description dict (also saved as scale.json).
    sandbox is a feature_check.sandbox.Sandbox (.root, .runtime) or just the sandbox folder."""
    root = _root(sandbox)
    runtime = Path(getattr(sandbox, 'runtime', None) or root / 'AppData' / 'Local' / 'AXIOM DJ') if not isinstance(sandbox, (str, os.PathLike)) else root / 'AppData' / 'Local' / 'AXIOM DJ'
    t0 = time.perf_counter()
    real = min(real, count)
    drive = missing_drive()
    names = []
    rng = random.Random(seed + 1)
    for index in range(real):                                    # a few real files have accents / long names too
        name = f'real-{index:04d}.mp3'
        if index % 10 == 3:
            name = f'Café 宇多田 {index:04d}.mp3'
        elif index % 25 == 4:
            name = f'real-{index:04d}' + ' long-name' * 12 + '.mp3'
        names.append(name)
    real_paths = make_real_files(root, real, names)
    tracks = make_tracks(count, real_paths, drive, seed)
    target = write_library(runtime, tracks)
    info = {'library': label, 'tracks': count, 'real_files': real, 'missing_drive': drive, 'cache': str(target),
            'cache_mb': round(target.stat().st_size / 1048576, 1), 'seed': seed, 'seconds': round(time.perf_counter() - t0, 1)}
    (root / LABEL_FILE).write_text(json.dumps(info), encoding='utf-8')
    return info


def current(sandbox_root):
    """What the sandbox library is ({'library','tracks',...}) or None when nothing was installed."""
    try:
        return json.loads((Path(sandbox_root) / LABEL_FILE).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


if __name__ == '__main__':       # python -m feature_check.synthetic_library <folder> [count]
    import sys
    from types import SimpleNamespace
    folder = Path(sys.argv[1])
    box = SimpleNamespace(root=folder, runtime=folder / 'AppData' / 'Local' / 'AXIOM DJ')
    print(json.dumps(install(box, int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_COUNT), indent=1))
