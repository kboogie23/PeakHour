"""Studio/Playlists "Export to Serato" on Windows, against a COPY of a Serato location.sqlite.

Usage: python test_windows_serato_export.py [copied location.sqlite] [drive of the original, e.g. E:]
Without arguments, fixtures/serato-copy/location.sqlite (a copy of the E: database) is used.
Tracks come from that drive's real Serato library and are only read.
"""
import os,sys,pathlib,shutil,uuid,sqlite3,traceback
args=[pathlib.Path(sys.argv[1]).resolve(),sys.argv[2].upper()] if len(sys.argv)>2 else None  # before probe_startup changes directory
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 if args: source,drive=args
 else:  # the copy of the real E: database; serato-lib holds other tests' synthetic databases
  source,drive=workspace/'fixtures'/'serato-copy'/'location.sqlite','E:'
 assert source.is_relative_to(workspace),'use a copy inside the workspace'
 if not source.exists():
  print('SKIP: needs a fixture that is not on this PC: '+str(source),flush=True);os._exit(0)
 folder=workspace/'fixtures'/'serato-export'/uuid.uuid4().hex;folder.mkdir(parents=True)
 (folder/'_Serato_'/'Library').mkdir(parents=True);db=folder/'_Serato_'/'Library'/'location.sqlite';shutil.copy2(source,db)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 import windows_serato_library as S, utils.serato_playlist_export as E
 S.location_database=lambda d:db if d.upper()==drive else pathlib.Path('Z:\\none')
 tracks,_,_=app._load_serato_library_tracks(database_paths=[str(pathlib.Path(drive+'\\','_Serato_','database V2'))])
 tracks=[t for t in tracks if os.path.isfile(t['path'])][:4]
 if len(tracks)<4:  # the songs of this library are not on this PC: nothing to test against, say so honestly
  print('SKIP: needs a fixture that is not on this PC: 4 songs of the copied Serato library (found %d)'%len(tracks),flush=True);os._exit(0)
 # app's own export dispatches to the module attribute while a modern library file exists
 marker=folder/'root.sqlite';marker.write_bytes(b'')
 app.SERATO_MODERN_LIBRARY_DB=str(marker);seen={}
 real=E.export_serato_playlist
 E.export_serato_playlist=lambda database,playlist,name,*a,**k:seen.update(database=database,name=name) or {'success':True}
 try: app._write_serato_crate(tracks,'AXIOM Export Test',register_modern=True)
 except Exception as exc: print('note: app export did not reach the exporter:',exc)
 E.export_serato_playlist=real
 assert seen.get('name')=='AXIOM Export Test',seen  # Studio and Playlists exports call it with register_modern=True
 c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);before=c.execute('select count(*) from asset').fetchone()[0];c.close()
 result=E.export_serato_playlist(str(marker),tracks,'AXIOM Export Test',str(folder))
 assert result['success'] and result['delivery_verified'] and result['verified_crate_tracks']==4,result
 c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
 crate=c.execute("select id from container where name='AXIOM Export Test'").fetchall()
 rows=[r[0] for r in c.execute("select a.portable_id from container_asset ca join space_asset sa on sa.id=ca.space_asset_id join asset a on a.id=sa.asset_id where ca.container_id=? order by ca.list_order",(crate[0][0],))]
 assert rows==[S.portable_id(t['path']) for t in tracks],rows
 assert c.execute('select count(*) from asset').fetchone()[0]==before,'assets were added'
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok' and not c.execute('PRAGMA foreign_key_check').fetchall()
 c.close()
 # crate folders are written now: rows in the drive's database, plus Serato's legacy Subcrates file and neworder.pref
 nested=folder/'nested'/'_Serato_';(nested/'Library').mkdir(parents=True);(nested/'neworder.pref').write_bytes('[begin record]\n[end record]\n'.encode('utf-16-be'))
 shutil.copy2(db,nested/'Library'/'location.sqlite');S.location_database=lambda d:nested/'Library'/'location.sqlite' if d.upper()==drive else pathlib.Path('Z:\\none')
 out=E.export_serato_playlist(str(marker),tracks,'Nested',str(folder),path_parts=['AXIOM Folder','AXIOM Child'])
 assert out['success'] and out['delivery_verified'] and out['serato_path_parts']==['AXIOM Folder','AXIOM Child'] and out['verified_crate_tracks']==4,out
 assert (nested/'Subcrates'/'AXIOM Folder%%AXIOM Child.crate').is_file() and not (nested/'Subcrates'/'AXIOM Folder.crate').exists()
 assert (nested/'neworder.pref').read_bytes().decode('utf-16-be')=='[begin record]\n[crate]AXIOM Folder\n[crate]AXIOM Folder%%AXIOM Child\n[end record]\n'
 c=sqlite3.connect((nested/'Library'/'location.sqlite').as_uri()+'?mode=ro',uri=True)
 assert c.execute("select count(*) from container child join container parent on parent.id=child.parent_id where child.name='AXIOM Child' and parent.name='AXIOM Folder'").fetchone()[0]==1
 assert c.execute('select count(*) from asset').fetchone()[0]==before and c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 c.close()
 mixed=tracks[:1]+[dict(tracks[1],path='C:'+tracks[1]['path'][2:])]
 out=E.export_serato_playlist(str(marker),mixed,'Mixed',str(folder))  # a song on the system drive is skipped, the rest is written
 assert out['success'] and out['verified_crate_tracks']==1 and [s['code'] for s in out['skipped']]==['system_drive'],out
 print('PASS: Serato export on Windows writes an ordered, verified crate to the drive database (copy); crate folders write rows, legacy crate and neworder.pref; songs on the system drive are skipped one by one')
except BaseException:
 traceback.print_exc();sys.exit(1)
