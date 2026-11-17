"""Playlists > Import Playlist: read an ordinary playlist file and match its songs to the library.

POST /api/windows/playlists/import   multipart, field "file" (only its content and its name are used)
  -> {success: true, format, playlists: [{name, total (entries in the file), matched_total, tracks: [library rows in file
      order, at most MAX_TRACKS_RETURNED + 1], unmatched: [{line, reason}], unmatched_total}], skipped_playlists}
  -> {success: false, error} with 400 (cannot be read) or 413 (too big) or 403 (laptop engine)

Formats: .m3u .m3u8 .pls .txt .csv, Rekordbox .xml, Serato .crate, VirtualDJ .vdjfolder (or .xml with a VirtualFolder root).
Nothing is written anywhere: the route reads the uploaded bytes and the library cache, and the page saves the sets itself
(browser storage, the same place Import Sets uses).
"""
import csv
import io
import logging
import ntpath
import os
import re
import unicodedata
import urllib.parse

from flask import Blueprint, jsonify, request

LOG = logging.getLogger('peak-hour.playlist-import')
ROUTE = '/api/windows/playlists/import'
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
FRAMING_ALLOWANCE = 64 * 1024  # multipart boundaries and headers around the file
MAX_ENTRIES = 20000      # songs per playlist
MAX_PLAYLISTS = 25       # playlists per file (Rekordbox)
UNMATCHED_SHOWN = 500    # unmatched lines returned per playlist
MAX_TRACKS_RETURNED = 3000  # the page refuses a set over this many songs, so rows are returned up to one more than this
NAME_MAX = 120
DROP_KEYS = ()           # library row fields left out of the answer (large blobs); see row_for_page
SUPPORTED = 'PEAK HOUR can\'t read this kind of file. Use .m3u, .m3u8, .pls, .txt, .csv, Rekordbox .xml, Serato .crate or VirtualDJ .vdjfolder.'
NOT_FOUND = 'Not in your library'
AMBIGUOUS = 'More than one song in your library has this file name'
DIFFERENT_SONG = 'A different song in your library has this file name'
TOO_MANY = 'This playlist has more than {:,} songs. Split it in your DJ software and import the parts.'
EMPTY_FILE = 'This file has no songs in it.'
PATH_LIKE = re.compile(r'^(?:[A-Za-z]:[\\/]|\\\\|/|file:)', re.I)
SEPARATOR = re.compile(r' [-–] ')
PATH_HEADERS = ('path', 'location', 'file', 'filename', 'file path')
TITLE_HEADERS = ('title', 'name', 'track title', 'song')
ARTIST_HEADERS = ('artist', 'artists')


class ImportProblem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def on_laptop():
    return bool(os.environ.get('AXIOM_DEVICE_ID'))


# ------------------------------------------------------------------ reading text
def _split_lines(text):
    return re.split(r'\r\n|\r|\n', text)


def _decode_text(data, utf16=False):
    if utf16 and (data.startswith(b'\xff\xfe') or data.startswith(b'\xfe\xff')):
        return data.decode('utf-16', errors='replace')
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('cp1252', errors='replace')


def _entry(line, path='', artist='', title=''):
    return {'line': line, 'path': path, 'artist': artist, 'title': title}


