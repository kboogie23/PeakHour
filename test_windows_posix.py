import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import uuid
 from windows_bootstrap import build_backend
 import windows_posix,scanner,audio_core
 folder=workspace/'fixtures'/'posix'/uuid.uuid4().hex;folder.mkdir(parents=True)
 build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 # The key-analyzer lookup raised AttributeError (os.uname) and stopped Unified Health
 assert scanner._axiom_key_analyzer_paths()==('','') and scanner._health_key_analyzer_session() is None
 assert scanner.os.uname().machine and scanner.os.getuid()==0 and audio_core.os.getuid()==0
 # Windows reports st_uid 0, so the "own file" checks still mean this user's files
 assert os.stat(__file__).st_uid==scanner.os.getuid()
 assert not hasattr(os,'uname') and not hasattr(os,'getuid') and scanner.os.path is os.path
 windows_posix.install();assert type(scanner.os) is windows_posix._OS  # idempotent
 # DJ Metadata Publish / year publish / health publish call os.fsync on a file opened 'rb'; Windows refuses that with
 # [Errno 9] Bad file descriptor, so every publish failed. Their `os` must be the proxy whose fsync accepts it.
 import errno,importlib
 scratch=folder/'fsync';scratch.mkdir()
 try:
  sample=scratch/'sample.bin';sample.write_bytes(b'x'*4096)
  with open(sample,'rb') as h:
   try:os.fsync(h.fileno());raise AssertionError('plain os.fsync on a read-only handle no longer fails; the stand-in is not needed (revisit this test)')
   except OSError as e:assert e.errno==errno.EBADF,e
  for name in ('metadata_publisher','year_publisher','health_metadata_publisher'):
   M=importlib.import_module(name)
   assert type(M.os) is windows_posix._OS,(name,type(M.os))
   assert M.os is not os and name in windows_posix.MODULES
   with open(sample,'rb') as h:M.os.fsync(h.fileno())  # must not raise
   with open(sample,'rb') as h:
    try:os.fsync(h.fileno());raise AssertionError('plain os.fsync should raise Errno 9')
    except OSError as e:assert e.errno==errno.EBADF,e
 finally:
  import shutil;shutil.rmtree(scratch,ignore_errors=True)
 print('PASS: Windows stand-ins for os.uname/os.getuid in scanner and audio_core; Health key analysis no longer crashes; the metadata, year and health publishers fsync a read-only handle')
except BaseException:
 traceback.print_exc();sys.exit(1)
