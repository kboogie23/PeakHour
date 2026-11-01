// Health Accelerator card for VirtualDJ (Windows), beside "Serato Database V2".
// Previews, then fills missing BPM, key and year in AXIOM from VirtualDJ's
// database (exact file paths). Existing AXIOM values are never overwritten.
(function(){
 'use strict';
 const byId=id=>document.getElementById(id);
 async function call(apply){
  const response=await fetch('/api/windows/virtualdj/health_pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apply})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)throw new Error(data.error||'VirtualDJ data could not be read.');
  return data;
 }
 function confirmFill(data){
  return new Promise(resolve=>{
   const s=data.summary,box=document.createElement('dialog');box.className='axiom-vdj-inspect';
   const fills=s.bpm+s.key+s.year;
   box.innerHTML=`<h2>Use VirtualDJ data</h2><p>${s.matched.toLocaleString()} of ${s.checked.toLocaleString()} AXIOM songs are in VirtualDJ.</p>
    <p>${fills?`AXIOM can fill <b>${s.bpm.toLocaleString()}</b> missing BPM, <b>${s.key.toLocaleString()}</b> missing keys and <b>${s.year.toLocaleString()}</b> missing years.`:'Nothing is missing that VirtualDJ knows.'}
    ${s.conflicts?` ${s.conflicts.toLocaleString()} song${s.conflicts===1?'':'s'} disagree with VirtualDJ; AXIOM keeps its own values for those.`:''}</p>
    <p>Only AXIOM's library changes. VirtualDJ and your music files stay untouched.</p>
    <div class="axiom-vdj-actions"><button type="button" data-no>Cancel</button>${fills?'<button type="button" data-yes>Fill missing data</button>':''}</div>`;
   let done=false;const finish=v=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve(v)};
   box.querySelector('[data-no]').onclick=()=>finish(false);const yes=box.querySelector('[data-yes]');if(yes)yes.onclick=()=>finish(true);
   box.addEventListener('cancel',()=>finish(false));document.body.append(box);box.showModal();
  });
 }
 async function run(button){
  if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('Use VirtualDJ data')))return;
  button.disabled=true;
  try{
   const preview=await call(false);
   if(!(await confirmFill(preview)))return;
   const applied=await call(true);
   window.showToast?.(`AXIOM filled data for ${applied.summary.updated.toLocaleString()} song${applied.summary.updated===1?'':'s'} from VirtualDJ. Refreshing Library Health.`);
   if(typeof runLibraryHealthCheck==='function')await runLibraryHealthCheck({force:true});
  }catch(error){window.showToast?.(error.message,true);}
  finally{button.disabled=false;}
 }
 function attach(){
  const serato=document.querySelector('.health-serato-database-connection');
  if(!serato||byId('health-virtualdj-database-connection'))return;
  const card=document.createElement('article');card.id='health-virtualdj-database-connection';card.className='health-source-connection';
  card.innerHTML=`<div class="health-source-connection-copy"><span>Health Accelerator</span><strong>VirtualDJ Database</strong>
   <small>Fill missing BPM, key and year from VirtualDJ, matched by exact file. Only AXIOM's cache changes.</small></div>
   <button type="button" class="health-source-connection-action" title="Preview first. Existing AXIOM values are never overwritten; VirtualDJ and your music stay untouched."><img src="/static/icons/database.svg" alt="" aria-hidden="true"><span>Use VirtualDJ Data</span></button>`;
  card.querySelector('button').onclick=event=>run(event.currentTarget);
  serato.after(card);
 }
 new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
 attach();
})();
