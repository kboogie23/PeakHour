import json,pathlib,marshal,types,dis,collections,re
root=pathlib.Path('work/axiom_bytecode/PYZ.pyz'); records=[]
for p in root.rglob('*.pyc'):
 if p.parts[len(root.parts)] not in ('studio_daw','utils') and len(p.relative_to(root).parts)>1: continue
 try:
  c=marshal.loads(p.read_bytes()[16:]); stack=[c]; functions=[]; imports=set(); routes=set()
  while stack:
   c=stack.pop(); functions.append(c.co_qualname)
   for i in dis.get_instructions(c):
    if i.opname=='IMPORT_NAME': imports.add(i.argval)
   for v in c.co_consts:
    if isinstance(v,types.CodeType): stack.append(v)
    elif isinstance(v,str) and re.match(r'^/(?:api|static|health|studio|library|playlist)[/\w<>-]*$',v): routes.add(v)
  records.append({'module':str(p.relative_to(root)),'functions':functions,'imports':sorted(imports),'routes':sorted(routes)})
 except Exception as e: print('error',p,e)
out=pathlib.Path('work/bytecode_inventory/modules.json');out.write_text(json.dumps(records,indent=2),encoding='utf8')
for rec in records:
 if rec['module']=='app.pyc':
  print('app routes',len(rec['routes'])); print('\n'.join(rec['routes'][:120]))
print('records',len(records))
