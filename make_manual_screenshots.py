"""Take the user manual's screenshots from a running PEAK HOUR (normally the walkthrough sandbox).

  python run_axiom_walkthrough_server.py fixtures/walkthrough 8097     (in another window)
  python make_manual_screenshots.py [port] [shot name ...]

Drives a hidden Microsoft Edge through its DevTools protocol (standard library only) and saves
JPEGs to axiom-win-probe/static/manual/img/<name>.jpg. Each shot in SHOTS starts from a fresh page
load, runs its JavaScript steps, waits, and captures the window or one element. Retake the shots
after every change to a screen the manual shows.
"""
import base64, json, os, random, shutil, socket, struct, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

WORK = Path(__file__).resolve().parent
OUT = WORK / 'axiom-win-probe' / 'static' / 'manual' / 'img'
EDGE = next((p for p in (Path(os.environ.get('ProgramFiles(x86)', '')) / 'Microsoft/Edge/Application/msedge.exe',
                         Path(os.environ.get('ProgramFiles', '')) / 'Microsoft/Edge/Application/msedge.exe') if p.is_file()), None)
WIDTH, HEIGHT = 1440, 900
# Seen-flags so the welcome tour and first-visit guides stay out of the pictures.
SEEN = {'axiomWalkthroughV2Seen': 'true', 'axiomLibraryGuideSeen.v2': 'true', 'axiomStudioGuideSeen.v2': 'true'}


