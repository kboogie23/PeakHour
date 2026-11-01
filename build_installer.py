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

Not included: the GPU stem runtime (PyTorch + Demucs, several GB) stays a separate download, and
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


def stage(target):
    if target.exists():
        shutil.rmtree(target)
    runtime = target / 'runtime'
    shutil.copytree(base_python(), runtime)
    shutil.copytree(VENV / 'Lib' / 'site-packages', runtime / 'Lib' / 'site-packages', dirs_exist_ok=True)
    shutil.copytree(APP, target / 'app', ignore=ignore_app)
    shutil.copy2(WORK / 'installer' / 'uninstall.ps1', target / 'uninstall.ps1')
    (target / 'version.txt').write_text(version(), encoding='utf-8')
    # The packaged Python must find the libraries without the workspace's virtual environment.
    check = subprocess.run([str(runtime / 'python.exe'), '-I', '-c',
                            'import flask, numpy, sounddevice, soundfile, pedalboard, dawdreamer, imageio_ffmpeg, defusedxml, anthropic, openai; print("ok")'],
                           capture_output=True, text=True, timeout=120)
    if check.stdout.strip() != 'ok':
        raise SystemExit('The packaged Python cannot load PEAK HOUR\'s libraries:\n' + check.stderr)


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
