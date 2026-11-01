"""Ctrl+F in the DJ software shows Live Assist (windows_hotkey.py): fires once per press, only while a DJ
program is in front, never when switched off; shows an open Live Assist without focus or opens one;
the setting persists. Keyboard and windows are stand-ins; the real Windows calls are only read."""
import os,sys,pathlib,uuid,json,time,threading,shutil,traceback
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_hotkey as H
 folder=workspace/'fixtures'/'hotkey'/uuid.uuid4().hex;folder.mkdir(parents=True)
 keys=set();front=['serato dj pro.exe'];windows=[None];shown=[];opened=[];done=threading.Event()
 def show(h):shown.append(h);done.set()
 def opener():opened.append(1);done.set()
 w=H.LiveAssistHotkey(folder/'hotkey.json',opener,key=lambda k:k in keys,front=lambda:front[0],find=lambda:windows[0],show=show)
 assert w.snapshot()['enabled'] is True  # on by default
 def press(down_before=False):
  done.clear();return w.step(down_before)
 # Ctrl+F in Serato with Live Assist closed: opens it
 keys.update({H.VK_CONTROL,H.VK_F});d=press();assert d and done.wait(2) and opened==[1] and not shown
 assert w.snapshot()['last_program']=='serato dj pro.exe' and w.snapshot()['last_result']=='opened'
 # Held down: no repeat
 done.clear();assert w.step(True) and not done.wait(0.2) and opened==[1]
 # Released, then pressed again with Live Assist open: shown, not reopened
 keys.clear();assert w.step(True) is False
 windows[0]=12345;keys.update({H.VK_CONTROL,H.VK_F});press();assert done.wait(2) and shown==[12345] and opened==[1]
 # F alone, or Ctrl+F in another program: nothing
 keys.clear();keys.add(H.VK_F);done.clear();w.step(False);assert not done.wait(0.2)
 keys.add(H.VK_CONTROL);front[0]='notepad.exe';done.clear();w.step(False);assert not done.wait(0.2)
 for program in ('virtualdj.exe','djayapp.exe','rekordbox.exe','traktor.exe'):
  front[0]=program;press();assert done.wait(2),program
 # Switched off: nothing, and the choice survives a restart
 assert w.set_enabled(False)['enabled'] is False;front[0]='serato dj pro.exe';done.clear();w.step(False);assert not done.wait(0.2)
 assert H.LiveAssistHotkey(folder/'hotkey.json').snapshot()['enabled'] is False
 # Endpoint
 from flask import Flask
 web=Flask('t');web.register_blueprint(H.create_hotkey_blueprint(w));c=web.test_client()
 assert c.get('/api/windows/live-assist-hotkey').get_json()['enabled'] is False
 assert c.post('/api/windows/live-assist-hotkey',json={'enabled':True}).get_json()['enabled'] is True
 assert c.post('/api/windows/live-assist-hotkey',json={'enabled':'yes'}).status_code==400
 assert c.post('/api/windows/live-assist-hotkey',json={'enabled':False},environ_base={'REMOTE_ADDR':'192.168.0.5'}).status_code==403
 # The thread polls and stops cleanly
 keys.clear();w2=H.LiveAssistHotkey(folder/'hotkey2.json',opener,key=lambda k:k in keys,front=lambda:'serato dj pro.exe',find=lambda:None,show=show,poll=0.01).start()
 time.sleep(0.05);assert w2.snapshot()['active'];done.clear();opened.clear();keys.update({H.VK_CONTROL,H.VK_F})
 assert done.wait(2) and opened==[1];w2.stop();assert not w2.snapshot()['active']
 # Real Windows calls: they answer without error (nothing is changed)
 assert isinstance(H.key_down(H.VK_CONTROL),bool) and isinstance(H.foreground_program(),str)
 found=H.find_live_assist();assert found is None or isinstance(found,int)
 shutil.rmtree(folder)
 print('PASS: Ctrl+F in a DJ program shows or opens Live Assist once per press; off switch and setting persist')
except BaseException:
 traceback.print_exc();sys.exit(1)
