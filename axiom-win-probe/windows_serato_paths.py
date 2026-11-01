"""Conservative Windows resolution of Serato volume-relative track paths.

Only use when the originating Serato library volume is known. This does not
open files or establish cross-platform or real-library compatibility.
"""
import ntpath
import os

def serato_track_path(value, serato_root=None):
    if not isinstance(value, (str, os.PathLike)):
        raise ValueError('Serato track path must be text')
    raw=os.fspath(value).strip().replace('/', '\\')
    if not raw or '\x00' in raw:
        raise ValueError('Serato track path is empty or invalid')
    if raw.startswith('\\\\'):
        raise ValueError('UNC and Windows device paths require explicit support')
    drive, tail=ntpath.splitdrive(raw)
    if any(part == '..' for part in tail.split('\\')):
        raise ValueError('Serato track path contains parent traversal')
    if ':' in tail:
        raise ValueError('Serato track path contains an invalid colon')
    if drive:
        if len(drive)!=2 or not drive[0].isalpha() or not tail.startswith('\\'):
            raise ValueError('Drive-relative Serato track paths are ambiguous')
        return ntpath.normpath(drive+tail)
    if not serato_root:
        raise ValueError('The Serato library volume is required for relative paths')
    root=os.fspath(serato_root)
    rootdrive, roottail=ntpath.splitdrive(root)
    if len(rootdrive)!=2 or not rootdrive[0].isalpha() or not roottail.startswith(('\\','/')):
        raise ValueError('The Serato library must be on a known local drive')
    return ntpath.normpath(rootdrive+'\\'+tail.lstrip('\\'))

def local_drive_roots():
    """Fixed and removable drive roots ("C:\\", "E:\\"); network drives are skipped."""
    import ctypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetDriveTypeW.argtypes = [ctypes.c_wchar_p]
    kernel.GetDriveTypeW.restype = ctypes.c_uint
    return [root for root in os.listdrives() if kernel.GetDriveTypeW(root) in (2, 3)]  # REMOVABLE, FIXED

def drive_library_databases(roots=None):
    """Serato keeps a library at the root of each drive holding tracks: <drive>\\_Serato_\\database V2."""
    found = []
    for root in (local_drive_roots() if roots is None else roots):
        path = ntpath.join(root, '_Serato_', 'database V2')
        if os.path.isfile(path):
            found.append(path)
    return found

def make_database_candidates(original, roots=None):
    """Windows replacement for app._serato_database_candidates: AXIOM's own
    candidates (home library, extras) plus drive libraries in place of /Volumes."""
    def candidates(extra_paths=None):
        result = list(original(extra_paths))
        seen = {ntpath.normcase(p) for p in result}
        for path in drive_library_databases(roots):
            if ntpath.normcase(path) not in seen:
                result.append(path)
                seen.add(ntpath.normcase(path))
        return result
    return candidates

def make_relpath_resolver(original):
    """Windows replacement for app._serato_relpath_to_absolute_path.

    AXIOM's version prefixes a separator (macOS "/"), so on Windows it drops
    drive letters: "E:\\x" -> "\\x", and a C:\\...\\_Serato_ library gives
    "\\Users\\...". Drive paths are kept and relative paths get the library's
    drive; with no library, a relative path keeps AXIOM's original result.
    """
    def resolve(value, serato_root=None):
        text = os.fspath(value) if isinstance(value, (str, os.PathLike)) else value
        if isinstance(text, str):
            drive, _ = ntpath.splitdrive(text.strip().replace('/', '\\'))
            if drive or serato_root:
                try:
                    return serato_track_path(text, serato_root)
                except ValueError:
                    pass
        return original(value, serato_root)
    return resolve

def crate_relative_path(value, serato_root):
    absolute=serato_track_path(value,serato_root)
    drive,tail=ntpath.splitdrive(absolute)
    rootdrive,_=ntpath.splitdrive(os.fspath(serato_root))
    if ntpath.normcase(drive)!=ntpath.normcase(rootdrive):
        raise ValueError('A volume-relative crate cannot safely reference a different drive')
    return tail.lstrip('\\').replace('\\','/')
