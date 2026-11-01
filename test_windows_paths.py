import os,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_paths import is_safe_location
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 p=pathlib.Path(d); f=p/'sample.wav'; f.write_bytes(b'test')
 assert is_safe_location(p) and is_safe_location(f)
 assert not is_safe_location('') and not is_safe_location('relative')
 assert not is_safe_location(os.path.splitdrive(str(p))[0]+'\\')
 assert not is_safe_location(os.environ['SystemRoot'])
 assert not is_safe_location(p/'missing')
 assert not is_safe_location(r'\\server\share\music')
 print('PASS: path admission accepts existing test files and rejects protected, root, relative, absent and network paths')
