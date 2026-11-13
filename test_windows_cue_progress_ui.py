"""The Sync to DJ cue dialog: songs choice, progress text/bar, job polling and the "never looks frozen" wording, run in node
against windows-virtualdj-write.js with a minimal fake page (no browser needed)."""
import pathlib, subprocess, sys, tempfile, traceback
root = pathlib.Path(__file__).resolve().parent
script = root / 'axiom-win-probe' / 'static' / 'js' / 'shared' / 'windows-virtualdj-write.js'
HARNESS = r"""
const fs = require('fs'), vm = require('vm'), assert = require('assert');
global.window = {};
global.document = {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: {}, createElement: () => ({}), body: {}};
global.MutationObserver = class { observe() {} };
vm.runInThisContext(fs.readFileSync(process.argv[2], 'utf8'));
const T = window.AxiomVirtualDJWrite._test;
const n = v => Number(v).toLocaleString();
(async () => {
  assert.strictEqual(T.progressText({phase: 'checking', done: 1234, total: 21000, current_title: 'Song A'}), `Checking ${n(1234)} of ${n(21000)} songs — Song A`);
  assert.strictEqual(T.progressText({phase: 'writing', done: 2, total: 60, current_title: 'B'}), `Writing 2 of 60 songs — B`);
  assert.strictEqual(T.progressText({phase: 'checking', done: 0, total: 0, current_title: ''}), 'Starting…');
  const bar = {max: 0, value: 0, removed: [], removeAttribute(name) { this.removed.push(name); }}, text = {textContent: ''};
  T.renderProgress({bar, text}, {phase: 'checking', done: 5, total: 20, current_title: 'X'});
  assert.deepStrictEqual([bar.max, bar.value, text.textContent], [20, 5, `Checking 5 of 20 songs — X`]);
  T.renderProgress({bar, text}, {phase: 'checking', done: 0, total: 0, current_title: 'Listing the songs in Serato'});
  assert.deepStrictEqual(bar.removed, ['value']);  // no total yet: an indeterminate bar, not a frozen one
  // the poll follows a job until it is not running any more
  const seen = [], answers = [{state: 'running', done: 1, total: 3}, {state: 'running', done: 2, total: 3}, {state: 'done', done: 3, total: 3, result: {ok: 1}}];
  const urls = [];
  global.fetch = async url => { urls.push(url); return {ok: true, json: async () => ({success: true, ...answers.shift()})}; };
  const final = await T.pollJob('/api/windows/serato/cues/', 'abc123', job => seen.push(job.done), 1);
  assert.deepStrictEqual(seen, [1, 2, 3]);
  assert.strictEqual(final.state, 'done');
  assert.ok(urls.every(u => u === '/api/windows/serato/cues/job/abc123'), urls);
  global.fetch = async () => ({ok: false, json: async () => ({success: false, error: 'There is no such job.'})});
  await assert.rejects(T.pollJob('/x/', 'gone', () => {}, 1), /no such job/);
  // songs: a playlist or set by default, the whole library only when chosen
  const sets = [{id: 'studio', label: 's', tracks: ['a.mp3', 'b.mp3']}, {id: 'p:2', label: 'p', tracks: ['c.mp3']}];
  assert.strictEqual(T.scopeTracks('library', '', sets), 'all');
  assert.deepStrictEqual(T.scopeTracks('set', 'p:2', sets), ['c.mp3']);
  assert.deepStrictEqual(T.scopeTracks('set', 'missing', sets), ['a.mp3', 'b.mp3']);
  assert.throws(() => T.scopeTracks('set', '', []), /Choose a playlist or set/);
  console.log('NODE-OK');
})().catch(error => { console.error(error); process.exit(1); });
"""
try:
    text = script.read_text(encoding='utf-8')
    for needle in ("Whole library (slow — reads every song's tags)", 'A playlist or set', "'Working…'", 'Checking songs', 'Sending cue points', 'data-cancel',
                   'The cue points could not be sent'):
        assert needle in text, needle
    harness = pathlib.Path(tempfile.mkdtemp()) / 'harness.js'
    harness.write_text(HARNESS, encoding='utf-8')
    done = subprocess.run(['node', str(harness), str(script)], capture_output=True, text=True, encoding='utf-8', timeout=60)
    assert done.returncode == 0 and 'NODE-OK' in done.stdout, done.stdout + done.stderr
    print('PASS: Sync to DJ cue dialog: playlist/set or whole-library choice, progress text and bar, job polling, Working... button text')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
