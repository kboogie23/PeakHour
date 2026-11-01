import os,sys,pathlib,inspect
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
import app
for n in ('load_cache','safe_write_json','get_camelot','classify_energy','get_era_from_year','coerce_bpm_value','coerce_release_year','runLibraryHealthCheck'):
  f=getattr(app,n,None)
  print(n, getattr(f,'__module__',None), f.__code__.co_varnames[:f.__code__.co_argcount] if f else None)
