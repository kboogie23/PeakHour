import marshal,dis,pathlib,types,json
root=pathlib.Path('work/axiom_bytecode'); dest=pathlib.Path('work/bytecode_inventory'); dest.mkdir(exist_ok=True)
for file in [root/'axiom_desktop_launcher',root/'PYZ.pyz/app.pyc',root/'PYZ.pyz/axiom_native_window.pyc']:
 data=file.read_bytes(); co=marshal.loads(data[16:]); out=dest/(file.name+'.dis.txt')
 with out.open('w',encoding='utf8') as f: dis.dis(co,file=f,depth=0)
 imports=[]
 for ins in dis.get_instructions(co):
  if ins.opname=='IMPORT_NAME': imports.append(ins.argval)
 def walk(c):
  yield c
  for x in c.co_consts:
   if isinstance(x,types.CodeType): yield from walk(x)
 codes=list(walk(co)); print(file.name,'code objects',len(codes),'top-level imports',imports,'name sample',[c.co_name for c in codes[:35]])
 (dest/(file.name+'.functions.json')).write_text(json.dumps([{'name':c.co_name,'qualname':c.co_qualname,'line':c.co_firstlineno,'names':c.co_names} for c in codes],indent=2),encoding='utf8')
