"""PEAK HOUR developer "feature check": does each feature of the app work, on this PC, in a throw-away sandbox.

  axiom-win-env\\Scripts\\python.exe check_features.py [--quick] [--ui|--no-ui] [--scale PATH] [--synthetic N]
        [--installed [DIR]] [--only AREA[,AREA]] [--list] [--legacy|--no-legacy] [--allow-sound]
        [--keep-sandbox] [--report PATH]

Order: guard self-check -> sandbox + fingerprint of the owner's real DJ files -> start the server (sandbox env,
fakes for audio, dialogs, network) -> existing test_windows_*.py scripts -> catalogue feature checks (feature_check.catalogue)
-> fingerprint verify -> report (console, report.html, report.md, results.json in feature-check-reports\\<timestamp>\\).

Exit code: 0 nothing failed, 1 at least one feature or test failed, 2 harness error (guard self-check failed, a real DJ
file changed, the server would not start).
Guard mode: environment FEATURE_CHECK_GUARD=enforce (default, blocks writes outside the sandbox and non-loopback
connects) or log (only records). See feature_check/guard.py.
"""
import os
import sys
import json
import time
import shutil
import argparse
import pathlib
import traceback
import subprocess

PROJECT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT))
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

from feature_check import sandbox as sb  # noqa: E402
from feature_check import legacy, report, real_mode  # noqa: E402
from feature_check.api import Context, Result, CheckFailed, CheckSkipped  # noqa: E402

REPORT_ROOT = PROJECT / 'feature-check-reports'
EDGES = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
# used only when the catalogue is not there yet and --quick is asked for: cheap, self-contained scripts
FALLBACK_QUICK = ['test_windows_launcher.py', 'test_windows_paths.py', 'test_windows_theme.py', 'test_windows_brand.py', 'test_windows_updates.py']


def parse(argv):
    p = argparse.ArgumentParser(prog='check_features.py', description='PEAK HOUR feature check')
    p.add_argument('--quick', action='store_true', help='only the MVP features and the existing tests that cover them')
    p.add_argument('--ui', dest='ui', action='store_true', default=None, help='run browser checks (default when Edge and node are found)')
    p.add_argument('--no-ui', dest='ui', action='store_false', help='skip browser checks')
    p.add_argument('--scale', metavar='PATH', help='a big music folder or library for the scale checks')
    p.add_argument('--synthetic', type=int, metavar='N', help='build a synthetic library of N songs for the scale checks')
    p.add_argument('--installed', nargs='?', const='', metavar='DIR', help='test the installed copy (DIR\\app, DIR\\runtime\\python.exe); default dist\\PEAK HOUR')
    p.add_argument('--only', metavar='AREA[,AREA]', help='only these catalogue areas (or feature ids)')
    p.add_argument('--list', action='store_true', help='list the features / tests and exit')
    p.add_argument('--legacy', dest='legacy', action='store_true', default=True, help='run the existing test_windows_*.py scripts (default)')
    p.add_argument('--no-legacy', dest='legacy', action='store_false', help='do not run the existing scripts')
    p.add_argument('--allow-sound', action='store_true', help='also run the two tests that play sound')
    p.add_argument('--keep-sandbox', action='store_true', help='keep fixtures\\feature-check\\<timestamp> afterwards')
    p.add_argument('--report', metavar='PATH', help='folder for the report folders (default feature-check-reports)')
    p.add_argument('--real', action='store_true', help="run against the owner's ACTUAL data (changes allowed): backup first, automatic restore after")
    p.add_argument('--restore', metavar='BACKUP_FOLDER', help='put a --real backup set back (after a crash) and exit')
    p.add_argument('--abandon', metavar='BACKUP_FOLDER', help='close a --real backup set WITHOUT restoring anything, and exit')
    p.add_argument('--inject', help=argparse.SUPPRESS)  # harness self-test: plant a known fault in the server
    return p.parse_args(argv)


def load_catalogue():
    """(features, error). A missing catalogue is not an error: only the existing tests run."""
    try:
        import importlib
        catalogue = importlib.import_module('feature_check.catalogue')
        return list(catalogue.FEATURES), None
    except ModuleNotFoundError as exc:
        if exc.name in ('feature_check.catalogue', 'catalogue'):
            return None, 'feature_check/catalogue.py does not exist yet: running the existing tests only'
        return None, 'catalogue failed to import (%r): running the existing tests only' % (exc,)
    except Exception as exc:  # noqa: BLE001
        return None, 'catalogue failed to import (%r): running the existing tests only' % (exc,)


