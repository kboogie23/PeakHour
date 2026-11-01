import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import uuid,sqlite3
 sys.path.insert(0,str(workspace))
 from djay_fixture import blob,title_id,windows_library
 from windows_bootstrap import build_backend
 import windows_djay
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 import utils.djay_cue_codec as codec
 from utils.cues import parse_djay_cues_blob
 from utils.dj_transfer import read_djay_tracks
 # djay 5.6 for Windows layout: double slot numbers, property order time/endTime/comment/number/color,
 # and a cue djay shows with no colour or comment at all (as in a real library)
 red=('ADCCuePoint',{'time':0.016,'endTime':-1.0,'comment':'','number':1.0,'color':'#CC0000'})
 plain=('ADCCuePoint',{'time':0.0,'endTime':-1.0,'number':2.0})
 def user(cues): return blob(('ADCMediaItemUserData',{'uuid':'w1','titleIDs':[title_id('w1','Song')],'cuePoints':cues,'playCount':1.0}))
 cued=user([red,plain])
 # Transfer reader: int slots, AXIOM's display default for the colourless cue
 assert codec.read_cues(cued)==[{'index':0,'time_ms':16,'label':'','color':'#CC0000'},{'index':1,'time_ms':0,'label':'','color':windows_djay.AXIOM_DEFAULT_CUE_COLOR}]
 # Display reader: structured path, not the byte-scanning fallback (which reported 1128 ms and a bogus cue)
 shown=[(c['label'],c['time_ms'],c['color'],c['index']) for c in parse_djay_cues_blob(cued)]
 assert shown==[('CUE 1',16,'#CC0000',0),('CUE 2',0,'#A3FF00',1)],shown
 # A fractional slot is still refused
 odd=user([('ADCCuePoint',{'time':1.0,'endTime':-1.0,'number':1.5,'color':'#CC0000'})])
 try: codec.read_cues(odd);raise AssertionError('accepted slot 1.5')
 except ValueError: pass
 # Writer: new cues on a cue-less track get double slots; nothing else changes
 empty=blob(('ADCMediaItemUserData',{'uuid':'w1','titleIDs':[title_id('w1','Song')],'playCount':1.0}))
 new=[{'index':0,'time_ms':16,'label':'','color':'#CC0000'},{'index':2,'time_ms':30000,'label':'Drop','color':'#0000CC'}]
 out=codec.replace_cues(empty,new)
 assert codec.read_cues(out)==new
 assert len(windows_djay._number_slots(out,b'number',windows_djay._DOUBLE))==2 and not windows_djay._number_slots(out,b'number',0x12)
 from utils.dj_track_colors import decode_djay_record as decode
 assert {k:v for k,v in decode(out).items() if k!='cuePoints'}==decode(empty)
 # Existing cues: identical -> record untouched (colourless cue stays colourless); different -> refused
 assert codec.replace_cues(cued,codec.read_cues(cued))==cued
 try: codec.replace_cues(cued,new);raise AssertionError('overwrote existing cues')
 except ValueError as e: assert 'differ' in str(e)
 # Reader with preparation over a synthetic library carrying those cues
 track,db=windows_library(folder,'Cue Track',1.0,windows_djay.quote)
 c=sqlite3.connect(db);c.execute("update database2 set data=? where collection='mediaItemUserData'",(cued,));c.commit();c.close()
 tracks,errors=read_djay_tracks([db],include_preparation=True,include_transfer_preparation=True)
 t=tracks[str(track)]
 assert not errors and t.get('transfer_preparation_error') is None and len(t['transfer_cues'])==2 and [c['time_ms'] for c in t['cues']]==[16,0],t
 print('PASS: djay for Windows cues read for display and transfer, colourless cue default, double slots on write, existing cues protected')
except BaseException:
 traceback.print_exc();sys.exit(1)
