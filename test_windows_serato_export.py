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
 folder=workspace/'fixtures'/'serato-export'/uuid.uuid4().hex;folder.mkdir(parents=True)
 db=folder/'location.sqlite';shutil.copy2(source,db)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 import windows_serato_library as S, utils.serato_playlist_export as E
 S.location_database=lambda d:db if d.upper()==drive else pathlib.Path('Z:\\none')
 tracks,_,_=app._load_serato_library_tracks(database_paths=[str(pathlib.Path(drive+'\\','_Serato_','database V2'))])
 tracks=[t for t in tracks if os.path.isfile(t['path'])][:4]
 assert len(tracks)==4,tracks
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
 try: E.export_serato_playlist(str(marker),tracks,'Nested',str(folder),path_parts=['A','B']);raise AssertionError('nested accepted')
 except S.SeratoLibraryError: pass
 mixed=tracks[:1]+[dict(tracks[1],path='C:'+tracks[1]['path'][2:])]
 try: E.export_serato_playlist(str(marker),mixed,'Mixed',str(folder));raise AssertionError('mixed drives accepted')
 except S.SeratoLibraryError: pass
 print('PASS: Serato export on Windows writes an ordered, verified crate to the drive database (copy); nested folders and mixed drives refused')
except BaseException:
 traceback.print_exc();sys.exit(1)
