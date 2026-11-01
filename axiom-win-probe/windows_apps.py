"""Opening DJ apps and showing files on Windows.

AXIOM reopens Serato after an export with app._open_mac_application, which
runs macOS "open -a" and returns False elsewhere. Here an app is found by its
Start menu name (Get-StartApps lists desktop and Store apps with the id that
"shell:AppsFolder" starts) and started through Explorer, as the Start menu
would. Nothing in the app's data is touched.
"""
import os
import subprocess

CREATE_NO_WINDOW = 0x08000000
_START_APPS = None


def start_apps(runner=subprocess.run):
    """Start menu apps as {name: app id}; read once per run."""
    global _START_APPS
    if _START_APPS is None:
        try:
            result = runner(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                             'Get-StartApps | ForEach-Object { $_.Name + "`t" + $_.AppID }'],
                            capture_output=True, text=True, timeout=20, creationflags=CREATE_NO_WINDOW)
            lines = result.stdout.splitlines() if result.returncode == 0 else []
        except (OSError, subprocess.SubprocessError):
            lines = []
        _START_APPS = dict(line.split('\t', 1) for line in lines if '\t' in line)
    return _START_APPS


def open_application(*names, runner=subprocess.run):
    """Start the first installed app with one of these Start menu names."""
    apps = {name.casefold(): app_id for name, app_id in start_apps(runner).items()}
    for name in names:
        app_id = apps.get(str(name).strip().casefold())
        if app_id and not app_id.startswith(('http:', 'https:')):
            try:
                runner(['explorer.exe', 'shell:AppsFolder\\' + app_id], timeout=10, creationflags=CREATE_NO_WINDOW)
                return True  # explorer.exe's exit code does not report whether the app started
            except (OSError, subprocess.SubprocessError):
                return False
    return False


def reveal_file(path, runner=subprocess.run):
    """Show a file selected in File Explorer."""
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    runner(['explorer.exe', '/select,', path], timeout=10)


def install(app):
    app._open_mac_application = open_application
