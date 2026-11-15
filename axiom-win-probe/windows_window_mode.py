"""Which window PEAK HOUR opens in: its own native window (opt-in) or the Edge/Chrome app window it has always used.

    PEAKHOUR_WINDOW=native | auto   own window (pywebview + WebView2), when this PC can run it; otherwise today's window
    PEAKHOUR_WINDOW=edge | chrome   today's window (the launcher still uses the browser chosen in Settings)
    unset / anything else           today's window; except that, with the variable unset, the first line of
                                    %LOCALAPPDATA%\\AXIOM DJ\\window-mode.txt (native, edge, chrome or auto) is used
The answer's 'source' is 'env', 'file' or 'default' (nothing asked for anything).

`choose_window` only decides; the launcher acts on mode == 'native' and leaves every other answer to its existing
Edge/Chrome code. The probes below only read (import specs, registry values) and never raise: a probe that cannot tell
counts as "not available", which keeps the old window.
"""
import importlib.util
import os

WEBVIEW2_CLIENT = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'  # Evergreen WebView2 runtime
NET48_RELEASE = 528040  # "Release" value of .NET Framework 4.8 and later
PROBE_ORDER = ('pywebview', 'pythonnet', 'webview2', 'dotnet48')
LABELS = {'pywebview': 'pywebview is not installed', 'pythonnet': 'pythonnet is not installed',
          'webview2': 'the WebView2 runtime is not installed', 'dotnet48': '.NET Framework 4.8 or newer is not installed'}


def _module_present(name):
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def probe_pywebview():
    return _module_present('webview')


def probe_pythonnet():
    return _module_present('pythonnet') and _module_present('clr_loader')


def webview2_version():
    """Version text of the installed WebView2 runtime ('' when none), read from the three places EdgeUpdate records it."""
    try:
        import winreg
    except Exception:
        return ''
    best, best_text = (), ''
    places = [(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\\' + WEBVIEW2_CLIENT),
              (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\EdgeUpdate\Clients\\' + WEBVIEW2_CLIENT),
              (winreg.HKEY_CURRENT_USER, r'SOFTWARE\Microsoft\EdgeUpdate\Clients\\' + WEBVIEW2_CLIENT),
              (winreg.HKEY_CURRENT_USER, r'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\\' + WEBVIEW2_CLIENT)]
    for hive, path in places:
        try:
            with winreg.OpenKey(hive, path.replace('\\\\', '\\'), 0, winreg.KEY_READ) as key:
                text = str(winreg.QueryValueEx(key, 'pv')[0]).strip()
            parts = tuple(int(p) for p in text.split('.'))
        except (OSError, ValueError):
            continue
        if any(parts) and parts > best:  # 0.0.0.0 is what an uninstalled runtime leaves behind
            best, best_text = parts, text
    return best_text


def probe_webview2():
    try:
        return bool(webview2_version())
    except Exception:
        return False


def dotnet_release():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 0,
                            winreg.KEY_READ) as key:
            return int(winreg.QueryValueEx(key, 'Release')[0])
    except Exception:
        return 0


def probe_dotnet48():
    return dotnet_release() >= NET48_RELEASE


DEFAULT_PROBES = {'pywebview': probe_pywebview, 'pythonnet': probe_pythonnet,
                  'webview2': probe_webview2, 'dotnet48': probe_dotnet48}


def _passes(probe):
    """True/False from a probe (a function returning a truth value, or a plain bool); an exception is a failure."""
    try:
        return bool(probe() if callable(probe) else probe)
    except Exception:
        return False


def failed_probes(probes=None):
    """Names of the probes that do not pass, in PROBE_ORDER. A probe missing from `probes` is a failure."""
    probes = DEFAULT_PROBES if probes is None else probes
    return [name for name in PROBE_ORDER if name not in probes or not _passes(probes[name])]


def choose_window(env=None, probes=None):
    """{'mode': 'native' | 'edge' | 'chrome', 'reason': text}. `env` is a mapping (default os.environ); `probes` maps the
    names in PROBE_ORDER to functions (default: the real, read-only probes)."""
    try:
        env = os.environ if env is None else env
        wanted = str(env.get('PEAKHOUR_WINDOW') or '').strip().lower()
        source = 'PEAKHOUR_WINDOW=' + wanted
        kind = 'env'
        if not wanted:  # the variable is unset: the per-user file may opt in
            wanted = _from_file(env)
            source, kind = ('window-mode.txt=' + wanted, 'file') if wanted else ('', 'default')
        if wanted == 'chrome':
            return {'mode': 'chrome', 'reason': source, 'source': kind}
        if wanted == 'edge':
            return {'mode': 'edge', 'reason': source, 'source': kind}
        if wanted not in ('native', 'auto'):
            return {'mode': 'edge', 'reason': 'PEAKHOUR_WINDOW not set: the usual app window', 'source': 'default'}
        failed = failed_probes(probes)
        if failed:
            return {'mode': 'edge', 'reason': 'native window unavailable: ' + '; '.join(LABELS[n] for n in failed), 'source': kind}
        return {'mode': 'native', 'reason': source + ' and this PC can run it', 'source': kind}
    except Exception as exc:  # never let the decision stop PEAK HOUR from opening
        return {'mode': 'edge', 'reason': f'could not decide ({exc!r}): the usual app window', 'source': 'default'}


def _from_file(env):
    """First line of %LOCALAPPDATA%\\AXIOM DJ\\window-mode.txt when it is native, edge, chrome or auto; else ''. Needs LOCALAPPDATA
    in `env` (no guessing), so a test with a bare env never reads the real file."""
    try:
        base = env.get('LOCALAPPDATA')
        if not base:
            return ''
        with open(os.path.join(base, 'AXIOM DJ', 'window-mode.txt'), encoding='utf-8-sig', errors='replace') as f:
            first = f.readline(200).strip().lower()
        return first if first in ('native', 'edge', 'chrome', 'auto') else ''
    except Exception:
        return ''
