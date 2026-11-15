r"""Studio DAW PAN, in a real (headless) Edge against the real app, measured on real audio.

- UI: the detailed mixer shows one Pan slider for each of the six lanes (Left Deck, Right Deck, Samples, FX, Recordings,
  Drums / Instruments) and none for Master; it is a role=slider with aria-valuenow / aria-valuetext ("L 35", "C", "R 35"),
  arrow keys move it, Backspace, double-click and Alt-click centre it, and no automation lane is offered for it.
- Export Mix (the real dialog and the real WAV on disk): a mono tone on Left Deck with the pan field never touched,
  and with pan 0 set and cleared again, exports sample-for-sample the same (both are what the engine rendered before pan
  existed); a stereo source at pan 0 is untouched too; pan -100 leaves the right channel silent and the left at the
  un-panned level; +100 is the mirror; L 35 / R 35 turn the far side down by cos(35% of a quarter turn).
- Live playback (the Web Audio graph is tapped just before the speakers): a pan changed while playing is heard at once, in
  both directions, and Alt-click brings the centre back; mute, solo and volume still work with a pan set.
- The pan is part of the project: it survives Save, a reload and "Open saved", is in the project file, is undone and redone
  with the other mixer edits, and an older project without the field opens centred.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\Users\gatli\Documents\PeakHour; & .\axiom-win-env\Scripts\python.exe test_windows_studio_pan.py"
Everything runs in a sandbox folder on a free port; nothing of the owner's is touched. Set PAN_SHOT=<file.png> to also save a
1600 x 900 screenshot of the mixer."""
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
from feature_check import browser as fb
from feature_check import sandbox as sb

ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

failures = []
box = sb.Sandbox.create(base=Path(tempfile.mkdtemp(prefix='phpan')))
OUT = box.root / 'out'
OUT.mkdir()
server = browser = None


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def tone_wav(path, left_hz, left_amp, right_hz=None, right_amp=None, seconds=6, sr=44100):
    t = np.arange(seconds * sr) / sr
    left = left_amp * np.sin(2 * np.pi * left_hz * t)
    channels = [left]
    if right_hz is not None:
        channels.append(right_amp * np.sin(2 * np.pi * right_hz * t))
    data = np.stack(channels, axis=1)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(len(channels))
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.round(data * 32767)).astype('<i2').tobytes())


def read_wav(path):
    blob = Path(path).read_bytes()
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(blob):
        cid, size = blob[pos:pos + 4], struct.unpack('<I', blob[pos + 4:pos + 8])[0]
        body = blob[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
        if cid == b'data':
            data = body
        pos += 8 + size + (size & 1)
    tag, channels, rate, _, _, bits = fmt
    if tag == 3 or (tag == 0xFFFE and bits == 32):
        samples = np.frombuffer(data, dtype='<f4')
    elif bits == 24:
        raw = np.frombuffer(data, dtype=np.uint8).reshape(-1, 3)
        samples = ((raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int32) << 16)) << 8 >> 8) / 8388608.0
    else:
        samples = np.frombuffer(data, dtype='<i2').astype(np.float64) / 32768.0
    usable = len(samples) // channels * channels
    return samples[:usable].reshape(-1, channels).astype(np.float64), rate


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def evaluate(expr, timeout=90):
    return browser.eval(expr, timeout=timeout)


def js(expr):
    """Run an expression and parse the JSON it returns."""
    return json.loads(evaluate('JSON.stringify(%s)' % expr))


def wait(ms):
    evaluate('new Promise(r => setTimeout(r, %d))' % ms)


def open_project(index, section='left-deck'):
    evaluate("(async()=>{AxiomStudioDaw.showStudioDawProject(window.__T[%d],'track');await new Promise(r=>setTimeout(r,1800));"
             "AxiomStudioDaw.selectSection(%s);AxiomMixer.open('mix',true);await new Promise(r=>setTimeout(r,300));return 1})()" % (index, json.dumps(section)))


