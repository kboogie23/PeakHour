"""Write cues, beat grid repairs and play counts into VirtualDJ's database.xml.

AXIOM publishes cues and grid repairs to Serato and djay and copies Serato
play counts to djay. This does the same for VirtualDJ, whose database.xml
(observed from VirtualDJ 8.5 / 2023 on Windows, CRLF lines, &apos; escapes)
stores them per <Song>:
  cue        <Poi Name="..." Pos="seconds" Num="slot" Color="ARGB" Type="cue" />
  grid       <Scan Bpm="seconds per beat" Phase="first beat" .../> and
             <Poi Pos="first beat" Type="beatgrid" />
  play count <Infos PlayCount="n" .../>

Rules:
  cues        Serato, then djay, then AXIOM's saved cues (the order AXIOM shows
              them in), into empty VirtualDJ cue slots only. A slot VirtualDJ
              already uses, or a cue already within 30 ms, is left alone.
  play counts the higher of Serato's and djay's lifetime count, by exact file
              path; a VirtualDJ count is only ever raised.
  grids       straight repairs from the VirtualDJ grid check, only while the
              song's stored grid is still the one that was checked, it has one
              beatgrid marker, and any BPM tag matches the analysed one.

Only the lines of the songs being changed are edited; every other byte of the
file stays as VirtualDJ wrote it. VirtualDJ must be closed. Each write keeps a
backup of every database it changes and a receipt, re-reads the new file and
checks that only the intended songs and values changed, and can be undone as
long as VirtualDJ has not changed the file since. Audio files are never opened
for writing.
"""
import hashlib
import json
import math
import ntpath
import os
import re
import sqlite3
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path

from defusedxml import ElementTree as SafeET
from flask import Blueprint, jsonify, request

from windows_virtualdj_database import read_database, VirtualDJDatabaseError
from windows_virtualdj_library import database_paths
from windows_virtualdj_lists import ensure_virtualdj_closed, VirtualDJListError

KINDS = ('cues', 'grids', 'play_counts')
CUE_SLOTS = 8
CUE_TOLERANCE_SECONDS = 0.03
ROW_LIMIT = 300
PREVIEWS_KEPT = 1  # the latest preview's plans are kept so that writing does not plan everything again
PREVIEW_SECONDS = 900  # ... and for how long
_SONG = re.compile(r'<Song\b(?:[^>"]|"[^"]*")*?(?:/>|>.*?</Song>)', re.S)
_TAG = r'<{name}\b(?:[^>"]|"[^"]*")*?/>'


class VirtualDJWriteError(RuntimeError):
    pass


