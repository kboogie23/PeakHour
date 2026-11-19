"""Windows versions of AXIOM features that only worked on a Mac.

  Reveal in Finder        /api/library/reveal and the duplicate archive's
                          "open folder" refused on Windows; both now open
                          File Explorer (explorer.exe /select).
  Core Audio check        _coreaudio_health_snapshot looked for macOS's audio
                          daemon and reported "Audio Repair Needed" on every
                          PC. It now checks the Windows Audio service and the
                          default sound output; "refresh" re-scans devices.
  macOS Trash             duplicate_trash.mac_trash refused off macOS. Unused
                          duplicate copies now go to the Windows Recycle Bin
                          (restorable), and the recycled file is located from
                          the Recycle Bin's own $I record so AXIOM's existing
                          content check (same SHA-256 after the move) still runs.
"""
import ctypes
import ntpath
import os
import struct
import subprocess
import time
from ctypes import wintypes
from pathlib import Path

from flask import jsonify, request

CREATE_NO_WINDOW = 0x08000000


# ------------------------------------------------------------------ File Explorer

def reveal(path, runner=subprocess.run):
    """Open File Explorer with this file selected (or this folder open)."""
    target = os.path.abspath(str(path))
    if os.path.isdir(target):
        runner(['explorer.exe', target], timeout=10)
    else:
        runner(['explorer.exe', '/select,', target], timeout=10)


def _local(fn):
    def view(*args, **kwargs):
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='This needs this PC.'), 403
        return fn(*args, **kwargs)
    view.__name__ = fn.__name__
    return view


def install_reveal(app, runner=subprocess.run):
    """Replace the Mac-only reveal routes; same checks as AXIOM's own."""
    flask_app = app.app
    endpoints = {rule.rule: rule.endpoint for rule in flask_app.url_map.iter_rules()}

    def reveal_library_track():
        data = request.get_json(silent=True) or {}
        path = str(data.get('path') or '')
        tracks = app._all_library_cache_tracks(app.load_cache(app.CACHE_PATH))
        key = ntpath.normcase(os.path.abspath(path)) if path else ''
        track = next((t for t in tracks if isinstance(t, dict) and t.get('path')
                      and ntpath.normcase(os.path.abspath(str(t['path']))) == key), None)
        if track is None:
            return jsonify(success=False, error='This file is not in the current library.'), 404
        if not os.path.isfile(track['path']):
            return jsonify(success=False, error='The file is disconnected. Reconnect its drive and try again.'), 404
        try:
            reveal(track['path'], runner)
        except (OSError, subprocess.SubprocessError):
            return jsonify(success=False, error='File Explorer could not show this file.'), 500
        return jsonify(success=True, revealed=True)

    flask_app.view_functions[endpoints['/api/library/reveal']] = _local(reveal_library_track)

    archive_endpoint = endpoints.get('/api/library/dupes/archive')
    if archive_endpoint:
        original = flask_app.view_functions[archive_endpoint]

        def duplicate_archive(*args, **kwargs):
            data = request.get_json(silent=True) if request.is_json else None
            if not isinstance(data, dict) or data.get('action') != 'reveal':
                return original(*args, **kwargs)
            origin = request.headers.get('Origin')
            if not origin or origin.rstrip('/') != request.host_url.rstrip('/'):
                return jsonify(success=False, error='Use the local Duplicate Resolver.'), 403
            from duplicate_archive import DuplicateArchive
            try:
                store = DuplicateArchive(os.path.join(app.DATA_DIR, 'duplicate_file_moves'))
                folder = Path(store._check_destination(store.load(data.get('batch_id'))))
                if not folder.is_dir():
                    raise ValueError('Reconnect the archive drive and open this folder again: ' + str(folder))
                reveal(folder, runner)
            except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
                return jsonify(success=False, error=str(exc)), 400
            return jsonify(success=True)

        flask_app.view_functions[archive_endpoint] = _local(duplicate_archive)


# ------------------------------------------------------------------ audio check

