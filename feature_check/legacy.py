"""Run the existing test_windows_*.py scripts as subprocesses inside the sandbox (guard on) and turn each into a Result.
PASS = exit code 0 and an output line starting with PASS. Root-level check_*.py scripts are never run."""
import os
import time
import pathlib
import subprocess

from .api import Result
from . import sandbox as sb

TIMEOUT = 300
PROJECT = sb.PROJECT
FIXTURES = PROJECT / 'fixtures'
AUDIBLE = ('test_windows_audio.py', 'test_windows_app_audio.py')  # these make sound on the real output device

# Fixtures that only exist on the owner's other machine / after a stress build. (path under the project, or an absolute path)
NEEDS = {
    'test_windows_ai.py': [FIXTURES / 'stress' / 'seed.mp3'],
    'test_windows_filetypes.py': [FIXTURES / 'stress' / 'seed.mp3'],
    'test_windows_intake.py': [FIXTURES / 'stress' / 'mp3-5000'],
    'test_windows_audio.py': [FIXTURES / 'silent.wav'],
    'test_windows_serato_export.py': [FIXTURES / 'serato-copy' / 'location.sqlite'],
    'test_windows_virtualdj_grids.py': [FIXTURES / 'vdj-copy' / 'home' / 'database.xml'],
    'test_windows_virtualdj_health.py': [FIXTURES / 'vdj-copy' / 'home' / 'database.xml'],
    'test_windows_year_fixes.py': [FIXTURES / 'health-year' / 'library_before.json'],
    'test_windows_stems.py': ['%LOCALAPPDATA%\\AXIOM\\stem-runtime'],
}


def discover(project=PROJECT):
    return sorted(pathlib.Path(project).glob('test_windows_*.py'))


def skip_reason(name, allow_sound=False, real_env=None):
    """Why this script cannot run on this PC (None = it can)."""
    real_env = real_env or os.environ
    if name in AUDIBLE and not allow_sound:
        return 'plays sound on the real output device; use --allow-sound'
    missing = []
    for need in NEEDS.get(name, []):
        need = pathlib.Path(str(need).replace('%LOCALAPPDATA%', real_env.get('LOCALAPPDATA', '')))
        if not need.exists():
            missing.append(str(need.relative_to(PROJECT)) if PROJECT in need.parents else str(need))
    if missing:
        return 'needs a fixture that is not on this PC: ' + ', '.join(missing)
    return None


def _tail(text, limit=2048):
    return text if len(text) <= limit else '...' + text[-limit:]


def run_one(path, box, allow_sound=False, timeout=TIMEOUT, guard='enforce'):
    path = pathlib.Path(path)
    reason = skip_reason(path.name, allow_sound, box.real_env)
    if reason:
        return Result('SKIP', reason=reason)
    pythonpath = str(sb.HERE) + (os.pathsep + box.real_env['PYTHONPATH'] if box.real_env.get('PYTHONPATH') else '')
    env = box.env(guard=guard, allow=[FIXTURES, PROJECT / 'probe-home'], allow_tmp=PROJECT,
                  extra={'PYTHONPATH': pythonpath, 'FEATURE_CHECK_LEGACY': '1'})
    log_before = len(_guard_lines(box))
    started = time.time()
    proc = subprocess.Popen([str(sb.python_exe()), str(path)], cwd=str(PROJECT), env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    try:
        out, err = proc.communicate(timeout=timeout)
        timed_out = False
    except subprocess.TimeoutExpired:
        sb.kill_tree(proc)
        try:
            out, err = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            out, err = '', ''
        timed_out = True
    seconds = time.time() - started
    blocked = _guard_lines(box)[log_before:]
    evidence = {'exit_code': proc.returncode, 'stdout_tail': _tail(out or ''), 'stderr_tail': _tail(err or '')}
    if blocked:
        evidence['guard'] = blocked[:10]
    if timed_out:
        return Result('FAIL', seconds, TIMEOUT, 'timed out after %ds' % timeout, evidence)
    pass_line = next((line.strip() for line in (out or '').splitlines() if line.startswith('PASS')), None)
    if proc.returncode == 0 and pass_line:
        evidence['pass_line'] = pass_line
        return Result('PASS', seconds, evidence=evidence, reason=pass_line[:160])
    if proc.returncode == 0:
        return Result('WARN', seconds, reason='exit code 0 but no line starting with PASS', evidence=evidence)
    last = next((l for l in reversed((err or out or '').strip().splitlines()) if l.strip()), '')
    return Result('FAIL', seconds, reason='exit code %s: %s' % (proc.returncode, last[:200]), evidence=evidence)


def _guard_lines(box):
    try:
        return box.guard_log.read_text(encoding='utf-8').splitlines()
    except OSError:
        return []


def run_all(files, box, allow_sound=False, guard='enforce', progress=None):
    """{file name: Result} in order; progress(name, result, index, total) is called after each."""
    results = {}
    for index, path in enumerate(files, 1):
        result = run_one(path, box, allow_sound=allow_sound, guard=guard)
        results[pathlib.Path(path).name] = result
        if progress:
            progress(pathlib.Path(path).name, result, index, len(files))
    return results
