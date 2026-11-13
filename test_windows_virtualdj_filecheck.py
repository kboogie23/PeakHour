"""The VirtualDJ connect checks every song's file from one listing per folder; its answers match os.path.isfile."""
import ntpath
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'axiom-win-probe'))
from windows_virtualdj_library import file_checker

with tempfile.TemporaryDirectory(prefix='phvfc') as base:
    base = Path(base)
    music = base / 'Music' / 'Long Folder Name'
    music.mkdir(parents=True)
    for name in ('One.mp3', 'Two Words.MP3', 'Ünïcode.flac', 'a' * 20 + '.mp3'):
        (music / name).write_bytes(b'x')
    (music / 'sub.mp3').mkdir()  # a folder with a song-like name is not a file
    junction = base / 'Junction'
    subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(music)], capture_output=True, check=True)
    short = subprocess.run(['cmd', '/c', 'for %I in ("' + str(music / ('a' * 20 + '.mp3')) + '") do @echo %~sI'],
                           capture_output=True, text=True).stdout.strip()
    cases = [str(music / 'One.mp3'), str(music / 'one.MP3'), str(music / 'Two Words.MP3'), str(music / 'Ünïcode.flac'),
             str(music / 'Missing.mp3'), str(music / 'sub.mp3'), str(base / 'Gone' / 'x.mp3'), 'Q:\\nothing\\x.mp3',
             str(junction / 'One.mp3'), str(music / 'One.mp3.'), str(music / 'One.mp3 '), str(music).replace('\\', '/') + '/One.mp3']
    if short and '~' in short:
        cases.append(short)
    check = file_checker()
    for path in cases + cases:  # second round answers from the cached listings
        assert check(path) == os.path.isfile(path), (path, check(path), os.path.isfile(path))
    calls = []
    real_scandir = os.scandir
    os.scandir = lambda folder: calls.append(ntpath.normcase(str(folder))) or real_scandir(folder)
    try:
        check = file_checker()
        for _ in range(50):
            assert check(str(music / 'One.mp3'))
    finally:
        os.scandir = real_scandir
    assert len(calls) == 1, calls
print('PASS: VirtualDJ file check answers like os.path.isfile (case, junction, short name, missing drive, folders) '
      'and lists each folder once')
