import os,sys,pathlib
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
import scanner
print('cpu',os.cpu_count(),'capacity',scanner._deep_audio_worker_capacity())
for n in dir(scanner):
  if n.isupper() and ('WORKER' in n or 'SLOT' in n or 'ENGINE' in n or 'DEEP' in n or 'RUST' in n or 'SIDECAR' in n): print(n,getattr(scanner,n) if not callable(getattr(scanner,n)) else 'fn')
