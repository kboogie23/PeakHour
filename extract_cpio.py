import gzip, pathlib, stat, shutil
base=pathlib.Path('work/axiom_extracted').resolve(); base.mkdir(parents=True,exist_ok=True)
for archive in ['Payload','Scripts']:
 count=0; size=0
 with gzip.open('work/axiom_package/'+archive,'rb') as f:
  while True:
   h=f.read(76)
   if not h: break
   if len(h)!=76 or h[:6]!=b'070707': raise Exception(('bad header',h[:30],count))
   mode=int(h[18:24],8); namesize=int(h[59:65],8); length=int(h[65:76],8); name=f.read(namesize).rstrip(b'\0').decode('utf-8','surrogateescape')
   if name=='TRAILER!!!': break
   dest=(base/archive/name).resolve()
   if not dest.is_relative_to(base/archive): raise Exception('unsafe path '+name)
   if stat.S_ISDIR(mode): dest.mkdir(parents=True,exist_ok=True)
   elif stat.S_ISREG(mode):
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open('wb') as o:
     left=length
     while left:
      chunk=f.read(min(left,1048576))
      if not chunk: raise Exception('truncated')
      o.write(chunk); left-=len(chunk)
    size+=length
   else:
    left=length
    while left:
     chunk=f.read(min(left,1048576)); left-=len(chunk)
     if not chunk: raise Exception('truncated')
   count+=1
 print(archive,'entries',count,'file bytes',size)
