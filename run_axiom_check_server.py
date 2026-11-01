"""Run AXIOM as the Windows launcher sets it up, but with AXIOM's own data in a
test folder, for checks against the user's real DJ libraries (read by AXIOM).

Usage: python run_axiom_check_server.py <port>
"""
import os,sys,pathlib
root=pathlib.Path(__file__).resolve().parent
data=root/'fixtures'/'axiom-check-data';data.mkdir(parents=True,exist_ok=True)
os.environ['AXIOM_RUNTIME_DIR']=str(data)
sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
L.data_root=lambda:data  # AXIOM's settings, cache and log stay in the test folder
L.log_server_errors()
port=int(sys.argv[1])
axiom=L.build_app(port)
from werkzeug.serving import make_server
print('ready',port,flush=True)
make_server(L.HOST,port,axiom.app,threaded=True).serve_forever()
