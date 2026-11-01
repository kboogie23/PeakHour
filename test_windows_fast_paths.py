"""Whole-library passes outside an import (windows_intake.FastRealpath, shared mode): opening Track Information
resolves every track in the library with realpath, 31 ms a file on an exFAT drive. A folder asked about
repeatedly is listed and resolved once and answered from the listing, with exactly Windows' answers."""
import os,sys,pathlib,shutil,tempfile,threading,time,subprocess,ntpath
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
import windows_intake as I
base=pathlib.Path(tempfile.mkdtemp(prefix='phfast_test_'))
try:
 music=base/'Music';(music/'A'/'B').mkdir(parents=True);(music/'Linked').mkdir()
 for name in ('one.mp3','Real Name.MP3','A/three.wav','A/B/four.mp4','Linked/inside.mp3'):(music/name).write_bytes(b'\0')
 subprocess.run(['cmd','/c','mklink','/J',str(music/'Junction'),str(music/'Linked')],capture_output=True,check=True)
 inputs=[str(music/'one.mp3'),str(music/'ONE.MP3'),str(music/'real name.mp3'),str(music/'A'/'three.wav'),str(music/'A')+'/B/four.mp4',
         str(music/'missing.mp3'),str(music/'Missing.MP3'),str(music/'nofolder'/'x.mp3'),r'Q:\nodrive\x.mp3',r'Q:\x.mp3',
         str(music),str(music/'A'),str(music/'Junction'),str(music/'Junction'/'inside.mp3'),str(music/'Junction'/'gone.mp3'),
         str(music/'A'/'..'/'one.mp3'),str(music/'one.mp3.'),str(music/'one.mp3 '),str(music/'one.mp3:stream'),
         str(music/'ONE~1.MP3'),'one.mp3',os.path.join('..','one.mp3'),'C:'+chr(92),chr(92)*2+r'localhost\c$\Windows\notepad.exe',
         bytes(str(music/'one.mp3'),'utf-8'),pathlib.Path(music/'one.mp3'),'']
 link=music/'Sym'
 try:
  os.symlink(music/'one.mp3',link);inputs.append(str(link))
  os.symlink(music/'A',music/'SymDir',target_is_directory=True);inputs.append(str(music/'SymDir'/'three.wav'))
 except OSError:pass  # symlinks need developer mode
 orig=ntpath.realpath
 opened=[]
 def counting(path,*a,**k):opened.append(path);return orig(path,*a,**k)
 fast=I.FastRealpath(counting);fast.SHARED_AFTER=1
 os.chdir(str(music))
 for _ in range(2):  # cold listing, then warm
  for x in inputs:
   assert fast(x)==orig(x),(x,fast(x),orig(x))
 # A folder is listed and resolved once however many files are asked about; a missing drive stays instant
 opened.clear();scans=[];real=os.scandir
 os.scandir=lambda p:(scans.append(p),real(p))[1]
 try:
  for _ in range(50):
   for n in ('one.mp3','missing.mp3','Real Name.MP3'):fast(str(music/n))
   fast(r'Q:\nodrive\x.mp3')
 finally:os.scandir=real
 assert not [p for p in opened if p.startswith(str(music/'one')) or p.endswith('missing.mp3')],opened
 assert len([p for p in scans if str(p).lower()==str(music).lower()])==0,scans  # warm from the loop above: no second listing
 # The default waits for a few calls on one folder before listing it (a lone call keeps Windows' realpath)
 lone=I.FastRealpath(counting);opened.clear()
 assert lone(str(music/'one.mp3'))==orig(str(music/'one.mp3')) and opened==[str(music/'one.mp3')]
 for _ in range(5):lone(str(music/'one.mp3'))
 assert len(opened)==lone.SHARED_AFTER-1+1,opened  # 2 plain calls + the folder's own resolve
 # Cached answers last SHARED_TTL seconds, then the folder is listed again
 ttl=I.FastRealpath(counting);ttl.SHARED_AFTER=1;ttl.SHARED_TTL=0.3
 late=str(music/'late.mp3');assert ttl(late)==orig(late)
 (music/'late.mp3').write_bytes(b'\0');time.sleep(0.4)
 assert ttl(str(music/'LATE.mp3'))==orig(str(music/'LATE.mp3')) and ttl(str(music/'LATE.mp3')).endswith('late.mp3')
 # Bounded size and safe from several threads
 small=I.FastRealpath(counting);small.SHARED_AFTER=1;small.SHARED_FOLDERS=2
 for n in ('A','A/B','Linked','A'):small(str(music/n/'x.mp3'))
 assert len(small.shared)<=2
 results=[];lock=threading.Lock()
 def work():
  got=[fast(x) for x in inputs[:20]]
  with lock:results.append(got)
 threads=[threading.Thread(target=work) for _ in range(8)];[t.start() for t in threads];[t.join() for t in threads]
 assert all(r==[orig(x) for x in inputs[:20]] for r in results)
 # More folders than the bound: oldest entries go one by one, so a pass keeps its fast path; the count stays bounded
 many=music/'Many'
 for i in range(60):
  (many/f'f{i}').mkdir(parents=True);(many/f'f{i}'/'a.mp3').write_bytes(b'\0')
 wide=I.FastRealpath(counting);wide.SHARED_AFTER=1;wide.SHARED_FOLDERS=20
 for _ in range(2):
  for i in range(60):
   for _ in range(5):assert wide(str(many/f'f{i}'/'a.mp3'))==orig(str(many/f'f{i}'/'a.mp3'))
 assert len(wide.shared)<=20 and wide.shared_entries==sum(e['count'] for e in wide.shared.values())<=20,(len(wide.shared),wide.shared_entries)
 opened.clear()
 for i in range(60):
  for _ in range(5):wide(str(many/f'f{i}'/'a.mp3'))
 assert len(opened)<=60,len(opened)  # one folder resolve each, not one per file
 capped=I.FastRealpath(counting);capped.SHARED_AFTER=1;capped.SHARED_ENTRIES=3
 for i in range(10):capped(str(many/f'f{i}'/'a.mp3'));capped(str(many/f'f{i}'/'a.mp3'))
 assert capped.shared_entries<=4 and capped.shared_entries==sum(e['count'] for e in capped.shared.values()),capped.shared_entries
 # Expired entries are dropped when another folder is added; the count never drifts under concurrent clears
 aged=I.FastRealpath(counting);aged.SHARED_AFTER=1;aged.SHARED_TTL=0.05
 for i in range(10):aged(str(many/f'f{i}'/'a.mp3'))
 time.sleep(0.1);aged(str(many/'f11'/'a.mp3'))
 assert len(aged.shared)==1,len(aged.shared)
 drift=I.FastRealpath(counting);drift.SHARED_AFTER=1;stop=[]
 def clearer():
  while not stop:
   with drift.shared_lock:
    for k in list(drift.shared):drift._shared_drop(k)
   time.sleep(0.0005)
 def caller():
  for _ in range(40):
   for i in range(60):drift(str(many/f'f{i}'/'a.mp3'))
 cl=threading.Thread(target=clearer);cl.start()
 callers=[threading.Thread(target=caller) for _ in range(4)];[t.start() for t in callers];[t.join() for t in callers];stop.append(1);cl.join()
 assert drift.shared_entries==sum(e['count'] for e in drift.shared.values()),(drift.shared_entries,len(drift.shared))
 # Names with letters outside ASCII, present or missing: Windows' own answer
 (music/'A'/'\u039f\u0394\u03a5\u03a3\u03a3\u0395\u03a5\u03a3.mp3').write_bytes(b'\0')
 for n in ('\u00dcn\u00ef.mp3','\u00dcN\u00cf.MP3','\u0130stanbul.mp3','Kelvin\u212a.mp3','\u03bf\u03b4\u03c5\u03c3\u03c3\u03b5\u03c5\u03c2.mp3','\u039f\u0394\u03a5\u03a3\u03a3\u0395\u03a5\u03a3.mp3'):
  for q in (n,n.lower(),n.upper()):
   x=str(music/'A'/q);assert fast(x)==orig(x),(q,fast(x),orig(x))
 # stat is never answered from the shared cache
 assert fast.stat(str(music/'one.mp3')).st_ino==os.stat(str(music/'one.mp3')).st_ino
 print('PASS: shared realpath gives the same answers as Windows for existing, missing, linked, odd and bytes paths, lists a folder once')
finally:
 os.chdir(str(workspace))
 shutil.rmtree(base,ignore_errors=True)
