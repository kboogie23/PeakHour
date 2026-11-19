import os,pathlib,subprocess,sys,tempfile
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace))
import build_installer as b
# 1. The exclusion rules, on a small fake tree.
with tempfile.TemporaryDirectory() as d:
 py=pathlib.Path(d)/'py'; pk=pathlib.Path(d)/'pk'
 for rel in ['python.exe','include/Python.h','libs/python312.lib','Scripts/pip.exe','Lib/os.py','Lib/venv/__init__.py','Lib/idlelib/a.py','Lib/tkinter/__init__.py',
             'Lib/site-packages/pip/__init__.py','Lib/site-packages/pip-26.dist-info/METADATA','Lib/site-packages/other-1.dist-info/METADATA','DLLs/_tkinter.pyd','DLLs/_testcapi.pyd','tcl/tk8.6/tk.tcl','tcl/tix8.4.3/x.tcl']:
  f=py/rel; f.parent.mkdir(parents=True,exist_ok=True); f.write_bytes(b'x')
 for rel in ['numpy/__init__.py','numpy/tests/t.py','numpy/_core/include/a.h','numpy/_core/lib/npymath.lib','numpy/_core/_x.py','numpy/__init__.pyi','librosa/__init__.pyi',
             'pandas/_libs/tslibs/np_datetime.pyi','pandas/tests/t.py','pip/__init__.py','pip-26.dist-info/METADATA','pandas-3.dist-info/METADATA',
             'dawdreamer/faustlibraries/basics.lib','scipy-1.whl','pdfplumber/__init__.py','narwhals/__init__.py','numpy/testing/x.py','numba/include/n.h']:
  f=pk/rel; f.parent.mkdir(parents=True,exist_ok=True); f.write_bytes(b'x')
 import shutil
 out=pathlib.Path(d)/'out'
 shutil.copytree(py,out/'py',ignore=b.ignore_runtime(py,b.SKIP_PYTHON_PATHS|{'Lib/site-packages/pip'}))
 shutil.copytree(pk,out/'pk',ignore=b.ignore_runtime(pk,b.SKIP_PACKAGE_PATHS,package=True))
 got={p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file()}
 for kept in ['py/python.exe','py/Lib/site-packages/other-1.dist-info/METADATA','py/Lib/os.py','py/Lib/tkinter/__init__.py','py/DLLs/_tkinter.pyd','py/tcl/tk8.6/tk.tcl','pk/numba/include/n.h','pk/numpy/__init__.py','pk/librosa/__init__.pyi','pk/numpy/_core/_x.py',
              'pk/pandas-3.dist-info/METADATA','pk/dawdreamer/faustlibraries/basics.lib','pk/pdfplumber/__init__.py','pk/narwhals/__init__.py','pk/numpy/testing/x.py']:
  assert kept in got,kept
 for gone in ['py/include/Python.h','py/libs/python312.lib','py/Scripts/pip.exe','py/Lib/venv/__init__.py','py/Lib/idlelib/a.py','py/Lib/site-packages/pip/__init__.py','py/Lib/site-packages/pip-26.dist-info/METADATA',
              'py/DLLs/_testcapi.pyd','py/tcl/tix8.4.3/x.tcl','pk/numpy/tests/t.py','pk/numpy/_core/include/a.h','pk/numpy/_core/lib/npymath.lib',
              'pk/pandas/tests/t.py','pk/pip/__init__.py','pk/pip-26.dist-info/METADATA','pk/scipy-1.whl']:
  assert gone not in got,gone
print('PASS: size exclusions drop pip, headers and test suites but keep .pyi (lazy_loader), pandas, pdf libs, narwhals, tkinter, faust libraries')
# 2. The staged package (if built): its own Python imports the app and every kept library, in a sandbox, network blocked.
runtime=workspace/'dist'/'PEAK HOUR'/'runtime'; app=workspace/'dist'/'PEAK HOUR'/'app'
if (runtime/'python.exe').exists():
 with tempfile.TemporaryDirectory() as home:
  code=("import os,sys,importlib\n"
        "sys.path.insert(0,sys.argv[1]); os.chdir(sys.argv[1])\n"
        "def audit(e,a):\n"
        " if e in ('socket.connect','socket.connect_ex'): raise PermissionError('network blocked')\n"
        "sys.addaudithook(audit)\n"
        f"for m in {b.REQUIRED_MODULES!r}: importlib.import_module(m)\n"
        "import roster, app\n"
        "import librosa, sklearn.cluster, scipy.signal, scipy.optimize, numba, pandas, pdfplumber\n"
        "print('IMPORT_OK routes',len(list(app.app.url_map.iter_rules())))\n")
  sub=lambda n:os.path.join(home,n)
  env=dict(os.environ,USERPROFILE=home,HOME=home,APPDATA=sub('AppData'),LOCALAPPDATA=sub('Local'),AXIOM_RUNTIME_DIR=sub('axiom-runtime'),NO_PROXY='*')
  r=subprocess.run([str(runtime/'python.exe'),'-I','-c',code,str(app)],capture_output=True,text=True,timeout=600,env=env)
  assert 'IMPORT_OK' in r.stdout,r.stdout[-500:]+r.stderr[-2000:]
  print('PASS:',r.stdout.strip().splitlines()[-1],'with the staged runtime')
else:
 print('SKIP: dist/PEAK HOUR is not staged')