PAN = "document.getElementById('ph-pan-slider')"
UI = """(()=>{const i=%s,row=i&&i.closest('.ph-pan');const vis=!!row&&!row.hidden&&row.getClientRects().length>0;
  return {present:!!i,visible:vis,disabled:i?i.disabled:null,role:i&&i.getAttribute('role'),now:i&&i.getAttribute('aria-valuenow'),
          text:i&&i.getAttribute('aria-valuetext'),readout:row&&row.querySelector('output').textContent,value:i&&i.value,
          min:i&&i.getAttribute('aria-valuemin'),max:i&&i.getAttribute('aria-valuemax'),label:i&&i.getAttribute('aria-label'),
          stored:AxiomStudioDaw.activeProject.rowMixer?.[AxiomStudioDaw.expandedSection]?.pan??null}})()""" % PAN


def ui():
    return js(UI)


def press(key, times=1):
    evaluate('(()=>{%s.focus();return document.activeElement===%s})()' % (PAN, PAN))
    for _ in range(times):
        browser.run([{'op': 'press', 'key': key}])
    wait(150)


def set_pan_field(section, value):
    """Write the saved field directly (what an older or hand-edited project looks like)."""
    evaluate("(()=>{const p=AxiomStudioDaw.activeProject;p.rowMixer||={};p.rowMixer[%s]||={volume:1,muted:false};"
             "if(%s===null)delete p.rowMixer[%s].pan;else p.rowMixer[%s].pan=%s;return 1})()"
             % (json.dumps(section), json.dumps(value), json.dumps(section), json.dumps(section), json.dumps(value)))


JS_UNCHECK = "(()=>{for(const c of document.querySelectorAll('dialog[open] input[type=checkbox]'))if(c.checked)c.click();return 'u'})()"
JS_CONT = "(()=>{const b=[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Continue');b.click();return 'clicked'})()"
JS_DONE = ("(()=>{const d=document.querySelector('dialog[open]');const t=d?d.innerText:'';return /Saved:|blocked|failed|Error|error|cancelled|unavailable/i.test(t)"
           "&&!/Exporting|Rendering|Preparing/.test(t.split('Format').pop().slice(-120))})()")
JS_STATUS = "(()=>{const d=document.querySelector('dialog[open]');return d?d.innerText.split(String.fromCharCode(10)).join(' | ').slice(-200):'no dialog'})()"


def export(name):
    """Export Mix through the real dialog to OUT/name.wav; returns (samples, rate)."""
    dest = OUT / (name + '.wav')
    if dest.exists():
        dest.unlink()
    (box.root / 'dialogs.json').write_text(json.dumps({'folder': str(dest)}), encoding='utf-8')
    r = browser.run([{'op': 'eval', 'expr': "(()=>{AxiomDawExport.open();return 'o'})()"}, {'op': 'sleep', 'seconds': 1.2},
                     {'op': 'eval', 'expr': JS_UNCHECK}, {'op': 'eval', 'expr': JS_CONT},
                     {'op': 'until', 'expr': JS_DONE, 'timeout': 120, 'interval': 500},
                     {'op': 'eval', 'expr': JS_STATUS},
                     {'op': 'eval', 'expr': "(()=>{const d=document.querySelector('dialog[open]');if(d){const b=[...d.querySelectorAll('button')].find(b=>/Done|Cancel/.test(b.textContent));b&&b.click();}return 'closed'})()"},
                     {'op': 'sleep', 'seconds': 0.8}], timeout=240)
    status = r.steps[5].get('value')
    check(dest.exists(), f'{name}: the export wrote no file ({status})')
    if not dest.exists():
        return None, 44100
    return read_wav(dest)


def window_of(x, rate):
    return x[int(0.5 * rate):len(x) - int(0.5 * rate)]


