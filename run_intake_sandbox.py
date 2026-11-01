"""Run PEAK HOUR as the launcher sets it up, with its data in fixtures/intake-sandbox-data (an empty
library), to test the music import window against fixture libraries. PH_SLOW_SCAN=<ms> makes the scan
wait that long per file, like a slow USB or network drive (the file count stays fast).

Usage: python run_intake_sandbox.py <port>
"""
import os,sys,pathlib
root=pathlib.Path(__file__).resolve().parent
data=root/'fixtures'/'intake-sandbox-data';data.mkdir(parents=True,exist_ok=True)
os.environ['AXIOM_RUNTIME_DIR']=str(data)
sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
L.data_root=lambda:data  # AXIOM's settings, cache and log stay in the test folder
L.log_server_errors()
port=int(sys.argv[1])
axiom=L.build_app(port)
if os.environ.get('PH_SLOW_SCAN'):
 import time,scanner
 delay=float(os.environ['PH_SLOW_SCAN'])/1000;check=scanner.detect_root_from_path
 def slow(*args,**kwargs):time.sleep(delay);return check(*args,**kwargs)
 scanner.detect_root_from_path=slow
from werkzeug.serving import make_server
print('ready',port,flush=True)
make_server(L.HOST,port,axiom.app,threaded=True).serve_forever()
