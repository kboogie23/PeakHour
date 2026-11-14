"""Browser-side PEAK HOUR names: download file names (windows-rename.js filename rules, run in node on a small
fake page), the Windows-layer scripts' own wording, and the cache-busting numbers in the three templates."""
import json, os, re, shutil, subprocess, sys, tempfile, traceback
from pathlib import Path

WORK = Path(__file__).resolve().parent
PROBE = WORK / 'axiom-win-probe'
SHARED = PROBE / 'static' / 'js' / 'shared'

HARNESS = r'''
const fs=require('fs'),vm=require('vm');
class Element{constructor(){this.attrs={};}
 setAttribute(n,v){this.attrs[String(n).toLowerCase()]=String(v);}
 getAttribute(n){const v=this.attrs[String(n).toLowerCase()];return v===undefined?null:v;}}
class HTMLAnchorElement extends Element{}
Object.defineProperty(HTMLAnchorElement.prototype,'download',{configurable:true,enumerable:true,
 get(){return Element.prototype.getAttribute.call(this,'download')??'';},
 set(v){Element.prototype.setAttribute.call(this,'download',v);}});
class MutationObserver{observe(){}}
const win={alert(){},confirm(){},prompt(){}};
const context=vm.createContext({window:win,Element,HTMLAnchorElement,MutationObserver,NodeFilter:{SHOW_TEXT:4,SHOW_ELEMENT:1},
 document:{documentElement:{},body:null,addEventListener(){},createTreeWalker(){return {nextNode(){return null;}};}}});
win.window=win;
vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),context);
const names=JSON.parse(process.argv[3]),out={filename:{},anchor:{},attribute:{}};
const filename=win.PeakHourFilename;
for(const n of names){
 out.filename[n]=filename(n);
 const a=new HTMLAnchorElement();a.download=n;out.anchor[n]=a.download;   // never attached to a page
 const b=new HTMLAnchorElement();b.setAttribute('Download',n);out.attribute[n]=b.download;
}
const other=new Element();other.setAttribute('title','AXIOM_x');out.title=other.getAttribute('title');
out.nonString=filename(null);
out.text=JSON.parse(process.argv[4]).map(t=>win.PeakHourRename(t));
console.log(JSON.stringify(out));
'''

CASES = {
    'AXIOM_SET_2026.m3u8': 'PEAK_HOUR_SET_2026.m3u8',
    'AXIOM_EXPORT_1.csv': 'PEAK_HOUR_EXPORT_1.csv',
    'AXIOM_REKORDBOX_1.xml': 'PEAK_HOUR_REKORDBOX_1.xml',
    'AXIOM_RELEASE_YEAR_RESEARCH_2026-01-01.csv': 'PEAK_HOUR_RELEASE_YEAR_RESEARCH_2026-01-01.csv',
    'AXIOM_MISSING_KEYS_5.m3u8': 'PEAK_HOUR_MISSING_KEYS_5.m3u8',
    'AXIOM-To-Buy.csv': 'PEAK-HOUR-To-Buy.csv',
    'axiom-beatgrid-doctor-receipt.json': 'peak-hour-beatgrid-doctor-receipt.json',
    'AXIOM Project.axiom.zip': 'PEAK HOUR Project.peakhour.zip',
    'AXIOM Night.json': 'AXIOM Night.json',
    'AXIOM Set 1.wav': 'AXIOM Set 1.wav',
    'AXIOM Project.axiom.json': 'PEAK HOUR Project.peakhour.json',
    'My Set.axiom.json': 'My Set.peakhour.json',
    'Mix.axiom.zip': 'Mix.peakhour.zip',
    'Summer Mix.wav': 'Summer Mix.wav',
    'Set_2026.json': 'Set_2026.json',
    'Daft Punk - AXIOM_Remix.mp3': 'Daft Punk - AXIOM_Remix.mp3',
    'My AXIOM Project.axiom': 'My AXIOM Project.axiom',
    'Song AXIOM-Edit.zip': 'Song AXIOM-Edit.zip',
    'AXIOMATIC.csv': 'AXIOMATIC.csv',
}


# Visible sentences; a quoted path inside one is kept as it is while the rest is renamed (the Studio "paused" toast).
TEXTS = {
    "Song paused: Prepared audio cache unavailable: [Errno 13] Permission denied: 'C:\\Users\\a\\.cache\\axiom-stretch-managed-v1\\.lock' AXIOM will try the remaining clips.":
        "Song paused: Prepared audio cache unavailable: [Errno 13] Permission denied: 'C:\\Users\\a\\.cache\\axiom-stretch-managed-v1\\.lock' PEAK HOUR will try the remaining clips.",
    'AXIOM will try the remaining clips.': 'PEAK HOUR will try the remaining clips.',
    'Saved to D:\\Old AXIOM': 'Saved to D:\\Old AXIOM',
    'Saved to D:\\Sets\\My AXIOM files': 'Saved to D:\\Sets\\My AXIOM files',
    'Saved to D:/Old AXIOM': 'Saved to D:/Old AXIOM',
    'Saved to \\\\server\\share\\AXIOM mixes': 'Saved to \\\\server\\share\\AXIOM mixes',
    'AXIOM saved it to C:\\Users\\a\\Music\\AXIOM DJ\\Recordings': 'AXIOM saved it to C:\\Users\\a\\Music\\AXIOM DJ\\Recordings',
    'AXIOM could not open C:\\Users\\a\\Music\\AXIOM DJ\\x.wav.': 'AXIOM could not open C:\\Users\\a\\Music\\AXIOM DJ\\x.wav.',
}