TAP = r"""
(()=>{
  if(window.__tapRead)return 'already';
  const orig=AudioNode.prototype.connect,taps=[];
  AudioNode.prototype.connect=function(dest,...a){
    const r=orig.call(this,dest,...a);
    try{
      if(typeof AudioDestinationNode!=='undefined'&&dest instanceof AudioDestinationNode&&!this.__phTap){
        this.__phTap=true;const c=this.context;let t=c.__phTap;
        if(!t){const sum=c.createGain();sum.channelCount=2;sum.channelCountMode='explicit';sum.channelInterpretation='speakers';
          const sp=c.createChannelSplitter(2),an=[0,1].map(()=>{const n=c.createAnalyser();n.fftSize=2048;return n;});
          orig.call(sum,sp);orig.call(sp,an[0],0);orig.call(sp,an[1],1);t=c.__phTap={ctx:c,sum,an,buf:new Float32Array(2048)};taps.push(t);}
        orig.call(this,t.sum);
      }
    }catch(e){window.__tapError=String(e);}
    return r;
  };
  window.__tapRead=async ms=>{
    const t=taps[taps.length-1];if(!t)return null;
    let n=0,l=0,r=0;const end=performance.now()+ms;
    while(performance.now()<end){
      await new Promise(x=>setTimeout(x,30));
      t.an[0].getFloatTimeDomainData(t.buf);for(const v of t.buf)l+=v*v;
      t.an[1].getFloatTimeDomainData(t.buf);for(const v of t.buf)r+=v*v;n+=2048;
    }
    return {l:Math.sqrt(l/n),r:Math.sqrt(r/n),state:t.ctx.state,taps:taps.length};
  };
  return 'installed';
})()"""


def level(ms=500):
    return json.loads(evaluate('(async()=>JSON.stringify(await window.__tapRead(%d)))()' % ms))


