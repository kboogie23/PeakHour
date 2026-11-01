import os, pathlib, subprocess, sys, tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
import fcntl
child='''import sys;sys.path.insert(0,sys.argv[1]);import fcntl\nf=open(sys.argv[2],"r+b")\ntry: fcntl.flock(f.fileno(),int(sys.argv[3])|fcntl.LOCK_NB);print("acquired");fcntl.flock(f.fileno(),fcntl.LOCK_UN)\nexcept BlockingIOError: print("blocked")'''
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 p=pathlib.Path(d)/'lock';p.write_bytes(b'x');f=p.open('r+b')
 def attempt(op):
  r=subprocess.run([sys.executable,'-c',child,sys.path[0],str(p),str(op)],capture_output=True,text=True,check=True);return r.stdout.strip()
 fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert attempt(fcntl.LOCK_EX)=='blocked';assert attempt(fcntl.LOCK_SH)=='blocked'
 fcntl.flock(f,fcntl.LOCK_UN)
 assert attempt(fcntl.LOCK_EX)=='acquired'
 fcntl.flock(f,fcntl.LOCK_SH|fcntl.LOCK_NB)
 assert attempt(fcntl.LOCK_SH)=='acquired';assert attempt(fcntl.LOCK_EX)=='blocked'
 fcntl.flock(f,fcntl.LOCK_UN);f.close()
 print('PASS: cross-process exclusive/shared contention and release')
