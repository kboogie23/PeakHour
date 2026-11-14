r"""Studio DAW recording on Windows, in a real (headless) Edge against the real app, with a fake microphone.

- A take recorded from the microphone lands on the Recordings lane (through the real toolbar Record button, the way a person
  does it) and its saved file is not silent, is 48 kHz and holds the fake microphone's 440 Hz tone.
- Recording does not depend on the sound device's own rate. Windows sound devices often run at 44.1 kHz, and the Studio DAW's
  capture used to be suspected of refusing them (it asks for a 48 kHz AudioContext). A 44.1 kHz input is built here (an
  AudioContext at 44.1 kHz feeding a MediaStream) and captured by the Studio DAW's own capture(): it must come out as a
  48 kHz take, the right length, still 440 Hz.
- When the input cannot be opened the message says what to do (windows-studio-recording.js): permission refused, an input that
  is not connected any more (Edge gives an EMPTY message for that), and no input at all.
- The static Record button of the old transport strip starts the real recording, and no "No Device" placeholder is left.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\Users\gatli\Documents\PeakHour; & .\axiom-win-env\Scripts\python.exe test_windows_studio_recording.py"
Everything runs in a temp folder on a free port; the real microphone is never opened (a fake device file is used)."""
import json
import math
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
from feature_check import browser as fb

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phrec'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
servers, browsers, failures = [], [], []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


def tone(path, seconds=6, sr=44100, freq=440, amp=12000):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(amp * math.sin(2 * math.pi * freq * i / sr)),) * 2) for i in range(seconds * sr)))