def main():
    global server, browser
    music = box.music
    tone_wav(music / 'mono.wav', 440, 0.5)
    tone_wav(music / 'stereo.wav', 440, 0.5, 660, 0.25)
    tone_wav(music / 'long.wav', 440, 0.5, seconds=70, sr=22050)  # live playback must outlast the whole live section

    def track(name, seconds=6):
        return {'path': str(music / name), 'title': name, 'artist': 'Test', 'bpm': 120, 'durationSec': seconds, 'duration': seconds, 'key': '8A', 'name': name}
    tracks = [track('mono.wav'), track('stereo.wav'), track('long.wav', 70)]
    server = sb.start_server(box, guard='enforce')
    browser = fb.Browser(box.root / 'edge', base_url=server.base_url, width=1624, height=992, shots=box.shots,
                         extra_args=['--autoplay-policy=no-user-gesture-required'])
    browser.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    evaluate("(()=>{showTab('studio');window.__T=%s;return 1})()" % json.dumps(tracks))
    wait(800)

    print('[the control]')
    open_project(0)
    s = ui()
    print('  ', s)
    check(s['present'] and s['visible'] and not s['disabled'], f'Pan slider is not shown on Left Deck ({s})')
    check(s['role'] == 'slider' and s['min'] == '-100' and s['max'] == '100', f'Pan should be role=slider from -100 to 100 ({s})')
    check(s['now'] == '0' and s['text'] == 'C' and s['readout'] == 'C', f'a deck without a pan field should read C ({s})')
    check(s['stored'] is None, 'opening a project and looking at Pan must not write a pan field')
    for section in ('left-deck', 'right-deck', 'samples', 'fx', 'recordings', 'instruments'):
        evaluate("(()=>{AxiomStudioDaw.selectSection(%s);AxiomMixer.open('mix',true);return 1})()" % json.dumps(section))
        wait(250)
        s = ui()
        check(s['visible'] and not s['disabled'], f'{section}: Pan should be shown ({s})')
    evaluate("(()=>{AxiomStudioDaw.selectSection('master');return 1})()")
    wait(250)
    s = ui()
    check(not s['visible'] and s['disabled'], f'Master must have no Pan ({s})')
    evaluate("(()=>{AxiomStudioDaw.selectSection('left-deck');return 1})()")
    wait(250)

    print('[keyboard, reset, readout]')
    press('ArrowRight', 3)
    s = ui()
    check(s['now'] == '3' and s['text'] == 'R 3' and s['readout'] == 'R 3' and s['stored'] == 3, f'3 x ArrowRight should give R 3 ({s})')
    press('ArrowLeft', 8)
    s = ui()
    check(s['now'] == '-5' and s['text'] == 'L 5' and s['stored'] == -5, f'then 8 x ArrowLeft should give L 5 ({s})')
    evaluate("(()=>{const i=%s;i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}));return 1})()" % PAN)
    wait(100)
    check(ui()['now'] == '-15', f'Shift+ArrowLeft should move 10 ({ui()})')
    press('Backspace')
    s = ui()
    check(s['now'] == '0' and s['text'] == 'C' and s['stored'] == 0, f'Backspace should centre ({s})')
    set_pan_field('left-deck', 35)
    evaluate('AxiomMixer.refresh()')
    wait(200)
    s = ui()
    check(s['text'] == 'R 35' and s['value'] == '35', f'a saved pan of 35 should read R 35 ({s})')
    set_pan_field('left-deck', -35)
    evaluate('AxiomMixer.refresh()')
    wait(200)
    check(ui()['text'] == 'L 35', f'a saved pan of -35 should read L 35 ({ui()})')
    evaluate("(()=>{const i=%s;i.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));return 1})()" % PAN)
    wait(150)
    check(ui()['now'] == '0', f'double-click should centre ({ui()})')
    press('ArrowRight', 20)
    evaluate("(()=>{const i=%s;i.dispatchEvent(new PointerEvent('pointerdown',{button:0,altKey:true,bubbles:true,cancelable:true}));return 1})()" % PAN)
    wait(150)
    check(ui()['now'] == '0', f'Alt-click should centre ({ui()})')
    check(js("AxiomDawAutomation.supported('deck','pan')") is False and js("AxiomDawAutomation.supported('clip','pan')") is False,
          'pan must not be an automation parameter')
    lanes_before = js('AxiomStudioDaw.activeProject.automationLanes.length')
    press('ArrowRight', 5)
    check(js('AxiomStudioDaw.activeProject.automationLanes.length') == lanes_before and js("document.querySelectorAll('.ph-auto').length") == 0,
          'changing pan must not create automation lanes or curves')

    print('[undo and redo]')
    set_pan_field('left-deck', None)
    evaluate('AxiomMixer.refresh()')
    press('ArrowRight', 1)
    check(ui()['now'] == '1', 'one step right')
    js("AxiomMixer.undo()")
    wait(200)
    s = ui()
    check(s['now'] == '0' and s['stored'] is None, f'undo should take the pan back to nothing / centre ({s})')
    js("AxiomMixer.undo(true)")
    wait(200)
    check(ui()['now'] == '1', f'redo should bring it back ({ui()})')
    set_pan_field('left-deck', None)
    evaluate('AxiomMixer.refresh()')

    print('[export: mono tone on Left Deck]')
    base, rate = export('mono_base')
    check(js("AxiomStudioDaw.activeProject.rowMixer?.['left-deck']?.pan===undefined"), 'the baseline project must not carry a pan field')
    wb = window_of(base, rate)
    base_l, base_r = rms(wb[:, 0]), rms(wb[:, 1])
    print(f'   baseline (no pan field): channels={base.shape[1]} rate={rate} frames={len(base)} RMS L={base_l:.6f} R={base_r:.6f}')
    check(base.shape[1] == 2, 'the export is a stereo WAV')
    check(base_l > 0.2, f'the baseline export should carry the tone, got {base_l:.4f}')
    check(np.array_equal(wb[:, 0], wb[:, 1]), 'a mono source must come out identical in both channels')

    open_project(0)
    press('ArrowRight', 5)
    press('Backspace')
    check(ui()['stored'] == 0, 'the pan feature has been touched and set back to 0')
    zero, _ = export('mono_zero')
    diff = float(np.max(np.abs(zero - base))) if zero is not None and zero.shape == base.shape else float('inf')
    print(f'   pan 0 after being touched: max |difference| from baseline = {diff}')
    check(zero is not None and zero.shape == base.shape and diff == 0.0, f'pan 0 must render sample-for-sample like the baseline (max diff {diff})')

    results = {}
    for value in (-100, 100, -35, 35):
        open_project(0)
        if value in (-100, 100):
            press('Home' if value < 0 else 'End')
        else:
            set_pan_field('left-deck', value)
            evaluate('AxiomMixer.refresh()')
            wait(150)
        got = ui()
        check(got['now'] == str(value), f'the slider should follow the saved value {value} ({got})')
        x, _ = export('mono_pan%d' % value)
        if x is None:
            continue
        w = window_of(x, rate)
        results[value] = (rms(w[:, 0]), rms(w[:, 1]))
        print(f'   pan {value:+d}: RMS L={results[value][0]:.6f} R={results[value][1]:.6f}')
    if -100 in results:
        l, r = results[-100]
        check(l > 0.9 * base_l and r < 1e-5 and abs(l - base_l) < 1e-3, f'pan -100: left should keep the level and right be silent (L={l:.5f} R={r:.7f})')
    if 100 in results:
        l, r = results[100]
        check(r > 0.9 * base_r and l < 1e-5 and abs(r - base_r) < 1e-3, f'pan +100: right should keep the level and left be silent (L={l:.7f} R={r:.5f})')
    side = math.cos(0.35 * math.pi / 2)
    if -35 in results:
        l, r = results[-35]
        check(abs(l - base_l) < 1e-3 and abs(r / l - side) < 0.01, f'pan L 35: right should be {side:.4f} of left (L={l:.5f} R={r:.5f})')
    if 35 in results:
        l, r = results[35]
        check(abs(r - base_r) < 1e-3 and abs(l / r - side) < 0.01, f'pan R 35: left should be {side:.4f} of right (L={l:.5f} R={r:.5f})')

    print('[export: stereo source]')
    open_project(1)
    s_base, _ = export('stereo_base')
    ws = window_of(s_base, rate)
    print(f'   stereo, no pan field: RMS L={rms(ws[:, 0]):.6f} R={rms(ws[:, 1]):.6f}')
    check(abs(rms(ws[:, 0]) - 0.5 / math.sqrt(2)) < 0.01 and abs(rms(ws[:, 1]) - 0.25 / math.sqrt(2)) < 0.01, 'a stereo source keeps its two different sides')
    open_project(1)
    press('ArrowRight', 2)
    press('Backspace')
    s_zero, _ = export('stereo_zero')
    sdiff = float(np.max(np.abs(s_zero - s_base))) if s_zero is not None and s_zero.shape == s_base.shape else float('inf')
    print(f'   stereo pan 0: max |difference| from baseline = {sdiff}')
    check(sdiff == 0.0, f'a stereo source at pan 0 must be unchanged sample-for-sample (max diff {sdiff})')
    open_project(1)
    press('End')
    s_right, _ = export('stereo_pan100')
    if s_right is not None:
        wr = window_of(s_right, rate)
        print(f'   stereo pan +100: RMS L={rms(wr[:, 0]):.6f} R={rms(wr[:, 1]):.6f}')
        check(rms(wr[:, 0]) < 1e-5 and abs(rms(wr[:, 1]) - 0.25 / math.sqrt(2)) < 0.01, 'a stereo source panned right keeps its right side and loses its left')

    print('[live playback]')
    evaluate(TAP)  # live contexts only: the exports above ran without it
    open_project(2)
    set_pan_field('left-deck', None)
    evaluate('AxiomMixer.refresh()')
    evaluate("(()=>{AxiomArrangement.play(AxiomStudioDaw.activeProject);return 1})()")
    centre = None
    for _ in range(160):  # up to 80 s: the audio is prepared first; the tap exists once the live context is built
        wait(500)
        centre = level(400)
        if centre and centre['l'] > 0.05:
            break
    wait(500)
    centre = level(800)
    print('   playing, centred:', centre)
    check(centre and centre['state'] == 'running' and centre['l'] > 0.05 and abs(centre['l'] - centre['r']) < 1e-3 * max(centre['l'], 1e-9) + 1e-6,
          f'centred live playback should be equal in both channels and audible ({centre})')
    live_ref = centre['l'] if centre else 0
    press('Home')
    wait(300)
    left = level(800)
    print('   Home (pan -100) while playing:', left)
    check(left and left['r'] < 0.01 * live_ref and abs(left['l'] - live_ref) < 0.05 * live_ref, f'pan -100 should silence the right side live ({left})')
    press('End')
    wait(300)
    right = level(800)
    print('   End (pan +100) while playing:', right)
    check(right and right['l'] < 0.01 * live_ref and abs(right['r'] - live_ref) < 0.05 * live_ref, f'pan +100 should silence the left side live ({right})')
    # mute, solo and volume with a pan set (pan is still +100: only the right side may sound)
    js("(AxiomMixer.set('mix',1,true),1)")
    wait(400)
    muted = level(500)
    check(muted and muted['l'] < 1e-4 and muted['r'] < 1e-4, f'mute must still silence a panned deck ({muted})')
    js("(AxiomMixer.set('mix',0,true),1)")
    wait(400)
    js("(AxiomMixer.set('mix',0.5),1)")
    wait(400)
    half = level(600)
    print('   volume 0.5, pan +100:', half)
    check(half and abs(half['r'] - 0.5 * live_ref) < 0.05 * live_ref and half['l'] < 0.01 * live_ref, f'volume must still scale a panned deck ({half})')
    js("(AxiomMixer.set('mix',1),1)")
    js("(AxiomStudioDaw.toggleDeckMixer('right-deck','solo'),1)")
    wait(500)
    soloed_away = level(500)
    check(soloed_away and soloed_away['l'] < 1e-4 and soloed_away['r'] < 1e-4, f'solo on another deck must silence this one ({soloed_away})')
    js("(AxiomStudioDaw.toggleDeckMixer('right-deck','solo'),1)")
    js("(AxiomStudioDaw.toggleDeckMixer('left-deck','solo'),1)")
    wait(500)
    soloed = level(600)
    check(soloed and soloed['r'] > 0.9 * live_ref and soloed['l'] < 0.01 * live_ref, f'solo on this deck keeps it audible, still panned right ({soloed})')
    js("(AxiomStudioDaw.toggleDeckMixer('left-deck','solo'),1)")
    wait(300)
    evaluate("(()=>{const i=%s;i.dispatchEvent(new PointerEvent('pointerdown',{button:0,altKey:true,bubbles:true,cancelable:true}));return 1})()" % PAN)
    wait(500)
    back = level(800)
    print('   Alt-click (centre) while playing:', back)
    check(back and abs(back['l'] - live_ref) < 0.05 * live_ref and abs(back['r'] - live_ref) < 0.05 * live_ref, f'centring live should bring both sides back ({back})')
    evaluate("(()=>{AxiomArrangement.stop(true);return 1})()")
    wait(300)

    print('[saved with the project]')
    open_project(0)
    set_pan_field('left-deck', None)
    evaluate('AxiomMixer.refresh()')
    press('ArrowRight', 35)
    evaluate("(()=>{AxiomStudioDaw.selectSection('right-deck');AxiomMixer.open('mix',true);return 1})()")
    wait(250)
    press('ArrowLeft', 60)
    check(ui()['stored'] == -60, f'right deck should hold -60 ({ui()})')
    check(evaluate('(async()=>String(await AxiomDawDrafts.checkpoint(true)))()') == 'true', 'saving the draft')
    wait(1500)
    saved = json.loads(evaluate('AxiomDawDrafts.serialize()'))['project']['rowMixer']
    check(saved['left-deck'].get('pan') == 35 and saved['right-deck'].get('pan') == -60, f'the project file must carry both pans ({saved})')
    browser.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    evaluate("(()=>{showTab('studio');return 1})()")
    wait(1500)
    evaluate("(()=>{AxiomDawDrafts.open();return 1})()")
    wait(1500)
    names = evaluate("[...document.querySelectorAll('#daw-draft-dialog button')].map(b=>b.textContent).join('|')")
    print('   draft dialog:', names)
    evaluate("(()=>{[...document.querySelectorAll('#daw-draft-dialog button')].find(b=>b.textContent==='Open saved').click();return 1})()")
    wait(2500)
    evaluate("(()=>{AxiomStudioDaw.selectSection('left-deck');AxiomMixer.open('mix',true);return 1})()")
    wait(300)
    s = ui()
    check(s['stored'] == 35 and s['now'] == '35' and s['text'] == 'R 35', f'after reload and Open saved Left Deck should read R 35 ({s})')
    evaluate("(()=>{AxiomStudioDaw.selectSection('right-deck');return 1})()")
    wait(300)
    s = ui()
    check(s['stored'] == -60 and s['text'] == 'L 60', f'after reload and Open saved Right Deck should read L 60 ({s})')
    evaluate("(()=>{AxiomStudioDaw.selectSection('samples');return 1})()")
    wait(300)
    s = ui()
    check(s['stored'] is None and s['text'] == 'C', f'a lane that never had a pan opens centred ({s})')

    print('[an older project without the field]')
    old = js("(()=>{const p=JSON.parse(JSON.stringify(AxiomStudioDaw.activeProject));for(const r of Object.values(p.rowMixer||{}))delete r.pan;return p})()")
    check(all('pan' not in row for row in (old.get('rowMixer') or {}).values()), 'built an older project')
    evaluate("(async()=>{const p=%s;AxiomDawDrafts.serialize(p);await AxiomStudioDaw.restoreProject(p);await new Promise(r=>setTimeout(r,1500));"
             "AxiomStudioDaw.selectSection('left-deck');AxiomMixer.open('mix',true);await new Promise(r=>setTimeout(r,300));return 1})()" % json.dumps(old))
    s = ui()
    check(s['stored'] is None and s['now'] == '0' and s['text'] == 'C', f'an older project opens centred ({s})')
    bad = evaluate("(()=>{const p=JSON.parse(JSON.stringify(AxiomStudioDaw.activeProject));p.rowMixer={'left-deck':{volume:1,pan:500}};try{AxiomDawDrafts.serialize(p);return 'accepted'}catch(e){return e.message}})()")
    check('pan' in bad.lower(), f'a pan outside -100..100 in a project file must be refused ({bad})')

    shot = os.environ.get('PAN_SHOT')
    if shot:
        open_project(0)
        set_pan_field('left-deck', -35)
        evaluate("(()=>{AxiomStudioDaw.selectSection('left-deck');AxiomMixer.open('mix',true);AxiomMixer.refresh();return 1})()")
        wait(600)
        Path(shot).parent.mkdir(parents=True, exist_ok=True)
        print('   viewport:', evaluate('innerWidth+"x"+innerHeight'))
        browser.run([{'op': 'screenshot', 'path': shot}])


try:
    main()
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    if browser:
        try:
            browser.close()
        except Exception:
            pass
    if server:
        try:
            server.stop()
        except Exception:
            pass
    shutil.rmtree(box.root.parent, ignore_errors=True)
print('PASS: pan is a slider on the six lanes, exports and plays live (mono and stereo) with an exactly unchanged centre, and is saved, restored and undone with the project'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
