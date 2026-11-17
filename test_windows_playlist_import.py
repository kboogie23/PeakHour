r"""Playlists > Import Playlist, server side: POST /api/windows/playlists/import reads an ordinary playlist file and matches
its songs to the library (windows_playlist_import.py). Nothing is written.

Real app (temp folder, free port, synthetic library with duplicate file names, non-ASCII names, a name with spaces,
a percent sign and an ampersand), files built here as bytes:
  parsers   .m3u (cp1252 / UTF-8 BOM, #EXTINF), .m3u8, .pls (out of order), .txt (paths, Artist - Title, en dash, title only,
            UTF-16 tab separated), .csv (header, no header, semicolon), Rekordbox .xml, Serato .crate, VirtualDJ .vdjfolder / .xml
  matching  exact path (case, slashes, file:// and percent codes), drive letter ignored, unique file name, duplicate file
            names (artist+title, folder trail, left unmatched with the reason), artist+title and swapped, title only,
            NFC/NFD, file order, repeated lines, the 500 unmatched cap
  agreement the file-name step with an artist+title entry only accepts a row whose title (equal or containing, normalised) and
            artist (when both have one; swapped accepted) agree; empty library title agrees; else "A different song in your
            library has this file name" after the artist+title step; plain path lines and title-only entries still take a unique name
  caps      at most 3,001 rows per playlist, matched_total = every match, total = entries in the file; 413 from the declared
            Content-Length before the body is read (test client with an unreadable body, and raw HTTP against the real server)
  refusals  DOCTYPE / entities / billion laughs, unknown type, corrupt files, empty file, over 32 MB (413), over 20,000
            songs, no file field, laptop engine (403, in-process app because the real one is started without a device id)
  the answer's track rows carry the library row's keys plus duration_min; the library cache is byte-identical afterwards;
  the existing VirtualDJ list tests still pass.

Run (PowerShell): .\axiom-win-env\Scripts\python.exe test_windows_playlist_import.py
Nothing of the owner's is touched (never port 8080)."""
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import types
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

workspace = Path(__file__).resolve().parent
APP_DIR = Path(os.environ.get('PH_TEST_APP_DIR') or workspace / 'axiom-win-probe')
sys.path.insert(0, str(workspace))
sys.path.insert(0, str(APP_DIR))
from feature_check import synthetic_library as sl

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'runtime'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
ROUTE = '/api/windows/playlists/import'
UNSUPPORTED = "PEAK HOUR can't read this kind of file. Use .m3u, .m3u8, .pls, .txt, .csv, Rekordbox .xml, Serato .crate or VirtualDJ .vdjfolder."
TOO_BIG = 'That file is too big to import (over 32 MB). Export just the playlist and try again.'
NOT_FOUND = 'Not in your library'
AMBIGUOUS = 'More than one song in your library has this file name'
DIFFERENT_SONG = 'A different song in your library has this file name'
failures = []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)
    return bool(cond)


def row(path, title, artist, **extra):
    data = {'path': path, 'filename': path.replace('/', '\\').rsplit('\\', 1)[-1], 'folder': 'Music', 'title': title, 'artist': artist,
            'album': 'A', 'genre': 'House', 'comments': 'c', 'bpm': 120.0, 'camelot': '8A', 'key_raw': '8A', 'energy': 'Mid', 'year': 2001,
            'duration_sec': 240, 'file_size': 4000000, 'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': False}
    data.update(extra)
    return data


HALO = 'D:\\Music\\Pop\\Beyonc\u00e9 - Halo.mp3'            # NFC spelling in the library
UTEKAI = 'E:\\Tunes\\Rock\\\u041c\u0443\u043c\u0438\u0439 \u0422\u0440\u043e\u043b\u043b\u044c - \u0423\u0442\u0435\u043a\u0430\u0439.mp3'
SPACEY = 'C:\\Users\\x\\My Music\\a b & c 50% off.mp3'
LIBRARY = {
    'alpha': row('D:\\Music\\House\\Alpha One.mp3', 'Alpha One', 'Alpha', duration_min=7.5),     # already has duration_min
    'beta': row('D:\\Music\\House\\Beta Two.mp3', 'Beta Two', 'Beta', duration_sec=90),
    'halo': row(HALO, 'Halo', 'Beyonc\u00e9'),
    'utekai': row(UTEKAI, '\u0423\u0442\u0435\u043a\u0430\u0439', '\u041c\u0443\u043c\u0438\u0439 \u0422\u0440\u043e\u043b\u043b\u044c'),
    'spacey': row(SPACEY, 'Spacey & Co', 'Sp'),
    'dupe1': row('D:\\Music\\A\\same.mp3', 'Dupe One', 'Art1'),
    'dupe2': row('D:\\Music\\B\\same.mp3', 'Dupe Two', 'Art2'),
    'only': row('F:\\Elsewhere\\only.mp3', 'Only One', 'Solo', duration_sec=None),
    'lonely': row('D:\\Music\\House\\Lonely.mp3', 'Lonely Title', 'Zed'),
    'twin1': row('D:\\Music\\Twin\\t1.mp3', 'Twin Song', 'T1'),
    'twin2': row('D:\\Music\\Twin\\t2.mp3', 'Twin Song', 'T2'),
    'kiss': row('D:\\Music\\Pop\\Kiss Me.mp3', 'Kiss Me (Original Mix)', 'Sixpence'),   # the file-name step compares titles and artists
    'untitled': row('D:\\Music\\Pop\\Untagged.mp3', '', 'Whoever'),                       # no title to compare: always agrees
    'noartist': row('D:\\Music\\Pop\\Mystery.mp3', 'Mystery', ''),                          # no artist on the library side: only titles are compared
}
P = {k: v['path'] for k, v in LIBRARY.items()}
BY_PATH = {v['path']: k for k, v in LIBRARY.items()}

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
if port == 8080:
    raise SystemExit('refusing port 8080')
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phimp'))
runtime = base / 'runtime'
cache = runtime / 'data' / 'library_cache.json'
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
env.pop('AXIOM_DEVICE_ID', None)
for name in ('local', 'home', 'roaming', 'runtime'):
    (base / name).mkdir()
servers = []


