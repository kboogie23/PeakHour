"""One laptop's AXIOM engine, started by windows_remote_hub.

The same AXIOM backend the launcher builds (axiom_windows_launcher.build_app),
but with its own data folder (AXIOM_RUNTIME_DIR = --root), on 127.0.0.1:--port,
with no window. The hub is its only client.

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
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ['AXIOM_RUNTIME_DIR'] = str(root)
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    import axiom_windows_launcher as launcher
    launcher.data_root = lambda: root  # recordings settings, video cache and logs for this library
    axiom = launcher.build_app(args.port)
    from werkzeug.serving import make_server
    server = make_server('127.0.0.1', args.port, axiom.app, threaded=True)
    threading.Thread(target=server.serve_forever, name='axiom-device', daemon=True).start()
    launcher.log(f'Library engine for {os.environ.get("AXIOM_DEVICE_NAME", "a laptop")} running on port {args.port}')
    threading.Event().wait()


if __name__ == '__main__':
    main()
