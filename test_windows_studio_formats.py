"""Studio DAW takes every audio and video type the Library lists (windows_studio_formats.py), not only the eight formats
the compiled studio_daw package allows (aac, aif, aiff, flac, m4a, mp3, mp4, wav).

Made with the bundled FFmpeg in a temp folder and sent to the real app (the sandbox server, nothing of the owner's is
touched): ogg, opus, wma, ALAC in .m4a, and the sound of an .mpg, .avi, .wmv, .mkv and .webm video. Each one must pass the
Studio audio check, give a waveform, and render through the stretch route (the route every clip plays through) as 48 kHz audio
that is not silent. A damaged file is still refused and the audio check says it may be damaged; a file type nobody listed
(.xyz) is still refused. No file is written next to the source: the music folder holds exactly what the test put there.

Run: python test_windows_studio_formats.py with the project's Python (no browser needed)"""
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
import math
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace / 'axiom-win-probe'))

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
failures = []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phfmt'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
server = None


def call(method, path, body=None, raw=False):
    request = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                     headers={'Content-Type': 'application/json', 'Origin': url, 'Sec-Fetch-Site': 'same-origin'})
    try:
        with urllib.request.urlopen(request, timeout=180) as reply:
            data = reply.read()
            return reply.status, data if raw else json.loads(data or b'{}')
    except urllib.error.HTTPError as error:
        data = error.read()
        try:
            return error.code, data if raw else json.loads(data or b'{}')
        except ValueError:
            return error.code, data


def audio_check(path):
    """The Studio audio check as the page asks for it (decoded and verified), polled until the probe finishes."""
    body = {'paths': [str(path)], 'metadataOnly': True, 'verifyDecoded': True}
    for _ in range(60):
        status, data = call('POST', '/api/studio-daw/assets/check', body)
        asset = data['assets'][0]
        if asset.get('status') != 'pending':
            return asset
        time.sleep(0.5)
    return asset


def render(path):
    """Stretch route (resample-source, 3 s): returns (state, error, channels, rate, peak 0..1)."""
    status, job = call('POST', '/api/studio-daw/stretch', {'path': str(path), 'start': 0, 'duration': 3, 'pitch': 0, 'mode': 'resample-source',
                                                          'anchors': [{'source': 0, 'target': 0}, {'source': 3, 'target': 3}]})
    if status not in (200, 202):
        return 'refused', job.get('error') if isinstance(job, dict) else str(job), 0, 0, 0
    for _ in range(80):
        if job.get('state') in ('ready', 'failed', 'cancelled'):
            break
        time.sleep(0.5)
        job = call('GET', '/api/studio-daw/stretch/' + job['id'])[1]
    if job.get('state') != 'ready':
        return job.get('state'), job.get('error'), 0, 0, 0
    data = call('GET', f'/api/studio-daw/stretch/{job["id"]}/audio', raw=True)[1]
    fmt = data.find(b'fmt ')
    _, channels, rate, _, _, bits = struct.unpack('<HHIIHH', data[fmt + 8:fmt + 24])
    at = data.find(b'data')
    size = struct.unpack('<I', data[at + 4:at + 8])[0]
    pcm = data[at + 8:at + 8 + size]
    step = bits // 8
    peak = max(abs(int.from_bytes(pcm[i:i + step], 'little', signed=True)) for i in range(0, len(pcm) - step, step * 7)) / float(1 << (bits - 1))
    return 'ready', None, channels, rate, peak


try:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    music = base / 'music'
    music.mkdir()
    source = music / 'source.wav'
    with wave.open(str(source), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(b''.join(struct.pack('<hh', *(int(12000 * math.sin(2 * math.pi * 440 * i / 44100)),) * 2) for i in range(4 * 44100)))

    def make(name, *args, video=False):
        command = [ffmpeg, '-y', '-v', 'error']
        command += ['-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=4', '-i', str(source), '-shortest'] if video else ['-i', str(source)]
        subprocess.run(command + list(args) + [str(music / name)], check=True, capture_output=True, creationflags=0x08000000)
    make('song.ogg', '-c:a', 'libvorbis')
    make('song.opus', '-c:a', 'libopus')
    make('song.wma', '-c:a', 'wmav2')
    make('alac.m4a', '-c:a', 'alac')
    make('clip.mpg', '-c:v', 'mpeg1video', '-c:a', 'mp2', video=True)
    make('clip.avi', '-c:v', 'mpeg4', '-c:a', 'mp3', video=True)
    make('clip.wmv', '-c:v', 'wmv2', '-c:a', 'wmav2', video=True)
    make('clip.mkv', '-c:v', 'mpeg4', '-c:a', 'aac', video=True)
    make('clip.webm', '-c:v', 'libvpx', '-c:a', 'libvorbis', video=True)
    make('already.flac', '-c:a', 'flac')  # a format that always worked: the control
    (music / 'broken.ogg').write_bytes(b'OggS' + b'\x00' * 200)
    (music / 'notes.xyz').write_bytes(b'not audio')
    listing = sorted(p.name for p in music.iterdir())

    server = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')], env=env, cwd=str(workspace),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise AssertionError('the app did not start')

    for name in ('song.ogg', 'song.opus', 'song.wma', 'alac.m4a', 'clip.mpg', 'clip.avi', 'clip.wmv', 'clip.mkv', 'clip.webm', 'already.flac'):
        path = music / name
        asset = audio_check(path)
        wave_status, wave_data = call('POST', '/api/studio-daw/waveform', {'path': str(path)}, raw=True)
        state, error, channels, rate, peak = render(path)
        print(f'  {name}: check {asset.get("status")} / waveform {wave_status} / render {state} {channels}ch {rate} Hz peak {peak:.2f}')
        check(asset.get('status') == 'ready', f'{name}: the audio check says {asset.get("status")} ({asset.get("reason")})')
        check(wave_status == 200 and wave_data[:4] == b'RIFF', f'{name}: no waveform (status {wave_status})')
        check(state == 'ready' and rate == 48000 and channels == 2, f'{name}: did not render as 48 kHz stereo ({state} {error})')
        check(peak > 0.2, f'{name}: the rendered audio is silent or nearly so (peak {peak:.3f})')

    asset = audio_check(music / 'broken.ogg')
    print('  broken.ogg:', asset.get('status'), asset.get('reason'))
    check(asset.get('status') == 'unavailable' and 'damaged' in (asset.get('reason') or ''), f'a damaged .ogg must be refused as damaged: {asset}')
    state, error, *_ = render(music / 'broken.ogg')
    check(state != 'ready', 'a damaged .ogg must not render')
    status, data = call('POST', '/api/studio-daw/waveform', {'path': str(music / 'broken.ogg')}, raw=True)
    check(status == 422 and b'decoding failed' in data, f'a damaged .ogg waveform should say decoding failed ({status} {data[:80]})')
    status, data = call('POST', '/api/studio-daw/waveform', {'path': str(music / 'notes.xyz')}, raw=True)
    check(status == 400, f'a .xyz file must still be refused ({status})')
    asset = audio_check(music / 'notes.xyz')
    check(asset.get('status') == 'unavailable' and 'cannot be used in Studio' in (asset.get('reason') or ''), f'.xyz reason: {asset}')
    check(sorted(p.name for p in music.iterdir()) == listing, 'the music folder changed: nothing may be written next to a song')

    # the Import Files picker (Windows only): only the picker shell.js hands to the Windows hook is widened (its files are decoded by
    # the server's FFmpeg); every other picker keeps its list, because those decode in the BROWSER (Edge cannot read wma/avi/vob/alac)
    import windows_studio_formats as formats
    probe_js = r"""
const fs=require('fs');
class Input{constructor(){this._accept='';this.type='file';}get accept(){return this._accept;}set accept(v){this._accept=String(v);}}
global.HTMLInputElement=Input;global.window=global;
eval(fs.readFileSync(process.argv[1],'utf8'));
const make=(type,accept)=>{const i=new Input();i.type=type;i.accept=accept;return i;};
const plain=(type,accept)=>make(type,accept).accept;
const hooked=(type,accept)=>AxiomWindowsStudioFormats.widenPicker(make(type,accept)).accept;
console.log(JSON.stringify({audio:hooked('file','audio/*'),legacy:hooked('file','.mp3,.mp4,.m4a,.wav,.aiff,.flac,.aac'),
 plainAudio:plain('file','audio/*'),plainLegacy:plain('file','.mp3,.mp4,.m4a,.wav,.aiff,.flac,.aac'),
 plainSweeps:plain('file','.wav,.aif,.aiff,.mp3,.m4a,.flac,.aac,.mp4'),
 json:hooked('file','.json,.axiom.json,application/json'),zip:hooked('file','.axiom.zip,.zip'),
 text:hooked('text','audio/*'),extensions:AxiomWindowsStudioFormats.extensions,
 tests:['a.MKV','b.opus','c.wma','d.txt','e.mp3x','f.webm','g.oga'].map(n=>AxiomWindowsStudioFormats.test(n))}));
"""
    answer = subprocess.run(['node', '-e', probe_js, str(workspace / 'axiom-win-probe' / 'static' / 'js' / 'shared' / 'windows-studio-formats.js')],
                            capture_output=True, text=True, timeout=60)
    check(answer.returncode == 0, 'node could not run windows-studio-formats.js: ' + answer.stderr[:300])
    picker = json.loads(answer.stdout or '{}')
    wanted = ['.ogg', '.opus', '.wma', '.mpg', '.mpeg', '.avi', '.mkv', '.webm', '.wmv']
    for name in ('audio', 'legacy'):
        check(all(ext in picker.get(name, '').split(',') for ext in wanted), f'the DAW import picker ({name}) does not offer {wanted}: {picker.get(name)}')
    check(picker.get('legacy', '').startswith('.mp3,.mp4,.m4a,.wav,.aiff,.flac,.aac,'), f'the old types must stay first: {picker.get("legacy")}')
    check(picker.get('audio', '').startswith('audio/*,'), picker.get('audio'))
    check(picker.get('plainAudio') == 'audio/*' and picker.get('plainLegacy') == '.mp3,.mp4,.m4a,.wav,.aiff,.flac,.aac'
          and picker.get('plainSweeps') == '.wav,.aif,.aiff,.mp3,.m4a,.flac,.aac,.mp4',
          f'a picker that is not handed to the hook (composer.js, assets.js replacement file, sweeps) must keep its list: {picker}')
    check(picker.get('json') == '.json,.axiom.json,application/json' and picker.get('zip') == '.axiom.zip,.zip' and picker.get('text') == 'audio/*',
          f'pickers for other file types must not change: {picker}')
    check(set(picker.get('extensions', [])) == set(formats.EXTRA), f'the page list differs from windows_studio_formats.EXTRA: {picker.get("extensions")}')
    check('.oga' not in picker.get('extensions', []) and '.oga' not in formats.EXTRA, '.oga is not a Library type (windows_filetypes), so it is in neither list')
    check(picker.get('tests') == [True, True, True, False, False, True, False], f'AxiomWindowsStudioFormats.test: {picker.get("tests")}')
    shared = workspace / 'axiom-win-probe' / 'static' / 'js' / 'studio-daw'
    check("picker.accept='.mp3,.mp4,.m4a,.wav,.aiff,.flac,.aac'" in (shared / 'assets.js').read_text('utf-8'), 'the shared Mac list in assets.js must stay as it is')
    check("input.type='file';input.accept='audio/*'" in (shared / 'composer.js').read_text('utf-8') or "input.accept='audio/*'" in (shared / 'composer.js').read_text('utf-8'),
          'composer.js picker must stay as it is')
    check('AxiomWindowsStudioFormats' not in (shared / 'assets.js').read_text('utf-8') and 'AxiomWindowsStudioFormats' not in (shared / 'composer.js').read_text('utf-8'),
          'only the DAW import picker in shell.js may use the Windows hook')
    shell_js = (shared / 'shell.js').read_text('utf-8')
    check(shell_js.count('window.AxiomWindowsStudioFormats?.test(file.name)') == 2 and '|mp4|m4a|wav|aiff?|flac|aac)$/i.test(file.name)' in shell_js,
          'shell.js: both import filters must keep the Mac list and only ask the Windows hook for more')
    check(shell_js.count('AxiomWindowsStudioFormats?.widenPicker?.(input)') == 1
          and shell_js.index('AxiomWindowsStudioFormats?.widenPicker') > shell_js.index("input.type='file';input.accept='audio/*';input.multiple=true;")
          and shell_js.index('AxiomWindowsStudioFormats?.widenPicker') < shell_js.index("fetch('/api/studio-daw/import',{method:'POST',body:form})"),
          'shell.js: the one Import Files picker (POSTs to /api/studio-daw/import) must call widenPicker, after setting its accept')
    index_html = (workspace / 'axiom-win-probe' / 'templates' / 'index.html').read_text('utf-8')
    check('windows-studio-formats.js' in index_html, 'index.html does not load windows-studio-formats.js')
finally:
    if server is not None:
        server.terminate()
        try:
            server.wait(15)
        except Exception:
            server.kill()
if failures:
    print('FAIL (%d)' % len(failures))
    sys.exit(1)
print('PASS: Studio DAW checks, draws and renders ogg, opus, wma, ALAC, mpg, avi, wmv, mkv and webm; damaged and unlisted files are still refused')