def _artist_title(text):
    parts = SEPARATOR.split(text.strip(), 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return '', text.strip()


def _check_count(entries):
    if len(entries) > MAX_ENTRIES:
        raise ImportProblem(TOO_MANY.format(MAX_ENTRIES))


# ------------------------------------------------------------------ text formats
def parse_m3u(data, extended_utf8=False):
    if extended_utf8:
        text = data.decode('utf-8-sig', errors='replace')
    else:
        text = _decode_text(data)
    entries, info = [], None
    for raw in _split_lines(text):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#'):
            if line.upper().startswith('#EXTINF:') and ',' in line:
                info = _artist_title(line.split(',', 1)[1])
            continue
        artist, title = info or ('', '')
        entries.append(_entry(line, path=line, artist=artist, title=title))
        info = None
        _check_count(entries)
    return entries


def parse_pls(data):
    text = _decode_text(data)
    files, titles = {}, {}
    for raw in _split_lines(text):
        match = re.match(r'^\s*(File|Title)(\d+)\s*=(.*)$', raw, re.I)
        if not match:
            continue
        kind, number, value = match.group(1).lower(), int(match.group(2)), match.group(3).strip()
        (files if kind == 'file' else titles)[number] = value
    entries = []
    for number in sorted(files):
        if not files[number]:
            continue
        artist, title = _artist_title(titles[number]) if titles.get(number) else ('', '')
        entries.append(_entry(files[number], path=files[number], artist=artist, title=title))
        _check_count(entries)
    return entries


def _line_entry(text):
    """One line of a plain text list: a path, "Artist - Title", or a title."""
    line = text.strip()
    if PATH_LIKE.match(line) or _is_media_name(line):
        return _entry(line, path=line)
    artist, title = _artist_title(line)
    return _entry(line, artist=artist, title=title)


def _is_media_name(line):
    from windows_virtualdj_library import MEDIA_EXTENSIONS
    return ntpath.splitext(line.lower())[1] in MEDIA_EXTENSIONS


def parse_txt(data):
    text = _decode_text(data, utf16=True)
    lines = _split_lines(text)
    first = next((l for l in lines if l.strip()), '')
    if first.count('\t') >= 2:
        return parse_csv_text(text, delimiter='\t')
    entries = []
    for raw in lines:
        if raw.strip():
            entries.append(_line_entry(raw))
            _check_count(entries)
    return entries


def parse_csv_text(text, delimiter=None):
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=',;\t|').delimiter
        except csv.Error:
            delimiter = ','
    rows = [row for row in csv.reader(io.StringIO(text, newline=''), delimiter=delimiter) if any(cell.strip() for cell in row)]
    if not rows:
        return []
    names = [cell.strip().lower() for cell in rows[0]]

    def column(options):
        return next((i for i, name in enumerate(names) if name in options), None)
    path_col, title_col, artist_col = column(PATH_HEADERS), column(TITLE_HEADERS), column(ARTIST_HEADERS)
    entries = []
    if path_col is None and title_col is None and artist_col is None:
        for row in rows:
            if row[0].strip():
                entries.append(_line_entry(row[0]))
                _check_count(entries)
        return entries

    def cell(row, index):
        return row[index].strip() if index is not None and index < len(row) else ''
    for row in rows[1:]:
        path, title, artist = cell(row, path_col), cell(row, title_col), cell(row, artist_col)
        if not (path or title):
            continue
        shown = path or (f'{artist} - {title}' if artist else title)
        entries.append(_entry(shown, path=path, artist=artist, title=title))
        _check_count(entries)
    return entries


def parse_csv(data):
    return parse_csv_text(_decode_text(data, utf16=True))


# ------------------------------------------------------------------ Rekordbox, Serato, VirtualDJ
def _safe_xml(data):
    from defusedxml import ElementTree as SafeET
    return SafeET.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)


def _location_text(value):
    text = str(value or '')
    return urllib.parse.unquote(text) if text.lower().startswith('file:') else text


def parse_rekordbox(root):
    """[(playlist name, entries)] for every playlist (Type="1" node) in the file, in file order."""
    collection = {}
    for track in root.iterfind('./COLLECTION/TRACK'):
        key = track.get('TrackID')
        if key is not None:
            collection[key] = track
    found = []

    def walk(node):
        for child in node.findall('NODE'):
            if child.get('Type') == '1':
                found.append(child)
            else:
                walk(child)
    holder = root.find('PLAYLISTS')
    if holder is not None:
        walk(holder)
    playlists = []
    for node in found:
        entries = []
        for item in node.findall('TRACK'):
            key = item.get('Key') or ''
            if (node.get('KeyType') or item.get('KeyType')) == '1':
                location = _location_text(key)
                entries.append(_entry(location, path=key))
            else:
                track = collection.get(key)
                if track is None:
                    entries.append(_entry('Track ' + key + ' (not described in this file)'))
                    continue
                raw = track.get('Location') or ''
                artist, title = (track.get('Artist') or '').strip(), (track.get('Name') or '').strip()
                shown = _location_text(raw) or (f'{artist} - {title}' if artist else title)
                entries.append(_entry(shown, path=raw, artist=artist, title=title))
            _check_count(entries)
        if entries:
            playlists.append((node.get('Name') or '', entries))
    return playlists


