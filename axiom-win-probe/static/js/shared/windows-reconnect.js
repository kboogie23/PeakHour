// Reconnect Music on Windows (windows_reconnect.py). AXIOM's relocateLibrary() asks for an old and a new
// path prefix in two prompt() boxes, which cannot handle music that moved into different folders. This replaces
// it with a small window: choose the folder or drive where the music is now, PEAK HOUR matches the missing songs
// by file name, and shows the result. Loads after health-repairs.js and health-maintenance.js, whose top-level
// functions it replaces (they are global, and the Health buttons call them by name).
(() => {
 'use strict';
 const api='/api/windows/library/reconnect/', ACTIVE=['indexing','matching','saving'];
 let dialog, intro, chosen, pathLabel, pathInput, waiting, chooseButton, startButton, stopButton, againButton, closeButton, progress, bar, line, result, breakdown, folder='', view='choose', timer=null, watching=false;
 const KINDS=[
  {kind:'relinked',label:'Reconnected',now:true},
  {kind:'in_library',label:'Already in your library',now:true,note:'These songs are already in your library at their new place. The old entries only show as missing.'},
  {kind:'ambiguous',label:'Same name in more than one place',note:'PEAK HOUR could not tell which file is the right one. Choose a narrower folder that holds only the right copies, then press Start again.',folders:true},
  {kind:'not_found',label:'Not found in this folder',note:'Try another folder or drive.'}
 ];
 function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
 async function request(endpoint,data){
  const response=await fetch(api+endpoint,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  let payload;try{payload=await response.json()}catch(_){throw new Error('PEAK HOUR did not answer. Try again.')}
  if(!response.ok||payload.success===false)throw new Error(payload.error||'Reconnect Music could not run.');
  return payload;
 }
 const count=n=>Number(n||0).toLocaleString();
 const entries=n=>`${count(n)} old entr${Number(n)===1?'y':'ies'}`;
 // Explorer's "Copy as path" puts the folder in double quotes; spaces and one pair of quotes are dropped.
 function cleanFolder(text){
  let value=String(text||'').trim();
  if(value.length>=2&&value[0]==='"'&&value[value.length-1]==='"')value=value.slice(1,-1).trim();
  return value;
 }
 function setFolder(value,fromField){
  folder=value;
  if(!fromField)pathInput.value=value;
  pathLabel.textContent=folder;chosen.hidden=!folder;startButton.disabled=!folder;
 }
 function show(next){
  view=next;
  intro.hidden=view!=='choose';progress.hidden=view!=='running';result.hidden=view!=='done';
  startButton.hidden=view!=='choose';chooseButton.hidden=view!=='choose';stopButton.hidden=view!=='running';againButton.hidden=view!=='done';
  if(view!=='done'){breakdown.hidden=true;breakdown.replaceChildren()}
  closeButton.textContent=view==='running'?'Hide':'Close';
 }
 function render(s){
  if(ACTIVE.includes(s.state)){
   show('running');
   stopButton.hidden=s.state==='saving';  // the save cannot be stopped half way
   const matching=s.state==='matching'&&s.total>0;
   bar.max=matching?s.total:0;if(matching)bar.value=s.checked;else bar.removeAttribute('value');
   line.textContent=s.state==='indexing'?`Looking through the folder: ${count(s.files_indexed)} music files found so far`
    :s.state==='matching'?`Matching your songs by file name: ${count(s.checked)} of ${count(s.total)} checked`:'Saving your library';
   return false;
  }
  return true;  // not running
 }
 function finish(s){
  const ok=s.state==='done';
  result.textContent=ok?s.message:s.state==='cancelled'?s.message||'Stopped. Your library was not changed.':s.error||'Reconnect Music did not finish. Your library was not changed.';
  result.dataset.status=ok?'ok':'stopped';
  show('done');
  if(typeof showToast==='function')showToast(ok?s.message:(s.error||s.message||'Reconnect Music stopped.'),!ok&&s.state==='failed');
  if(ok&&s.relinked>0)refresh();
  if(ok)loadBreakdown();
 }
 // What happened to each missing song, as four lists that open and close. Song names come from the library and
 // are only ever put in with textContent.
 async function loadBreakdown(){
  let data;
  try{data=await request('result')}catch(_){return}
  if(view!=='done')return;
  breakdown.replaceChildren();
  for(const spec of KINDS){
   const total=Number((data.counts||{})[spec.kind]||0),items=(data.lists||{})[spec.kind]||[],more=Number((data.more||{})[spec.kind]||0);
   const block=element('details',undefined,'axiom-reconnect-block');block.dataset.kind=spec.kind;block.hidden=!total;
   block.append(element('summary',`${spec.label} (${count(total)})`));
   if(spec.note)block.append(element('p',spec.note,'axiom-reconnect-note'));
   const list=element('ul');
   for(const item of items){
    const li=element('li',item.name||item.path||'');
    if(spec.folders&&Array.isArray(item.folders)&&item.folders.length)li.append(element('small',`In: ${item.folders.join('; ')}`));
    if(spec.now&&item.now)li.append(element('small',`Now at: ${item.now}`,'axiom-reconnect-now'));
    list.append(li);
   }
   if(more>0)list.append(element('li',`and ${count(more)} more`,'axiom-reconnect-more'));
   block.append(list);
   if(spec.kind==='in_library'&&total)block.append(staleControls(total,items.map(item=>item.path).filter(path=>typeof path==='string')));
   breakdown.append(block);
  }
  breakdown.hidden=false;
 }
 // "Remove these old entries": asks inside this window first (the page's own confirm box would sit under the modal).
 function staleControls(total,shownPaths){
  const box=element('div',undefined,'axiom-reconnect-stale');
  const status=element('p','',  'axiom-reconnect-stale-status');status.setAttribute('role','status');status.hidden=true;
  const removeButton=element('button',`Remove ${Number(total)===1?'this':'these'} ${entries(total)}`);removeButton.id='ph-reconnect-remove-stale';
  const panel=element('div',undefined,'axiom-reconnect-confirm');panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','Remove old entries');
  const sure=element('button',`Remove ${count(total)} ${Number(total)===1?'entry':'entries'}`),keep=element('button','Keep them');
  sure.className='danger';
  [removeButton,sure,keep].forEach(b=>b.type='button');
  panel.append(element('p',`Remove ${entries(total)} from PEAK HOUR? These songs are already in your library at their new place. Your music files are not touched, and nothing changes in VirtualDJ, Serato or djay. You can bring the entries back from Health > Restore Bin.`));
  const row=element('div',undefined,'axiom-reconnect-confirm-actions');row.append(sure,keep);panel.append(row);
  const say=(text,bad)=>{status.textContent=text;status.hidden=!text;status.dataset.status=bad?'stopped':'ok'};
  removeButton.onclick=()=>{say('');removeButton.hidden=true;panel.hidden=false;sure.focus()};
  keep.onclick=()=>{panel.hidden=true;removeButton.hidden=false;removeButton.focus()};
  sure.onclick=async()=>{
   sure.disabled=keep.disabled=true;
   try{
    const stale=await request('stale');
    if(!stale.count){panel.hidden=true;say('Nothing to remove — these entries have already changed.');return}
    if(Number(stale.count)>Number(total)){panel.hidden=true;say('The list has changed since you looked. Close this window and run Reconnect Music again.',true);return}
    // Only entries the user was shown (exact path) are sent; an empty list must never be posted, the route would treat it as "all missing".
    const shown=new Set(shownPaths||[]);
    const paths=(Array.isArray(stale.paths)?stale.paths:[]).filter(path=>shown.has(path));
    if(!Array.isArray(paths)||!paths.length){panel.hidden=true;say('Nothing to remove — these entries have already changed.');return}
    const response=await fetch('/api/library/purge_missing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths})});
    let data={};try{data=await response.json()}catch(_){}
    if(!response.ok||data.success===false)throw new Error(data.error||data.message||'PEAK HOUR could not remove the old entries.');
    const removed=Number(data.purged_count||0);
    panel.hidden=true;
    if(removed>0){
     say(`Removed ${entries(removed)}. You can bring ${Number(removed)===1?'it':'them'} back from Health > Restore Bin.`);
     if(typeof updateRemovedFromAxiomBinPanel==='function'){try{updateRemovedFromAxiomBinPanel(data.bin)}catch(_){}}
     refresh();
    }else{
     say('Nothing was removed — these entries have already changed.');
    }
   }catch(error){
    panel.hidden=true;removeButton.hidden=false;say(error.message,true);
   }finally{sure.disabled=keep.disabled=false}
  };
  box.append(removeButton,panel,status);
  return box;
 }
 function refresh(){
  if(typeof runLibraryHealthCheck==='function')Promise.resolve(runLibraryHealthCheck({force:true})).catch(()=>{});
  if(typeof loadLibraryStats==='function')Promise.resolve(loadLibraryStats(false)).catch(()=>{});
  if(typeof runSearch==='function')Promise.resolve(runSearch()).catch(()=>{});
 }
 // Polls only while a job runs.
 function watch(){
  if(watching)return;watching=true;
  const tick=async()=>{
   timer=null;
   try{
    const s=await request('status');
    if(render(s)){watching=false;finish(s);return}  // render() is true once the job is no longer running
   }catch(error){watching=false;result.textContent=error.message;result.dataset.status='stopped';show('done');return}
   timer=setTimeout(tick,500);
  };
  tick();
 }
 async function choose(){
  // Only the choose button waits: the folder window can open behind this one, so the typed path and Start stay usable.
  const typed=pathInput.value;
  chooseButton.disabled=true;waiting.hidden=false;
  try{
   const data=await request('choose',{});
   if(!data.cancelled&&view==='choose'&&pathInput.value===typed){setFolder(data.folder);result.textContent=''}
  }catch(error){result.textContent=error.message;result.dataset.status='stopped';result.hidden=false}
  finally{waiting.hidden=true;chooseButton.disabled=false;startButton.disabled=!folder}
 }
 async function start(){
  startButton.disabled=chooseButton.disabled=true;
  try{await request('start',{folder});show('running');line.textContent='Starting';watch()}
  catch(error){result.textContent=error.message;result.dataset.status='stopped';show('choose');result.hidden=false;chooseButton.disabled=false;startButton.disabled=false}
 }
 function setup(){
  dialog=document.createElement('dialog');dialog.className='axiom-reconnect';dialog.setAttribute('aria-labelledby','axiom-reconnect-title');
  const head=element('header'),title=element('h2','Reconnect Music');title.id='axiom-reconnect-title';head.append(title);
  intro=element('div');
  intro.append(element('p','Choose the folder or drive where your music is now. PEAK HOUR looks for your missing songs there by file name and reconnects the ones it finds. Your music files are not changed.'));
  chosen=element('p',undefined,'axiom-reconnect-chosen');chosen.hidden=true;pathLabel=element('strong','');chosen.append(element('span','Search in: '),pathLabel);intro.append(chosen);
  const field=element('label',undefined,'axiom-reconnect-field');field.htmlFor='ph-reconnect-path';
  pathInput=document.createElement('input');pathInput.id='ph-reconnect-path';pathInput.type='text';pathInput.spellcheck=false;pathInput.placeholder='For example D:\\Music';pathInput.autocomplete='off';
  field.append(element('span','Or type or paste the folder:'),pathInput);intro.append(field);
  pathInput.oninput=()=>{folder=cleanFolder(pathInput.value);pathLabel.textContent=folder;chosen.hidden=!folder;startButton.disabled=!folder};
  waiting=element('p','A folder window is open. If you can\'t see it, look behind this window (press Alt+Tab), or type the folder above instead.','axiom-reconnect-waiting');waiting.setAttribute('role','status');waiting.hidden=true;intro.append(waiting);
  progress=element('div');progress.hidden=true;
  bar=document.createElement('progress');bar.setAttribute('aria-label','Reconnect Music progress');bar.className='axiom-reconnect-bar';line=element('p','');progress.append(bar,line);
  result=element('p','',null);result.className='axiom-reconnect-result';result.hidden=true;result.setAttribute('role','status');result.setAttribute('aria-live','polite');
  const actions=element('div',undefined,'axiom-reconnect-actions');
  chooseButton=element('button','Choose folder or drive');startButton=element('button','Start');startButton.disabled=true;startButton.className='primary';
  stopButton=element('button','Stop');stopButton.hidden=true;closeButton=element('button','Close');
  againButton=element('button','Search another folder');againButton.hidden=true;
  [chooseButton,startButton,stopButton,againButton,closeButton].forEach(b=>b.type='button');
  chooseButton.onclick=choose;startButton.onclick=start;closeButton.onclick=()=>dialog.close();
  againButton.onclick=()=>{result.textContent='';show('choose');startButton.disabled=!folder;pathInput.focus()};
  stopButton.onclick=async()=>{stopButton.disabled=true;try{await request('cancel',{})}catch(_){}finally{stopButton.disabled=false}};
  breakdown=element('div',undefined,'axiom-reconnect-breakdown');breakdown.hidden=true;
  actions.append(chooseButton,startButton,stopButton,againButton,closeButton);
  dialog.append(head,intro,progress,result,breakdown,actions);document.body.append(dialog);
 }
 async function open(){
  if(!dialog)setup();
  if(!dialog.open)dialog.showModal();
  result.textContent='';
  show('choose');
  try{
   const s=await request('status');
   if(s.folder&&!folder)setFolder(s.folder);
   else setFolder(folder);
   if(!render(s))watch();
  }catch(_){/* the choose button reports problems */}
 }
 window.relocateLibrary=open;
 // The original does nothing but re-run the Health check when the summary says 0 missing files. Someone who clicked
 // Reconnect Music on a missing-file task still wants to choose where the music is now, so that task opens this window
 // whatever the count says (the Health summary can be out of date, and the songs may sit on a drive that is away).
 const original=window.runHealthApprovedSelectedAction;
 if(typeof original==='function'){
  window.runHealthApprovedSelectedAction=function(...args){
   let key='';try{key=typeof healthApprovedCurrentTaskKey==='function'?healthApprovedCurrentTaskKey():''}catch(_){}
   return key==='missing_file'?open():original.apply(this,args);
  };
 }
 window.AxiomWindowsReconnect={open};
})();