class Socket:
    """Just enough of a WebSocket client (RFC 6455) for the DevTools protocol."""

    def __init__(self, url):
        host, _, path = url[len('ws://'):].partition('/')
        name, _, port = host.partition(':')
        self.sock = socket.create_connection((name, int(port)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        reply = b''
        while b'\r\n\r\n' not in reply:
            reply += self.sock.recv(4096)
        if b' 101 ' not in reply.split(b'\r\n', 1)[0]:
            raise RuntimeError(reply.decode(errors='replace'))
        self.buffer = reply.split(b'\r\n\r\n', 1)[1]

    def _read(self, size):
        while len(self.buffer) < size:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise ConnectionError('Edge closed the connection')
            self.buffer += chunk
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        size = len(payload)
        head = struct.pack('!BB', 0x81, 0x80 | size) if size < 126 else (
            struct.pack('!BBH', 0x81, 0xFE, size) if size < 65536 else struct.pack('!BBQ', 0x81, 0xFF, size))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def receive(self):
        message = b''
        while True:
            first, second = self._read(2)
            size = second & 0x7F
            if size == 126:
                size = struct.unpack('!H', self._read(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self._read(8))[0]
            payload = self._read(size)
            if first & 0x0F == 0x9:  # ping
                continue
            message += payload
            if first & 0x80:
                return message.decode()


class Page:
    def __init__(self, ws_url):
        self.ws = Socket(ws_url)
        self.next_id = 0

    def call(self, method, **params):
        self.next_id += 1
        self.ws.send(json.dumps({'id': self.next_id, 'method': method, 'params': params}))
        while True:
            reply = json.loads(self.ws.receive())
            if reply.get('id') == self.next_id:
                if 'error' in reply:
                    raise RuntimeError(f"{method}: {reply['error']}")
                return reply.get('result', {})

    def run(self, script):
        result = self.call('Runtime.evaluate', expression=f'(async () => {{ {script} }})()', awaitPromise=True, returnByValue=True)
        if result.get('exceptionDetails'):
            raise RuntimeError(result['exceptionDetails'].get('exception', {}).get('description', result['exceptionDetails']))
        return result.get('result', {}).get('value')


WAIT = ('const wait = ms => new Promise(r => setTimeout(r, ms)); const $ = s => document.querySelector(s);'
        # clickText('Track Prep'): clicks the visible button or link with that text (case and spacing ignored).
        'const shown = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };'
        r'const clickText = (text, within) => { const tidy = t => t.toLowerCase().replace(/\s+/g, " ").trim(); const want = tidy(text);'
        r' const all = [...(within ? document.querySelector(within) : document).querySelectorAll("button,a,[role=button],[role=menuitem],[role=tab],summary,label,[onclick]")].filter(shown);'
        ' const hit = all.find(e => tidy(e.innerText) === want) || all.find(e => tidy(e.innerText).endsWith(want));'
        ' if (!hit) throw new Error("No button: " + text); hit.click(); return hit; };')
# Before each capture: toasts closed, and the sandbox's folder (with the Windows user name) shown as an everyday one.
TIDY = ('document.querySelectorAll(".toast, .axiom-toast, [id^=toast], .health-toast, .unified-toast").forEach(e => e.remove());'
        r'const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const swap = /C:\\Users\\[^\\]+\\Documents\\Codex\\.*?\\profile/gi;'
        r'while (walker.nextNode()) { const n = walker.currentNode; if (swap.test(n.nodeValue)) { swap.lastIndex = 0; n.nodeValue = n.nodeValue.replace(swap, "C:\\Users\\You"); } }')


def shoot(page, base, name, steps, element=None, pause=1.5, keep_toasts=False, frame=None):
    # Choices a previous shot made (Type filter, audio only) must not carry over.
    page.run("localStorage.removeItem('peakhour.libraryFileType'); localStorage.removeItem('peakhour.videoAudioOnly');"
             + ''.join(f'localStorage.setItem({json.dumps(k)}, {json.dumps(v)});' for k, v in SEEN.items()))
    page.call('Page.navigate', url=base)
    for _ in range(100):
        time.sleep(0.2)
        if page.run('return document.readyState === "complete" && !!window.showTab'):
            break
    time.sleep(2.5)
    page.run(WAIT + 'document.querySelectorAll("#walkthrough-overlay, .walkthrough-overlay").forEach(e => e.remove());')
    if frame:
        # Headless Edge has no H.264 decoder, so a video shot shows a real frame of the clip (FFmpeg) as the
        # player's picture instead of playing it.
        import imageio_ffmpeg
        picture = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(frame[1]), '-i', frame[0], '-frames:v', '1',
                                  '-vf', 'scale=720:-2,format=yuvj420p', '-f', 'image2', '-c:v', 'mjpeg', '-'], capture_output=True, timeout=60).stdout
        if not picture:
            raise RuntimeError(f'no frame from {frame[0]}')
        steps = f"const FRAME = 'data:image/jpeg;base64,{base64.b64encode(picture).decode()}'; const VIDEO = {json.dumps(frame[0])};" + steps
    if steps:
        page.run(WAIT + steps)
    time.sleep(pause)
    if not keep_toasts:
        page.run(TIDY)
    params = {'format': 'jpeg', 'quality': 84}
    if element:
        box = page.run(f'const r = document.querySelector({json.dumps(element)}).getBoundingClientRect(); '
                       'return [r.left, r.top, r.width, r.height];')
        pad = 8
        params['clip'] = {'x': max(0, box[0] - pad), 'y': max(0, box[1] - pad), 'scale': 1,
                          'width': min(WIDTH, box[2] + 2 * pad), 'height': min(HEIGHT, box[3] + 2 * pad)}
    data = base64.b64decode(page.call('Page.captureScreenshot', **params)['data'])
    (OUT / f'{name}.jpg').write_bytes(data)
    print(f'{name}.jpg  {len(data) // 1024} KB', flush=True)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8097
    wanted = [a for a in sys.argv[1:] if not a.isdigit()]
    from manual_shots import SHOTS
    base = f'http://127.0.0.1:{port}/'
    urllib.request.urlopen(base, timeout=10).read(1)
    if not EDGE:
        raise SystemExit('Microsoft Edge was not found.')
    OUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='ph-manual-edge-'))
    debug = random.randint(20000, 40000)
    edge = subprocess.Popen([str(EDGE), '--headless=new', f'--remote-debugging-port={debug}', f'--user-data-dir={profile}',
                             f'--window-size={WIDTH},{HEIGHT}', '--hide-scrollbars', '--mute-audio', '--no-first-run',
                             '--autoplay-policy=no-user-gesture-required', 'about:blank'])
    try:
        for _ in range(150):  # up to 30 s: Edge can be slow to start while the PC is busy
            try:
                targets = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{debug}/json', timeout=2).read())
                target = next(t for t in targets if t.get('type') == 'page')
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise SystemExit('Edge did not open its DevTools port.')
        page = Page(target['webSocketDebuggerUrl'])
        page.call('Page.enable')
        page.call('Emulation.setDeviceMetricsOverride', width=WIDTH, height=HEIGHT, deviceScaleFactor=1, mobile=False)
        page.call('Page.navigate', url=base)
        time.sleep(2)
        page.run('; '.join(f'localStorage.setItem({json.dumps(k)}, {json.dumps(v)})' for k, v in SEEN.items()))
        for shot in SHOTS:
            if wanted and shot['name'] not in wanted:
                continue
            try:
                shoot(page, base, shot['name'], shot.get('steps', ''), shot.get('element'), shot.get('pause', 1.5), shot.get('keep_toasts', False),
                      shot.get('frame'))
            except Exception as error:
                print(f"{shot['name']}: FAILED {error}", flush=True)
    finally:
        edge.terminate()
        try:
            edge.wait(10)
        except subprocess.TimeoutExpired:
            edge.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