def parse_crate(data):
    from windows_crate_publish import _blocks
    entries = []
    for name, payload in _blocks(data):
        if name != 'otrk':
            continue
        for inner, body in _blocks(payload):
            if inner == 'ptrk':
                path = body.decode('utf-16-be')
                entries.append(_entry(path, path=path))
                _check_count(entries)
                break
    return entries


def parse_vdjfolder(data):
    from windows_virtualdj_lists import parse_list
    entries = []
    for song in parse_list(data)['songs']:
        path = song.get('path') or ''
        entries.append(_entry(path, path=path, artist=(song.get('artist') or '').strip(), title=(song.get('title') or '').strip()))
        _check_count(entries)
    return entries


def _base_name(filename, strip_crate_prefix=False):
    base = ntpath.basename(str(filename or '').replace('/', '\\'))
    base = ''.join(ch for ch in base if ord(ch) >= 32)
    stem = ntpath.splitext(base)[0]
    if strip_crate_prefix and '%%' in stem:
        stem = stem.rsplit('%%', 1)[1]
    return (stem.strip() or 'Imported playlist')[:NAME_MAX]


def parse_file(data, filename):
    """(format, [(name, entries)], skipped_playlists) or ImportProblem."""
    extension = ntpath.splitext(str(filename or '').lower())[1]
    kind = None
    try:
        if extension == '.m3u':
            kind = 'm3u'
            entries = parse_m3u(data)
        elif extension == '.m3u8':
            kind = 'm3u8'
            entries = parse_m3u(data, extended_utf8=True)
        elif extension == '.pls':
            kind = 'pls'
            entries = parse_pls(data)
        elif extension == '.txt':
            kind = 'txt'
            entries = parse_txt(data)
        elif extension == '.csv':
            kind = 'csv'
            entries = parse_csv(data)
        elif extension == '.crate':
            kind = 'Serato crate'
            entries = parse_crate(data)
            if not entries:
                raise ImportProblem(EMPTY_FILE)
            return kind, [(_base_name(filename, True), entries)], 0
        elif extension == '.vdjfolder':
            kind = 'VirtualDJ list'
            entries = parse_vdjfolder(data)
        elif extension == '.xml':
            try:
                root = _safe_xml(data)
            except Exception:
                raise ImportProblem('This file could not be read as a Rekordbox or VirtualDJ playlist.')
            if root.tag == 'DJ_PLAYLISTS':
                kind = 'Rekordbox'
                playlists = parse_rekordbox(root)
                if not playlists:
                    raise ImportProblem('This Rekordbox file has no playlists in it.')
                skipped = max(0, len(playlists) - MAX_PLAYLISTS)
                named = [(_clean_name(name) or _base_name(filename), entries) for name, entries in playlists[:MAX_PLAYLISTS]]
                return kind, named, skipped
            if root.tag == 'VirtualFolder':
                kind = 'VirtualDJ list'
                entries = parse_vdjfolder(data)
            else:
                raise ImportProblem('This XML file is not a Rekordbox or VirtualDJ playlist.')
        else:
            raise ImportProblem(SUPPORTED)
    except ImportProblem:
        raise
    except Exception:
        LOG.info('Playlist import: could not read %s as %s', extension, kind, exc_info=True)
        label = {'VirtualDJ list': 'VirtualDJ'}.get(kind, kind)
        raise ImportProblem(f'This file could not be read as a {label} playlist.' if label else 'This file could not be read as a playlist.')
    if not entries:
        raise ImportProblem(EMPTY_FILE)
    return kind, [(_base_name(filename), entries)], 0


