"""Build PEAK HOUR's Windows installer from this workspace.

  dist/PEAK HOUR/            the program as installed: runtime/ (this project's Python 3.12 with
                             every library PEAK HOUR uses), app/ (PEAK HOUR itself), version.txt,
                             uninstall.ps1
  dist/PEAK-HOUR-<v>.zip     that folder, packed
  dist/PEAK HOUR Setup <v>.exe
                             a self-extracting setup made with Windows' own IExpress: it unpacks the
                             zip and runs installer/install.ps1 (per user, no admin rights)
  dist/PEAK HOUR User Manual.html
                             the user manual (static/manual) as one file, pictures included

Not included: the stem runtime (PyTorch + Demucs, several GB) is downloaded on first use by the app
itself (windows_stem_installer.py: Studio > Stems > "Install stem engine", into the data folder), and
the program is not code-signed (that needs a certificate bought by the publisher), so Windows
SmartScreen will warn on first run.
Usage: python build_installer.py [--no-setup]
"""
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

WORK = Path(__file__).resolve().parent
APP = WORK / 'axiom-win-probe'
VENV = WORK / 'axiom-win-env'
DIST = WORK / 'dist'
SKIP_APP = {('data', 'theme-cache')}  # rebuilt on first run

# Left out of the packaged Python (runtime/) to keep the installer small. Each entry was checked: nothing in
# PEAK HOUR (plain source, AXIOM's compiled core in axiom-win-probe/*.pyc, bytecode_inventory/) or in the
# libraries it loads imports them at run time. Deliberately KEPT even though they look removable:
#   pandas, pdfplumber, pdfminer, pypdfium2   roster.pyc (AXIOM core) imports pandas and pdfplumber
#   narwhals                                  sklearn.utils.validation imports it (librosa -> sklearn)
#   tkinter, tcl/                             windows_dialogs.py uses tkinter
#   imageio_ffmpeg's ffmpeg.exe AND av.libs   launcher/windows_audio use the exe; windows_media_worker does `import av`
#   *.pyi stubs                               lazy_loader (librosa, ...) reads them at import: librosa fails without
#   __pycache__ of libraries                  saves ~10 MB zipped, but every first start would recompile them
#   dawdreamer/faustlibraries, numba headers  loaded at run time
# SKIP_*_PATHS entries match only that exact path relative to the copied root (so 'include' removes the base
# Python's include/ but never numba's or dawdreamer's include folders). SKIP_PACKAGE_NAMES/SUFFIXES/PREFIXES match at any depth.
SKIP_PYTHON_PATHS = {'include', 'libs', 'Scripts',                        # C headers, import libraries, pip.exe
                     'Lib/ensurepip', 'Lib/idlelib', 'Lib/lib2to3', 'Lib/turtledemo', 'Lib/venv', 'Lib/msilib',
                     'Lib/test', 'tcl/tix8.4.3', 'tcl/nmake'}
SKIP_PACKAGE_PATHS = {'numpy/_core/include', 'numpy/_core/lib', 'numpy/random/lib'}  # build-only headers/.lib files
SKIP_PACKAGE_NAMES = {'tests', 'pip'}                                     # libraries' own test suites; pip
SKIP_PACKAGE_SUFFIXES = ('.whl',)                                         # a 0-byte scipy wheel marker
SKIP_PACKAGE_PREFIXES = ('pip-',)                                         # pip-<v>.dist-info
SKIP_PYTHON_FILES = ('_ctypes_test.pyd', '_test')                         # CPython's own test extension modules
# After staging, these must import in the packaged Python (kept) and these must be gone (excluded).
REQUIRED_MODULES = ('flask', 'numpy', 'sounddevice', 'soundfile', 'pedalboard', 'dawdreamer', 'imageio_ffmpeg', 'defusedxml',
                    'anthropic', 'openai', 'pandas', 'pdfplumber', 'pdfminer', 'pypdfium2', 'narwhals', 'av', 'scipy', 'sklearn',
                    'librosa', 'numba', 'llvmlite', 'joblib', 'PIL', 'cryptography', 'keyring', 'mutagen', 'serato_tools',
                    'mltseratotags', 'rtmidi', 'soxr', 'requests', 'tkinter', '_tkinter', 'sqlite3', 'ssl', 'ctypes', 'unittest')