def read_wav(data):
    """(rate, channels, samples as float array [frames, channels]) from a RIFF/WAVE (PCM 16/24/32 or float)."""
    fmt = data.find(b'fmt ')
    tag, channels, rate, _, _, bits = struct.unpack('<HHIIHH', data[fmt + 8:fmt + 24])
    at = data.find(b'data')
    size = struct.unpack('<I', data[at + 4:at + 8])[0]
    pcm = data[at + 8:at + 8 + size]
    if bits == 24:
        raw = np.frombuffer(pcm[:len(pcm) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        values = ((raw[:, 0] | raw[:, 1] << 8 | raw[:, 2] << 16) << 8 >> 8).astype(np.float64) / 8388608
    elif bits == 16:
        values = np.frombuffer(pcm, dtype='<i2').astype(np.float64) / 32768
    elif bits == 32 and tag == 3:
        values = np.frombuffer(pcm, dtype='<f4').astype(np.float64)
    else:
        values = np.frombuffer(pcm, dtype='<i4').astype(np.float64) / 2147483648
    return rate, channels, values[:len(values) // channels * channels].reshape(-1, channels)


def dominant(samples, rate):
    mono = samples.mean(axis=1)
    window = mono[len(mono) // 4:len(mono) // 4 + rate]  # one second from the middle, away from the start-up
    spectrum = np.abs(np.fft.rfft(window * np.hanning(len(window))))
    return float(np.argmax(spectrum) * rate / len(window))


def page(extra):
    b = fb.Browser(sandbox=base / ('edge-' + str(len(browsers))), base_url=url, extra_args=['--autoplay-policy=no-user-gesture-required', *extra])
    browsers.append(b)
    b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    b.eval("(()=>{showTab('studio');return 1})()")
    b.eval('new Promise(r => setTimeout(r, 800))')
    return b


def open_project(b, music):
    tracks = []
    for name in ('one.wav', 'two.wav'):
        tone(music / name, sr=22050, freq=330, amp=8000)
        tracks.append({'path': str(music / name), 'title': name, 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': name})
    b.eval("(async()=>{AxiomStudioDaw.showStudioDawProject(%s,'track');await new Promise(r=>setTimeout(r,1500));return 1})()" % json.dumps(tracks[0]))


FRIENDLY = r'''
(async () => {
  const out = {};
  for (const constraints of [{audio: true}, {audio: {deviceId: {exact: 'no-such-input'}}}]) {
    try { await navigator.mediaDevices.getUserMedia(constraints); out[JSON.stringify(constraints)] = 'opened'; }
    catch (e) { out[JSON.stringify(constraints)] = [e.name, e.message]; }
  }
  return out;
})()
'''
# the real wrapper, run against a stand-in mediaDevices that fails the way Edge does when there is no microphone at all
NOT_FOUND = r'''
(async () => {
  const script = await (await fetch('/static/js/shared/windows-studio-recording.js')).text();
  const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'mediaDevices');
  const stub = {getUserMedia: () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'))};
  Object.defineProperty(navigator, 'mediaDevices', {value: stub, configurable: true});
  (0, eval)(script);
  let result;
  try { await navigator.mediaDevices.getUserMedia({audio: true}); result = 'opened'; } catch (e) { result = [e.name, e.message]; }
  delete navigator.mediaDevices;
  return result;
})()
'''
CAPTURE_44 = r'''
(async () => {
  const source = new AudioContext({sampleRate: 44100});
  const osc = source.createOscillator(); osc.frequency.value = 440;
  const gain = source.createGain(); gain.gain.value = .5;
  const dest = source.createMediaStreamDestination();
  osc.connect(gain); gain.connect(dest); osc.start(); await source.resume();
  let take = null, failure = null;
  const recorder = await AxiomDawRecording.capture(dest.stream, a => { take = a; }, e => { failure = e.message; });
  await new Promise(r => setTimeout(r, 3000));
  recorder.stop();
  for (let i = 0; i < 40 && !take && !failure; i++) await new Promise(r => setTimeout(r, 150));
  const result = {failure, sourceRate: source.sampleRate};
  if (take) {
    const bytes = new Uint8Array(await take.file.arrayBuffer());
    let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    result.rate = take.sampleRate; result.frames = take.length; result.seconds = take.duration; result.b64 = btoa(text);
    take.release && take.release();
  }
  osc.stop(); await source.close();
  return result;
})()
'''
SETUP = r'''
(async () => {
  AxiomDawTimelineRecording.setup(); await new Promise(r => setTimeout(r, 600));
  const dialog = document.getElementById('daw-record-dialog');
  dialog.querySelector('[data-enable-inputs]').click(); await new Promise(r => setTimeout(r, 1500));
  const select = dialog.querySelector('[data-input-device]');
  const real = [...select.options].find(o => o.value);
  if (!real) return {error: 'no input listed', status: dialog.querySelector('output').textContent};
  select.value = real.value; select.onchange(); await new Promise(r => setTimeout(r, 200));
  dialog.querySelector('[data-action]').click(); await new Promise(r => setTimeout(r, 500));
  return {label: real.textContent, open: !!document.getElementById('daw-record-dialog')};
})()
'''
TAKE = r'''
(async () => {
  const button = document.getElementById('daw-toolbar-record');
  const t0 = performance.now();
  button.click();
  // the microphone and the capture worklet take a varying time to open (Edge start-up, PC load): time the take from "Recording"
  for (let i = 0; i < 100 && !/^Recording/.test(document.querySelector('#daw-record-status output')?.textContent || ''); i++) await new Promise(r => setTimeout(r, 100));
  const startedAfter = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 3000));
  const during = {active: AxiomDawTimelineRecording.active, pressed: button.getAttribute('aria-pressed'), label: button.getAttribute('aria-label')};
  button.click();
  for (let i = 0; i < 50 && AxiomDawTimelineRecording.active; i++) await new Promise(r => setTimeout(r, 200));
  const p = AxiomStudioDaw.activeProject;
  return {startedAfter, during, clips: p.arrangementClips.filter(c => c.sectionId === 'recordings').map(c => ({path: c.path, recorded: c.recorded, beats: c.timelineDurationBeats, rate: c.recordingInfo && c.recordingInfo.sampleRate}))};
})()
'''


try:
    music = base / 'music'
    music.mkdir()
    mic = base / 'mic-440.wav'
    tone(mic, seconds=4, sr=44100, freq=440, amp=12000)  # the fake microphone plays this file on a loop
    start()

    print('[a take from the (fake) microphone lands on the Recordings lane]')
    b = page(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + str(mic)])
    open_project(b, music)
    check(b.eval("typeof AxiomDawTimelineRecording.toggle") == 'function', 'AxiomDawTimelineRecording is missing')
    setup = b.eval(SETUP)
    print('  input chosen:', setup)
    check(not setup.get('error') and setup.get('open') is False, f'could not choose the fake input: {setup}')
    took = b.eval(TAKE)
    print('  recording began after', took['startedAfter'], 'ms; during:', took['during'], 'clips:', [(c['beats'], c['rate']) for c in took['clips']])
    check(took['during']['active'] and took['during']['pressed'] == 'true' and took['during']['label'] == 'Stop recording', f'record button did not show recording: {took["during"]}')
    check(len(took['clips']) == 1 and took['clips'][0]['recorded'], f'one take should be on the Recordings lane: {took["clips"]}')
    if took['clips']:
        rate, channels, samples = read_wav(Path(took['clips'][0]['path']).read_bytes())
        peak = float(np.abs(samples).max())
        freq = dominant(samples, rate)
        print(f'  saved take: {rate} Hz {channels}ch {len(samples) / rate:.2f}s peak {peak:.3f} dominant {freq:.0f} Hz')
        check(rate == 48000 and channels == 2, f'the take should be 48 kHz stereo ({rate} Hz {channels}ch)')
        check(len(samples) / rate > 1.5, 'the take is too short')
        check(peak > 0.05, f'the take is silent (peak {peak:.4f})')
        check(abs(freq - 440) < 25, f'the take should carry the 440 Hz microphone tone, not {freq:.0f} Hz')
    sixteen = b.eval("document.querySelector('.studio-daw-transport button[aria-label=\"Record take\"]')?.getAttribute('onclick')")
    check(sixteen and ('AxiomDawTimelineRecording.toggle' in sixteen or 'AxiomDawTimelineRecording?.toggle' in sixteen), f'the Record button of the transport strip must start the real recording: {sixteen}')
    check(b.eval("document.getElementById('studio-daw-shell').innerHTML.includes('No Device')") is False, '"No Device" placeholder is still on the page')

    print('[a 44.1 kHz input records as a 48 kHz take]')
    got = b.eval(CAPTURE_44)
    print('  ', {k: v for k, v in got.items() if k != 'b64'})
    check(not got.get('failure') and got.get('sourceRate') == 44100, f'44.1 kHz capture failed: {got.get("failure")}')
    if got.get('b64'):
        import base64
        rate, channels, samples = read_wav(base64.b64decode(got['b64']))
        freq = dominant(samples, rate)
        check(got['rate'] == 48000 and rate == 48000, f'the take must be 48 kHz ({got["rate"]}, file {rate})')
        check(2.2 < got['seconds'] < 3.3 and abs(got['frames'] - got['seconds'] * 48000) < 2, f'take length {got["seconds"]} s / {got["frames"]} frames')
        check(float(np.abs(samples).max()) > 0.3, 'the 44.1 kHz take is silent')
        check(abs(freq - 440) < 10, f'the 44.1 kHz take should still be 440 Hz, got {freq:.1f} Hz (wrong resampling)')
    b.close()
    browsers.remove(b)

    print('[when the input cannot be opened the message says what to do]')
    b = page(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    answers = b.eval(FRIENDLY)
    gone = answers['{"audio": {"deviceId": {"exact": "no-such-input"}}}'.replace(': ', ':').replace(', ', ',')]
    print('  input that is gone:', gone)
    check(gone[0] == 'OverconstrainedError' and 'not connected any more' in gone[1], f'an unplugged input needs a plain message (Edge says nothing): {gone}')
    missing = b.eval(NOT_FOUND)
    print('  no input at all:', missing)
    check(missing[0] == 'NotFoundError' and 'No microphone or audio input was found' in missing[1] and 'Settings' in missing[1], f'no-input message: {missing}')
    b.close()
    browsers.remove(b)
    b = page([])  # no fake-ui flag: headless Edge refuses the microphone, like a user who clicked Block
    denied = b.eval(FRIENDLY)['{"audio":true}']
    print('  permission refused:', denied)
    check(denied[0] == 'NotAllowedError' and 'Privacy & security' in denied[1] and 'Permission denied' not in denied[1], f'permission message: {denied}')
finally:
    for b in browsers:
        b.close()
    for s in servers:
        s.terminate()
        try:
            s.wait(15)
        except Exception:
            s.kill()
    import shutil
    shutil.rmtree(base, ignore_errors=True)
if failures:
    print('FAIL (%d)' % len(failures))
    sys.exit(1)
print('PASS: a fake-microphone take lands on the Recordings lane (48 kHz, not silent, 440 Hz); a 44.1 kHz input records as a 48 kHz take; input errors are explained')