def node_executable():
    found = shutil.which('node')
    if found:
        return found
    default = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'nodejs' / 'node.exe'
    return str(default) if default.is_file() else None


try:
    node = node_executable()
    assert node, 'node was not found, so the download name rules could not be run'
    with tempfile.TemporaryDirectory() as folder:
        harness = Path(folder) / 'harness.js'
        harness.write_text(HARNESS, encoding='utf-8')
        done = subprocess.run([node, str(harness), str(SHARED / 'windows-rename.js'), json.dumps(list(CASES)), json.dumps(list(TEXTS))],
                              capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    out = json.loads(done.stdout)
    for route in ('filename', 'anchor', 'attribute'):
        for name, want in CASES.items():
            assert out[route][name] == want, f'{route}: {name!r} became {out[route][name]!r}, wanted {want!r}'
    assert out['title'] == 'AXIOM_x', 'setAttribute changed an attribute other than download'
    assert out['nonString'] is None
    for (text, want), got in zip(TEXTS.items(), out['text']):
        assert got == want, f'text {text!r} became {got!r}, wanted {want!r}'

    # The scripts' own wording says PEAK HOUR (identifiers, class names and API paths keep AXIOM).
    visible = {
        'windows-virtualdj.js': ['PEAK HOUR is reading your VirtualDJ', 'PEAK HOUR adds ${count}', '`PEAK HOUR ${new Date'],
        'windows-virtualdj-exports.js': ['PEAK HOUR adds', "name:'PEAK HOUR Favorites'", "'PEAK HOUR - Needs Cue Points'", '`PEAK HOUR Year Fixes'],
        'windows-virtualdj-grids.js': ['<p>PEAK HOUR checks the grids', 'What PEAK HOUR found', '`PEAK HOUR Grid Review'],
        'windows-virtualdj-health.js': ['PEAK HOUR songs are in VirtualDJ', 'PEAK HOUR can fill', 'PEAK HOUR keeps its own values',
                                        "Only PEAK HOUR's library changes", 'PEAK HOUR filled data', "Only PEAK HOUR's cache changes"],
        'windows-virtualdj-write.js': ['PEAK HOUR will write', 'PEAK HOUR would send', 'PEAK HOUR keeps a backup',
                                       'last PEAK HOUR write', 'or PEAK HOUR,', 'PEAK HOUR marked'],
        'windows-mix-export.js': ['The local PEAK HOUR engine'],
        'windows-dj-send.js': ['PEAK HOUR will put', 'PEAK HOUR will create', 'PEAK HOUR keeps a backup'],
    }
    for name, needles in visible.items():
        text = (SHARED / name).read_text(encoding='utf-8')
        for needle in needles:
            assert needle in text, f'{name} lacks {needle!r}'

    # Every script that changed has a newer cache-busting number in each page that loads it.
    for template, scripts in {
        'index.html': {'windows-rename.js': 11, 'windows-virtualdj.js': 2, 'windows-virtualdj-grids.js': 2, 'windows-virtualdj-health.js': 2,
                       'windows-virtualdj-exports.js': 2, 'windows-virtualdj-write.js': 7,'windows-mix-export.js': 3},
        'live_assist_window.html': {'windows-rename.js': 11},
        'live_assist_coach_prompt.html': {'windows-rename.js': 11},
    }.items():
        page = (PROBE / 'templates' / template).read_text(encoding='utf-8')
        for script, version in scripts.items():
            assert f'/static/js/shared/{script}?v={version}"' in page, f'{template}: {script} is not at ?v={version}'

    # Import filters still accept the old project names (new .peakhour.* names match .zip / .json).
    assets = (PROBE / 'static/js/studio-daw/assets.js').read_text(encoding='utf-8')
    drafts = (PROBE / 'static/js/studio-daw/drafts.js').read_text(encoding='utf-8')
    assert "accept='.axiom.zip,.zip'" in assets and "accept='.json,.axiom.json,application/json'" in drafts
    print(f'PASS: {len(CASES)} download names x 3 routes (rule, anchor never attached, setAttribute) run in node, '
          'scripts say PEAK HOUR, cache numbers bumped, old .axiom imports still accepted')
except BaseException:
    traceback.print_exc(); sys.exit(1)