EXCLUDED_MODULES = ('pip', 'ensurepip', 'idlelib', 'venv', 'lib2to3')
# The stem engine's download is installed from these (windows_stem_installer.py: exact versions and SHA-256 of every package); the
# app folder is copied whole, but the installer must never ship without them.
REQUIRED_APP_FILES = ('stem_engine_lock_cuda.txt', 'stem_engine_lock_cpu.txt')
SKIP_FILES = {'make_90s_art.py', 'make_peak_hour_logo.py', 'make_region_backgrounds.py', 'make_regions_art.py'}


def base_python():
    home = next(line.split('=', 1)[1].strip() for line in (VENV / 'pyvenv.cfg').read_text().splitlines()
                if line.startswith('home'))
    return Path(home)


def version():
    build = json.loads((APP / 'axiom_build.json').read_text(encoding='utf-8'))
    return f"{build.get('version', '1.0')}-win"


def ignore_app(folder, names):
    rel = Path(folder).relative_to(APP).parts
    skipped = {name for name in names if (*rel, name) in SKIP_APP or tuple(rel) == () and name in SKIP_FILES}
    return skipped | {name for name in names if name.endswith(('.partial', '.tmp'))}


def ignore_runtime(root, skip_paths, package=False):
    """copytree ignore function for runtime/: the base Python (package=False) or site-packages (package=True)."""
    root = Path(root)

    def ignore(folder, names):
        rel = Path(folder).relative_to(root).as_posix()
        skipped = set()
        for name in names:
            path = name if rel == '.' else f'{rel}/{name}'
            if path in skip_paths:
                skipped.add(name)
            elif package and (name in SKIP_PACKAGE_NAMES and (Path(folder) / name).is_dir() or name.endswith(SKIP_PACKAGE_SUFFIXES)
                              or name.startswith(SKIP_PACKAGE_PREFIXES)):
                skipped.add(name)
            elif not package and rel == 'Lib/site-packages' and name.startswith(SKIP_PACKAGE_PREFIXES):
                skipped.add(name)  # pip-<v>.dist-info of the base Python's own (pip-less) site-packages
            elif not package and rel == 'DLLs' and name.startswith(SKIP_PYTHON_FILES):
                skipped.add(name)
            elif not package and rel == 'tcl' and name.endswith(('.lib', '.sh')):
                skipped.add(name)
        return skipped
    return ignore


def stage(target):
    if target.exists():
        shutil.rmtree(target)
    runtime = target / 'runtime'
    python = base_python()
    shutil.copytree(python, runtime, ignore=ignore_runtime(python, SKIP_PYTHON_PATHS | {'Lib/site-packages/pip'}))
    packages = VENV / 'Lib' / 'site-packages'
    shutil.copytree(packages, runtime / 'Lib' / 'site-packages', dirs_exist_ok=True,
                    ignore=ignore_runtime(packages, SKIP_PACKAGE_PATHS, package=True))
    shutil.copytree(APP, target / 'app', ignore=ignore_app)
    missing = [name for name in REQUIRED_APP_FILES if not (target / 'app' / name).is_file()]
    if missing:
        raise SystemExit('The package lacks the stem engine lock file(s): ' + ', '.join(missing))
    shutil.copy2(WORK / 'installer' / 'uninstall.ps1', target / 'uninstall.ps1')
    (target / 'version.txt').write_text(version(), encoding='utf-8')
    # The packaged Python must find the libraries without the workspace's virtual environment.
    code = ('import importlib, importlib.util\n'
            f'for name in {REQUIRED_MODULES!r}: importlib.import_module(name)\n'
            f'gone = [name for name in {EXCLUDED_MODULES!r} if importlib.util.find_spec(name)]\n'
            'assert not gone, "excluded modules are still packaged: %s" % gone\n'
            'print("ok")')
    check = subprocess.run([str(runtime / 'python.exe'), '-I', '-c', code], capture_output=True, text=True, timeout=300)
    if check.stdout.strip() != 'ok':
        raise SystemExit('The packaged Python cannot load PEAK HOUR\'s libraries:\n' + check.stderr)
    leftovers = [p for p in ('include', 'libs', 'Scripts', 'Lib/ensurepip', 'Lib/idlelib', 'Lib/test') if (runtime / p).exists()]
    leftovers += [str(p.relative_to(runtime)) for p in (runtime / 'Lib' / 'site-packages').rglob('tests') if p.is_dir()]
    if leftovers:
        raise SystemExit('Excluded folders are still in the package: ' + ', '.join(leftovers[:10]))