def post(name, data, field='file', content_type=None, retries=2):
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() \
        + data + f'\r\n--{boundary}--\r\n'.encode()
    headers = {'Content-Type': content_type or f'multipart/form-data; boundary={boundary}', 'Origin': url}
    for attempt in range(retries + 1):
        req = urllib.request.Request(url + ROUTE, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, {'raw': raw[:300].decode('utf-8', 'replace')}
        except (ConnectionError, urllib.error.URLError):
            if attempt == retries:
                raise
            time.sleep(0.5)


def good(label, name, data, fmt=None):
    """POST, expect 200 success; returns the answer (or an empty shell after recording the failure)."""
    code, d = post(name, data)
    if not check(code == 200 and d.get('success') is True, f'{label}: wanted 200 success, got {code} {str(d)[:300]}'):
        return {'playlists': [], 'skipped_playlists': 0}
    if fmt:
        check(d.get('format') == fmt, f'{label}: format {d.get("format")!r}, wanted {fmt!r}')
    return d


def refused(label, name, data, code_want=400, text=None):
    code, d = post(name, data)
    check(code == code_want and d.get('success') is False, f'{label}: wanted {code_want} success=false, got {code} {str(d)[:200]}')
    message = str(d.get('error', ''))
    check(bool(message), f'{label}: no error sentence')
    if text is not None:
        check(message == text, f'{label}: error {message!r}, wanted {text!r}')
    low = message.lower()
    leak = [bad for bad in ('traceback', 'file "', '.py', str(base).lower(), str(APP_DIR).lower(), 'c:\\users', 'exception', 'errno') if bad in low]
    check(not leak, f'{label}: the error sentence leaks internals {leak}: {message!r}')
    check(message.endswith('.') and message[:1].isupper(), f'{label}: not a plain sentence: {message!r}')
    return message


def keys(d, index=0):
    """Library keys of the matched tracks of playlist #index in file order."""
    return [BY_PATH.get(t['path'], '?' + t['path']) for t in d['playlists'][index]['tracks']] if d['playlists'] else None


def unmatched(d, index=0):
    return [(u['line'], u['reason']) for u in d['playlists'][index]['unmatched']] if d['playlists'] else None


def expect(label, got, want):
    check(got == want, f'{label}: got {got!r}, wanted {want!r}')


# ------------------------------------------------------------------------------------------------ parsers and matching
def text_formats():
    # ---- m3u: cp1252 and UTF-8 with BOM; #EXTINF only used when the path is unknown; blank lines and comments skipped
    body = ('#EXTM3U\n#EXTINF:200,Beyonc\u00e9 - Halo\n' + P['halo'] + '\n\n#a comment\n' + P['alpha'] + '\n'
            '#EXTINF:100,Alpha - Alpha One\nQ:\\gone\\unknown path.mp3\nQ:\\gone\\nothing.mp3\n')
    for label, data in (('m3u cp1252', body.encode('cp1252')), ('m3u utf-8 BOM', b'\xef\xbb\xbf' + body.encode('utf-8')), ('m3u utf-8 no BOM', body.encode('utf-8'))):
        d = good(label, 'mix.m3u', data, 'm3u')
        expect(label + ' order', keys(d), ['halo', 'alpha', 'alpha'])      # third: path unknown, #EXTINF artist+title finds Alpha One
        expect(label + ' unmatched', unmatched(d), [('Q:\\gone\\nothing.mp3', NOT_FOUND)])
        pl = d['playlists'][0]
        check(pl['name'] == 'mix' and pl['total'] == 4 and pl['unmatched_total'] == 1 and len(pl['tracks']) == 3 and pl['matched_total'] == 3, f'{label}: name/total/counts wrong: {pl["name"]} {pl["total"]} {pl["unmatched_total"]} {pl.get("matched_total")}')
    # a file path ending in a cp1252-only byte is not mistaken for UTF-8
    d = good('m3u8', 'u.m3u8', ('#EXTM3U\n' + P['utekai'] + '\n' + P['halo'] + '\n').encode('utf-8'), 'm3u8')
    expect('m3u8 order', keys(d), ['utekai', 'halo'])
    # percent codes and file:// URLs, spaces, ampersand, percent sign in the name
    url_form = 'file:///C:/Users/x/My%20Music/a%20b%20%26%20c%2050%25%20off.mp3'
    plain_coded = 'C:\\Users\\x\\My%20Music\\a b & c 50% off.mp3'
    d = good('url forms', 'u.m3u', ('\n'.join([P['spacey'], url_form, plain_coded, 'file://localhost/D:/Music/House/Alpha%20One.mp3']) + '\n').encode('utf-8'), 'm3u')
    expect('url forms', keys(d), ['spacey', 'spacey', 'spacey', 'alpha'])
    # exact path matching ignores case and slash direction
    d = good('case and slashes', 'c.m3u', 'd:/music/house/ALPHA ONE.MP3\nD:\\MUSIC\\House\\beta two.mp3\nd:\\music\\house\\\\beta two.mp3\n'.encode(), 'm3u')
    expect('case and slashes', keys(d), ['alpha', 'beta', 'beta'])
    # the same name spelled NFD (e + combining accent) matches the NFC library path; and the reverse
    nfd = unicodedata.normalize('NFD', HALO)
    check(nfd != HALO, 'test setup: NFD and NFC spellings should differ')
    d = good('NFD', 'n.m3u', (nfd + '\n').encode('utf-8'), 'm3u')
    expect('NFD matches NFC path', keys(d), ['halo'])
    d = good('NFD artist title', 'n.txt', unicodedata.normalize('NFD', 'Beyonc\u00e9 - Halo').encode('utf-8'), 'txt')
    expect('NFD artist title', keys(d), ['halo'])
    # drive letter ignored when the rest of the path is unique; the file name when unique
    d = good('drive', 'dr.m3u', 'X:\\Music\\A\\same.mp3\nX:\\Moved\\Elsewhere\\only.mp3\nZ:\\whatever\\LONELY.MP3\n'.encode(), 'm3u')
    expect('drive-less and unique name', keys(d), ['dupe1', 'only', 'lonely'])
    # duplicate file names: folder trail decides, artist+title decides, otherwise left out with the reason
    d = good('dup trail', 'dup.m3u', 'X:\\B\\same.mp3\nX:\\whatever\\A\\same.mp3\nX:\\Other\\same.mp3\n'.encode(), 'm3u')
    expect('dup trail', keys(d), ['dupe2', 'dupe1'])
    expect('dup unmatched', unmatched(d), [('X:\\Other\\same.mp3', AMBIGUOUS)])
    d = good('dup artist title', 'dup2.m3u', '#EXTINF:1,Art2 - Dupe Two\nX:\\Other\\same.mp3\n#EXTINF:1,Dupe One - Art1\nX:\\Other\\same.mp3\n'.encode(), 'm3u')
    expect('dup artist+title (also swapped)', keys(d), ['dupe2', 'dupe1'])
    d = good('dup wrong hint', 'dup3.m3u', '#EXTINF:1,Nobody - Nothing\nX:\\Other\\same.mp3\n'.encode(), 'm3u')
    expect('dup with a hint that matches neither (no candidate agrees with the named song)', unmatched(d), [('X:\\Other\\same.mp3', DIFFERENT_SONG)])
    # repeated lines are kept as often as they appear (the page later saves a repeated song once)
    d = good('repeats', 'r.m3u', f'{P["alpha"]}\n{P["beta"]}\n{P["alpha"]}\n'.encode(), 'm3u')
    expect('repeated lines kept, file order', keys(d), ['alpha', 'beta', 'alpha'])
    check(d['playlists'][0]['total'] == 3, 'repeats: total should count every line')

    # ---- pls: ordered by number, not by position in the file; Title gives artist+title when the path is unknown
    pls = (f'[playlist]\nNumberOfEntries=4\nFile3={P["beta"]}\nTitle3=x\nFile1=Q:\\gone\\a.mp3\nTitle1=Beyonc\u00e9 - Halo\n'
           f'File10={P["utekai"]}\nfile2={P["alpha"]}\nVersion=2\n')
    d = good('pls', 'a.pls', pls.encode('utf-8'), 'pls')
    expect('pls order 1,2,3,10', keys(d), ['halo', 'alpha', 'beta', 'utekai'])

    # ---- txt: paths, Artist - Title, en dash, title only, and what cannot be found
    txt = '\n'.join([P['alpha'], 'D:/music/house/beta two.mp3', 'Beyonc\u00e9 - Halo', '\u041c\u0443\u043c\u0438\u0439 \u0422\u0440\u043e\u043b\u043b\u044c \u2013 \u0423\u0442\u0435\u043a\u0430\u0439',
                 'Lonely Title', 'Twin Song', 'Nothing Here', 'ghost.mp3', 'halo - beyonc\u00e9', 'Spacey & Co', '']) + '\n'
    d = good('txt', 'list.txt', b'\xef\xbb\xbf' + txt.encode('utf-8'), 'txt')
    expect('txt order', keys(d), ['alpha', 'beta', 'halo', 'utekai', 'lonely', 'halo', 'spacey'])
    expect('txt unmatched (title only that is not unique; not found; file name not found)', unmatched(d),
           [('Twin Song', NOT_FOUND), ('Nothing Here', NOT_FOUND), ('ghost.mp3', NOT_FOUND)])
    d = good('txt cp1252', 'list.txt', 'Beyonc\u00e9 - Halo\n'.encode('cp1252'), 'txt')
    expect('txt cp1252', keys(d), ['halo'])
    # UTF-16 with BOM and tab separated (a Rekordbox / Traktor style export)
    rb = 'Track Title\tArtist\tAlbum\nHalo\tBeyonc\u00e9\tx\nNothing\tNobody\ty\nAlpha One\tAlpha\tz\n'
    d = good('utf16 tabs', 'rb.txt', b'\xff\xfe' + rb.encode('utf-16-le'), 'txt')
    expect('utf16 tabs', keys(d), ['halo', 'alpha'])
    expect('utf16 tabs unmatched', unmatched(d), [('Nobody - Nothing', NOT_FOUND)])
    d = good('utf16 be', 'be.txt', b'\xfe\xff' + 'Alpha - Alpha One\n'.encode('utf-16-be'), 'txt')
    expect('utf16 be', keys(d), ['alpha'])

    # ---- csv
    d = good('csv header', 'c.csv', f'Title,Artist,Location\nBeta Two,Beta,\n,,{P["alpha"]}\nQ,R,\n"Halo, the song",Beyonc\u00e9,\n'.encode('utf-8'), 'csv')
    expect('csv header', keys(d), ['beta', 'alpha'])
    expect('csv header unmatched', unmatched(d), [('R - Q', NOT_FOUND), ('Beyonc\u00e9 - Halo, the song', NOT_FOUND)])
    d = good('csv semicolon', 's.csv', 'Artist;Name;Other\nAlpha;Alpha One;1\nBeta;Beta Two;2\n'.encode(), 'csv')
    expect('csv semicolon', keys(d), ['alpha', 'beta'])
    d = good('csv no header', 'n.csv', f'{P["beta"]}\nAlpha - Alpha One\nLonely Title\n'.encode('utf-8'), 'csv')
    expect('csv no header', keys(d), ['beta', 'alpha', 'lonely'])
    d = good('csv path header', 'p.csv', f'File Path,Artist\n{P["alpha"]},x\n'.encode('utf-8'), 'csv')
    expect('csv "File Path" column', keys(d), ['alpha'])
    d = good('csv utf-8 BOM', 'b.csv', b'\xef\xbb\xbf' + 'artist,title\nBeyonc\u00e9,Halo\n'.encode('utf-8'), 'csv')
    expect('csv BOM + header', keys(d), ['halo'])


def title_only():
    d = good('title only unique', 't.txt', b'Halo\nTwin Song\nhalo\n', 'txt')
    expect('title only: unique matches, not-unique does not', keys(d), ['halo', 'halo'])
    expect('title only unmatched', unmatched(d), [('Twin Song', NOT_FOUND)])
    d = good('artist+title picks one twin', 't2.txt', b'T2 - Twin Song\nTwin Song - T1\n', 'txt')
    expect('artist+title between twins', keys(d), ['twin2', 'twin1'])


def name_agreement():
    """At the file-name step an entry that names artist AND title only accepts a library row that agrees (titles equal or one
    containing the other after normalising; artists the same when both sides have one; swapped "Title - Artist" accepted)."""
    moved = 'X:\\Moved\\'

    def one(label, extinf, name, want):
        d = good(label, 'a.m3u', f'#EXTINF:1,{extinf}\n{moved}{name}\n'.encode('utf-8'), 'm3u')
        if want is None:
            expect(label + ' (kept out)', (keys(d), unmatched(d)), ([], [(moved + name, DIFFERENT_SONG)]))
        else:
            expect(label, (keys(d), unmatched(d)), ([want], []))
        pl = d['playlists'][0]
        check(pl['matched_total'] == len(pl['tracks']) == (0 if want is None else 1) and pl['total'] == 1, f'{label}: counts {pl["matched_total"]}/{len(pl["tracks"])}/{pl["total"]}')
    one('same song', 'Zed - Lonely Title', 'Lonely.mp3', 'lonely')
    one('swapped Title - Artist', 'Lonely Title - Zed', 'Lonely.mp3', 'lonely')
    one('case and punctuation ignored', 'ZED - lonely, title!', 'Lonely.mp3', 'lonely')
    one('the entry title contains the library title', 'Zed - Lonely Title (Extended Mix)', 'Lonely.mp3', 'lonely')
    one('the library title contains the entry title', 'Sixpence - Kiss Me', 'Kiss Me.mp3', 'kiss')
    one('library row with an empty title always agrees', 'Nobody - Nothing', 'Untagged.mp3', 'untitled')
    one('library row without an artist: titles decide', 'Anyone - Mystery', 'Mystery.mp3', 'noartist')
    one('library row without an artist, other title', 'Anyone - Other Song', 'Mystery.mp3', None)
    one('a different song under the same file name', 'Nobody - Nothing', 'Lonely.mp3', None)
    one('same title, other artist', 'Other - Lonely Title', 'Lonely.mp3', None)
    one('same artist, other title', 'Zed - Other Song', 'Lonely.mp3', None)
    # a title alone (no artist) or a plain path line keeps accepting the one file with that name
    d = good('title only #EXTINF', 'a.m3u', f'#EXTINF:1,Whatever Song\n{moved}Lonely.mp3\n{moved}Alpha One.mp3\n'.encode(), 'm3u')
    expect('a title without an artist does not veto a unique file name; neither does a plain path line', (keys(d), unmatched(d)), (['lonely', 'alpha'], []))
    # a refused file name falls through to artist + title, which finds the song the entry really names
    d = good('falls through', 'a.m3u', f'#EXTINF:1,Zed - Lonely Title\n{moved}Alpha One.mp3\n'.encode(), 'm3u')
    expect('file name belongs to another song, artist + title finds the right one', (keys(d), unmatched(d)), (['lonely'], []))
    # the same rule for the other formats that carry artist and title next to the path
    d = good('csv', 'a.csv', f'Title,Artist,Location\nNope,Zed,{moved}Lonely.mp3\nLonely Title,Zed,{moved}Lonely.mp3\n'.encode(), 'csv')
    expect('csv: a path with a disagreeing title', (keys(d), unmatched(d)), (['lonely'], [(moved + 'Lonely.mp3', DIFFERENT_SONG)]))
    d = good('pls', 'a.pls', f'[playlist]\nFile1={moved}Lonely.mp3\nTitle1=Nobody - Nothing\nFile2={moved}Lonely.mp3\nTitle2=Zed - Lonely Title\n'.encode(), 'pls')
    expect('pls: a disagreeing Title', (keys(d), unmatched(d)), (['lonely'], [(moved + 'Lonely.mp3', DIFFERENT_SONG)]))
    # duplicate file names: the rows that disagree are not candidates, so the one that agrees wins without a folder trail
    d = good('dup agreement', 'a.m3u', '#EXTINF:1,Art1 - Dupe One\nX:\\Other\\same.mp3\n#EXTINF:1,Art2 - Dupe Two (Radio Edit)\nX:\\Other\\same.mp3\n'.encode(), 'm3u')
    expect('dup names: only the agreeing row stays a candidate', keys(d), ['dupe1', 'dupe2'])


def track_cap():
    """At most MAX_TRACKS_RETURNED + 1 rows come back per playlist, the first ones in file order; matched_total counts every match,
    total every entry in the file."""
    import windows_playlist_import as W
    check(W.MAX_TRACKS_RETURNED == 3000, f'MAX_TRACKS_RETURNED is {W.MAX_TRACKS_RETURNED}')
    for label, count in (('exactly 3000', 3000), ('3001', 3001), ('3002', 3002), ('3100', 3100)):
        d = good(label, 'big.m3u', ('\n'.join([P['beta']] + [P['alpha']] * (count - 2) + [P['beta']]) + '\n').encode(), 'm3u')
        pl = d['playlists'][0]
        want_rows = min(count, 3001)
        check(len(pl['tracks']) == want_rows and pl['matched_total'] == count and pl['total'] == count and pl['unmatched_total'] == 0,
              f'{label}: {len(pl["tracks"])} rows, matched_total {pl["matched_total"]}, total {pl["total"]}, unmatched {pl["unmatched_total"]}')
        order = keys(d)
        check(order[0] == 'beta' and order[1] == 'alpha' and (order[-1] == 'beta') == (count <= 3001), f'{label}: rows are not the first ones in file order ({order[:2]} ... {order[-1]})')
    d = good('3100 with unknown lines', 'big.m3u', ('\n'.join([P['alpha']] * 3100 + [f'Z:\\none\\{i}.mp3' for i in range(50)])).encode(), 'm3u')
    pl = d['playlists'][0]
    check(len(pl['tracks']) == 3001 and pl['matched_total'] == 3100 and pl['total'] == 3150 and pl['unmatched_total'] == 50 and len(pl['unmatched']) == 50,
          f'3100 + 50 unknown: {len(pl["tracks"])} rows, matched {pl["matched_total"]}, total {pl["total"]}, unmatched {pl["unmatched_total"]}')


def early_413():
    """The route answers 413 from the declared Content-Length (cap + 64 KB allowance) before it reads the upload."""
    from flask import Flask
    import windows_playlist_import as W
    flask_app = Flask('early-413')
    W.install(types.SimpleNamespace(app=flask_app, load_cache=lambda path: {'tracks': list(LIBRARY.values())}, CACHE_PATH='unused'))
    client = flask_app.test_client()
    check(W.FRAMING_ALLOWANCE == 64 * 1024 and W.MAX_UPLOAD_BYTES == 32 * 1024 * 1024, 'upload cap or framing allowance changed')

    declared = W.MAX_UPLOAD_BYTES + W.FRAMING_ALLOWANCE + 1

    class Unreadable:
        """A body of `declared` bytes (the test client measures it with seek/tell) that fails the test when anything reads it."""
        reads = 0
        position = 0

        def tell(self):
            return self.position

        def seek(self, offset, whence=0):
            self.position = offset if whence == 0 else declared + offset

        def read(self, *args):
            Unreadable.reads += 1
            raise AssertionError('the body must not be read')
        readline = readinto = read
    r = client.open(ROUTE, method='POST', input_stream=Unreadable(), content_type='multipart/form-data; boundary=x')
    body = r.get_json()
    check(r.status_code == 413 and body.get('success') is False and body.get('error') == TOO_BIG, f'declared {declared} bytes: {r.status_code} {r.get_data()[:200]}')
    check(Unreadable.reads == 0, f'the body was read {Unreadable.reads} time(s) before the 413')
    # the real server (raw HTTP: only the headers are sent, no body at all)
    sock = socket.create_connection(('127.0.0.1', port), timeout=20)
    try:
        sock.sendall((f'POST {ROUTE} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {url}\r\nContent-Type: multipart/form-data; boundary=x\r\n'
                      f'Content-Length: {500 * 1024 * 1024}\r\nConnection: close\r\n\r\n').encode())
        started = time.monotonic()
        answer = b''
        while b'}' not in answer:
            chunk = sock.recv(65536)
            if not chunk:
                break
            answer += chunk
        took = time.monotonic() - started
    finally:
        sock.close()
    status_line = answer.split(b'\r\n', 1)[0].decode('latin-1')
    check(' 413 ' in status_line, f'raw request with a 500 MB Content-Length and no body: {status_line!r}')
    check(b'too big' in answer and took < 10, f'the 413 should come at once, with the plain sentence ({took:.1f} s): {answer[-200:]!r}')


def rekordbox():
    def loc(path):
        return 'file://localhost/' + urllib.parse.quote(path.replace('\\', '/'))
    xml = f'''<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="5">
<TRACK TrackID="11" Name="Halo" Artist="Beyonc\u00e9" Location="{loc(HALO)}"/>
<TRACK TrackID="12" Name="Spacey &amp; Co" Artist="Sp" Location="{loc(SPACEY)}"/>
<TRACK TrackID="13" Name="Ghost" Artist="G" Location="file://localhost/Z:/g.mp3"/>
<TRACK TrackID="14" Name="\u0423\u0442\u0435\u043a\u0430\u0439" Artist="\u041c\u0443\u043c\u0438\u0439 \u0422\u0440\u043e\u043b\u043b\u044c" Location="{loc('Y:/moved/' + UTEKAI.rsplit(chr(92), 1)[1])}"/>
<TRACK TrackID="15" Name="Utekai" Artist="Nobody" Location="{loc('Y:/moved/' + UTEKAI.rsplit(chr(92), 1)[1])}"/></COLLECTION>
<PLAYLISTS><NODE Type="0" Name="ROOT" Count="3">
<NODE Type="1" Name="Mix One" KeyType="0" Entries="4"><TRACK Key="12"/><TRACK Key="11"/><TRACK Key="13"/><TRACK Key="99"/><TRACK Key="14"/><TRACK Key="15"/></NODE>
<NODE Type="0" Name="Folder" Count="1"><NODE Type="0" Name="Inner" Count="1"><NODE Type="1" Name="Mix Two" KeyType="1" Entries="3"><TRACK Key="{loc(P['alpha'])}"/><TRACK Key="file://localhost/Z:/none.mp3"/><TRACK Key="{loc(P['beta'])}"/></NODE></NODE></NODE>
<NODE Type="1" Name="Empty" KeyType="0" Entries="0"/></NODE></PLAYLISTS></DJ_PLAYLISTS>'''
    d = good('rekordbox', 'rb.xml', xml.encode('utf-8'), 'Rekordbox')
    names = [p['name'] for p in d['playlists']]
    expect('rekordbox playlist names (empty one skipped, nested one found, file order)', names, ['Mix One', 'Mix Two'])
    expect('rekordbox KeyType 0 (TrackID) playlist', keys(d, 0), ['spacey', 'halo', 'utekai'])
    mix_one = d['playlists'][0]
    check(mix_one['unmatched_total'] == 3 and mix_one['total'] == 6 and mix_one['matched_total'] == 3, f'rekordbox Mix One counts: {mix_one["unmatched_total"]} unmatched, {mix_one["matched_total"]} matched of {mix_one["total"]}')
    # a correctly tagged entry matches by file name (artist and title as in the library); the same file name with another artist/title is a different song
    expect('rekordbox mismatched entry (Nobody - Utekai on the Cyrillic file name)', [u[1] for u in unmatched(d, 0) if 'Track 99' not in u[0] and 'g.mp3' not in u[0]], [DIFFERENT_SONG])
    check(any('Track 99' in u[0] for u in unmatched(d, 0)), 'rekordbox: a TrackID that is not in the collection should be listed as unmatched')
    expect('rekordbox KeyType 1 (Location) playlist', keys(d, 1), ['alpha', 'beta'])
    check(d['playlists'][1]['unmatched_total'] == 1, 'rekordbox Mix Two should have 1 unmatched')
    check(d['skipped_playlists'] == 0, 'rekordbox: nothing skipped')
    # one name in the file spelled with markup stays plain text (the answer is JSON, not HTML)
    d = good('rekordbox name', 'rb.xml', (b'<DJ_PLAYLISTS><COLLECTION/><PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="&lt;b&gt;x&lt;/b&gt;" KeyType="1">'
                                         b'<TRACK Key="' + P['alpha'].encode() + b'"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>'), 'Rekordbox')
    expect('rekordbox markup name kept literally', d['playlists'][0]['name'], '<b>x</b>')
    many = '<DJ_PLAYLISTS><COLLECTION/><PLAYLISTS><NODE Type="0" Name="ROOT">' + ''.join(
        f'<NODE Type="1" Name="L{i}" KeyType="1"><TRACK Key="{P["alpha"]}"/></NODE>' for i in range(27)) + '</NODE></PLAYLISTS></DJ_PLAYLISTS>'
    d = good('27 playlists', 'many.xml', many.encode(), 'Rekordbox')
    check(len(d['playlists']) == 25 and d['skipped_playlists'] == 2, f'27 playlists: got {len(d["playlists"])} + skipped {d["skipped_playlists"]}, wanted 25 + 2')
    check([p['name'] for p in d['playlists']] == [f'L{i}' for i in range(25)], '27 playlists: the first 25 in file order should be kept')
    refused('rekordbox without playlists', 'rb2.xml', b'<DJ_PLAYLISTS><COLLECTION/><PLAYLISTS><NODE Type="0" Name="ROOT" Count="0"/></PLAYLISTS></DJ_PLAYLISTS>',
            text='This Rekordbox file has no playlists in it.')
    refused('rekordbox only empty playlists', 'rb3.xml', b'<DJ_PLAYLISTS><COLLECTION/><PLAYLISTS><NODE Type="1" Name="E" KeyType="0"/></PLAYLISTS></DJ_PLAYLISTS>',
            text='This Rekordbox file has no playlists in it.')


def serato_and_vdj():
    from windows_crate_publish import legacy_crate_bytes
    from windows_virtualdj_lists import format_vdjfolder
    rel = ['Music/House/Alpha One.mp3', 'Tunes/Rock/' + UTEKAI.rsplit('\\', 1)[1], 'Music/A/same.mp3', 'nowhere/q.mp3', 'Elsewhere/only.mp3']
    crate = legacy_crate_bytes(rel)
    d = good('crate', 'Parent%%Child.crate', crate, 'Serato crate')
    expect('crate name after the last %%', d['playlists'][0]['name'], 'Child')
    expect('crate (drive-less paths)', keys(d), ['alpha', 'utekai', 'dupe1', 'only'])
    expect('crate unmatched', [u[0] for u in unmatched(d)], ['nowhere/q.mp3'])
    d = good('crate plain', 'Solo.crate', crate, 'Serato crate')
    expect('crate plain name', d['playlists'][0]['name'], 'Solo')
    d = good('crate deep', 'A%%B%%C.crate', crate)
    expect('crate three levels', d['playlists'][0]['name'], 'C')

    songs = [{'path': P['alpha']}, {'path': 'Q:\\Nope\\same.mp3', 'artist': 'Art2', 'title': 'Dupe Two'}, {'path': 'Q:\\Nope\\gone.mp3'},
             {'path': 'Z:\\none.mp3', 'artist': 'Solo', 'title': 'Only One'}, {'path': P['beta'], 'artist': "O'Brien & <Co>", 'title': 'x"y'}]
    vdj = format_vdjfolder(songs)
    d = good('vdjfolder', 'My List.vdjfolder', vdj, 'VirtualDJ list')
    expect('vdjfolder name', d['playlists'][0]['name'], 'My List')
    expect('vdjfolder', keys(d), ['alpha', 'dupe2', 'only', 'beta'])
    expect('vdjfolder unmatched', unmatched(d), [('Q:\\Nope\\gone.mp3', NOT_FOUND)])
    d = good('vdj as xml', 'V.xml', vdj, 'VirtualDJ list')
    expect('VirtualFolder xml', keys(d), ['alpha', 'dupe2', 'only', 'beta'])
    refused('vdj xml of another kind', 'V.xml', b'<foo><bar/></foo>', text='This XML file is not a Rekordbox or VirtualDJ playlist.')


# ------------------------------------------------------------------------------------------------ the answer
def answer_shape():
    d = good('shape', 's.m3u', f'{P["alpha"]}\n{P["beta"]}\n{P["only"]}\nQ:\\x.mp3\n'.encode(), 'm3u')
    check(set(d) == {'success', 'format', 'playlists', 'skipped_playlists'}, f'answer keys: {sorted(d)}')
    pl = d['playlists'][0]
    check(set(pl) == {'name', 'total', 'matched_total', 'tracks', 'unmatched', 'unmatched_total'}, f'playlist keys: {sorted(pl)}')
    check(pl['total'] == 4 and pl['matched_total'] == 3 and len(pl['tracks']) == 3 and pl['unmatched_total'] == 1, f'total is the entries in the file, matched_total the songs found: {pl["total"]} {pl["matched_total"]}')
    library = {t['path']: t for t in json.loads(cache.read_text('utf-8'))['tracks']}
    for track in pl['tracks']:
        original = library[track['path']]
        missing = [k for k in original if k not in track]
        check(not missing, f'track {track["title"]!r}: library keys missing from the answer: {missing}')
        changed = [k for k in original if k in track and track[k] != original[k]]
        check(not changed, f'track {track["title"]!r}: values differ from the library row: {changed}')
        check(isinstance(track.get('path'), str) and isinstance(track.get('title'), str), 'track rows need path and title')
    by = {BY_PATH[t['path']]: t for t in pl['tracks']}
    check(by['alpha'].get('duration_min') == 7.5, f'an existing duration_min must be kept, got {by["alpha"].get("duration_min")!r}')
    check(by['beta'].get('duration_min') == 1.5, f'duration_min for 90 s should be 1.5, got {by["beta"].get("duration_min")!r}')
    check('duration_min' not in by['only'] or by['only']['duration_min'] in (None, ''), f'no duration -> no duration_min, got {by["only"].get("duration_min")!r}')
    for u in pl['unmatched']:
        check(set(u) == {'line', 'reason'}, f'unmatched keys {sorted(u)}')


def unmatched_cap():
    lines = '\n'.join(f'Z:\\nothing\\{i}.mp3' for i in range(600)) + '\n' + P['alpha'] + '\n'
    d = good('600 unknown', 'u.m3u', lines.encode(), 'm3u')
    pl = d['playlists'][0]
    check(pl['total'] == 601 and pl['unmatched_total'] == 600 and len(pl['unmatched']) == 500 and len(pl['tracks']) == 1,
          f'cap: total {pl["total"]}, unmatched_total {pl["unmatched_total"]}, shown {len(pl["unmatched"])}, tracks {len(pl["tracks"])}')
    check(pl['unmatched'][0]['line'] == 'Z:\\nothing\\0.mp3' and pl['unmatched'][-1]['line'] == 'Z:\\nothing\\499.mp3', 'cap: the first 500 lines in file order are shown')
    d = good('exactly 20000', 'edge.m3u', ('\n'.join(f'Z:\\n\\{i}.mp3' for i in range(19999)) + '\n' + P['beta'] + '\n').encode(), 'm3u')
    check(d['playlists'][0]['total'] == 20000 and keys(d) == ['beta'], 'exactly 20,000 songs should be accepted')


# ------------------------------------------------------------------------------------------------ refusals
def refusals():
    refused('unknown extension', 'a.docx', b'zzz', text=UNSUPPORTED)
    refused('no extension', 'playlist', b'zzz', text=UNSUPPORTED)
    refused('.json is not for the server', 'a.json', b'[]', text=UNSUPPORTED)
    refused('empty m3u', 'e.m3u', b'', text='This file has no songs in it.')
    refused('header only m3u', 'e.m3u', b'#EXTM3U\n#comment\n\n', text='This file has no songs in it.')
    refused('empty txt', 'e.txt', b'\n\n  \n', text='This file has no songs in it.')
    refused('empty pls', 'e.pls', b'[playlist]\nNumberOfEntries=0\n', text='This file has no songs in it.')
    refused('csv header only', 'e.csv', b'Title,Artist,Location\n', text='This file has no songs in it.')
    refused('empty vdjfolder', 'e.vdjfolder', b'', text='This file could not be read as a VirtualDJ playlist.')
    refused('not xml', 'x.xml', b'not xml at all')
    refused('empty xml', 'x.xml', b'')
    refused('corrupt crate', 'Bad.crate', b'abcd')
    refused('truncated crate', 'Bad.crate', b'otrk\x00\x00\x01\x00ptrk')
    refused('crate of nothing', 'Bad.crate', b'vrsn\x00\x00\x00\x02\x00\x31')
    refused('crate bad utf-16', 'Bad.crate', b'otrk\x00\x00\x00\x0dptrk\x00\x00\x00\x05\xd8\x00\x00\x00\x00')
    refused('bad vdjfolder', 'V.vdjfolder', b'<VirtualFolder><x/></VirtualFolder>')
    refused('vdjfolder song without path', 'V.vdjfolder', b'<VirtualFolder><song title="x"/></VirtualFolder>')
    refused('vdjfolder not xml', 'V.vdjfolder', b'\x00\x01\x02 binary')

    # XML with a DOCTYPE / entities is refused, and the entity is never expanded
    refused('doctype', 'x.xml', b'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e "x">]><DJ_PLAYLISTS>&e;</DJ_PLAYLISTS>')
    refused('doctype only', 'x.xml', b'<?xml version="1.0"?><!DOCTYPE DJ_PLAYLISTS><DJ_PLAYLISTS><PLAYLISTS/></DJ_PLAYLISTS>')
    secret = base / 'secret.txt'
    secret.write_text('TOP-SECRET-CONTENT', encoding='utf-8')
    for label, payload in (('external entity file', f'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e SYSTEM "file:///{secret.as_posix()}">]><DJ_PLAYLISTS><COLLECTION/><PLAYLISTS><NODE Type="1" Name="&e;" KeyType="1"><TRACK Key="&e;"/></NODE></PLAYLISTS></DJ_PLAYLISTS>'),
                           ('parameter entity', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY % p SYSTEM "http://127.0.0.1:9/x.dtd">%p;]><DJ_PLAYLISTS/>'),
                           ('vdj entity', f'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e SYSTEM "file:///{secret.as_posix()}">]><VirtualFolder><song path="&e;"/></VirtualFolder>')):
        for name in ('x.xml', 'x.vdjfolder'):
            code, d = post(name, payload.encode())
            check(code == 400 and d.get('success') is False, f'{label} ({name}): wanted 400, got {code} {str(d)[:160]}')
            check('TOP-SECRET' not in json.dumps(d), f'{label} ({name}): the entity was expanded into the answer')
    declared = ''.join('<!ENTITY lol%d "%s">' % (i, ('&lol%d;' % (i - 1) if i > 1 else '&lol;') * 10) for i in range(1, 10))
    laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">' + declared + ']><DJ_PLAYLISTS>&lol9;</DJ_PLAYLISTS>'
    started = time.monotonic()
    refused('billion laughs', 'x.xml', laughs.encode())
    took = time.monotonic() - started
    check(took < 5, f'billion laughs took {took:.1f} s to refuse')
    # quadratic blow-up shaped payload (huge attribute made of entity references) refused as well
    quad = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "' + 'a' * 5000 + '">]><DJ_PLAYLISTS x="' + '&a;' * 5000 + '"/>'
    started = time.monotonic()
    refused('quadratic blow-up', 'x.xml', quad.encode())
    check(time.monotonic() - started < 5, 'quadratic blow-up payload took too long to refuse')

    refused('too many songs', 'many.m3u', ('\n'.join(f'Z:\\{i}.mp3' for i in range(20001))).encode(),
            text='This playlist has more than 20,000 songs. Split it in your DJ software and import the parts.')
    refused('too many songs txt', 'many.txt', ('\n'.join(f'Song {i}' for i in range(20001))).encode(),
            text='This playlist has more than 20,000 songs. Split it in your DJ software and import the parts.')
    refused('too many in one Rekordbox playlist', 'many.xml', ('<DJ_PLAYLISTS><COLLECTION/><PLAYLISTS><NODE Type="1" Name="Big" KeyType="1">' + '<TRACK Key="Z:\\a.mp3"/>' * 20001
                                                          + '</NODE></PLAYLISTS></DJ_PLAYLISTS>').encode())
    refused('over 32 MB', 'big.m3u', b'a' * (32 * 1024 * 1024 + 10), code_want=413, text=TOO_BIG)

    code, d = post('x.m3u', b'a\n', field='upload')
    check(code == 400 and d.get('success') is False and 'file' in str(d.get('error', '')).lower(), f'no "file" field: {code} {d}')
    code, d = post('x.m3u', b'a\n', content_type='application/json')
    check(code == 400 and d.get('success') is False, f'a body that is not a form: {code} {str(d)[:200]}')
    req = urllib.request.Request(url + ROUTE, data=b'', headers={'Origin': url})
    try:
        urllib.request.urlopen(req, timeout=30)
        check(False, 'an empty POST should be refused')
    except urllib.error.HTTPError as e:
        check(e.code in (400, 415), f'empty POST: {e.code}')
    # no Origin header: the app itself answers 403 (not this route's business, but it must not import)
    req = urllib.request.Request(url + ROUTE, data=b'--x\r\n', headers={'Content-Type': 'multipart/form-data; boundary=x'})
    try:
        urllib.request.urlopen(req, timeout=30)
        check(False, 'a POST without Origin must be refused')
    except urllib.error.HTTPError as e:
        check(e.code == 403, f'POST without Origin: {e.code}')
    # GET is not allowed
    try:
        urllib.request.urlopen(urllib.request.Request(url + ROUTE, headers={'Origin': url}), timeout=30)
        check(False, 'GET should not be served')
    except urllib.error.HTTPError as e:
        check(e.code == 405, f'GET: {e.code}')
    # hostile names stay inside the name only
    d = good('path-like file name', '..\\..\\evil name.m3u', b'\xef\xbb\xbfZ:\\a.mp3\n' + P['alpha'].encode() + b'\n')
    shown = d['playlists'][0]['name']      # the web server already drops the backslashes of such a name before the route sees it
    check(shown.endswith('evil name') and '\\' not in shown and '/' not in shown, f'name from a path-like file name: {shown!r}')
    d = good('long name', ('n' * 300) + '.m3u', P['alpha'].encode())
    check(len(d['playlists'][0]['name']) <= 120, 'a long file name should be cut to 120 characters')
    d = good('html name', '<img src=x onerror=1>.m3u', P['alpha'].encode())
    check(d['playlists'][0]['name'] == '<img src=x onerror=1>', f'html-like name kept as text: {d["playlists"][0]["name"]!r}')


