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
 function render(){
  const waiting=jobs.filter(j=>j.status==='queued'||j.status==='applying');
  if(!pill)return;
  pill.hidden=!waiting.length;
  pill.textContent='DJ writes waiting ('+waiting.length+')';
  if(!waiting.length&&panel)panel.hidden=true;
  if(!panel||panel.hidden)return;
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
   notify(jobs);render();
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
  pill.title='Changes for VirtualDJ, Serato or djay that wait until the program is closed';
  panel=document.createElement('div');
  panel.id='windows-dj-queue-panel';panel.hidden=true;
  panel.style.cssText='position:fixed;top:36px;right:150px;z-index:9000;min-width:260px;max-width:420px;padding:8px 10px;border-radius:8px;font-size:12px;background:var(--panel,#222);color:var(--text,#eee);border:1px solid rgba(128,128,128,.4)';
  pill.addEventListener('click',()=>{panel.hidden=!panel.hidden;render();});
  document.body.append(pill,panel);
 }
 function start(){build();document.addEventListener('visibilitychange',schedule);schedule();}
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
})();
