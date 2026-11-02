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
   <div class="axiom-vdj-grid-actions"><button type="button" class="health-transfer-primary" id="health-vdj-write-preview">Preview VirtualDJ Changes</button>
    <button type="button" class="health-transfer-secondary" id="health-vdj-write-undo" hidden>Undo Last VirtualDJ Write</button></div>
   <p class="health-transfer-note" id="health-vdj-write-undo-note" hidden></p>`;
  detail.after(card);
  byId('health-vdj-write-preview').onclick=event=>open([...card.querySelectorAll('input:checked')].map(x=>x.value),event.currentTarget);
  byId('health-vdj-write-undo').onclick=event=>undo(event.currentTarget);
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
 window.AxiomVirtualDJWrite={open,refreshUndo};
})();