def select_features(features, args):
    chosen = list(features)
    if args.only:
        wanted = [w.strip().lower() for w in args.only.split(',') if w.strip()]
        chosen = [f for f in chosen if f.area.lower() in wanted or f.id.lower() in wanted or any(f.id.lower().startswith(w + '.') for w in wanted)]
    if args.quick:
        chosen = [f for f in chosen if f.mvp]
    return chosen


def do_list(features, error):
    if features is None:
        print('# %s' % error)
        print('Existing tests (%d):' % len(legacy.discover()))
        for path in legacy.discover():
            reason = legacy.skip_reason(path.name)
            print('  %-48s %s' % (path.name, 'SKIP: ' + reason if reason else ''))
        return
    area = None
    for f in sorted(features, key=lambda f: (f.area, f.id)):
        if f.area != area:
            area = f.area
            print('\n[%s]' % area)
        kinds = ','.join(sorted({c.kind for c in f.checks})) or 'no checks'
        flags = ' '.join(x for x in ('MVP' if f.mvp else '', 'mac-only' if f.platform != 'windows' else '', ' '.join(f.requires)) if x)
        print('  %-28s %-44s [%s] %s' % (f.id, f.name, kinds, flags))
        if f.works_means:
            print('      works means: %s' % f.works_means)
    print('\n%d features, %d MVP' % (len(features), sum(1 for f in features if f.mvp)))


# --------------------------------------------------------------------------- guard self-check

SELFCHECK = r'''
import os, sys, json, socket, pathlib
out = {}
inside = pathlib.Path(os.environ['FEATURE_CHECK_SANDBOX']) / 'inside.txt'
outside = pathlib.Path(sys.argv[1]) / 'guard-selfcheck-outside.txt'
def attempt(name, fn):
    try:
        fn(); out[name] = 'allowed'
    except PermissionError: out[name] = 'blocked'
    except Exception as exc: out[name] = 'other:' + type(exc).__name__
def write_inside(): inside.write_text('x')
def write_outside(): outside.write_text('x')
def remove_outside(): os.remove(str(outside) + '.missing')
def rename_outside(): os.rename(str(outside) + '.missing', str(outside) + '.moved')
def mkdir_outside(): os.mkdir(str(outside) + '.dir')
def net_out():
    s = socket.socket(); s.settimeout(1)
    try: s.connect(('192.0.2.1', 9))
    finally: s.close()
def net_local():
    s = socket.socket(); s.settimeout(1)
    try: s.connect(('127.0.0.1', 9))
    finally: s.close()
for name, fn in (('write_inside', write_inside), ('write_outside', write_outside), ('remove_outside', remove_outside),
                 ('rename_outside', rename_outside), ('mkdir_outside', mkdir_outside), ('connect_external', net_out), ('connect_loopback', net_local)):
    attempt(name, fn)
print(json.dumps(out))
'''


def guard_self_check(real_env):
    """Prove the guard blocks what it should, in a child started exactly like the legacy tests. Returns (ok, message)."""
    base = PROJECT / 'fixtures' / 'feature-check'
    folder = base / ('selfcheck-' + time.strftime('%Y%m%d-%H%M%S'))
    folder.mkdir(parents=True, exist_ok=True)
    outside_dir = PROJECT / 'fixtures'
    probe = outside_dir / 'guard-selfcheck-outside.txt'
    try:
        box = sb.Sandbox(folder, real_env)
        env = box.env(guard='enforce', extra={'PYTHONPATH': str(sb.HERE)})
        folder.joinpath('guard.jsonl').touch()
        done = subprocess.run([str(sb.python_exe()), '-c', SELFCHECK, str(outside_dir)], env=env, capture_output=True, text=True, timeout=60)
        try:
            got = json.loads(done.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return False, 'self-check printed nothing usable: %s %s' % (done.stdout[-300:], done.stderr[-300:])
        want = {'write_inside': 'allowed', 'write_outside': 'blocked', 'remove_outside': 'blocked', 'rename_outside': 'blocked',
                'mkdir_outside': 'blocked', 'connect_external': 'blocked', 'connect_loopback': 'other:ConnectionRefusedError'}
        if probe.exists():
            probe.unlink()
        for leftover in (str(probe) + '.dir',):
            if os.path.isdir(leftover):
                os.rmdir(leftover)
        bad = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v and not (k == 'connect_loopback' and got.get(k, '').startswith('other:'))}
        if bad:
            return False, 'guard self-check failed (got, wanted): %s' % bad
        return True, 'guard blocks outside writes, removes, renames, mkdirs and external connects; allows sandbox writes and loopback'
    finally:
        shutil.rmtree(folder, ignore_errors=True)


