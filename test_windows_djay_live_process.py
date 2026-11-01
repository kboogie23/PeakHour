import os,pathlib,shutil,subprocess,sys,tempfile,time
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_djay import process_snapshot,running_dj_publish_apps
python=root/'python'/'cpython-3.12.15-windows-x86_64-none'/'python.exe'
with tempfile.TemporaryDirectory(dir=root) as d:
    clone=pathlib.Path(d)/'djayApp.exe';shutil.copy2(python,clone)
    env=dict(os.environ,PYTHONHOME=str(python.parent),PATH=str(python.parent)+os.pathsep+os.environ.get('PATH',''))
    baseline=set(process_snapshot('djay Pro')['pids'])  # a real djay may already be open
    p=subprocess.Popen([str(clone),'-c','import time;time.sleep(30)'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline=time.monotonic()+5
        while p.pid not in process_snapshot('djay Pro')['pids'] and time.monotonic()<deadline:time.sleep(.05)
        snap=process_snapshot('djay Pro')
        assert snap['running'] and p.pid in snap['pids'] and snap['started_at'] and snap['started_at']<=time.time()+1
        assert baseline or abs(snap['started_at']-time.time())<60
        r=running_dj_publish_apps()
        assert 'djay Pro' in r
    finally:
        p.terminate();p.wait(timeout=10)
    after=process_snapshot('djay Pro')
    assert p.pid not in after['pids'] and after['running']==bool(set(after['pids'])&baseline)
print('PASS: live disposable djayApp.exe detected with pid and start time, then cleared after exit')


