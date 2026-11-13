"""The Sync to DJ cue dialog: songs choice, one dialog for the whole send (opens before any request), VirtualDJ scoped to the
chosen songs, progress text and bar, honest "why nothing to write" counts, job polling and Close wording. Run in node against
windows-virtualdj-write.js with a minimal fake page (no browser needed)."""
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
const json = body => ({ok: true, json: async () => ({success: true, ...body})});
(async () => {
  assert.strictEqual(T.progressText({phase: 'checking', done: 1234, total: 21000, current_title: 'Song A'}), `Checking ${n(1234)} of ${n(21000)} songs — Song A`);
  assert.strictEqual(T.progressText({phase: 'writing', done: 2, total: 60, current_title: 'B'}), `Writing 2 of 60 songs — B`);
  assert.strictEqual(T.progressText({phase: 'reading', done: 0, total: 0, current_title: "Reading VirtualDJ's database…"}), "Reading VirtualDJ's database…");
  const bar = {max: 0, value: 0, removed: [], removeAttribute(name) { this.removed.push(name); }}, text = {textContent: ''};
  T.renderProgress({bar, text}, {phase: 'checking', done: 5, total: 20, current_title: 'X'});
  assert.deepStrictEqual([bar.max, bar.value, text.textContent], [20, 5, `Checking 5 of 20 songs — X`]);
  T.renderProgress({bar, text}, {phase: 'reading', done: 0, total: 0, current_title: 'Reading'});
  assert.deepStrictEqual(bar.removed, ['value']);  // no total yet: an indeterminate bar, not a frozen one
  // songs: a playlist or set by default, the whole library only when chosen
  const sets = [{id: 'studio', label: 's', tracks: ['a.mp3', 'b.mp3']}, {id: 'p:2', label: 'p', tracks: ['c.mp3']}];
  assert.strictEqual(T.scopeTracks('library', '', sets), 'all');
  assert.deepStrictEqual(T.scopeTracks('set', 'p:2', sets), ['c.mp3']);
  assert.throws(() => T.scopeTracks('set', '', []), /Choose a playlist or set/);
  // the breakdown says why songs are left alone, each in its own words
  assert.strictEqual(T.cueBreakdown('Serato', {already_have_cues: 5, no_cues_to_copy: 3, songs_to_write: 2, songs_growing: 1}),
    '5 already have cue points in Serato · 3 have no cue points anywhere to copy · 2 would be filled (1 grow the file)');
  const djay = T.cueBreakdown('djay', {not_in_djay: 57, no_cues_to_copy: 4, already_have_cues: 0, songs_to_write: 0});
  assert.strictEqual(djay, "4 have no cue points anywhere to copy · 57 aren't in djay yet — add them in djay first · 0 would be filled");
  assert.ok(!/already have/.test(djay), djay);  // songs that are not in djay do not "already have cue points in djay"
  assert.ok(/file was not found/.test(T.cueBreakdown('Serato', {file_not_found: 1, songs_to_write: 0})));
  // a whole send: the dialog lines exist before the first request; VirtualDJ is scoped to the chosen songs; one program after another
  const log = [], posts = [];
  const jobs = {
    '/api/windows/virtualdj/write/job/v1': [
      {state: 'running', phase: 'reading', done: 0, total: 0, current_title: "Reading VirtualDJ's database…"},
      {state: 'running', phase: 'checking', done: 20, total: 61, current_title: 'Song 20'},
      {state: 'done', done: 61, total: 61, result: {success: true, songs: 3, counts: {cues: 7}, kinds: ['cues'], preview_token: 'tok', rows: [], skipped_count: 0}}],
    '/api/windows/virtualdj/write/job/v2': [
      {state: 'running', phase: 'writing', done: 1, total: 3, current_title: 'Song 1'},
      {state: 'done', result: {success: true, written: 3, undo: {available: true, id: 'u', songs: 3, created_at: 1}}}],
  };
  global.fetch = async (url, options = {}) => {
    log.push(['fetch', url]);
    if (options.method === 'POST') posts.push([url, JSON.parse(options.body)]);
    if (jobs[url]) return json(jobs[url].shift());
    if (url === '/api/windows/virtualdj/write/preview') return json({background: true, job_id: 'v1'});
    if (url === '/api/windows/virtualdj/write/apply') return json({background: true, job_id: 'v2'});
    if (url === '/api/windows/serato/cues/preview') return json({counts: {songs_to_write: 0, already_have_cues: 61}});
    if (url === '/api/windows/djay/cues/preview') return json({counts: {songs_to_write: 0, not_in_djay: 57, no_cues_to_copy: 4}});
    throw new Error('unexpected request ' + url);
  };
  const lines = {}, progress = [];
  const ui = {cancelled: () => false, setLine(target, text) { log.push(['line', target, text]); lines[target] = text; },
              setProgress(job) { progress.push(T.progressText(job)); }, onJob() {}};
  const tracks = ['D:\\a.mp3', 'D:\\b.mp3', 'D:\\c.mp3'];
  const results = await T.runSend(['virtualdj', 'serato', 'djay'], tracks, ui, {confirm: async () => true});
  assert.deepStrictEqual(results.map(r => r.state), ['written', 'nothing', 'nothing']);
  assert.strictEqual(log[0][0], 'line');  // the status lines are there before the first request
  assert.ok(log.findIndex(e => e[0] === 'fetch') > 2, log.slice(0, 5));
  assert.deepStrictEqual(posts.map(p => p[0]), ['/api/windows/virtualdj/write/preview', '/api/windows/virtualdj/write/apply',
                                                '/api/windows/serato/cues/preview', '/api/windows/djay/cues/preview']);
  assert.deepStrictEqual(posts[0][1], {kinds: ['cues'], tracks});  // VirtualDJ looks at the chosen songs only
  assert.deepStrictEqual(posts[1][1], {kinds: ['cues'], tracks, preview_token: 'tok', confirm: true});
  assert.deepStrictEqual(posts[2][1], {tracks});
  assert.ok(progress.includes("Reading VirtualDJ's database…") && progress.includes(`Checking 20 of 61 songs — Song 20`) && progress.includes('Writing 1 of 3 songs — Song 1'), progress);
  assert.ok(/Written to 3 songs/.test(lines.virtualdj), lines.virtualdj);
  assert.ok(/Nothing to write — 61 already have cue points in Serato/.test(lines.serato), lines.serato);
  assert.ok(/57 aren't in djay yet — add them in djay first/.test(lines.djay) && !/already have/.test(lines.djay), lines.djay);
  // Cancel: the programs not started yet are not started
  const stopped = {cancelled: () => true, setLine() {}, setProgress() {}, onJob() {}};
  assert.deepStrictEqual((await T.runSend(['serato', 'djay'], tracks, stopped, {})).map(r => r.state), ['cancelled', 'cancelled']);
  // job polling
  const seen = [], answers = [{state: 'running', done: 1, total: 3}, {state: 'running', done: 2, total: 3}, {state: 'done', done: 3, total: 3, result: {ok: 1}}];
  global.fetch = async () => json(answers.shift());
  const final = await T.pollJob('/api/windows/serato/cues/', 'abc123', job => seen.push(job.done), 1);
  assert.deepStrictEqual(seen, [1, 2, 3]);
  assert.strictEqual(final.state, 'done');
  global.fetch = async () => ({ok: false, json: async () => ({success: false, error: 'There is no such job.'})});
  await assert.rejects(T.pollJob('/x/', 'gone', () => {}, 1), /no such job/);
  console.log('NODE-OK');
})().catch(error => { console.error(error); process.exit(1); });
"""
try:
    text = script.read_text(encoding='utf-8')
    for needle in ("Whole library (slow — reads every song's tags)", 'A playlist or set', "'Working…'", 'Sending cue points', 'data-cancel',
                   'The cue points could not be sent', '<button type="button" data-no>Close</button>', 'data-details', "'Close'"):
        assert needle in text, needle
    body = text[text.index(' async function sendCuesTo('):text.index(' // The VirtualDJ-only buttons')]
    assert body.index('openSendDialog(targets') < body.index('ensureAxiomLicenseUsable') < body.index('runSend('), 'the dialog must open before any request'
    harness = pathlib.Path(tempfile.mkdtemp()) / 'harness.js'
    harness.write_text(HARNESS, encoding='utf-8')
    done = subprocess.run(['node', str(harness), str(script)], capture_output=True, text=True, encoding='utf-8', timeout=60)
    assert done.returncode == 0 and 'NODE-OK' in done.stdout, done.stdout + done.stderr
    print('PASS: Sync to DJ cue dialog: dialog before requests, VirtualDJ scoped to the chosen songs, progress, honest counts, Close button, cancel')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
