"""One laptop's AXIOM engine, started by windows_remote_hub.

The same AXIOM backend the launcher builds (axiom_windows_launcher.build_app),
but with its own data folder (AXIOM_RUNTIME_DIR = --root), on 127.0.0.1:--port,
with no window. The hub is its only client: every request must carry the hub's secret
header (AXIOM_HUB_TOKEN, set when the hub starts this engine). The engine repeats the
hub's refusals itself (including audio playback, Studio DAW, artwork and CSV/import-by-path
routes), uses deny-all path policies and a deck that cannot play. Routes that only edit
this library's own cache (library JSON in the device folder) stay available.

Usage: pythonw windows_device_server.py --root FOLDER --port PORT
"""
import argparse
import os
import sys
import threading
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    token = os.environ.pop('AXIOM_HUB_TOKEN', '')
    if not token:
        sys.exit('This engine must be started by the hub (AXIOM_HUB_TOKEN is missing).')
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ['AXIOM_RUNTIME_DIR'] = str(root)
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    import axiom_windows_launcher as launcher
    launcher.data_root = lambda: root  # recordings settings, video cache and logs for this library
    axiom = launcher.build_app(args.port, device=True)
    from windows_remote_hub import install_device_guard
    install_device_guard(axiom.app, token)
    from werkzeug.serving import make_server
    server = make_server('127.0.0.1', args.port, axiom.app, threaded=True)
    threading.Thread(target=server.serve_forever, name='axiom-device', daemon=True).start()
    launcher.log(f'Library engine for {os.environ.get("AXIOM_DEVICE_NAME", "a laptop")} running on port {args.port}')
    threading.Event().wait()


if __name__ == '__main__':
    main()