def _key(path):
    return ntpath.normcase(ntpath.normpath(str(path)))


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _escape(value):
    return (str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&apos;'))


def _seconds(value, places):
    return f'{value:.{places}f}'


# ------------------------------------------------------------------ text edits

def songs(text):
    """[(start, end, Element)] for every <Song> in a database's text."""
    found = []
    for match in _SONG.finditer(text):
        try:
            element = SafeET.fromstring(match.group(0))
        except Exception as exc:
            raise VirtualDJWriteError('A VirtualDJ song entry could not be read') from exc
        found.append((match.start(), match.end(), element))
    return found


def _set_attributes(tag_text, values):
    """One self-closing tag's text with these attributes replaced or appended."""
    for name, value in values.items():
        pattern = re.compile(r'(\s' + re.escape(name) + r'=")[^"]*(")')
        if pattern.search(tag_text):
            tag_text = pattern.sub(lambda m: m.group(1) + _escape(value) + m.group(2), tag_text, count=1)
        else:
            end = tag_text.rstrip().rfind('/>')
            head = tag_text[:end].rstrip()
            tag_text = f'{head} {name}="{_escape(value)}"' + (' />' if tag_text[:end].endswith(' ') else '/>')
    return tag_text


def _edit_tag(fragment, name, values, where=None):
    """Replace attributes in the first <name .../> (matching where) inside a song; None if absent."""
    for match in re.finditer(_TAG.format(name=name), fragment):
        if where is None or where(match.group(0)):
            return fragment[:match.start()] + _set_attributes(match.group(0), values) + fragment[match.end():]
    return None


def _append_lines(fragment, lines, newline, song_indent):
    """Insert child lines just before </Song>, opening a self-closing <Song .../> if needed."""
    child_indent = song_indent + ' '
    existing = re.search(r'\n([ \t]*)<', fragment)
    if existing:
        child_indent = existing.group(1)
    body = ''.join(child_indent + line + newline for line in lines)
    if fragment.endswith('/>') and not fragment.endswith('</Song>'):
        return fragment[:-2].rstrip() + '>' + newline + body + song_indent + '</Song>'
    close = fragment.rfind('</Song>')
    line_start = fragment.rfind('\n', 0, close) + 1
    if fragment[line_start:close].strip():  # </Song> shares a line with content
        return fragment[:close] + newline + body + song_indent + fragment[close:]
    return fragment[:line_start] + body + fragment[line_start:]


def _poi(element, kind):
    return [p.attrib for p in element.findall('Poi') if p.get('Type') == kind]


def _signature(path):
    """(modified, size) of a file, or None when it is not there: what a plan was made from."""
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return stat.st_mtime_ns, stat.st_size


def _cue_stores(path):
    """Signatures of AXIOM's own saved-cue files for a song (what read_cues reads)."""
    try:
        from utils.cues import sidecar_path_for, legacy_sidecar_path_for
        return tuple(_signature(find(path)) for find in (sidecar_path_for, legacy_sidecar_path_for))
    except Exception:
        return ('unreadable', time.monotonic_ns())  # never equal to a later check: the plan is not reused


def _audio_signature(path):
    """What a song's cues came from: the audio file and AXIOM's saved-cue files."""
    return _signature(path), _cue_stores(path)


def _float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


# ------------------------------------------------------------------ sources

def serato_play_counts(roots=None):
    """{path key: count} from each drive's Serato library (read-only; drive-relative ids)."""
    from windows_serato_library import library_folder, system_drive
    from windows_serato_paths import local_drive_roots
    counts = {}
    sources = [(system_drive(), library_folder() / 'root.sqlite')]
    for root in (local_drive_roots() if roots is None else roots):
        drive = ntpath.splitdrive(str(root))[0].upper()
        if drive and drive != system_drive():
            sources.append((drive, Path(drive + '\\', '_Serato_', 'Library', 'location.sqlite')))
    for drive, database in sources:
        if not database.is_file():
            continue
        try:
            connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
            try:
                rows = connection.execute('SELECT portable_id, dj_play_count FROM asset WHERE dj_play_count > 0').fetchall()
            finally:
                connection.close()
        except sqlite3.Error:
            continue
        for portable, count in rows:
            if isinstance(portable, str) and isinstance(count, int) and not portable.startswith('/'):
                key = _key(drive + '\\' + portable.replace('/', '\\'))
                counts[key] = max(count, counts.get(key, 0))
    return counts


def djay_play_counts(app):
    """{path key: count} from djay's library (read-only, AXIOM's own reader)."""
    from utils.dj_transfer import read_djay_tracks
    database = getattr(app, 'DJAY_MEDIA_LIBRARY_DB', '')
    if not database or not os.path.isfile(database):
        return {}
    try:
        tracks, _errors = read_djay_tracks([database])
    except Exception:
        return {}
    counts = {}
    for path, track in (tracks or {}).items():
        count = track.get('djay_play_count') if isinstance(track, dict) else None
        if isinstance(count, int) and count > 0:
            counts[_key(path)] = max(count, counts.get(_key(path), 0))
    return counts


def source_cues(app, path):
    """(cues, source label) as AXIOM shows them: Serato, then djay, then AXIOM's saved cues."""
    for label, reader in (('Serato', getattr(app, 'read_serato_cues', None)),
                          ('djay', getattr(app, '_load_djay_cues_for_path', None)),
                          ('AXIOM', getattr(app, 'read_cues', None))):
        if not callable(reader):
            continue
        try:
            cues = reader(path)
        except Exception:
            continue
        if cues:
            return cues, label
    return [], ''


def _color(value):
    text = str(value or '').lstrip('#')
    if re.fullmatch(r'[0-9A-Fa-f]{6}', text):
        return str(0xFF000000 | int(text, 16))
    return None


def _grid_repairs(app):
    checker = getattr(app, 'WINDOWS_VIRTUALDJ_GRIDS', None)
    if checker is None:
        return {}
    state = checker.snapshot(include_results=True)
    return {_key(row['path']): row for row in state.get('results') or []
            if row.get('status') == 'repair' and row.get('repair_grid') and row.get('checked_grid')}


# ------------------------------------------------------------------ planning

def _plan_song(element, kinds, sources, app):
    """(changes, skipped) for one VirtualDJ song: changes are [{'kind', ...}]."""
    path = element.get('FilePath', '')
    key = _key(path)
    changes, skipped = [], []
    if 'cues' in kinds and os.path.isfile(path):
        cues, label = source_cues(app, path)
        existing = _poi(element, 'cue')
        used = {str(c.get('Num')) for c in existing}
        positions = [p for p in (_float(c.get('Pos')) for c in existing) if p is not None]
        for order, cue in enumerate(cues):
            index = cue.get('index', order)
            seconds = _float(cue.get('time_ms'))
            if not isinstance(index, int) or not 0 <= index < CUE_SLOTS or seconds is None or seconds < 0:
                continue
            seconds /= 1000.0
            if any(abs(seconds - p) <= CUE_TOLERANCE_SECONDS for p in positions):
                continue  # VirtualDJ already has a cue here
            if str(index + 1) in used:
                skipped.append(f'Cue {index + 1}: VirtualDJ already uses this slot')
                continue
            name = str(cue.get('label') or '').strip()
            changes.append({'kind': 'cues', 'num': index + 1, 'seconds': seconds, 'source': label,
                            'name': '' if re.fullmatch(r'(?i)cue\s*\d+', name) else name[:60],
                            'color': _color(cue.get('color'))})
            used.add(str(index + 1))
            positions.append(seconds)
    if 'play_counts' in kinds:
        serato, djay = sources['serato'].get(key, 0), sources['djay'].get(key, 0)
        best = max(serato, djay)
        infos = element.find('Infos')
        current = 0
        if infos is not None and infos.get('PlayCount') is not None:
            try:
                current = int(infos.get('PlayCount'))
            except ValueError:
                current = None
                skipped.append('Play count: VirtualDJ has a count PEAK HOUR cannot read')
        if current is not None and best > current:
            changes.append({'kind': 'play_counts', 'before': current, 'after': best,
                            'source': 'Serato' if serato >= djay else 'djay'})
    if 'grids' in kinds and key in sources['grids']:
        row = sources['grids'][key]
        scan = element.findall('Scan')
        markers = _poi(element, 'beatgrid')
        spb = _float(scan[0].get('Bpm')) if len(scan) == 1 else None
        first = _float(markers[0].get('Pos')) if len(markers) == 1 else None
        checked = row['checked_grid']
        tags = element.find('Tags')
        tag_bpm = _float(tags.get('Bpm')) if tags is not None and tags.get('Bpm') is not None else None
        if spb is None or first is None:
            skipped.append('Grid: VirtualDJ now has no single straight grid for this song')
        elif abs(spb - checked['spb']) > 1e-6 or abs(first - checked['first']) > 1e-6:
            skipped.append('Grid: changed in VirtualDJ since the grid check; check again')
        elif tag_bpm is not None and abs(tag_bpm - spb) > 1e-5:
            skipped.append('Grid: the song has a BPM set by hand in VirtualDJ')
        else:
            repair = row['repair_grid']
            changes.append({'kind': 'grids', 'before': {'spb': spb, 'first': first},
                            'after': {'spb': repair['spb'], 'first': repair['first']},
                            'bpm_before': round(60.0 / spb, 2), 'bpm_after': round(60.0 / repair['spb'], 2),
                            'tag_bpm': tag_bpm is not None})
    return changes, skipped


def _apply_song(fragment, element, changes, newline, song_indent):
    """The song's text with these changes made (line edits only)."""
    lines = []
    for change in changes:
        if change['kind'] == 'cues':
            attrs = []
            if change['name']:
                attrs.append(f'Name="{_escape(change["name"])}"')
            attrs.append(f'Pos="{_seconds(change["seconds"], 3)}"')
            attrs.append(f'Num="{change["num"]}"')
            if change['color']:
                attrs.append(f'Color="{change["color"]}"')
            lines.append('<Poi ' + ' '.join(attrs) + ' Type="cue" />')
        elif change['kind'] == 'play_counts':
            edited = _edit_tag(fragment, 'Infos', {'PlayCount': str(change['after'])})
            if edited is None:
                lines.insert(0, f'<Infos PlayCount="{change["after"]}" />')
            else:
                fragment = edited
        elif change['kind'] == 'grids':
            spb, first = _seconds(change['after']['spb'], 6), _seconds(change['after']['first'], 6)
            scan = re.search(_TAG.format(name='Scan'), fragment)
            values = {'Bpm': spb, 'Phase': first} if scan and ' Phase="' in scan.group(0) else {'Bpm': spb}
            edited = _edit_tag(fragment, 'Scan', values)
            edited = edited and _edit_tag(edited, 'Poi', {'Pos': first}, lambda tag: 'Type="beatgrid"' in tag)
            if edited and change['tag_bpm']:
                edited = _edit_tag(edited, 'Tags', {'Bpm': spb})
            if not edited:
                raise VirtualDJWriteError('A VirtualDJ grid could not be edited safely')
            fragment = edited
    if lines:
        fragment = _append_lines(fragment, lines, newline, song_indent)
    return fragment


def plan_database(database, kinds, sources, app):
    """Plan for one database file: text before/after and per-song changes."""
    data = Path(database).read_bytes()
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    pieces, cursor, rows, skipped, audio = [], 0, [], [], {}
    for start, end, element in songs(text):
        path = element.get('FilePath', '')
        if 'cues' in kinds:  # cues are read from the audio file and AXIOM's cue files: remember which versions
            audio[path] = _audio_signature(path)
        changes, skips = _plan_song(element, kinds, sources, app)
        if skips:
            skipped.append({'path': path, 'reasons': skips})
        if not changes:
            continue
        line_start = text.rfind('\n', 0, start) + 1
        indent = text[line_start:start] if not text[line_start:start].strip() else ''
        pieces.append(text[cursor:start])
        pieces.append(_apply_song(text[start:end], element, changes, newline, indent))
        cursor = end
        tags = element.find('Tags')
        rows.append({'path': path, 'title': (tags.get('Title') if tags is not None else '') or ntpath.basename(path),
                     'artist': (tags.get('Author') if tags is not None else '') or '', 'changes': changes})
    pieces.append(text[cursor:])
    return {'database': str(database), 'before': data, 'after': ''.join(pieces).encode('utf-8'),
            'rows': rows, 'skipped': skipped, 'audio': audio}


def verify(plan, scratch):
    """Re-read the new text and check that only the planned songs and values changed.
    The copies are read from AXIOM's own scratch folder, never VirtualDJ's."""
    Path(scratch).mkdir(parents=True, exist_ok=True)
    probe = Path(scratch) / f'verify-{uuid.uuid4().hex}.xml'
    try:
        probe.write_bytes(plan['before'])
        before = read_database(probe)['tracks']
        probe.write_bytes(plan['after'])
        after = read_database(probe)['tracks']
    finally:
        try:
            probe.unlink()
        except OSError:
            pass
    if len(before) != len(after):
        raise VirtualDJWriteError('The new VirtualDJ database would have a different number of songs')
    planned = {_key(row['path']): row['changes'] for row in plan['rows']}
    for old, new in zip(before, after):
        if old['path'] != new['path']:
            raise VirtualDJWriteError('The new VirtualDJ database would reorder songs')
        changes = planned.get(_key(old['path']))
        if not changes:
            if old != new:
                raise VirtualDJWriteError('A song PEAK HOUR did not plan to change would change')
            continue
        kinds = {c['kind'] for c in changes}
        sections_old, sections_new = old['source_sections'], new['source_sections']
        for name in set(sections_old) | set(sections_new):
            if name == 'Poi' and kinds & {'cues', 'grids'}:
                continue
            if name == 'Infos' and 'play_counts' in kinds:
                continue
            if name == 'Scan' and 'grids' in kinds:
                continue
            if name == 'Tags' and 'grids' in kinds:
                continue
            if sections_old.get(name) != sections_new.get(name):
                raise VirtualDJWriteError(f'{name} would change unexpectedly for {old["path"]}')
        if old['source_attributes'] != new['source_attributes']:
            raise VirtualDJWriteError('A song entry would change unexpectedly')
        old_poi = [p['attributes'] for p in sections_old.get('Poi', [])]
        new_poi = [p['attributes'] for p in sections_new.get('Poi', [])]
        for change in changes:
            if change['kind'] == 'cues':
                wanted = [p for p in new_poi if p.get('Type') == 'cue' and p.get('Num') == str(change['num'])]
                if len(wanted) != 1 or abs(float(wanted[0]['Pos']) - change['seconds']) > 0.0006:
                    raise VirtualDJWriteError('A cue did not read back as planned')
            elif change['kind'] == 'play_counts':
                infos = sections_new.get('Infos') or [{}]
                if infos[0].get('attributes', {}).get('PlayCount') != str(change['after']):
                    raise VirtualDJWriteError('A play count did not read back as planned')
                rest_old = {k: v for k, v in (sections_old.get('Infos') or [{}])[0].get('attributes', {}).items() if k != 'PlayCount'}
                rest_new = {k: v for k, v in infos[0].get('attributes', {}).items() if k != 'PlayCount'}
                if rest_old != rest_new:
                    raise VirtualDJWriteError('Song details other than the play count would change')
            elif change['kind'] == 'grids':
                scan = sections_new['Scan'][0]['attributes']
                marker = [p for p in new_poi if p.get('Type') == 'beatgrid']
                if (abs(float(scan['Bpm']) - change['after']['spb']) > 1e-6 or len(marker) != 1
                        or abs(float(marker[0]['Pos']) - change['after']['first']) > 1e-6
                        or ('Phase' in scan and abs(float(scan['Phase']) - change['after']['first']) > 1e-6)):
                    raise VirtualDJWriteError('A grid did not read back as planned')
        # Existing cues stay as they were (new ones are appended); other markers never change.
        old_cues = [p for p in old_poi if p.get('Type') == 'cue']
        new_cues = [p for p in new_poi if p.get('Type') == 'cue']
        added = sum(c['kind'] == 'cues' for c in changes)
        if new_cues[:len(old_cues)] != old_cues or len(new_cues) != len(old_cues) + added:
            raise VirtualDJWriteError('Existing VirtualDJ cue points would change')
        if [p for p in old_poi if p.get('Type') not in ('cue', 'beatgrid')] != \
                [p for p in new_poi if p.get('Type') not in ('cue', 'beatgrid')]:
            raise VirtualDJWriteError('Other VirtualDJ markers would change')
        if 'grids' not in kinds and [p for p in old_poi if p.get('Type') == 'beatgrid'] != \
                [p for p in new_poi if p.get('Type') == 'beatgrid']:
            raise VirtualDJWriteError('A VirtualDJ grid would change unexpectedly')


# ------------------------------------------------------------------ writer

class VirtualDJWriter:
    def __init__(self, app, root, databases=database_paths, ensure_closed=ensure_virtualdj_closed):
        self.app = app
        self.root = Path(root)
        self.databases = databases
        self.ensure_closed = ensure_closed
        self._lock = threading.Lock()
        self._previews = OrderedDict()  # preview token -> the plans it showed, newest last
        self._previews_lock = threading.Lock()

    def _sources(self, kinds):
        return {'serato': serato_play_counts() if 'play_counts' in kinds else {},
                'djay': djay_play_counts(self.app) if 'play_counts' in kinds else {},
                'grids': _grid_repairs(self.app) if 'grids' in kinds else {}}

    def _plans(self, kinds):
        kinds = tuple(k for k in KINDS if k in set(kinds or ()))
        if not kinds:
            raise ValueError('Choose cue points, beat grid repairs or play counts.')
        databases = list(self.databases())
        if not databases:
            raise ValueError('No VirtualDJ database was found on this PC.')
        return self._plan_all(kinds, databases, self._sources(kinds))

    def _plan_all(self, kinds, databases, sources):
        plans = []
        for database in databases:
            try:
                plans.append(plan_database(database, kinds, sources, self.app))
            except (OSError, UnicodeDecodeError, VirtualDJWriteError) as exc:
                raise VirtualDJWriteError(f'{database}: {exc}') from exc
        token = _sha(json.dumps([kinds] + [[p['database'], _sha(p['before']), _sha(p['after'])] for p in plans]).encode())
        return kinds, plans, token, sources

    @staticmethod
    def _summary(kinds, plans):
        counts = {kind: 0 for kind in kinds}
        rows, skipped = [], []
        for plan in plans:
            for row in plan['rows']:
                for change in row['changes']:
                    counts[change['kind']] += 1
                if len(rows) < ROW_LIMIT:
                    rows.append(dict(row, database=plan['database']))
            skipped.extend(plan['skipped'])
        return {'counts': counts, 'songs': sum(len(p['rows']) for p in plans), 'rows': rows,
                'skipped': skipped[:ROW_LIMIT], 'skipped_count': len(skipped),
                'databases': [{'path': p['database'], 'songs': len(p['rows'])} for p in plans]}

    def preview(self, kinds):
        djay = _signature(getattr(self.app, 'DJAY_MEDIA_LIBRARY_DB', '') or '')  # taken before planning reads it
        kinds, plans, token, sources = self._plans(kinds)
        for plan in plans:
            if plan['rows']:
                verify(plan, self.root / 'scratch')
        # Kept small: the database as a hash only (apply reads the file again and backs up what it finds),
        # the new text only for databases that change.
        kept = [dict(plan, before=None, before_sha=_sha(plan['before']), after=plan['after'] if plan['rows'] else None)
                for plan in plans]
        now = time.monotonic()
        with self._previews_lock:
            for old in [t for t, e in self._previews.items() if now - e['at'] > PREVIEW_SECONDS]:
                del self._previews[old]
            self._previews[token] = {'kinds': kinds, 'plans': kept, 'sources': sources, 'djay': djay, 'at': now}
            self._previews.move_to_end(token)
            while len(self._previews) > PREVIEWS_KEPT:
                self._previews.popitem(last=False)
        return dict(self._summary(kinds, plans), success=True, kinds=list(kinds), preview_token=token,
                    writes_to='nothing (preview)', undo=self.undo_status())

    def _previewed(self, kinds, token):
        """The plans of this preview (with the databases' current bytes as 'before') when nothing they were made
        from has changed since: each database file byte for byte (sha256), each audio file and AXIOM's saved-cue
        files of that song (modified time and size), djay's media library file (modified time and size), and the
        Serato/djay play counts and grid repairs (compared as read). Else None."""
        kinds = tuple(k for k in KINDS if k in set(kinds or ()))
        with self._previews_lock:
            entry = self._previews.get(token)
        if not entry or entry['kinds'] != kinds or time.monotonic() - entry['at'] > PREVIEW_SECONDS:
            return None
        try:
            if [str(d) for d in self.databases()] != [p['database'] for p in entry['plans']]:
                return None
            if 'cues' in kinds and _signature(getattr(self.app, 'DJAY_MEDIA_LIBRARY_DB', '') or '') != entry['djay']:
                return None
            plans = []
            for plan in entry['plans']:
                data = Path(plan['database']).read_bytes()
                if _sha(data) != plan['before_sha']:
                    return None
                if any(_audio_signature(path) != signature for path, signature in plan['audio'].items()):
                    return None
                plans.append(dict(plan, before=data))
            if self._sources(kinds) != entry['sources']:
                return None
        except OSError:
            return None
        return kinds, plans

    def apply(self, kinds, token):
        with self._lock:
            self.ensure_closed()
            previewed = self._previewed(kinds, token)
            if previewed:
                kinds, plans = previewed
            else:  # nothing kept, expired or something changed since: plan again, as a preview would
                kinds, plans, current, _sources = self._plans(kinds)
                if token != current:
                    raise VirtualDJWriteError('The VirtualDJ library or the sources changed. Preview again before writing.')
            changed = [p for p in plans if p['rows']]
            if not changed:
                return dict(self._summary(kinds, plans), success=True, written=0, message='Nothing to write.')
            for plan in changed:
                verify(plan, self.root / 'scratch')
            identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
            folder = self.root / identifier
            folder.mkdir(parents=True)
            receipt = {'kind': 'axiom_virtualdj_write', 'id': identifier, 'created_at': time.time(), 'kinds': list(kinds),
                       'status': 'writing', 'databases': []}
            for number, plan in enumerate(changed):
                backup = folder / f'database-{number + 1}.xml'
                backup.write_bytes(plan['before'])
                receipt['databases'].append({'path': plan['database'], 'backup': str(backup),
                                             'before_sha256': _sha(plan['before']), 'after_sha256': _sha(plan['after']),
                                             'songs': len(plan['rows'])})
            receipt['summary'] = self._summary(kinds, plans)
            self._save(folder, receipt)
            self.ensure_closed()
            written = []
            try:
                for plan, entry in zip(changed, receipt['databases']):
                    target = Path(plan['database'])
                    if _sha(target.read_bytes()) != entry['before_sha256']:
                        raise VirtualDJWriteError('VirtualDJ changed its database while PEAK HOUR was writing')
                    _replace(target, plan['after'])
                    written.append(entry)
                    if _sha(target.read_bytes()) != entry['after_sha256']:
                        raise VirtualDJWriteError('The VirtualDJ database did not read back as written')
            except Exception as error:
                failed = []
                for entry in written:  # put back what this write already changed; one failing must not stop the rest
                    try:
                        _replace(Path(entry['path']), Path(entry['backup']).read_bytes())
                    except Exception:
                        failed.append(entry['path'])
                receipt['status'] = 'rolled_back' if not failed else 'rollback_failed'
                try:
                    self._save(folder, receipt)
                except OSError:
                    pass
                if failed:
                    raise VirtualDJWriteError(f'{error} PEAK HOUR could not put back {", ".join(failed)}; '
                                              f'the backup is in {folder}.') from error
                raise
            with self._previews_lock:
                self._previews.clear()  # the databases are different now
            receipt['status'] = 'written'
            self._save(folder, receipt)
            return dict(receipt['summary'], success=True, written=sum(e['songs'] for e in written), receipt=identifier,
                        backups=[e['backup'] for e in written], undo=self.undo_status(),
                        message='Written to VirtualDJ. A backup was kept and this can be undone.')

    def _save(self, folder, receipt):
        stage = folder / 'receipt.json.tmp'
        stage.write_text(json.dumps(receipt, indent=1), encoding='utf-8')
        os.replace(stage, folder / 'receipt.json')

    def _latest(self):
        receipts = []
        for path in self.root.glob('*/receipt.json') if self.root.is_dir() else []:
            try:
                receipt = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if receipt.get('kind') == 'axiom_virtualdj_write' and receipt.get('status') == 'written':
                receipts.append((receipt.get('created_at', 0), path.parent, receipt))
        return max(receipts, key=lambda item: item[0])[1:] if receipts else (None, None)

    def undo_status(self):
        folder, receipt = self._latest()
        if not receipt:
            return {'available': False}
        current = all(Path(e['path']).is_file() and _sha(Path(e['path']).read_bytes()) == e['after_sha256']
                      for e in receipt['databases'])
        return {'available': current, 'id': receipt['id'], 'created_at': receipt['created_at'], 'kinds': receipt['kinds'],
                'songs': sum(e['songs'] for e in receipt['databases']),
                'reason': '' if current else 'VirtualDJ has changed its database since this write, so it cannot be undone safely.'}

    def undo(self):
        with self._lock:
            self.ensure_closed()
            folder, receipt = self._latest()
            if not receipt:
                raise VirtualDJWriteError('There is no VirtualDJ write to undo.')
            for entry in receipt['databases']:
                if _sha(Path(entry['path']).read_bytes()) != entry['after_sha256']:
                    raise VirtualDJWriteError('VirtualDJ has changed its database since this write, so it cannot be undone safely.')
                if _sha(Path(entry['backup']).read_bytes()) != entry['before_sha256']:
                    raise VirtualDJWriteError('The backup for this write is damaged. Nothing was changed.')
            for entry in receipt['databases']:
                _replace(Path(entry['path']), Path(entry['backup']).read_bytes())
            with self._previews_lock:
                self._previews.clear()
            receipt.update(status='undone', undone_at=time.time())
            self._save(folder, receipt)
            return {'success': True, 'restored': [e['path'] for e in receipt['databases']], 'undo': self.undo_status()}


def _replace(target, data):
    """Write data next to target, flush it to disk, then swap it in (keeps the file whole on a crash)."""
    stage = target.with_name(f'.{target.name}.axiom-{uuid.uuid4().hex[:8]}.tmp')
    try:
        with open(stage, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(stage, target)
    finally:  # a failed write or swap must not leave the stage file in VirtualDJ's folder
        try:
            stage.unlink()
        except OSError:
            pass


def create_write_blueprint(writer, license_guard):
    bp = Blueprint('windows_virtualdj_write', __name__)

    @bp.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Writing to VirtualDJ requires this PC'), 403
        origin = request.headers.get('Origin')
        if request.method != 'GET' and (not origin or origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Writing to VirtualDJ requires a same-origin request'), 403

    def respond(action):
        try:
            return jsonify(action())
        except (ValueError, OSError, VirtualDJWriteError, VirtualDJListError, VirtualDJDatabaseError) as exc:
            return jsonify(success=False, error=str(exc)), 400

    @bp.get('/api/windows/virtualdj/write/status')
    def status():
        return jsonify(success=True, undo=writer.undo_status())

    @bp.post('/api/windows/virtualdj/write/preview')
    def preview():
        gate = license_guard('Write to VirtualDJ')
        if gate:
            return gate
        data = request.get_json(silent=True) or {}
        return respond(lambda: writer.preview(data.get('kinds') or []))

    @bp.post('/api/windows/virtualdj/write/apply')
    def apply():
        gate = license_guard('Write to VirtualDJ')
        if gate:
            return gate
        data = request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return jsonify(success=False, error='Confirm writing to VirtualDJ first.'), 400
        return respond(lambda: writer.apply(data.get('kinds') or [], data.get('preview_token')))

    @bp.post('/api/windows/virtualdj/write/undo')
    def undo():
        gate = license_guard('Write to VirtualDJ')
        if gate:
            return gate
        return respond(writer.undo)
    return bp
