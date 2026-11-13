// Reconnect Music on Windows (windows_reconnect.py). AXIOM's relocateLibrary() asks for an old and a new
// path prefix in two prompt() boxes, which cannot handle music that moved into different folders. This replaces
// it with a small window: choose the folder or drive where the music is now, PEAK HOUR matches the missing songs
// by file name, and shows the result. Loads after health-repairs.js and health-maintenance.js, whose top-level
// functions it replaces (they are global, and the Health buttons call them by name).
(() => {
 'use strict';
 const api='/api/windows/library/reconnect/', ACTIVE=['indexing','matching','saving'];
 let dialog, intro, chosen, pathLabel, chooseButton, startButton, stopButton, closeButton, progress, bar, line, result, folder='', timer=null, watching=false;
 function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
 async function request(endpoint,data){
  const response=await fetch(api+endpoint,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  let payload;try{payload=await response.json()}catch(_){throw new Error('PEAK HOUR did not answer. Try again.')}
  if(!response.ok||payload.success===false)throw new Error(payload.error||'Reconnect Music could not run.');
  return payload;
 }
 const count=n=>Number(n||0).toLocaleString();
 function show(view){
  intro.hidden=view!=='choose';progress.hidden=view!=='running';result.hidden=view!=='done';
  startButton.hidden=view!=='choose';chooseButton.hidden=view!=='choose';stopButton.hidden=view!=='running';
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
  chooseButton.disabled=startButton.disabled=true;
  try{
   const data=await request('choose',{});
   if(!data.cancelled){folder=data.folder;pathLabel.textContent=folder;chosen.hidden=false;startButton.disabled=false;result.textContent=''}
  }catch(error){result.textContent=error.message;result.dataset.status='stopped';result.hidden=false}
  finally{chooseButton.disabled=false;startButton.disabled=!folder}
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
  progress=element('div');progress.hidden=true;
  bar=document.createElement('progress');bar.setAttribute('aria-label','Reconnect Music progress');bar.className='axiom-reconnect-bar';line=element('p','');progress.append(bar,line);
  result=element('p','',null);result.className='axiom-reconnect-result';result.hidden=true;result.setAttribute('role','status');result.setAttribute('aria-live','polite');
  const actions=element('div',undefined,'axiom-reconnect-actions');
  chooseButton=element('button','Choose folder or drive');startButton=element('button','Start');startButton.disabled=true;startButton.className='primary';
  stopButton=element('button','Stop');stopButton.hidden=true;closeButton=element('button','Close');
  [chooseButton,startButton,stopButton,closeButton].forEach(b=>b.type='button');
  chooseButton.onclick=choose;startButton.onclick=start;closeButton.onclick=()=>dialog.close();
  stopButton.onclick=async()=>{stopButton.disabled=true;try{await request('cancel',{})}catch(_){}finally{stopButton.disabled=false}};
  actions.append(chooseButton,startButton,stopButton,closeButton);
  dialog.append(head,intro,progress,result,actions);document.body.append(dialog);
 }
 async function open(){
  if(!dialog)setup();
  if(!dialog.open)dialog.showModal();
  result.textContent='';
  show('choose');
  try{
   const s=await request('status');
   if(s.folder&&!folder){folder=s.folder}
   pathLabel.textContent=folder;chosen.hidden=!folder;startButton.disabled=!folder;
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
