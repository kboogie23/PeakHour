// Send to VirtualDJ (Windows): cue points, beat grid repairs and play counts,
// written into VirtualDJ's database by windows_virtualdj_write.py.
// Always previews first; VirtualDJ must be closed; every write keeps a backup
// and the last one can be undone. A card sits under Health > Sync to DJ, and
// the VirtualDJ grid check gets a "Write repairs to VirtualDJ" button.
(function(){
 'use strict';
 const api='/api/windows/virtualdj/write/';
 const byId=id=>document.getElementById(id);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={cues:'cue points',grids:'beat grid repairs',play_counts:'play counts'};
 const plural=(n,word)=>`${n.toLocaleString()} ${word}${n===1?'':'s'}`;
 async function call(action,body){
  const response=await fetch(api+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)throw new Error(data.error||'VirtualDJ could not be updated.');
  return data;
 }
 function describe(change){
  if(change.kind==='cues')return `Cue ${change.num} at ${change.seconds.toFixed(2)}s from ${escape(change.source)}`;
  if(change.kind==='play_counts')return `Plays ${change.before} → ${change.after} (${escape(change.source)})`;
  return `Grid ${change.bpm_before} → ${change.bpm_after} BPM, first beat ${change.before.first.toFixed(3)}s → ${change.after.first.toFixed(3)}s`;
 }
 const numberText=n=>Number(n||0).toLocaleString();
 // ---- the targets a cue send can go to, and how each one's preview/apply/job routes are named
 const CUE_TARGETS={virtualdj:{label:'VirtualDJ',api},serato:{label:'Serato',api:'/api/windows/serato/cues/'},djay:{label:'djay',api:'/api/windows/djay/cues/'}};
 async function postTarget(url,body){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)throw new Error(data.error||'The cue points could not be sent.');
  return {status:response.status,data};
 }
 // ---- progress of a background job
 function progressText(job){
  const verb=job.phase==='writing'?'Writing':'Checking';
  if(!job.total)return job.current_title||'Starting…';
  return `${verb} ${numberText(job.done)} of ${numberText(job.total)} songs${job.current_title?' — '+job.current_title:''}`;
 }
 function renderProgress(parts,job){
  if(job.total){parts.bar.max=job.total;parts.bar.value=Math.min(job.done||0,job.total);}else parts.bar.removeAttribute('value');
  parts.text.textContent=progressText(job);
 }
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function pollJob(base,jobId,onUpdate,wait=400){
  for(;;){
   const response=await fetch(`${base}job/${encodeURIComponent(jobId)}`,{cache:'no-store'});
   const job=await response.json().catch(()=>({}));
   if(!response.ok||job.success===false)throw new Error(job.error||'The job could not be followed.');
   onUpdate(job);
   if(job.state!=='running')return job;
   await sleep(wait);
  }
 }
 // A request that starts a background job answers {job_id}: follow it (progress on `ui`) and return {status, data} like a plain
 // answer, or null if it was cancelled before it had a result.
 async function jobCall(url,body,base,ui,target){
  const started=await postTarget(url,body);
  if(!started.data.job_id)return started;
  ui.onJob(base,started.data.job_id);
  let job;
  try{job=await pollJob(base,started.data.job_id,update=>ui.setProgress(update,target));}
  finally{ui.onJob(null,null);}
  if(job.state==='failed')throw new Error(job.error||'The job did not finish.');
  if(job.state==='cancelled'&&!job.result)return null;
  const result=job.result||{};
  return {status:result.http_status||200,data:result};
 }
 // ---- which songs: a playlist or the Studio set (default), or the whole library
 function scopeSets(){
  const sets=[];
  const studio=typeof getActiveStudioOutputTracks==='function'?(getActiveStudioOutputTracks()||[]):[];
  const paths=list=>(list||[]).map(t=>typeof t==='string'?t:t&&t.path).filter(Boolean);
  if(paths(studio).length)sets.push({id:'studio',label:`Current Studio set (${plural(paths(studio).length,'song')})`,tracks:paths(studio)});
  for(const item of (typeof savedPlaylists!=='undefined'?savedPlaylists:[])||[]){
   const list=paths(item.tracks);
   if(list.length)sets.push({id:'p:'+item.id,label:`${item.name||'Playlist'} (${plural(list.length,'song')})`,tracks:list});
  }
  return sets;
 }
 function scopeTracks(scope,setId,sets){
  if(scope==='library')return 'all';
  const chosen=(sets||[]).find(item=>item.id===setId)||(sets||[])[0];
  if(!chosen||!chosen.tracks.length)throw new Error('Choose a playlist or set with songs, or pick "Whole library".');
  return chosen.tracks;
 }
 function fillScope(){
  const select=byId('health-dj-cue-set');if(!select)return;
  const sets=scopeSets(),keep=select.value;
  select.replaceChildren(...sets.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.label;return o;}));
  if(!sets.length){const o=document.createElement('option');o.value='';o.textContent='No saved playlists or set yet';select.append(o);}
  else if(sets.some(item=>item.id===keep))select.value=keep;
  const library=document.querySelector('input[name="health-dj-cue-scope"][value="library"]');
  select.disabled=!!(library&&library.checked);
 }
 // ---- what a preview found, in words ("5 already have cue points in Serato · 3 have no cue points anywhere to copy · 2 would be filled")
 function cueBreakdown(label,c){
  const parts=[],n=numberText;
  if(c.already_have_cues)parts.push(`${n(c.already_have_cues)} already have cue points in ${label}`);
  if(c.no_cues_to_copy)parts.push(`${n(c.no_cues_to_copy)} have no cue points anywhere to copy`);
  if(c.not_in_djay)parts.push(`${n(c.not_in_djay)} aren't in djay yet — add them in djay first`);
  if(c.no_djay_record)parts.push(`${n(c.no_djay_record)} have no djay record yet — open them once in djay`);
  if(c.file_not_found)parts.push(`${n(c.file_not_found)} ${c.file_not_found===1?'file was':'files were'} not found`);
  if(c.cannot_read)parts.push(`${n(c.cannot_read)} can't be read`);
  if(c.no_room)parts.push(`${n(c.no_room)} have no room in the tag`);
  parts.push(`${n(c.songs_to_write||0)} would be filled${c.songs_growing?` (${n(c.songs_growing)} grow the file)`:''}`);
  if(c.not_in_serato)parts.push(`${n(c.not_in_serato)} aren't in a Serato library yet`);
  return parts.join(' · ');
 }
 function vdjCounts(preview){return {songs_to_write:preview.songs||0,cues_to_write:(preview.counts||{}).cues||0,already_have_cues:0};}
 // ---- confirmation dialogs (a finished check with nothing to write only offers Close)
 function confirmCues(label,counts){
  return new Promise(resolve=>{
   const box=document.createElement('dialog');box.className='axiom-vdj-inspect axiom-vdj-write';
   const songs=counts.songs_to_write||0;
   const detail=label==='Serato'
    ?"Serato keeps cues inside the song file, so PEAK HOUR edits the song's tag (the audio and the date stay the same; a backup is kept). A song with no spare room in its tag gets about 1-4 KB bigger, and VirtualDJ's record of its file size is updated (after VirtualDJ closes, if it is open). A song that is open in another program is left alone."
    :'Your music files are not changed. Cue points already in the song are never replaced.';
   box.innerHTML=`<h2>Send cue points to ${label}</h2>
    <p>${songs?`PEAK HOUR will write <b>${numberText(counts.cues_to_write)}</b> cue points to ${plural(songs,'song')} in ${label}.`:'Nothing to write.'}</p>
    <p class="axiom-vdj-breakdown">${cueBreakdown(label,counts)}</p>
    <p>Only songs with no cue points in ${label} are filled. PEAK HOUR keeps a backup you can undo.</p>
    <p><button type="button" data-more>Details</button></p>
    <div data-details hidden><p>If ${label} is open, PEAK HOUR writes this after you close it. ${detail}</p></div>
    <div class="axiom-vdj-actions">${songs?`<button type="button" data-no>Cancel</button><button type="button" data-yes>Send to ${label}</button>`:'<button type="button" data-no>Close</button>'}</div>`;
   const more=box.querySelector('[data-more]'),details=box.querySelector('[data-details]');
   more.onclick=()=>{details.hidden=!details.hidden;more.textContent=details.hidden?'Details':'Hide details';};
   let done=false;const finish=v=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve(v)};
   box.querySelector('[data-no]').onclick=()=>finish(false);const yes=box.querySelector('[data-yes]');if(yes)yes.onclick=()=>finish(true);
   box.addEventListener('cancel',()=>finish(false));document.body.append(box);box.showModal();
  });
 }
 function confirmWrite(data){
  return new Promise(resolve=>{
   const box=document.createElement('dialog');box.className='axiom-vdj-inspect axiom-vdj-write';
   const parts=data.kinds.map(kind=>`<b>${(data.counts[kind]||0).toLocaleString()}</b> ${names[kind]}`).join(', ');
   const rows=data.rows.slice(0,40).map(row=>`<li><strong>${escape(row.artist)} – ${escape(row.title)}</strong><small>${row.changes.map(describe).join(' · ')}</small></li>`).join('');
   box.innerHTML=`<h2>Send to VirtualDJ</h2>
    <p>${data.songs?`PEAK HOUR will write ${parts} to ${plural(data.songs,'song')} in VirtualDJ.`:'Nothing to write: VirtualDJ already has everything PEAK HOUR would send.'}</p>
    ${data.skipped_count?`<p>${plural(data.skipped_count,'song')} left alone (VirtualDJ's own cue in that slot, or a grid changed since the check).</p>`:''}
    ${rows?`<ul class="axiom-vdj-write-rows">${rows}</ul>${data.songs>40?`<p>…and ${(data.songs-40).toLocaleString()} more.</p>`:''}`:''}
    <p>Quit VirtualDJ first. Existing VirtualDJ cues are never replaced and play counts only go up. PEAK HOUR keeps a backup, and you can undo this write. Your music files are not changed.</p>
    <div class="axiom-vdj-actions">${data.songs?'<button type="button" data-no>Cancel</button><button type="button" data-yes>Write to VirtualDJ</button>':'<button type="button" data-no>Close</button>'}</div>`;
   let done=false;const finish=v=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve(v)};
   box.querySelector('[data-no]').onclick=()=>finish(false);const yes=box.querySelector('[data-yes]');if(yes)yes.onclick=()=>finish(true);
   box.addEventListener('cancel',()=>finish(false));document.body.append(box);box.showModal();
  });
 }
 // ---- one dialog for the whole send: it opens the moment the button is clicked, shows each program's status and a progress bar
 function openSendDialog(targets,title){
  const box=document.createElement('dialog');box.className='axiom-vdj-inspect axiom-vdj-write axiom-vdj-send';box.setAttribute('aria-live','polite');
  box.innerHTML=`<h2></h2><ul class="axiom-vdj-send-lines"></ul><progress class="axiom-vdj-progress" aria-label="Progress"></progress>
   <p class="axiom-vdj-progress-text" role="status">Starting…</p><div class="axiom-vdj-send-extra"></div>
   <div class="axiom-vdj-actions"><button type="button" data-cancel>Cancel</button></div>`;
  box.querySelector('h2').textContent=title;
  const list=box.querySelector('ul'),lines={};
  for(const target of targets){
   const item=document.createElement('li'),name=document.createElement('strong'),status=document.createElement('span');
   name.textContent=((CUE_TARGETS[target]||{}).label||target)+': ';status.textContent='Waiting…';item.append(name,status);list.append(item);lines[target]=status;
  }
  const parts={bar:box.querySelector('progress'),text:box.querySelector('.axiom-vdj-progress-text')};
  const cancel=box.querySelector('[data-cancel]');
  const ui={box,parts,stopped:false,job:null,
   cancelled(){return this.stopped;},
   setLine(target,text){if(lines[target])lines[target].textContent=text;},
   setProgress(job){renderProgress(parts,job);},
   onJob(base,id){this.job=base?{base,id}:null;},
   close(){if(box.open)box.close();box.remove();}};
  cancel.onclick=async()=>{
   ui.stopped=true;cancel.disabled=true;parts.text.textContent='Stopping after the current song…';
   if(ui.job){try{await fetch(`${ui.job.base}job/${encodeURIComponent(ui.job.id)}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch(error){/* the poll shows what happened */}}
  };
  box.addEventListener('cancel',event=>event.preventDefault());
  document.body.append(box);box.showModal();
  ui.cancelButton=cancel;ui.extra=box.querySelector('.axiom-vdj-send-extra');
  return ui;
 }
 // The result of sending to the programs, in the same dialog: a line each, Undo buttons for what was written, and Close.
 function finishSend(ui,results){
  ui.parts.bar.hidden=true;
  const written=results.filter(r=>r.state==='written').length;
  ui.parts.text.textContent=ui.cancelled()?'Stopped.':written?'Done.':'Nothing was written.';
  for(const result of results){
   if(!result.backup_id||!result.base)continue;
   const button=document.createElement('button');button.type='button';button.textContent=`Undo ${result.label}`;
   button.onclick=async()=>{
    button.disabled=true;
    try{
     const undone=(await postTarget(result.base+'undo',{backup_id:result.backup_id})).data;
     ui.setLine(result.target,undone.skipped&&undone.skipped.length?`${plural(undone.restored.length,'song')} restored; ${plural(undone.skipped.length,'song')} had changed and were left as they are.`:'Undone: your songs are back as they were.');
    }catch(error){button.disabled=false;ui.setLine(result.target,error.message);}
   };
   ui.extra.append(button);
  }
  ui.cancelButton.disabled=false;ui.cancelButton.textContent='Close';ui.cancelButton.onclick=()=>ui.close();
 }
 // ---- one program after another
 async function sendOne(target,tracks,ui,io){
  const cfg=CUE_TARGETS[target],label=cfg.label,base=cfg.api,isVdj=target==='virtualdj';
  ui.setLine(target,'Checking songs…');
  const first=await jobCall(base+'preview',isVdj?{kinds:['cues'],tracks}:{tracks},base,ui,target);
  if(!first){ui.setLine(target,'Cancelled. Nothing was written.');return {target,label,state:'cancelled'};}
  const preview=first.data,counts=isVdj?vdjCounts(preview):(preview.counts||{});
  if(!(counts.songs_to_write>0)){
   const text=isVdj?'Nothing to write: VirtualDJ already has everything PEAK HOUR would send.':'Nothing to write — '+cueBreakdown(label,counts)+'.';
   ui.setLine(target,text);return {target,label,state:'nothing',text};
  }
  ui.setLine(target,cueBreakdown(label,counts));
  if(!(await io.confirm(target,preview,counts))){ui.setLine(target,'Not sent.');return {target,label,state:'declined'};}
  ui.setLine(target,'Sending…');
  const body=isVdj?{kinds:['cues'],tracks,preview_token:preview.preview_token,confirm:true}:{tracks,digest:preview.digest,confirm:true};
  const sent=await jobCall(base+'apply',body,base,ui,target);
  const data=sent?sent.data:{};
  let state='nothing',text='Nothing was written.';
  if(sent&&sent.status===202&&data.queued){state='queued';text=data.message||`${label} is open — PEAK HOUR will write this after you close it.`;}
  else if(data.written){
   state='written';
   text=`Written to ${plural(data.written,'song')}.`+(data.grown?` ${plural(data.grown,'song')} got a little bigger; the audio is unchanged.`:'')
    +(data.cancelled?' Stopped early at your request.':'')+(data.backup_id?` Backup ${data.backup_id}.`:'');
  }
  if(isVdj&&data.undo)refreshUndo(data.undo);
  ui.setLine(target,text);
  return {target,label,state,text,backup_id:data.backup_id||'',base:isVdj?null:base,written:data.written||0};
 }
 async function runSend(targets,tracks,ui,io){
  for(const target of targets)ui.setLine(target,'Waiting…');
  const results=[];
  for(const target of targets){
   if(ui.cancelled()){ui.setLine(target,'Not started (stopped).');results.push({target,label:CUE_TARGETS[target].label,state:'cancelled'});continue;}
   try{results.push(await sendOne(target,tracks,ui,io));}
   catch(error){ui.setLine(target,error.message);results.push({target,label:CUE_TARGETS[target].label,state:'failed',text:error.message});}
  }
  return results;
 }
 const confirmFor=(target,preview,counts)=>target==='virtualdj'?confirmWrite(preview):confirmCues(CUE_TARGETS[target].label,counts);
 async function sendCuesTo(targets,button){
  if(!targets.length){window.showToast?.('Choose where to send cue points.',true);return;}
  let tracks;
  try{
   const scope=document.querySelector('input[name="health-dj-cue-scope"]:checked')?.value||'set';
   tracks=scopeTracks(scope,byId('health-dj-cue-set')?.value,scopeSets());
  }catch(error){window.showToast?.(error.message,true);return;}
  const label=button?button.textContent:'';
  if(button){button.disabled=true;button.textContent='Working…';}
  const ui=openSendDialog(targets,'Sending cue points');  // on screen before anything is asked of the server
  try{
   if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('Send cue points'))){ui.close();return;}
   finishSend(ui,await runSend(targets,tracks,ui,{confirm:confirmFor}));
  }catch(error){ui.close();window.showToast?.(error.message,true);}
  finally{if(button){button.disabled=false;button.textContent=label;}}
 }
 // The VirtualDJ-only buttons (cue points, grid repairs, play counts for the whole library): preview and write as background jobs too.
 async function open(kinds,button){
  if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('Write to VirtualDJ')))return;
  if(!kinds.length){window.showToast?.('Choose what to send to VirtualDJ.',true);return;}
  const label=button?button.textContent:'';
  if(button){button.disabled=true;button.textContent='Working…';}
  let ui=openSendDialog(['virtualdj'],'Checking VirtualDJ');
  try{
   ui.setLine('virtualdj','Reading the library…');
   const first=await jobCall(api+'preview',{kinds},api,ui,'virtualdj');
   ui.close();
   if(!first){window.showToast?.('Cancelled. Nothing was written.');return;}
   const preview=first.data;
   if(!(await confirmWrite(preview)))return;
   ui=openSendDialog(['virtualdj'],'Writing to VirtualDJ');ui.setLine('virtualdj','Writing…');
   const sent=await jobCall(api+'apply',{kinds,preview_token:preview.preview_token,confirm:true},api,ui,'virtualdj');
   ui.close();
   const result=sent?sent.data:{};
   window.showToast?.(result.written?`Written to ${plural(result.written,'song')} in VirtualDJ. A backup was kept.`:'Nothing to write.');
   refreshUndo(result.undo);
  }catch(error){ui.close();window.showToast?.(error.message,true);}
  finally{if(button){button.disabled=false;button.textContent=label;}}
 }
 function refreshUndo(state){
  const apply=info=>{
   const button=byId('health-vdj-write-undo'),note=byId('health-vdj-write-undo-note');if(!button)return;
   button.hidden=!info?.available;note.hidden=!(info&&info.id);
   if(info&&info.id)note.textContent=info.available?`Last write: ${plural(info.songs,'song')} on ${new Date(info.created_at*1000).toLocaleString()}.`:info.reason||'';
  };
  if(state)apply(state);else call('status').then(d=>apply(d.undo)).catch(()=>{});
 }
 async function undo(button){
  if(!confirm('Put VirtualDJ\'s database back the way it was before the last PEAK HOUR write? Quit VirtualDJ first.'))return;
  button.disabled=true;
  try{const r=await call('undo',{});window.showToast?.('VirtualDJ restored from the backup.');refreshUndo(r.undo);}
  catch(error){window.showToast?.(error.message,true);}
  finally{button.disabled=false;}
 }
 function attachCard(){
  const detail=byId('health-dj-transfer-detail');
  if(!detail||byId('health-vdj-write'))return;
  const card=document.createElement('section');card.id='health-vdj-write';card.className='axiom-vdj-write-card';
  card.innerHTML=`<div class="axiom-vdj-write-copy"><strong>Send to VirtualDJ</strong>
    <small>Copy cue points from Serato, djay or PEAK HOUR, beat grid repairs from the VirtualDJ grid check, and play counts from Serato or djay into VirtualDJ.</small></div>
   <div class="axiom-vdj-write-options">
    <label><input type="checkbox" value="cues" checked> Cue points</label>
    <label><input type="checkbox" value="grids" checked> Beat grid repairs</label>
    <label><input type="checkbox" value="play_counts" checked> Play counts</label></div>
   <div class="axiom-vdj-write-options" id="health-dj-cue-targets"><strong>Send cues to:</strong>
    <label><input type="checkbox" value="virtualdj" checked> VirtualDJ</label>
    <label><input type="checkbox" value="serato"> Serato</label>
    <label><input type="checkbox" value="djay"> djay</label></div>
   <div class="axiom-vdj-write-options axiom-vdj-write-scope" id="health-dj-cue-scope"><strong>Songs:</strong>
    <label><input type="radio" name="health-dj-cue-scope" value="set" checked> A playlist or set</label>
    <select id="health-dj-cue-set" aria-label="Playlist or set"></select>
    <label><input type="radio" name="health-dj-cue-scope" value="library"> Whole library (slow — reads every song's tags)</label></div>
   <p class="health-transfer-note">Cue points go only to songs that have none in that program; existing cues are never replaced. If a program is open, PEAK HOUR writes after you close it.</p>
   <div class="axiom-vdj-grid-actions"><button type="button" class="health-transfer-primary" id="health-dj-cues-send">Preview Cue Changes</button></div>
   <div class="axiom-vdj-grid-actions"><button type="button" class="health-transfer-primary" id="health-vdj-write-preview">Preview VirtualDJ Changes</button>
    <button type="button" class="health-transfer-secondary" id="health-vdj-write-undo" hidden>Undo Last VirtualDJ Write</button></div>
   <p class="health-transfer-note" id="health-vdj-write-undo-note" hidden></p>`;
  detail.after(card);
  byId('health-vdj-write-preview').onclick=event=>open([...card.querySelectorAll('.axiom-vdj-write-options:not(#health-dj-cue-targets):not(.axiom-vdj-write-scope) input:checked')].map(x=>x.value),event.currentTarget);
  byId('health-dj-cues-send').onclick=event=>sendCuesTo([...byId('health-dj-cue-targets').querySelectorAll('input:checked')].map(x=>x.value),event.currentTarget);
  byId('health-vdj-write-undo').onclick=event=>undo(event.currentTarget);
  const refill=()=>fillScope();
  card.querySelectorAll('input[name="health-dj-cue-scope"]').forEach(radio=>radio.addEventListener('change',refill));
  byId('health-dj-cue-set').addEventListener('focus',refill);byId('health-dj-cue-set').addEventListener('mousedown',refill);
  fillScope();
  refreshUndo();
 }
 function attachGridButton(){
  const actions=document.querySelector('#health-doctor-vdj .axiom-vdj-grid-actions');
  if(!actions||byId('health-doctor-vdj-write'))return;
  const button=document.createElement('button');button.type='button';button.id='health-doctor-vdj-write';button.className='health-transfer-secondary';
  button.textContent='Write Repairs to VirtualDJ';button.title='Preview first. Only straight grids PEAK HOUR marked "Needs repair" are written.';
  button.onclick=()=>open(['grids'],button);
  actions.append(button);
 }
 const attach=()=>{attachCard();attachGridButton();};
 new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
 attach();
 window.AxiomVirtualDJWrite={open,refreshUndo,_test:{progressText,renderProgress,pollJob,scopeTracks,runSend,cueBreakdown,jobCall}};
})();