def laptop_engine():
    """The route answers 403 when AXIOM_DEVICE_ID is set (laptop engine). The real app is started without a device id, so this
    uses a small in-process Flask app with the module's own blueprint."""
    from flask import Flask
    import windows_playlist_import as W
    flask_app = Flask('laptop-test')
    fake = types.SimpleNamespace(app=flask_app, load_cache=lambda path: {'tracks': list(LIBRARY.values())}, CACHE_PATH='unused')
    W.install(fake)
    W.install(fake)    # twice: still one route
    check(sum(1 for r in flask_app.url_map.iter_rules() if r.rule == ROUTE) == 1, 'install() must be idempotent')
    client = flask_app.test_client()
    old = os.environ.pop('AXIOM_DEVICE_ID', None)
    try:
        data = {'file': (__import__('io').BytesIO(P['alpha'].encode()), 'x.m3u')}
        r = client.post(ROUTE, data=data, content_type='multipart/form-data')
        check(r.status_code == 200 and r.get_json()['success'] is True and len(r.get_json()['playlists'][0]['tracks']) == 1, f'without a device id: {r.status_code} {r.get_data()[:200]}')
        os.environ['AXIOM_DEVICE_ID'] = 'laptop-1'
        data = {'file': (__import__('io').BytesIO(P['alpha'].encode()), 'x.m3u')}
        r = client.post(ROUTE, data=data, content_type='multipart/form-data')
        body = r.get_json()
        check(r.status_code == 403 and body.get('success') is False and body.get('error'), f'with AXIOM_DEVICE_ID set: {r.status_code} {r.get_data()[:200]}')
        check('Traceback' not in json.dumps(body), 'the 403 answer leaks a traceback')
    finally:
        os.environ.pop('AXIOM_DEVICE_ID', None)
        if old is not None:
            os.environ['AXIOM_DEVICE_ID'] = old
    # the module-level limits are the ones the owner was promised
    check((W.MAX_UPLOAD_BYTES, W.MAX_ENTRIES, W.MAX_PLAYLISTS, W.UNMATCHED_SHOWN) == (32 * 1024 * 1024, 20000, 25, 500), 'limits changed')