def _clean_name(name):
    return ''.join(ch for ch in str(name or '') if ord(ch) >= 32).strip()[:NAME_MAX]


# ------------------------------------------------------------------ matching
def _nfc_fold(text):
    return unicodedata.normalize('NFC', text).casefold()


def _normalise_path(path, decode=False):
    text = str(path or '').strip()
    is_url = text.lower().startswith('file:')
    if is_url:
        text = re.sub(r'^file://localhost/|^file:///|^file:/', '', text, flags=re.I)
        if not re.match(r'^[A-Za-z]:|^[A-Za-z]%3A', text, re.I) and not text.startswith('\\\\'):
            text = '/' + text
    if is_url or decode:
        text = urllib.parse.unquote(text)
    if not text:
        return ''
    return _nfc_fold(ntpath.normpath(text.replace('/', '\\')))


def _path_keys(path):
    first = _normalise_path(path)
    keys = [first] if first else []
    text = str(path or '')
    if '%' in text and not text.strip().lower().startswith('file:'):
        second = _normalise_path(path, decode=True)
        if second and second not in keys:
            keys.append(second)
    return keys


def _without_drive(key):
    return ntpath.splitdrive(key)[1].lstrip('\\')


def _words(text):
    folded = unicodedata.normalize('NFKC', str(text or '')).casefold()
    folded = ''.join(ch for ch in folded if not unicodedata.category(ch).startswith('P'))
    return ' '.join(folded.split())


def _trail(key):
    return [part for part in _without_drive(key).split('\\')[:-1] if part and part != '.']


def _trail_score(a, b):
    score = 0
    for left, right in zip(reversed(a), reversed(b)):
        if left != right:
            break
        score += 1
    return score


def _same_words(a, b):
    """Equal, or one contains the other (a tag with "(Original Mix)" against one without)."""
    return bool(a) and bool(b) and (a == b or a in b or b in a)


def _agrees(entry, row):
    """False when the entry names both artist and title and the library row names a different song. An entry without
    both (a plain path line) always agrees, and so does a row with no title to compare."""
    artist, title = _words(entry['artist']), _words(entry['title'])
    if not (artist and title):
        return True
    row_artist, row_title = _words(row.get('artist')), _words(row.get('title'))
    if not row_title:
        return True

    def fits(first, second):  # first, second: the entry's words that should match the row's artist and title
        return _same_words(second, row_title) and (not row_artist or _same_words(first, row_artist))
    return fits(artist, title) or fits(title, artist)  # a list may write "Title - Artist"


class Library:
    """Indexes of the library rows, made once per request."""

    def __init__(self, rows):
        self.rows = [r for r in rows if isinstance(r, dict) and isinstance(r.get('path'), str)]
        self.exact, self.no_drive, self.names, self.pairs, self.titles = {}, {}, {}, {}, {}
        self.keys = {}
        for row in self.rows:
            key = _normalise_path(row['path'])
            if not key:
                continue
            self.keys[id(row)] = key
            self.exact.setdefault(key, row)
            self.no_drive.setdefault(_without_drive(key), {}).setdefault(key, row)
            self.names.setdefault(ntpath.basename(key), []).append(row)
            artist, title = _words(row.get('artist')), _words(row.get('title'))
            if title:
                self.titles.setdefault(title, []).append(row)
                self.pairs.setdefault((artist, title), row)

    def match(self, entry):
        """(row, None) or (None, reason)."""
        keys = _path_keys(entry['path']) if entry['path'] else []
        for key in keys:
            if key in self.exact:
                return self.exact[key], None
        for key in keys:
            same = self.no_drive.get(_without_drive(key))
            if same and len(same) == 1:
                return next(iter(same.values())), None
        reason = None
        for key in keys:
            candidates = self.names.get(ntpath.basename(key), [])
            if not candidates:
                continue
            # A file name alone can belong to another song (a list from another PC): when the entry names the song,
            # the library row must agree with it.
            agreeing = [r for r in candidates if _agrees(entry, r)]
            if not agreeing:
                reason = DIFFERENT_SONG
                continue
            if len(agreeing) == 1:
                return agreeing[0], None
            chosen = self._pick(entry, key, agreeing)
            if chosen is not None:
                return chosen, None
            reason = AMBIGUOUS
            break
        if reason == AMBIGUOUS:
            return None, reason
        artist, title = _words(entry['artist']), _words(entry['title'])
        if title and artist:
            for pair in ((artist, title), (title, artist)):
                if pair in self.pairs:
                    return self.pairs[pair], None
        elif title:
            same = self.titles.get(title, [])
            if len(same) == 1:
                return same[0], None
        return None, reason or NOT_FOUND

    def _pick(self, entry, key, candidates):
        artist, title = _words(entry['artist']), _words(entry['title'])
        if artist and title:
            same = [r for r in candidates if (_words(r.get('artist')), _words(r.get('title'))) in ((artist, title), (title, artist))]
            if len(same) == 1:
                return same[0]
        trail = _trail(key)
        scored = [(_trail_score(trail, _trail(self.keys.get(id(r), ''))), r) for r in candidates]
        best = max(score for score, _ in scored)
        top = [r for score, r in scored if score == best]
        return top[0] if best >= 1 and len(top) == 1 else None