def audio_service_running(runner=subprocess.run):
    try:
        result = runner(['sc.exe', 'query', 'Audiosrv'], capture_output=True, text=True, timeout=5,
                        creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return None
    return 'RUNNING' in (result.stdout or '')


def default_output():
    """The default sound output's name (WASAPI's full name; MME cuts names at 31 characters)."""
    import sounddevice as sd
    try:
        device = sd.query_devices(kind='output')
    except Exception:
        return None
    if not isinstance(device, dict) or device.get('max_output_channels', 0) <= 0:
        return None
    try:
        for api in sd.query_hostapis():
            if 'WASAPI' in api.get('name', '') and api.get('default_output_device', -1) >= 0:
                return sd.query_devices(api['default_output_device'])['name']
    except Exception:
        pass
    return device.get('name')


def audio_snapshot(app, service=audio_service_running, output=default_output):
    """Same shape as AXIOM's Core Audio snapshot, for Windows."""
    running = service()
    device = output()
    deck = getattr(app, 'NATIVE_AUDIO_DECK', None) is not None
    if running is False:
        return {'status': 'error', 'reason': 'audio_service_stopped', 'message': 'Windows Audio is stopped',
                'daemon_running': False, 'native_bridge_available': deck, 'output_device': device}
    if not device:
        return {'status': 'error', 'reason': 'no_output_device', 'message': 'No sound output found',
                'daemon_running': running is not False, 'native_bridge_available': deck, 'output_device': None}
    return {'status': 'ok', 'reason': '', 'message': f'Windows audio is ready ({device})',
            'daemon_running': True, 'native_bridge_available': deck, 'output_device': device}


def install_audio(app, snapshot=None):
    snapshot = snapshot or (lambda: audio_snapshot(app))
    app._coreaudio_health_snapshot = lambda *args, **kwargs: snapshot()
    flask_app = app.app
    endpoints = {rule.rule: rule.endpoint for rule in flask_app.url_map.iter_rules()}

    def refresh_audio():
        before = snapshot()
        if before.get('status') == 'ok':
            return jsonify(success=True, action='not_needed', message='Audio is ready. No reset was needed.')
        deck = getattr(app, 'NATIVE_AUDIO_DECK', None)
        try:
            if deck is not None:
                deck.stop()
            import sounddevice as sd
            sd._terminate()  # re-scan sound devices (a headset or interface plugged in since start)
            sd._initialize()
        except Exception:
            pass
        after = snapshot()
        if after.get('status') == 'ok':
            return jsonify(success=True, action='repaired', message='Audio checked and ready.')
        advice = ('Start the Windows Audio service (Services app), then check again.'
                  if after.get('reason') == 'audio_service_stopped'
                  else 'Connect or turn on speakers or headphones, choose them in Windows Sound settings, then check again.')
        return jsonify(success=False, action='system_recovery_required', message=f"{after.get('message')}. {advice}",
                       requires=after.get('reason')), 409

    if '/api/performance/refresh_audio' in endpoints:
        flask_app.view_functions[endpoints['/api/performance/refresh_audio']] = _local(refresh_audio)


# ------------------------------------------------------------------ Recycle Bin

class _SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [('hwnd', wintypes.HWND), ('wFunc', wintypes.UINT), ('pFrom', wintypes.LPCWSTR),
                ('pTo', wintypes.LPCWSTR), ('fFlags', ctypes.c_ushort), ('fAnyOperationsAborted', wintypes.BOOL),
                ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', wintypes.LPCWSTR)]


FO_DELETE = 3
FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI, FOF_WANTNUKEWARNING = 0x4, 0x10, 0x40, 0x400, 0x4000
DRIVE_FIXED = 3
POLICY_KEY = r'Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'
DEFAULT_BIN_SHARE = 0.05
BIN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume'


def _volume_root(path):
    buffer = ctypes.create_unicode_buffer(1024)
    if not ctypes.WinDLL('kernel32').GetVolumePathNameW(path, buffer, 1024):
        raise OSError('Windows could not tell which drive this file is on. Nothing was moved.')
    return buffer.value


def _drive_type(root):
    return ctypes.WinDLL('kernel32').GetDriveTypeW(root)


def _reg_int(hive, subkey, field):
    import winreg
    try:
        with winreg.OpenKey(hive, subkey) as key:
            return int(winreg.QueryValueEx(key, field)[0])
    except (OSError, ValueError, TypeError):
        return None


def _bin_settings(root):
    """(NukeOnDelete, MaxCapacity in MB) from this volume's Recycle Bin settings and the Explorer policies
    (NoRecycleFiles, RecycleBinSize); None where unset. Raises OSError for a volume with no GUID (SUBST drive)."""
    import winreg
    name = ctypes.create_unicode_buffer(256)
    if not ctypes.WinDLL('kernel32').GetVolumeNameForVolumeMountPointW(root, name, 256) or '{' not in name.value:
        raise OSError(f'{root} is a virtual or substituted drive with no Recycle Bin, so the file was NOT deleted.')
    guid = name.value[name.value.find('{'):name.value.find('}') + 1]
    volume = BIN_KEY + '\\' + guid
    nuke = _reg_int(winreg.HKEY_CURRENT_USER, volume, 'NukeOnDelete')
    sizes = [_reg_int(winreg.HKEY_CURRENT_USER, volume, 'MaxCapacity')]
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        if _reg_int(hive, POLICY_KEY, 'NoRecycleFiles') == 1:
            nuke = 1
        sizes.append(_reg_int(hive, POLICY_KEY, 'RecycleBinSize'))
    sizes = [v for v in sizes if v]
    return nuke, (min(sizes) if sizes else None)


def _disk_total(root):
    total = ctypes.c_ulonglong(0)
    ok = ctypes.WinDLL('kernel32').GetDiskFreeSpaceExW(root, None, ctypes.byref(total), None)
    return total.value if ok else 0


def check_recyclable(path, drive_type=None, settings=None, disk_total=None):
    """Raise OSError (file untouched) unless Windows can really put this file in a Recycle Bin: it deletes for
    good on removable or network drives, with the bin off, or when the file is over its size."""
    root = _volume_root(path)
    if (drive_type or _drive_type)(root) != DRIVE_FIXED:
        raise OSError(f'{root} is a removable or network drive and has no Recycle Bin, so the file was NOT deleted. '
                      'Delete it in File Explorer if you really want it gone.')
    nuke, capacity = (settings or _bin_settings)(root)
    if nuke:
        raise OSError(f'The Recycle Bin on {root} is set to delete files immediately, so the file was NOT deleted.')
    size = os.path.getsize(path)
    if capacity and size > capacity * 1024 * 1024:
        raise OSError(f'The file is bigger than the Recycle Bin size set for {root} ({capacity} MB), so it was NOT deleted.')
    total = 0 if capacity else (disk_total or _disk_total)(root)  # no size stored: Windows' default is a share of the drive
    if total and size > total * DEFAULT_BIN_SHARE:
        raise OSError(f'The file is probably bigger than the Recycle Bin on {root} allows, so it was NOT deleted.')


def _shell_recycle(path):
    # FOF_WANTNUKEWARNING: last resort; Windows asks instead of deleting silently (the prompt has no owner window)
    operation = _SHFILEOPSTRUCTW(wFunc=FO_DELETE, pFrom=path + '\0\0',
                                 fFlags=FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_SILENT | FOF_NOERRORUI)
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result != 0 or operation.fAnyOperationsAborted:
        raise OSError(f'Windows could not move the file to the Recycle Bin (code {result}).')


def read_recycle_record(path):
    """Original path stored in a Recycle Bin $I file (Windows Vista+ v1, Windows 10+ v2)."""
    data = Path(path).read_bytes()
    if len(data) < 24:
        return None
    version = struct.unpack_from('<q', data, 0)[0]
    if version == 2 and len(data) >= 28:
        length = struct.unpack_from('<i', data, 24)[0]
        raw = data[28:28 + 2 * max(0, length)]
    elif version == 1:
        raw = data[24:24 + 520]
    else:
        return None
    return raw.decode('utf-16-le', 'replace').split('\0', 1)[0]


def _recycle_records(drive, root=None):
    """{$I path: mtime} the current user can see in this drive's Recycle Bin."""
    root = Path(root) if root else Path(drive + '\\', '$Recycle.Bin')
    found = {}
    try:
        folders = [entry.path for entry in os.scandir(root) if entry.is_dir()]
    except OSError:
        return found
    for folder in folders:
        try:
            for entry in os.scandir(folder):
                if entry.name.startswith('$I'):
                    found[entry.path] = entry.stat().st_mtime_ns
        except OSError:
            continue
    return found


def recycle(path, shell=_shell_recycle, bin_root=None, wait=3.0, check=check_recyclable):
    """Move one file to the Recycle Bin; returns where Windows put it (the $R file)."""
    target = os.path.abspath(str(path))
    if not os.path.isfile(target):
        raise OSError('The file is no longer there. Nothing was moved.')
    drive = ntpath.splitdrive(target)[0]
    if len(drive) != 2 or drive[1] != ':':
        raise OSError('Only files on a local drive letter can go to the Recycle Bin.')
    check(target)
    before = _recycle_records(drive, bin_root)
    shell(target)
    if os.path.exists(target):
        raise OSError('Windows did not move the file to the Recycle Bin.')
    key = ntpath.normcase(target)
    deadline = time.monotonic() + wait
    while True:  # Windows writes the $I record a moment after the move returns
        for record, stamp in _recycle_records(drive, bin_root).items():
            if before.get(record) == stamp:
                continue
            try:
                original = read_recycle_record(record)
            except OSError:
                continue
            if original and ntpath.normcase(original) == key:
                recycled = ntpath.join(ntpath.dirname(record), '$R' + ntpath.basename(record)[2:])
                if os.path.isfile(recycled):
                    return recycled
        if time.monotonic() >= deadline:
            break
        time.sleep(0.1)
    raise OSError('The file left its folder but could not be found in the Recycle Bin. Check the Recycle Bin.')


def install_recycle_bin():
    import duplicate_trash
    duplicate_trash.mac_trash = recycle
    defaults = duplicate_trash.apply.__defaults__ or ()
    if defaults:
        duplicate_trash.apply.__defaults__ = defaults[:-1] + (recycle,)


def install(app):
    if getattr(app, '_windows_mac_parity_installed', False):
        return
    install_reveal(app)
    install_audio(app)
    install_recycle_bin()
    app._windows_mac_parity_installed = True
