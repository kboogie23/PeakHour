r"""Plain reasons for the Studio audio check (Audio check complete ... need attention).

studio_daw.imports._duration_asset answers "Audio file is missing or is not a regular file." for every path
Path.resolve().is_file() refuses, and "Audio path or format is not permitted." for a format outside FORMATS (aac, aif,
aiff, flac, m4a, mp3, mp4, wav) or a place is_safe_location refuses. It never looks at the library: a song counts as
checked wherever its file is. On this PC the common causes of "missing" are:
  - the song's drive letter is gone (a library imported from VirtualDJ still lists F:\2022\... after the files moved to
    D:\2022\...), which this module says, and names the same file on another drive when there is one;
  - a path of 260 or more characters (Windows' limit unless LongPathsEnabled is on; Python then reports "not found");
  - a file or folder that was moved or renamed.
install() wraps the function; only the reason text changes, never a status, and a file that was ready stays ready.
"""
import ntpath
import os
import threading
import time

MISSING = 'Audio file is missing or is not a regular file.'
NOT_PERMITTED = 'Audio path or format is not permitted.'
DECODER = 'Audio decoder reported an error. No partial source duration was accepted.'
BACKSLASH = chr(92)
LIMIT = 260  # MAX_PATH, counting the terminating null


TTL = 30.0  # seconds a drive's answer is reused: one probe per drive for a whole check request
PROBE_WAIT = 2.0  # seconds a network drive gets to answer
_DRIVES = {}
_LOCK = threading.Lock()


def drive_type(root):
    """GetDriveTypeW: 0 unknown, 1 no such drive, 2 removable, 3 fixed, 4 network, 5 CD, 6 RAM disk."""
    from windows_paths import _drive_type
    return _drive_type(root)


def drive_state(drive, clock=time.monotonic):
    """'absent' (no such drive, never touched), 'down' (a network drive that did not answer) or 'ok'; once per TTL."""
    key = drive.upper()
    with _LOCK:
        known = _DRIVES.get(key)
        if known and clock() - known[0] < TTL:
            return known[1]
        kind = drive_type(key + BACKSLASH)
        if kind in (0, 1):
            state = 'absent'
        elif kind == 4:  # a dead share can stall for seconds: ask in a thread and stop waiting
            answer = []
            worker = threading.Thread(target=lambda: answer.append(os.path.isdir(key + BACKSLASH)), daemon=True)
            worker.start()
            worker.join(PROBE_WAIT)
            state = 'ok' if answer and answer[0] else 'down' if not answer else 'absent'
        else:
            state = 'ok' if os.path.isdir(key + BACKSLASH) else 'absent'
        _DRIVES[key] = (clock(), state)
        return state


def _letters():
    from windows_paths import _LOCAL_DRIVES
    for letter in 'CDEFGHIJKLMNOPQRSTUVWXYZAB':
        if drive_type(letter + ':' + BACKSLASH) in _LOCAL_DRIVES:
            yield letter


def other_drive_copy(path):
    r"""The same path on another connected local drive (F:\2022\a.mp3 -> D:\2022\a.mp3), or None."""
    drive, tail = ntpath.splitdrive(path)
    for letter in _letters():
        candidate = letter + ':' + tail
        if letter.upper() != drive[:1].upper() and os.path.isfile(candidate):
            return candidate
    return None


def missing_reason(value):
    text = os.path.expanduser(str(value))
    drive, tail = ntpath.splitdrive(text)
    state = drive_state(drive) if len(drive) == 2 and drive[1] == ':' else 'ok'
    if state == 'down':
        return ('This song is on drive %s, a network drive that is not answering. Reconnect to the network, or use '
                'Health > Reconnect Music if the file moved.' % drive.upper())
    if state == 'absent':
        found = other_drive_copy(text)
        if found:
            return ('This song is on drive %s, which is not connected to this PC any more, but the same file is on %s. '
                    'Use Health > Reconnect Music to relink it.' % (drive.upper(), found))
        return ('This song is on drive %s, which is not connected to this PC. Connect it again, or use Health > '
                'Reconnect Music if the file moved.' % drive.upper())
    if len(text) >= LIMIT:
        return ('This song\'s path is %d characters long, more than Windows allows PEAK HOUR to open (%d). Move its '
                'folder somewhere with a shorter name, then use Health > Reconnect Music.' % (len(text), LIMIT - 1))
    if os.path.isdir(text):
        return 'This is a folder, not an audio file.'
    if os.path.exists(text):
        return 'This is not a regular file (it is a device or a special item), so it cannot be checked.'
    return 'This file is no longer at that location (it was moved, renamed or deleted). Use Health > Reconnect Music to find it.'


def not_permitted_reason(value, formats):
    suffix = os.path.splitext(str(value))[1].lower()
    if suffix not in formats:
        return '%s files cannot be used in Studio; it plays %s.' % (suffix or 'This kind of', ', '.join(sorted(formats)).replace('.', ''))
    return 'This file is in a place PEAK HOUR does not read (Windows, Program Files, ProgramData or app data folders).'


def explain(value, record, formats):
    reason = record.get('reason') if isinstance(record, dict) else None
    if reason == MISSING:
        record['reason'] = missing_reason(value)
    elif reason == NOT_PERMITTED:
        record['reason'] = not_permitted_reason(value, formats)
    elif reason == DECODER:
        record['reason'] = DECODER + ' The file may be damaged: replace it with a good copy or export it again.'
    return record


def install():
    import importlib
    imports = importlib.import_module('studio_daw.imports')
    original = imports._duration_asset
    if getattr(original, '_windows_audio_check', False):
        return

    def duration_asset(value, *args, **kwargs):
        return explain(value, original(value, *args, **kwargs), imports.FORMATS)
    duration_asset._windows_audio_check = True
    imports._duration_asset = duration_asset
