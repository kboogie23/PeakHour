"""Edge or Chrome for PEAK HOUR's window (windows_browser.py): Edge by default, the saved choice
used when installed, the other browser when it is not, the default browser with neither; the
Settings endpoint accepts only installed Edge or Chrome."""
import json, os, sys, tempfile, traceback
from pathlib import Path

WORK = Path(__file__).resolve().parent
sys.path.insert(0, str(WORK / 'axiom-win-probe'))
try:
    import windows_browser as B
    from flask import Flask
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        programs, data = folder / 'Program Files', folder / 'data'
        data.mkdir()
        saved = {k: os.environ.get(k) for k in ('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA')}
        os.environ.update({'ProgramFiles': str(programs), 'ProgramFiles(x86)': str(folder / 'none'), 'LOCALAPPDATA': str(folder / 'none')})
        try:
            def install(name):
                program = programs / B.BROWSERS[name][1]
                program.parent.mkdir(parents=True, exist_ok=True); program.write_bytes(b'')
                return program
            choice = B.WindowBrowser(data)
            assert choice.chosen() == 'edge' and choice.resolve() is None  # nothing installed: default browser
            edge = install('edge')
            assert choice.resolve() == ('edge', edge, data / 'Window')
            choice.choose('chrome')
            assert json.loads((data / 'window-browser.json').read_text()) == {'browser': 'chrome'}
            assert choice.resolve() == ('edge', edge, data / 'Window')  # Chrome missing: Edge
            chrome = install('chrome')
            assert choice.resolve() == ('chrome', chrome, data / 'Window-Chrome')
            (data / 'window-browser.json').write_text('{broken')
            assert choice.chosen() == 'edge'
            try:
                choice.choose('firefox'); raise AssertionError('firefox accepted')
            except ValueError:
                pass
            app = Flask(__name__)
            app.register_blueprint(B.create_browser_blueprint(choice, lambda: 'edge'))
            client = app.test_client()
            state = client.get('/api/windows/window-browser').get_json()
            assert state['browser'] == 'edge' and state['current'] == 'edge' and state['installed'] == {'edge': True, 'chrome': True}
            assert client.post('/api/windows/window-browser', json={'browser': 'firefox'}).status_code == 400
            assert client.post('/api/windows/window-browser', json={'browser': 'chrome'}).get_json()['browser'] == 'chrome'
            chrome.unlink()
            refused = client.post('/api/windows/window-browser', json={'browser': 'chrome'})
            assert refused.status_code == 409 and 'not installed' in refused.get_json()['error']
        finally:
            for key, value in saved.items():
                if value is None: os.environ.pop(key, None)
                else: os.environ[key] = value
    print('PASS: PEAK HOUR window opens in Edge by default or Chrome when chosen; missing browsers fall back; only installed Edge/Chrome accepted')
except BaseException:
    traceback.print_exc(); sys.exit(1)