def row_for_page(row):
    """A copy of the library row for the page's saved set, with the length in minutes the page reads."""
    copy = {k: v for k, v in row.items() if k not in DROP_KEYS}
    seconds = copy.get('duration_sec')
    if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and copy.get('duration_min') in (None, ''):
        copy['duration_min'] = round(seconds / 60, 2)
    return copy


def match_playlist(name, entries, library):
    tracks, unmatched = [], []
    unmatched_total = matched_total = 0
    for entry in entries:
        row, reason = library.match(entry)
        if row is not None:
            matched_total += 1
            if len(tracks) <= MAX_TRACKS_RETURNED:  # 3,001 rows are enough for the page to see "over 3,000"
                tracks.append(row_for_page(row))
        else:
            unmatched_total += 1
            if len(unmatched) < UNMATCHED_SHOWN:
                unmatched.append({'line': entry['line'], 'reason': reason})
    return {'name': name, 'total': len(entries), 'matched_total': matched_total, 'tracks': tracks, 'unmatched': unmatched,
            'unmatched_total': unmatched_total}


# ------------------------------------------------------------------ route
def create_blueprint(app):
    bp = Blueprint('windows_playlist_import', __name__)

    def fail(message, status):
        return jsonify(success=False, error=message), status

    @bp.post(ROUTE)
    def import_playlist():
        if on_laptop():
            return fail('Importing a playlist runs on the PC that holds the library.', 403)
        too_big = 'That file is too big to import (over 32 MB). Export just the playlist and try again.'
        if request.content_length and request.content_length > MAX_UPLOAD_BYTES + FRAMING_ALLOWANCE:
            return fail(too_big, 413)  # answered before the body is read
        try:
            upload = request.files.get('file')
        except Exception:  # the web server's own size limit, or a body that is not a form
            return fail(too_big, 413) if request.content_length and request.content_length > MAX_UPLOAD_BYTES else fail('PEAK HOUR did not receive a file.', 400)
        if upload is None:
            return fail('PEAK HOUR did not receive a file.', 400)
        data = upload.stream.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            return fail(too_big, 413)
        try:
            kind, playlists, skipped = parse_file(data, upload.filename)
            library = Library(app.load_cache(app.CACHE_PATH).get('tracks') or [])
            result = [match_playlist(name, entries, library) for name, entries in playlists]
        except ImportProblem as problem:
            return fail(problem.message, problem.status)
        except Exception:
            LOG.exception('Playlist import failed')
            return fail('This file could not be read as a playlist.', 400)
        return jsonify(success=True, format=kind, playlists=result, skipped_playlists=skipped)
    return bp


def install(app):
    if getattr(app, '_windows_playlist_import_installed', False):
        return
    app.app.register_blueprint(create_blueprint(app))
    app._windows_playlist_import_installed = True
