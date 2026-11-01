"""Reopening DJ apps and revealing files on Windows, with a recorded command runner (nothing is started)."""
import os,sys,pathlib,types,traceback
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
try:
 import windows_apps as A
 calls=[]
 def runner(args,**kw):
  calls.append(args)
  if args[0]=='powershell.exe':
   return types.SimpleNamespace(returncode=0,stdout='Serato DJ Pro\t{6D809377}\\Serato\\Serato DJ Pro\\Serato DJ Pro.exe\ndjay Pro\t59BEBC1A.djay_x!App\nwww.virtualdj.com\thttps://www.virtualdj.com/\n')
  return types.SimpleNamespace(returncode=1)  # explorer.exe reports 1 even when the app starts
 A._START_APPS=None
 assert A.open_application('Serato DJ Pro','Serato DJ',runner=runner) is True
 assert calls[-1]==['explorer.exe','shell:AppsFolder\\{6D809377}\\Serato\\Serato DJ Pro\\Serato DJ Pro.exe'],calls[-1]
 assert A.open_application('djay pro',runner=runner) and calls[-1][1]=='shell:AppsFolder\\59BEBC1A.djay_x!App'
 n=len(calls);assert A.open_application('www.virtualdj.com','Missing App',runner=runner) is False and len(calls)==n  # web links and unknown names start nothing
 assert sum(c[0]=='powershell.exe' for c in calls)==1  # the Start menu is read once
 A.reveal_file(__file__,runner=runner);assert calls[-1]==['explorer.exe','/select,',os.path.abspath(__file__)]
 try: A.reveal_file('Z:\\missing.wav',runner=runner);raise AssertionError('missing file revealed')
 except FileNotFoundError: pass
 app=types.SimpleNamespace();A.install(app);assert app._open_mac_application is A.open_application
 print('PASS: Serato/djay reopen through the Start menu id; Explorer reveal; nothing else started')
except BaseException:
 traceback.print_exc();sys.exit(1)
