import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import uuid,hashlib,json
 from windows_bootstrap import build_backend
 import windows_virtualdj_library as V
 folder=workspace/'fixtures'/'vdj-library'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,
                   virtualdj_allowed_path=lambda p:True,virtualdj_chooser=lambda kind:('',True))
 music=folder/'Music';music.mkdir();a=music/"Rock & Roll's Song.mp3";b=music/'Clip.VOB';a.write_bytes(b'x');b.write_bytes(b'y')
 def esc(v):return str(v).replace('&','&amp;').replace("'",'&apos;').replace('"','&quot;')
 home=folder/'VirtualDJ';home.mkdir();drive=folder/'Drive'/'VirtualDJ';drive.mkdir(parents=True)
 (home/'database.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="2023">'
  f'<Song FilePath="{esc(home/"database.xml")}" FileSize="1"><Tags Flag="2"/></Song>'
  f'<Song FilePath="{esc(a)}" FileSize="1"><Tags Author="Band &amp; Co" Title="Rock &amp; Roll&apos;s Song" Genre="Funk" Year="1983"/>'
  '<Infos SongLength="201.0"/><Scan Bpm="0.568720" Key="F#m"/><Poi Pos="1.0" Type="cue" Num="1"/><Poi Pos="0.1" Type="beatgrid"/><Comment>11A - Energy 6</Comment></Song>'
  f'<Song FilePath="{esc(music/"Gone.mp3")}" FileSize="1"><Tags Title="Gone"/></Song></VirtualDJ_Database>',encoding='utf8')
 (drive/'database.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="8.5">'
  f'<Song FilePath="{esc(b)}" FileSize="1"><Tags Title="Clip"/><Scan Bpm="0.5" Key="E"/></Song>'
  f'<Song FilePath="{esc(a)}" FileSize="1"><Tags Title="Duplicate"/></Song></VirtualDJ_Database>',encoding='utf8')
 paths=V.database_paths(home=home,roots=[str(folder/'Drive'),str(folder/'NoDrive')])
 assert [p.name for p in paths]==['database.xml','database.xml'] and paths[1].parent==drive
 sums={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
 tracks,read,errors=V.read_tracks(app,paths)
 assert read==2 and not errors and len(tracks)==3,(tracks,errors)  # database.xml entry skipped, duplicate path once
 song=next(t for t in tracks if t['path']==str(a))
 assert (song['title'],song['artist'],song['genre'],song['year'],song['camelot'],song['key_raw'],song['cue_count'])==("Rock & Roll's Song",'Band & Co','Funk',1983,'11A','F#m',1),song
 assert abs(song['bpm']-105.5)<0.05 and song['energy']==app.classify_energy(song['bpm']) and song['era']==app.get_era_from_year(1983)
 assert song['comments']=='11A - Energy 6' and not song['needs_relink'] and song['connected_from']=='virtualdj'
 gone=next(t for t in tracks if t['title']=='Gone');assert gone['needs_relink'] and gone['artist']=='Unknown Artist' and gone['bpm'] is None
 clip=next(t for t in tracks if t['path']==str(b));assert clip['camelot']=='12B' and clip['bpm']==120.0
 result=V.connect(app,paths)
 assert result['success'] and result['scanned_count']==3 and result['databases_read']==2 and result['total_tracks']>=3,result
 assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in sums.items())
 assert not V.connect(app,[folder/'missing.xml'])['success']
 # API: capabilities and the connect route behind AXIOM's licence gate
 client=app.app.test_client();h={'Origin':'http://localhost'}
 assert client.get('/api/windows/virtualdj/capabilities').json['connect_library']
 assert client.post('/api/windows/virtualdj/connect_library',json={}).status_code==403  # same-origin required
 # rekordbox XML locations keep their drive (AXIOM produced "C:Users\...")
 assert app._dj_export_path('file://localhost/C:/Users/DJ/a%20b.mp3')==r'C:\Users\DJ\a b.mp3'
 assert app._dj_export_path('file:///E:/Music/x.mp3')==r'E:\Music\x.mp3'
 print('PASS: VirtualDJ library connection from home and drive databases into AXIOM; rekordbox paths keep drives')
except BaseException:
 traceback.print_exc();sys.exit(1)
