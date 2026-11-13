// "DJ writes waiting (N)" pill + panel and toasts for the DJ write queue (windows_dj_write_queue.py).
(function(){
 'use strict';
 const FINAL={done:1,failed:1,needs_review:1};
 const seen=new Map();   // job id -> last status seen
 let jobs=[],timer=null,pill=null,panel=null;
 function toast(text,bad){if(typeof window.showToast==='function')window.showToast(text,bad);}
 const NAMES={virtualdj:'VirtualDJ',serato:'Serato',djay:'djay'};
 function label(job){return (NAMES[job.program]||job.program)+' '+(job.kind==='cues'?'cue points':'playlist');}
 // A finished job is announced once, even if the page only learns of it later (hidden window, restart): the ids already
 // announced are kept in localStorage, and only jobs that finished in the last 10 minutes are announced.
 const KEY='ph-dj-queue-announced';
 let announced=new Set();
 try{announced=new Set(JSON.parse(localStorage.getItem(KEY)||'[]'));}catch(error){/* storage unavailable */}
 function remember(id){
  announced.add(id);
  try{localStorage.setItem(KEY,JSON.stringify([...announced].slice(-200)));}catch(error){/* storage unavailable */}
 }
 function notify(list){
  const now=Date.now()/1000;
  for(const job of list){
   const before=seen.get(job.id);
   seen.set(job.id,job.status);
   if(!FINAL[job.status]||announced.has(job.id))continue;
   const recent=job.finished_at&&now-job.finished_at<600;
   if(!(before&&!FINAL[before])&&!recent)continue;
   remember(job.id);
   if(job.status==='done')toast('Written to '+label(job)+'. '+(job.message||''),false);
   else if(job.status==='failed')toast('Could not write '+label(job)+': '+(job.message||''),true);
   else toast(label(job)+' changed while waiting. Review it and send it again.',true);
  }
 }
 let recent=[];
 const PROGRAM_NAMES={virtualdj:'VirtualDJ',serato:'Serato',djay:'djay'};
 function when(seconds){return seconds?new Date(seconds*1000).toLocaleString():'';}
 // One line per recent write, with Undo; a refusal from the writer is shown as it is (text only).
 function recentRow(write){
  const row=document.createElement('div');
  row.className='windows-dj-recent-row';row.dataset.id=write.id;
  row.style.cssText='padding:3px 0;border-top:1px solid rgba(128,128,128,.25)';
  const line=document.createElement('div');
  line.style.cssText='display:flex;gap:8px;align-items:center';
  const text=document.createElement('span');
  text.style.flex='1';
  text.textContent=(PROGRAM_NAMES[write.program]||write.program)+': '+write.label+(write.what?' — '+write.what:'')+' — '+when(write.created_at);
  line.appendChild(text);
  const refusal=document.createElement('div');
  refusal.className='windows-dj-recent-refusal';refusal.style.cssText='color:#ff9d8a;margin-top:2px';refusal.hidden=true;
  if(write.undone){
   const done=document.createElement('small');done.textContent='undone';line.appendChild(done);
  }else if(write.undoable===false){  // e.g. an older send Serato has changed since: say why, offer no button
   refusal.textContent=write.note||'PEAK HOUR can\'t undo this one safely.';refusal.hidden=false;
  }else{
   const undo=document.createElement('button');
   undo.type='button';undo.textContent='Undo';undo.className='windows-dj-recent-undo';
   undo.addEventListener('click',()=>undoWrite(write,undo,refusal));
   line.appendChild(undo);
  }
  row.append(line,refusal);
  return row;
 }
 async function undoWrite(write,button,refusal){
  button.disabled=true;refusal.hidden=true;
  try{
   const response=await fetch(write.undo_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup_id:write.id})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.success===false)throw new Error(data.error||data.message||'PEAK HOUR could not undo this write.');
   toast((PROGRAM_NAMES[write.program]||write.program)+' restored. PEAK HOUR undid this write.',false);
   await loadRecent();
  }catch(error){
   refusal.textContent=error.message;refusal.hidden=false;button.disabled=false;
  }
 }
 async function loadRecent(){
  try{
   const response=await fetch('/api/windows/dj-writes/recent',{cache:'no-store'});
   if(!response.ok)return;
   recent=(await response.json()).writes||[];
  }catch(error){/* the next load tries again */}
  render();
 }
 function render(){
  const waiting=jobs.filter(j=>j.status==='queued'||j.status==='applying');
  if(!pill)return;
  pill.hidden=!waiting.length&&!recent.length;
  pill.textContent=waiting.length?'DJ writes waiting ('+waiting.length+')':'Recent DJ writes';
  if(pill.hidden&&panel)panel.hidden=true;
  if(!panel||panel.hidden)return;
  const refusals=new Map([...panel.querySelectorAll('.windows-dj-recent-row')].map(r=>[r.dataset.id,r.querySelector('.windows-dj-recent-refusal')]));
  panel.textContent='';
  for(const job of waiting){
   const row=document.createElement('div');
   row.style.cssText='display:flex;gap:8px;align-items:center;padding:3px 0';
   const text=document.createElement('span');
   text.style.flex='1';text.textContent=label(job)+(job.status==='applying'?' (applying)':' (waits for the program to close)');
   row.appendChild(text);
   if(job.status==='queued'){
    const cancel=document.createElement('button');
    cancel.type='button';cancel.textContent='Cancel';
    cancel.addEventListener('click',()=>cancelJob(job.id));
    row.appendChild(cancel);
   }
   panel.appendChild(row);
  }
  const heading=document.createElement('strong');
  heading.textContent='Recent writes';heading.style.cssText='display:block;margin-top:6px';
  panel.appendChild(heading);
  if(!recent.length){const none=document.createElement('div');none.textContent='Nothing written yet.';panel.appendChild(none);}
  for(const write of recent){
   const row=recentRow(write);
   const old=refusals.get(write.id);
   if(old&&!old.hidden){const mine=row.querySelector('.windows-dj-recent-refusal');mine.textContent=old.textContent;mine.hidden=false;}
   panel.appendChild(row);
  }
 }
 async function cancelJob(id){
  try{
   const response=await fetch('/api/windows/dj-queue/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
   if(!response.ok)throw new Error('That job can no longer be cancelled.');
  }catch(error){toast(error.message,true);}
  poll();
 }
 async function poll(){
  try{
   const response=await fetch('/api/windows/dj-queue/list',{cache:'no-store'});
   if(!response.ok)return;
   jobs=(await response.json()).jobs||[];
   const finished=jobs.some(j=>FINAL[j.status]&&seen.get(j.id)!==j.status);
   notify(jobs);render();
   if(finished)loadRecent();
  }catch(error){/* the next poll tries again */}
 }
 function schedule(){
  if(timer){clearInterval(timer);timer=null;}
  poll();timer=setInterval(poll,document.visibilityState==='visible'?10000:30000);  // keeps polling when hidden: a minimized window must still learn of a finished write
 }
 function build(){
  pill=document.createElement('button');
  pill.type='button';pill.id='windows-dj-queue-pill';pill.hidden=true;
  pill.style.cssText='position:fixed;top:8px;right:150px;z-index:9000;padding:2px 10px;border-radius:12px;font-size:12px;cursor:pointer';
  pill.title='Writes for VirtualDJ, Serato or djay that wait until the program is closed, and your recent writes (with Undo)';
  panel=document.createElement('div');
  panel.id='windows-dj-queue-panel';panel.hidden=true;
  panel.style.cssText='position:fixed;top:36px;right:150px;z-index:9000;min-width:260px;max-width:420px;padding:8px 10px;border-radius:8px;font-size:12px;background:var(--panel,#222);color:var(--text,#eee);border:1px solid rgba(128,128,128,.4)';
  pill.addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden)loadRecent();else render();});
  document.body.append(pill,panel);
 }
 function start(){build();document.addEventListener('visibilitychange',schedule);schedule();loadRecent();}
 window.AxiomDJQueue={showRecent(){if(!panel)return;panel.hidden=false;loadRecent();},refresh:loadRecent};
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
})();