# --------------------------------------------------------------------------- browser

def warm_up_edge(box, notes):
    """The first Edge started in a brand-new sandbox environment (new LOCALAPPDATA / USERPROFILE / TEMP) can need 10+ s before
    it lists a page target; later ones need under a second. The existing live-watch test waits only 10 s for that target, so
    start one throw-away headless Edge in the sandbox environment first and wait until it shows a page."""
    import json as _json
    import urllib.request
    edge = next((e for e in EDGES if os.path.isfile(e)), None)
    if not edge:
        return
    started = time.time()
    ready = False
    for attempt in range(4):     # the very first Edge in a new environment may never open its port; the next one does
        profile = box.root / ('edge-warmup-%d' % attempt)
        profile.mkdir(exist_ok=True)
        port = sb.free_port()
        proc = subprocess.Popen([edge, '--headless=new', '--remote-debugging-port=%d' % port, '--user-data-dir=%s' % profile, '--no-first-run',
                                 '--no-default-browser-check', '--disable-extensions', 'about:blank'], env=box.env(),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            tried = time.time()
            while time.time() - tried < 15 and proc.poll() is None:
                try:
                    with urllib.request.urlopen('http://127.0.0.1:%d/json' % port, timeout=2) as r:
                        if any(t.get('type') == 'page' and t.get('webSocketDebuggerUrl') for t in _json.load(r)):
                            ready = True
                            break
                except (OSError, ValueError):
                    pass
                time.sleep(0.25)
        finally:
            sb.kill_tree(proc)
        if ready:
            break
    print('edge warm-up: %s in %.1fs' % ('ready' if ready else 'NOT ready', time.time() - started))
    if not ready:
        notes.append('Edge did not show a page in 4 tries in the sandbox environment (browser checks may fail)')


def make_browser(args, box, handle, notes):
    """The UI driver from feature_check.browser (Coder B), or None with a note saying why."""
    if args.ui is False:
        return None
    edge = next((e for e in EDGES if os.path.isfile(e)), None)
    node = shutil.which('node')
    if not edge or not node:
        notes.append('UI checks skipped: %s not found' % ('Edge' if not edge else 'node'))
        return None
    try:
        import importlib
        B = importlib.import_module('feature_check.browser')
    except ModuleNotFoundError as exc:
        if exc.name in ('feature_check.browser', 'browser'):
            notes.append('UI checks skipped: feature_check/browser.py does not exist yet')
            return None
        notes.append('UI checks skipped: browser module failed to import (%r)' % (exc,))
        return None
    except Exception as exc:  # noqa: BLE001
        notes.append('UI checks skipped: browser module failed to import (%r)' % (exc,))
        return None
    try:
        return B.Browser(sandbox=box.root / 'browser', base_url=handle.base_url, port=handle.port, shots=box.shots, edge=edge, node=node)
    except Exception as exc:  # noqa: BLE001
        notes.append('UI checks skipped: browser failed to start (%r)' % (exc,))
    return None


def close_browser(browser):
    for name in ('close', 'stop', 'quit'):
        method = getattr(browser, name, None)
        if method:
            try:
                method()
            except Exception:  # noqa: BLE001
                pass
            return


# --------------------------------------------------------------------------- running checks

def result_dict(res):
    return {'status': res.status, 'seconds': round(res.seconds, 2), 'budget': res.budget, 'reason': res.reason,
            'evidence': res.evidence, 'shots': list(res.shots)}


def note_progress(ctx):
    """--real: tell the backup set the run is still alive (drives last_activity)."""
    callback = getattr(ctx, 'progress', None)
    if callback:
        callback()


def media_events(ctx):
    """How many writes to audio / video files the guard has refused so far (any process of this run)."""
    box = getattr(ctx, 'box', None)
    try:
        return sum(1 for line in box.guard_log.read_text(encoding='utf-8').splitlines() if '"media-write"' in line) if box else 0
    except OSError:
        return 0


def run_check(check, ctx, feature, handle):
    start = time.perf_counter()
    note_progress(ctx)
    ctx.last_request = None
    media_before = media_events(ctx)
    try:
        res = check.run(ctx)
        if not isinstance(res, Result):
            res = Result('PASS' if res in (None, True) else 'FAIL', reason='' if res in (None, True) else 'check returned %r' % (res,))
    except CheckSkipped as exc:
        res = Result('SKIP', reason=str(exc.args[0]) if exc.args else 'skipped')
    except CheckFailed as exc:
        res = Result('FAIL', reason=str(exc.args[0]) if exc.args else 'failed', evidence=dict(exc.args[1]) if len(exc.args) > 1 and isinstance(exc.args[1], dict) else {})
    except Exception as exc:  # noqa: BLE001
        res = Result('FAIL', reason='check crashed: %r' % (exc,), evidence={'traceback': traceback.format_exc()[-2000:]})
    if not res.seconds:
        res.seconds = time.perf_counter() - start
    if res.budget is None:
        res.budget = feature.budget_s
    if res.status == 'PASS' and res.budget and res.seconds > res.budget:
        res.status = 'FAIL'
        res.reason = 'took %.1fs, budget %gs' % (res.seconds, res.budget)
    if res.status == 'FAIL' and getattr(ctx, 'real', False) and media_events(ctx) > media_before:
        res = Result('SKIP', res.seconds, res.budget, 'would modify music files (blocked by the guard in --real mode)', {'was': res.reason})
    note_progress(ctx)
    if res.status in ('FAIL', 'WARN'):
        if ctx.last_request and 'last_request' not in res.evidence:
            res.evidence['last_request'] = ctx.last_request
        res.evidence.setdefault('server_log', handle.log_tail(40) if handle else [])
    return res


def run_feature(feature, ctx, args, legacy_results, handle):
    checks_out = []
    flaky_any = False
    for check in feature.checks:
        if check.kind == 'legacy':
            item = legacy_results.get(check.legacy)
            res = Result(item.status, item.seconds, reason=item.reason, evidence=item.evidence) if item else Result('SKIP', reason='existing test %s was not run' % check.legacy)
            flaky = False
        elif feature.platform != 'windows' and check.run is None:
            res, flaky = Result('N/A', reason='Mac only'), False
        elif check.kind == 'ui' and ctx.browser is None:
            res, flaky = Result('SKIP', reason='no browser (--no-ui, or Edge/node/browser.py missing)'), False
        elif check.kind == 'scale' and not (args.scale or args.synthetic):
            res, flaky = Result('SKIP', reason='needs --scale PATH or --synthetic N'), False
        elif check.run is None:
            res, flaky = Result('SKIP', reason='check has no code'), False
        else:
            res = run_check(check, ctx, feature, handle)
            flaky = False
            if check.kind == 'ui' and res.status == 'FAIL':
                first = res
                retry = run_check(check, ctx, feature, handle)
                if retry.status == 'PASS':
                    flaky = True
                    retry.reason = 'flaky: failed once (%s), passed on retry' % first.reason[:120]
                    retry.evidence['first_failure'] = first.evidence
                    res = retry
                else:
                    retry.shots = list(first.shots) + list(retry.shots)
                    res = retry
        row = {'kind': check.kind, 'name': check.name, 'flaky': flaky}
        row.update(result_dict(res))
        checks_out.append(row)
        flaky_any = flaky_any or flaky
    statuses = [c['status'] for c in checks_out]
    status = report.rollup(statuses)
    first_bad = next((c for c in checks_out if c['status'] in ('FAIL', 'WARN')), None) or next((c for c in checks_out if c['status'] in ('SKIP', 'N/A') and c['reason']), None)
    flaky_row = next((c for c in checks_out if c['flaky']), None)
    reason = (first_bad or flaky_row or {}).get('reason', '') if (status != 'PASS' or flaky_row) else ''
    if not checks_out:
        status, reason = 'N/A', 'no checks written yet'
    return {'id': feature.id, 'area': feature.area, 'name': feature.name, 'works_means': feature.works_means, 'status': status,
            'seconds': round(sum(c['seconds'] for c in checks_out), 2), 'budget': feature.budget_s, 'reason': reason,
            'api_only': bool(checks_out) and all(c['kind'] in ('api', 'legacy') for c in checks_out), 'flaky': flaky_any,
            'mvp': feature.mvp, 'covered_by': list(feature.covered_by), 'checks': checks_out}


def main(argv=None):
    args = parse(argv)
    features, catalogue_error = load_catalogue()
    if args.list:
        do_list(features, catalogue_error)
        return 0
    started = time.time()
    stamp = time.strftime('%Y%m%d-%H%M%S')
    real_env = dict(os.environ)
    notes = []
    if catalogue_error:
        notes.append(catalogue_error)
    harness_error = False
    guard_mode = (os.environ.get('FEATURE_CHECK_GUARD') or 'enforce').lower()
    if args.inject:
        os.environ['FEATURE_CHECK_SELFTEST'] = '1'
    if args.restore:
        return do_restore(args.restore)
    if args.abandon:
        return do_abandon(args.abandon)
    real = bool(args.real)
    if real and args.inject:
        print('HARNESS ERROR: --inject (self-test faults) cannot be combined with --real')
        return 2
    if real and guard_mode != 'enforce':
        print('HARNESS ERROR: --real needs the guard in enforce mode (FEATURE_CHECK_GUARD=%s)' % guard_mode)
        return 2

    print('PEAK HOUR feature check %s%s' % (stamp, '   *** REAL DATA MODE ***' if real else ''))
    ok, message = guard_self_check(real_env)
    print('guard self-check: %s' % ('ok - ' + message if ok else 'FAILED - ' + message))
    if not ok:
        print('HARNESS ERROR: the guard does not hold, nothing was run.')
        return 2
    if guard_mode != 'enforce':
        notes.append('guard mode is %r: violations are recorded, not blocked' % guard_mode)

    realstate = {'set': None, 'done': False, 'result': None, 'changes': None}
    if real:
        problems = real_mode.running_blockers()
        if problems:
            print('HARNESS ERROR: --real refused. Close these first: ' + '; '.join(problems))
            return 2
        pending = real_mode.unfinished_backups()
        if pending:
            print('HARNESS ERROR: --real refused: an earlier real run was not restored and verified:')
            for folder, state in pending:
                print('   %s (%s)  ->  axiom-win-env\\Scripts\\python.exe check_features.py --restore "%s"' % (folder.name, state, folder))
            return 2
    before = sb.fingerprint(sb.real_dj_files(real_env)) if not real else {}
    print('fingerprinted %d real DJ file(s): %s' % (len(before), ', '.join(pathlib.Path(p).name for p in before) or 'none'))
    box = sb.Sandbox.create(stamp=stamp)
    print('sandbox: %s' % box.root)

    handle = browser = None
    legacy_results = {}
    real_extra = None

    def finalize_real():
        """Stop the server, restore the owner's data, verify. Idempotent; runs from finally, atexit and signals."""
        if not real or realstate['done'] or realstate['set'] is None:
            return
        realstate['done'] = True
        try:
            if browser is not None:
                close_browser(browser)
        except Exception:  # noqa: BLE001
            pass
        bs = realstate['set']
        realstate['result'], realstate['changes'] = finalize_data(bs, lambda: handle.stop() if handle is not None else None)

    if real:
        import atexit
        import signal
        atexit.register(finalize_real)
        for sig in ('SIGTERM', 'SIGBREAK'):
            if hasattr(signal, sig):
                signal.signal(getattr(signal, sig), lambda *a: sys.exit(2))
    run = {'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'args': list(argv if argv is not None else sys.argv[1:]), 'notes': notes,
           'features': [], 'legacy': [], 'guard': [], 'fingerprint_changes': [], 'server_log_tail': []}
    installed = None
    if args.installed is not None:
        installed = pathlib.Path(args.installed) if args.installed else PROJECT / 'dist' / 'PEAK HOUR'
        if not (installed / 'app').is_dir():
            print('HARNESS ERROR: %s has no app folder' % installed)
            return 2

    def restart():
        try:
            sb.kill_tree(handle.proc) if handle else None
            return sb.start_server(box, installed=installed, inject=args.inject, guard=guard_mode, real_env=real_extra)
        except Exception as exc:  # noqa: BLE001
            notes.append('server could not be restarted: %s' % exc)
            return None

    try:
        selected = select_features(features, args) if features is not None else None
        if real:
            run_start = time.time()
            cfg = real_mode.plan(real_env)
            print("REAL DATA: backing up the owner's data before anything runs ...", flush=True)
            realstate['set'] = real_mode.BackupSet.create(cfg, run_start, stamp=stamp)
            realstate['set'].set(sandbox=str(box.root))
            box.guard_log = realstate['set'].guard_log  # the guard's record of everything the run creates lives with the backup
            realstate['set'].start_heartbeat()
            real_extra = real_mode.guard_env(cfg, run_start)
            notes.append("REAL DATA mode: checks ran against the owner's actual data; it was restored afterwards")
        try:
            handle = sb.start_server(box, installed=installed, inject=args.inject, guard=guard_mode, real_env=real_extra)
            if real:
                realstate['set'].set(server_pid=handle.proc.pid)
            print('server: %s%s' % (handle.base_url, ' (installed copy)' if installed else ''))
        except Exception as exc:  # noqa: BLE001
            harness_error = True
            notes.append('HARNESS ERROR: the server did not start: %s' % exc)
            print(notes[-1])

        # existing scripts (Edge is warmed up first: see warm_up_edge)
        if args.legacy and args.ui is not False:
            warm_up_edge(box, notes)
        if args.legacy:
            files = legacy.discover()
            if args.quick:
                names = set()
                if selected is not None:
                    for f in selected:
                        names.update(f.covered_by)
                        names.update(c.legacy for c in f.checks if c.legacy)
                else:
                    names.update(FALLBACK_QUICK)
                files = [p for p in files if p.name in names]
            elif selected is not None and args.only:
                names = set()
                for f in selected:
                    names.update(f.covered_by)
                    names.update(c.legacy for c in f.checks if c.legacy)
                files = [p for p in files if p.name in names]

            def progress(name, result, index, total):
                if realstate['set'] is not None:
                    realstate['set'].progress()
                print('  [%d/%d] %-5s %-46s %5.1fs %s' % (index, total, result.status, name, result.seconds, (result.reason or '')[:70]), flush=True)
            print('existing tests: %d script(s)' % len(files))
            legacy_results = legacy.run_all(files, box, allow_sound=args.allow_sound, guard=guard_mode, progress=progress)
            for name, res in legacy_results.items():
                run['legacy'].append({'name': name, 'status': res.status, 'seconds': round(res.seconds, 2), 'budget': res.budget,
                                      'reason': res.reason, 'evidence': res.evidence})
        else:
            notes.append('existing tests were not run (--no-legacy)')

        # catalogue checks
        if selected is not None and handle is not None:
            ctx = Context(handle.base_url, handle.port, box.root)
            ctx.quick = bool(args.quick)
            ctx.real = real
            ctx.progress = realstate['set'].progress if real else None
            if not real:
                os.environ['FEATURE_CHECK_VDJ_ROOTS_FAKED'] = '1'
            if args.quick:
                os.environ['FEATURE_CHECK_QUICK'] = '1'
            ctx.scale_path, ctx.synthetic, ctx.box, ctx.allow_sound = args.scale, args.synthetic, box, args.allow_sound
            if any(c.kind == 'ui' for f in selected for c in f.checks):
                browser = make_browser(args, box, handle, notes)
            ctx.browser = browser
            print('feature checks: %d feature(s)%s' % (len(selected), ' with browser' if browser else ', no browser'))
            for feature in selected:
                row = run_feature(feature, ctx, args, legacy_results, handle)
                handle = restart_handle(handle, ctx, restart) if not handle.alive() else handle
                run['features'].append(row)
                print('  %-5s %-28s %s' % (row['status'], feature.id, row['reason'][:80]), flush=True)
        elif selected is not None and handle is None:
            notes.append('feature checks not run: no server')
    except KeyboardInterrupt:
        notes.append('interrupted')
        harness_error = True
    except Exception as exc:  # noqa: BLE001
        harness_error = True
        notes.append('HARNESS ERROR: %r' % (exc,))
        notes.append(traceback.format_exc()[-1500:])
    finally:
        if browser is not None:
            close_browser(browser)
        if handle is not None:
            run['server_log_tail'] = handle.log_tail(40)
            handle.stop()
        finalize_real()

    if real and realstate['set'] is not None:
        result = realstate['result'] or {'restored': [], 'quarantined': [], 'left_behind': [], 'refused': [], 'mismatches': ['restore did not run']}
        bs = realstate['set']
        run['real'] = {'backup': bs.summary(), 'changes': realstate['changes'] or [], 'restored': result['restored'], 'quarantined': result['quarantined'],
                       'left_behind': result['left_behind'], 'mismatches': result['mismatches'], 'refused': result['refused'], 'state': bs.state.get('state'),
                       'restore_command': bs.restore_command()}
        if result['refused']:
            harness_error = True
            run['fingerprint_changes'] = list(result['refused'])
            print('\n*** YOUR DATA WAS NOT RESTORED AUTOMATICALLY:\n    ' + '\n    '.join(result['refused']) +
                  '\n    The backup set stays open. Close the DJ programs, then run:\n    %s\n    (or --abandon "%s" to keep the data as it is now)\n' % (bs.restore_command(), bs.folder))
        elif result['mismatches']:
            harness_error = True
            run['fingerprint_changes'] = ['RESTORE VERIFY FAILED: ' + m for m in result['mismatches']]
            print('\n*** RESTORE FAILED - YOUR DATA MAY NOT BE BACK. The backup is kept. Restore it with:\n    %s\n' % bs.restore_command())
        else:
            real_mode.prune()
    # did anything touch the owner's real files?
    after = sb.fingerprint(sb.real_dj_files(real_env)) if not real else {}
    changes = []
    running = None
    for path in sb.changed_paths(before, after):
        program = sb.program_of(path)
        if program:
            running = sb.running_dj_programs() if running is None else running
        text = sb.fingerprint_diff({path: before.get(path)} if path in before else {}, {path: after.get(path)} if path in after else {})[0]
        if program and program in running:
            notes.append('WARN: %s changed while %s was running (not caused by the check): %s' % (pathlib.Path(path).name, program, text[:200]))
        else:
            changes.append(text)
    if changes:
        harness_error = True
        run['fingerprint_changes'] = changes
    run['guard'] = [g for g in __import__('feature_check.guard', fromlist=['read_log']).read_log(str(box.guard_log))
                    if g.get('kind') not in ('created', 'created-dir')]
    blocked = [g for g in run['guard'] if g.get('blocked')]
    if blocked:
        notes.append('the guard blocked %d write/connect attempt(s) outside the sandbox (see Guard log)' % len(blocked))
        first = blocked[0]
        run['features'].append({'id': 'harness.guard', 'area': 'Harness', 'name': 'Guard blocked writes or connections', 'works_means': 'nothing wrote or connected outside what a run may',
                                'status': 'WARN', 'seconds': 0.0, 'budget': None, 'api_only': False, 'flaky': False, 'mvp': False, 'covered_by': [],
                                'reason': '%d blocked, e.g. %s %s' % (len(blocked), first.get('kind'), str(first.get('detail'))[:120]), 'checks': []})
    run['seconds'] = round(time.time() - started, 1)

    root = pathlib.Path(args.report) if args.report else REPORT_ROOT
    outdir = root / stamp
    previous = report.previous_results(root, stamp)
    report.write_reports(run, outdir, previous)
    print()
    if run.get('real'):
        r = run['real']
        print('*** REAL DATA (%s): backed up %d file(s), %d changed during the run, %d restored, %d moved to quarantine ***'
              % ('restored and verified' if r['state'] == 'restored' else 'NOT RESTORED', r['backup']['files'], len(r['changes']), len(r['restored']), len(r['quarantined'])))
    print(report.console_table(run))
    for note in notes:
        print('NOTE: ' + note.splitlines()[0])
    for change in changes:
        print('HARNESS ERROR (real file changed): ' + change)
    print('\nreport: %s' % (outdir / 'report.html'))

    if args.keep_sandbox or changes or (run.get('real') and (run['real']['mismatches'] or run['real']['refused'])):
        print('sandbox kept: %s' % box.root)
    else:
        box.cleanup()
    failed = any(r['status'] == 'FAIL' for r in report.all_rows(run))
    if harness_error:
        return 2
    return 1 if failed else 0


def finalize_data(bs, stop_server):
    """End of a --real run: stop the server (gracefully), then restore - unless a DJ program or PEAK HOUR is running by now.
    Returns (result, changes). Never raises."""
    empty = {'restored': [], 'quarantined': [], 'left_behind': [], 'mismatches': [], 'refused': []}
    try:
        stop_server()  # graceful first, so SQLite can checkpoint and close
    except Exception:  # noqa: BLE001
        pass
    real_mode.kill_leftover_server(bs.state)
    bs.stop_heartbeat()
    try:
        blockers = real_mode.running_blockers()
        if blockers:  # their files are theirs now: no automatic restore, the set stays open
            return dict(empty, refused=['NOT restored automatically: ' + '; '.join(blockers) + ' (started during the run?)']), bs.changes()
        # no touch() here: last_activity is the last progress the main thread reported, so a file changed after it is flagged as late
        changes = bs.changes()
        return bs.restore(confirm=None), changes
    except Exception as exc:  # noqa: BLE001
        return dict(empty, mismatches=['restore crashed: %r' % (exc,)]), []


def do_restore(folder, confirm=None, check_programs=True):
    folder = pathlib.Path(folder)
    if not (folder / 'manifest.json').is_file():
        print('HARNESS ERROR: %s has no manifest.json' % folder)
        return 2
    bs = real_mode.BackupSet.load(folder)
    if bs.state.get('state') in ('restored', 'abandoned'):
        print('%s is already %s: nothing to do' % (folder.name, bs.state['state']))
        return 0
    problems = real_mode.running_blockers() if check_programs else []
    if problems:
        print('HARNESS ERROR: close these before restoring: ' + '; '.join(problems))
        return 2
    real_mode.kill_leftover_server(bs.state)
    last = bs.state.get('last_activity')
    print('restoring %d file(s) from %s (run last active %s) ...' % (len(bs.manifest['files']), folder, real_mode._iso(last) if last else 'unknown'))

    def ask(late):
        print('\nThese backed-up files were changed AFTER the run ended (by you or a program), and differ from the backup:')
        for path, when in late[:40]:
            print('   %s   (changed %s)' % (path, when))
        if len(late) > 40:
            print('   ... and %d more' % (len(late) - 40))
        if confirm is not None:
            return confirm(late)
        if not sys.stdin or not sys.stdin.isatty():
            print('Not interactive: refusing to overwrite them. Run this in a terminal, or use --abandon to keep today\'s data.')
            return False
        return input('Overwrite them with the backed-up versions (the current ones go to quarantine)? [y/N] ').strip().lower() == 'y'

    result = bs.restore(confirm=ask)
    if result['refused']:
        print('NOT restored (nothing was changed). The set stays open: --restore again, or --abandon "%s".' % folder)
        return 2
    print('restored %d, moved %d new file(s) to quarantine, left behind %d' % (len(result['restored']), len(result['quarantined']), len(result['left_behind'])))
    for item in result['left_behind'][:20]:
        print('  left behind (newer than the run, not touched): ' + item)
    if result['mismatches']:
        print('*** VERIFY FAILED - the backup is kept:')
        for m in result['mismatches'][:30]:
            print('  ' + m)
        return 2
    print('verified: every backed-up file matches its sha256 (quarantine: %s)' % bs.quarantine_dir)
    real_mode.prune()
    return 0


def do_abandon(folder):
    folder = pathlib.Path(folder)
    if not (folder / 'state.json').is_file():
        print('HARNESS ERROR: %s is not a backup set' % folder)
        return 2
    bs = real_mode.BackupSet.load(folder) if (folder / 'manifest.json').is_file() else real_mode.BackupSet(folder)
    real_mode.kill_leftover_server(bs.state)
    bs.abandon()
    print('%s closed WITHOUT restoring: the data stays as the run left it. The backup copy is kept (it is pruned after 3 newer sets).' % folder.name)
    return 0


def restart_handle(handle, ctx, restart):
    new = restart()
    if new is not None:
        ctx.base_url, ctx.port = new.base_url, new.port
    return new if new is not None else handle


if __name__ == '__main__':
    sys.exit(main())