def existing_tests():
    for name in ('test_windows_virtualdj_lists.py', 'test_windows_virtualdj_vdjfolder.py'):
        r = subprocess.run([sys.executable, str(workspace / name)], cwd=str(workspace), capture_output=True, text=True, timeout=600)
        last = (r.stdout.strip().splitlines() or [''])[-1]
        check(r.returncode == 0 and last.startswith('PASS'), f'{name} no longer passes: exit {r.returncode}, last line {last[:200]!r} {r.stderr[-300:]}')


# ------------------------------------------------------------------------------------------------ run
def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(APP_DIR)],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


try:
    sl.write_library(runtime, list(LIBRARY.values()))
    before = hashlib.sha256(cache.read_bytes()).hexdigest()
    start()
    for step in (text_formats, title_only, name_agreement, rekordbox, serato_and_vdj, answer_shape, unmatched_cap, track_cap, refusals):
        print('..', step.__name__)
        step()
    check(hashlib.sha256(cache.read_bytes()).hexdigest() == before, 'the library cache changed (the import must write nothing)')
    leftovers = [p.name for p in runtime.rglob('*') if p.is_file() and p.suffix in ('.m3u', '.m3u8', '.pls', '.crate', '.vdjfolder')]
    check(not leftovers, f'uploaded files were kept on disk: {leftovers}')
    print('.. laptop_engine')
    laptop_engine()
    print('.. early_413')
    early_413()
    print('.. existing VirtualDJ list tests')
    existing_tests()
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    for process in servers:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(process.pid)], capture_output=True)
    time.sleep(1)
    shutil.rmtree(base, ignore_errors=True)
print('PASS: Import Playlist reads .m3u/.m3u8/.pls/.txt/.csv/Rekordbox/Serato/VirtualDJ files, matches them to the library (path, drive, name, folder, artist and title, NFC), '
      'refuses unsafe or unreadable files in plain words, caps what it returns, and writes nothing'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