def pack(folder, archive):
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                out.write(path, path.relative_to(folder).as_posix())


def setup_exe(archive, exe):
    """Self-extracting setup with IExpress (built into Windows); runs install.ps1 on the zip."""
    work = DIST / 'iexpress'
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    shutil.copy2(archive, work / 'PEAK-HOUR.zip')
    shutil.copy2(WORK / 'installer' / 'install.ps1', work / 'install.ps1')
    (work / 'setup.cmd').write_text('@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" '
                                    '-Zip "%~dp0PEAK-HOUR.zip"\r\n', encoding='ascii')
    files = ['PEAK-HOUR.zip', 'install.ps1', 'setup.cmd']
    sed = ['[Version]', 'Class=IEXPRESS', 'SEDVersion=3', '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=0',
           'HideExtractAnimation=0', 'UseLongFileName=1', 'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0',
           'RebootMode=N', 'InstallPrompt=%InstallPrompt%', 'DisplayLicense=%DisplayLicense%', 'FinishMessage=%FinishMessage%',
           'TargetName=%TargetName%', 'FriendlyName=%FriendlyName%', 'AppLaunched=%AppLaunched%', 'PostInstallCmd=%PostInstallCmd%',
           'AdminQuietInstCmd=%AdminQuietInstCmd%', 'UserQuietInstCmd=%UserQuietInstCmd%', 'SourceFiles=SourceFiles',
           '[Strings]', 'InstallPrompt=', 'DisplayLicense=', 'FinishMessage=PEAK HOUR is installed. Open it from the Start menu or your desktop.',
           f'TargetName={exe}', 'FriendlyName=PEAK HOUR Setup', 'AppLaunched=cmd.exe /c setup.cmd', 'PostInstallCmd=<None>',
           'AdminQuietInstCmd=', 'UserQuietInstCmd=']
    sed += [f'FILE{i}="{name}"' for i, name in enumerate(files)]
    sed += ['[SourceFiles]', f'SourceFiles0={work}\\', '[SourceFiles0]'] + [f'%FILE{i}%=' for i in range(len(files))]
    (work / 'setup.sed').write_text('\r\n'.join(sed) + '\r\n', encoding='ascii')
    # IExpress fails (exit 1) when it has to overwrite the previous setup file, e.g. while it is still being
    # scanned: the previous one is set aside first and put back if the new build fails.
    previous = exe.with_name(exe.name + '.previous')
    if previous.exists():
        previous.unlink()
    if exe.exists():
        exe.rename(previous)
    try:
        subprocess.run(['iexpress.exe', '/N', '/Q', str(work / 'setup.sed')], check=True, timeout=3600)
        if not exe.is_file():
            raise SystemExit('IExpress did not produce the setup file.')
    except BaseException:
        if exe.exists():
            exe.unlink()
        if previous.exists():
            previous.rename(exe)
        raise
    if previous.exists():
        previous.unlink()
    shutil.rmtree(work)


def standalone_manual(target):
    """The user manual as one file with its pictures inside, to send or share outside PEAK HOUR."""
    import base64, re
    manual = APP / 'static' / 'manual'
    page = (manual / 'index.html').read_text(encoding='utf-8')
    picture = lambda m: 'src="data:image/jpeg;base64,' + base64.b64encode((manual / m.group(1)).read_bytes()).decode() + '"'
    target.write_text(re.sub(r'src="(img/[\w-]+\.jpg)"', picture, page), encoding='utf-8')


def main():
    DIST.mkdir(exist_ok=True)
    v = version()
    standalone_manual(DIST / 'PEAK HOUR User Manual.html')
    folder = DIST / 'PEAK HOUR'
    print("Staging", folder)
    stage(folder)
    archive = DIST / f'PEAK-HOUR-{v}.zip'
    print("Packing", archive)
    pack(folder, archive)
    if '--no-setup' not in sys.argv:
        exe = DIST / f'PEAK HOUR Setup {v}.exe'
        print("Building", exe)
        setup_exe(archive, exe)
    for path in sorted(DIST.iterdir()):
        if path.is_file():
            print(f'{path.name}: {path.stat().st_size / 1e6:.0f} MB')


if __name__ == '__main__':
    main()
