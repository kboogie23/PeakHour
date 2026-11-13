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
    <div class="axiom-vdj-actions"><button type="button" data-no>Cancel</button>${data.songs?'<button type="button" data-yes>Write to VirtualDJ</button>':''}</div>`;
   let done=false;const finish=v=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve(v)};
   box.querySelector('[data-no]').onclick=()=>finish(false);const yes=box.querySelector('[data-yes]');if(yes)yes.onclick=()=>finish(true);
   box.addEventListener('cancel',()=>finish(false));document.body.append(box);box.showModal();
  });
 }
 async function open(kinds,button){
  if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('Write to VirtualDJ')))return;
  if(!kinds.length){window.showToast?.('Choose what to send to VirtualDJ.',true);return;}
  if(button)button.disabled=true;
  try{
   const preview=await call('preview',{kinds});
   if(!(await confirmWrite(preview)))return;
   const result=await call('apply',{kinds,preview_token:preview.preview_token,confirm:true});
   window.showToast?.(result.written?`Written to ${plural(result.written,'song')} in VirtualDJ. A backup was kept.`:'Nothing to write.');
   refreshUndo(result.undo);
  }catch(error){window.showToast?.(error.message,true);}
  finally{if(button)button.disabled=false;}
 }
 // Cue points into Serato or djay: songs with NO cue points in that program only; queued while the program is open.
 const CUE_TARGETS={serato:{label:'Serato',api:'/api/windows/serato/cues/'},djay:{label:'djay',api:'/api/windows/djay/cues/'}};
 async function postTarget(url,body){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)throw new Error(data.error||'The cue points could not be sent.');
  return {status:response.status,data};
 }
 function confirmCues(label,counts){
  return new Promise(resolve=>{
   const box=document.createElement('dialog');box.className='axiom-vdj-inspect axiom-vdj-write';
   const songs=counts.songs_to_write||0;
   box.innerHTML=`<h2>Send cue points to ${label}</h2>
    <p>${songs?`PEAK HOUR will write <b>${(counts.cues_to_write||0).toLocaleString()}</b> cue points to ${plural(songs,'song')} in ${label}.`:`Nothing to write: every song PEAK HOUR could fill already has cue points in ${label}.`}</p>
    ${counts.skipped?`<p>${plural(counts.skipped,'song')} left alone (already has cue points in ${label}, or no cue points to copy).</p>`:''}
    <p>Only songs with no cue points in ${label} are filled; cue points already there are never replaced. If ${label} is open, PEAK HOUR writes this after you close it. PEAK HOUR keeps a backup. ${label==='Serato'?"Serato keeps cues inside the song file, so PEAK HOUR edits the song's tag (the audio and the date stay the same; a backup is kept). A song with no spare room in its tag gets about 1-4 KB bigger, and VirtualDJ's record of its file size is updated (after VirtualDJ closes, if it is open).":'Your music files are not changed.'}</p>
    <div class="axiom-vdj-actions"><button type="button" data-no>Cancel</button>${songs?`<button type="button" data-yes>Send to ${label}</button>`:''}</div>`;
   let done=false;const finish=v=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve(v)};
   box.querySelector('[data-no]').onclick=()=>finish(false);const yes=box.querySelector('[data-yes]');if(yes)yes.onclick=()=>finish(true);
   box.addEventListener('cancel',()=>finish(false));document.body.append(box);box.showModal();
  });
 }
 // After a direct write: the backup id and an Undo button (Serato and djay cue writes can both be undone).
 function showWritten(label,base,data){
  return new Promise(resolve=>{
   const box=document.createElement('dialog');box.className='axiom-vdj-inspect axiom-vdj-write';
   const left=(data.skipped_now||[]).length;
   box.innerHTML=`<h2>Cue points sent to ${label}</h2>
    <p>Written to <b>${plural(data.written,'song')}</b>.${left?` ${plural(left,'song')} left alone (they changed since the preview).`:''} ${data.grown?` ${plural(data.grown,'song')} got a little bigger; the audio is unchanged${data.virtualdj_sync?(data.virtualdj_sync.applied?" and VirtualDJ's file sizes were updated":" and VirtualDJ's file sizes will be updated when VirtualDJ is closed"):''}.`:''} PEAK HOUR keeps a backup.</p>
    <p>Backup id: <code>${String(data.backup_id).replace(/[^0-9A-Za-z_-]/g,'')}</code></p>
    <div class="axiom-vdj-actions"><button type="button" data-undo>Undo</button><button type="button" data-ok>Done</button></div>`;
   let done=false;const finish=()=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve()};
   box.querySelector('[data-ok]').onclick=finish;
   box.querySelector('[data-undo]').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
     const undone=(await postTarget(base+'undo',{backup_id:data.backup_id})).data;
     window.showToast?.(undone.skipped&&undone.skipped.length?`${plural(undone.restored.length,'song')} restored; ${plural(undone.skipped.length,'song')} had changed and were left as they are.`:`${label} cue points undone: your songs are back as they were.`);
     finish();
    }catch(error){window.showToast?.(error.message,true);button.disabled=false;}
   };
   box.addEventListener('cancel',finish);document.body.append(box);box.showModal();
  });
 }
 // ---- which songs, and a progress bar for the long jobs (a whole library takes minutes and must never look frozen)
 const numberText=n=>Number(n||0).toLocaleString();
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
 // The songs a cue send covers: a playlist or the Studio set (default), or the whole library.
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
 function runJob(label,base,jobId,title){
  return new Promise((resolve,reject)=>{
   const box=document.createElement('dialog');box.className='axiom-vdj-inspect axiom-vdj-write';box.setAttribute('aria-live','polite');
   box.innerHTML=`<h2>${title} (${label})</h2><progress class="axiom-vdj-progress" aria-label="Progress"></progress>
    <p class="axiom-vdj-progress-text" role="status">Starting…</p>
    <div class="axiom-vdj-actions"><button type="button" data-cancel>Cancel</button></div>`;
   const parts={bar:box.querySelector('progress'),text:box.querySelector('.axiom-vdj-progress-text')};
   const cancel=box.querySelector('[data-cancel]');
   cancel.onclick=async()=>{
    cancel.disabled=true;parts.text.textContent='Stopping after the current song…';
    try{await fetch(`${base}job/${encodeURIComponent(jobId)}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch(error){/* the poll shows what happened */}
   };
   box.addEventListener('cancel',event=>event.preventDefault());
   document.body.append(box);box.showModal();
   pollJob(base,jobId,job=>renderProgress(parts,job)).then(job=>{box.close();box.remove();resolve(job);})
    .catch(error=>{box.close();box.remove();reject(error);});
  });
 }
 async function sendCues(target,tracks='all'){
  const {label,api:base}=CUE_TARGETS[target];
  try{
   const started=await postTarget(base+'preview',{tracks});
   let preview=started.data;
   if(preview.job_id){
    const job=await runJob(label,base,preview.job_id,'Checking songs');
    if(job.state==='cancelled'){window.showToast?.('Cancelled. Nothing was written.');return;}
    if(job.state!=='done')throw new Error(job.error||'The check did not finish.');
    preview=job.result||{};
   }
   if(!(await confirmCues(label,preview.counts||{})))return;
   let sent=await postTarget(base+'apply',{tracks,digest:preview.digest,confirm:true});
   if(sent.data.job_id){
    const job=await runJob(label,base,sent.data.job_id,'Sending cue points');
    if(job.state==='failed'||!job.result)throw new Error(job.error||'The write did not finish.');
    sent={status:job.result.http_status||200,data:job.result};
   }
   if(sent.status===202&&sent.data.queued)window.showToast?.(sent.data.message||`${label} is open — PEAK HOUR will write this after you close it.`);
   else if(sent.data.written&&sent.data.backup_id)await showWritten(label,base,sent.data);
   else window.showToast?.(sent.data.written?`Cue points written to ${plural(sent.data.written,'song')} in ${label}. A backup was kept.`:'Nothing to write.');
  }catch(error){window.showToast?.(error.message,true);}
 }
 async function sendCuesTo(targets,button){
  if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('Send cue points')))return;
  if(!targets.length){window.showToast?.('Choose where to send cue points.',true);return;}
  let tracks;
  try{
   const scope=document.querySelector('input[name="health-dj-cue-scope"]:checked')?.value||'set';
   tracks=scopeTracks(scope,byId('health-dj-cue-set')?.value,scopeSets());
  }catch(error){window.showToast?.(error.message,true);return;}
  const label=button?button.textContent:'';
  if(button){button.disabled=true;button.textContent='Working…';}
  try{
   for(const target of targets){
    if(target==='virtualdj')await open(['cues']);else await sendCues(target,tracks);
   }
  }finally{if(button){button.disabled=false;button.textContent=label;}}
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
 window.AxiomVirtualDJWrite={open,refreshUndo,_test:{progressText,renderProgress,pollJob,scopeTracks}};
})();
