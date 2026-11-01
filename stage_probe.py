import json,pathlib,shutil
r=pathlib.Path(r'work/axiom_extracted/Payload/Applications/AXIOM PRO.app/Contents/Resources'); m=json.loads((r/'axiom_build.json').read_text(encoding='utf8'))['source_manifest']; src=pathlib.Path('work/axiom_bytecode/PYZ.pyz'); dst=pathlib.Path('work/axiom-win-probe'); dst.mkdir(exist_ok=True)
copied=[]; missing=[]
for name in m:
 if not name.endswith('.py') or name.startswith(('packaging/','script/','tests/')): continue
 p=pathlib.Path(name).with_suffix('.pyc'); f=src/p
 if f.exists():
  target=dst/p; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(f,target); copied.append(str(p))
 else: missing.append(str(p))
for package in ['utils','studio_daw']:
 p=dst/package/'__init__.pyc'
 if not p.exists(): (dst/package/'__init__.py').write_text('')
for folder in ['templates','static','data']:
 shutil.copytree(r/folder,dst/folder,dirs_exist_ok=True,ignore=shutil.ignore_patterns('._*'))
shutil.copy2(r/'axiom_build.json',dst/'axiom_build.json')
print('copied',len(copied),'missing',missing)
