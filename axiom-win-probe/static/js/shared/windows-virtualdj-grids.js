// Beatgrid Doctor: VirtualDJ as a third DJ library (Windows).
// The Doctor's own menu offers djay Pro and Serato. This adds VirtualDJ, which
// runs windows_virtualdj_grids.py: AXIOM's grid engine checks VirtualDJ's stored
// grids against the audio, read-only. Songs that need attention can be added to
// a new VirtualDJ list (AxiomWindowsVirtualDJ.exportList).
(function(){
 'use strict';
 const api='/api/windows/virtualdj/grids/';
 const labels={repair:'Needs repair',review:'Check by ear',error:'Could not check',no_grid:'No grid',missing:'File missing',skipped:'Not checked',clean:'Clean'};
 const djayOnly=['health-doctor-sources','health-doctor-folder','health-doctor-scope-note','health-doctor-check','health-doctor-summary'];
 let panel=null,timer=null,showClean=false,last=null;
 const byId=id=>document.getElementById(id);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function nativeParts(show){
  for(const id of djayOnly){const node=byId(id);if(node)node.style.display=show?'':'none';}
  const scope=byId('health-doctor-scope')?.closest('label'),verify=byId('health-doctor-verification')?.closest('label'),tasks=document.querySelector('.health-doctor-tasks');
  for(const node of [scope,verify,tasks])if(node)node.style.display=show?'':'none';
 }
 function choose(value){
  const select=byId('health-doctor-provider');if(select)select.value=value;
  const vdj=value==='virtualdj';nativeParts(!vdj);panel.hidden=!vdj;
  if(vdj)refresh(true);else window.AxiomHealthDoctor?.provider(value);
 }
 function attach(){
  const select=byId('health-doctor-provider'),setup=byId('health-doctor-setup');
  if(!select||!setup||select.querySelector('option[value="virtualdj"]'))return;
  select.append(new Option('VirtualDJ','virtualdj'));
  select.removeAttribute('onchange');select.addEventListener('change',()=>choose(select.value));
  panel=document.createElement('section');panel.id='health-doctor-vdj';panel.className='axiom-vdj-grids';panel.hidden=true;
  panel.innerHTML=`<p>PEAK HOUR checks the grids VirtualDJ has stored against the actual audio. Nothing in VirtualDJ is changed.</p>
   <div class="health-doctor-fields"><label>Music<select id="health-doctor-vdj-scope"><option value="full">Entire VirtualDJ library</option><option value="test">Quick test: 10 songs</option><option value="folder">Music folder</option></select></label></div>
   <div class="axiom-vdj-grid-actions"><button id="health-doctor-vdj-check" class="health-transfer-primary" type="button">Check VirtualDJ Beatgrids</button>
   <button id="health-doctor-vdj-cancel" class="health-transfer-secondary" type="button" hidden>Stop</button></div>
   <p id="health-doctor-vdj-status" role="status" aria-live="polite"></p><div id="health-doctor-vdj-results"></div>`;
  setup.after(panel);
  byId('health-doctor-vdj-check').onclick=start;
  byId('health-doctor-vdj-cancel').onclick=()=>fetch(api+'cancel',{method:'POST'}).then(()=>refresh(true));
 }
 async function start(){
  const button=byId('health-doctor-vdj-check');button.disabled=true;
  try{
   const scope=byId('health-doctor-vdj-scope').value;
   if(scope==='folder')byId('health-doctor-vdj-status').textContent='Choose a music folder in the window that opened…';
   const response=await fetch(api+'start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope})});
   const data=await response.json().catch(()=>({}));
   if(data.cancelled){byId('health-doctor-vdj-status').textContent='No folder chosen.';return;}
   if(!response.ok||data.success===false)throw new Error(data.error||'The VirtualDJ check could not start.');
   refresh(true);
  }catch(error){byId('health-doctor-vdj-status').textContent=error.message;}
  finally{button.disabled=false;}
 }
 async function refresh(withResults){
  clearTimeout(timer);
  try{
   const data=await (await fetch(api+'status'+(withResults?'?results=1':''))).json();
   const running=data.status==='running';
   byId('health-doctor-vdj-check').hidden=running;byId('health-doctor-vdj-cancel').hidden=!running;
   const counts=data.counts||{},total=data.total||0,done=data.done||0;
   byId('health-doctor-vdj-status').textContent=running?`Checking ${done.toLocaleString()} of ${total.toLocaleString()} songs… VirtualDJ is not changed.`:
    data.status==='idle'?'Not checked yet.':data.status==='failed'?`The check stopped: ${data.error||'unknown error'}`:
    `${data.status==='complete'?'Checked':'Stopped after'} ${done.toLocaleString()} of ${total.toLocaleString()} songs: ${Object.entries(labels).filter(([k])=>counts[k]).map(([k,v])=>`${counts[k].toLocaleString()} ${v.toLowerCase()}`).join(', ')||'nothing to report'}.`;
   if(withResults&&data.results)render(data);
   if(running&&!panel.hidden)timer=setTimeout(()=>refresh(false),1500);
   else if(!running&&!withResults&&data.status!=='idle')refresh(true);
  }catch(error){byId('health-doctor-vdj-status').textContent='Could not read the VirtualDJ check: '+error.message;}
 }
 function render(data){
  last=data;const host=byId('health-doctor-vdj-results');
  const rows=(data.results||[]).filter(r=>showClean||r.status!=='clean');
  const attention=(data.results||[]).filter(r=>r.status==='repair'||r.status==='review');
  host.innerHTML=`${data.results?.length?`<div class="axiom-vdj-grid-tools"><label><input type="checkbox" id="health-doctor-vdj-clean" ${showClean?'checked':''}> Show clean songs</label>
   <button id="health-doctor-vdj-list" class="health-transfer-secondary" type="button" ${attention.length?'':'disabled'}>Add ${attention.length.toLocaleString()} song${attention.length===1?'':'s'} to a VirtualDJ list</button></div>`:''}
   ${rows.length?`<table class="axiom-vdj-grid-table"><thead><tr><th>Result</th><th>Song</th><th>BPM</th><th>What PEAK HOUR found</th></tr></thead><tbody>${rows.map(r=>`<tr data-status="${escape(r.status)}">
    <td>${escape(labels[r.status]||r.status)}</td><td><strong>${escape(r.title)}</strong><small>${escape(r.artist)}</small></td><td>${r.bpm?escape(r.bpm):''}</td>
    <td>${escape([...(r.issue_text||[]),r.detail,r.suggestion].filter(Boolean).join(' '))||'Grid matches the audio.'}</td></tr>`).join('')}</tbody></table>`:
    data.results?.length?'<p>Every checked song has a clean grid.</p>':''}`;
  const toggle=byId('health-doctor-vdj-clean');if(toggle)toggle.onchange=()=>{showClean=toggle.checked;render(last);};
  const list=byId('health-doctor-vdj-list');if(list)list.onclick=()=>window.AxiomWindowsVirtualDJ?.exportList?.({name:`PEAK HOUR Grid Review ${new Date().toISOString().slice(0,10)}`,tracks:attention.map(r=>({path:r.path}))});
 }
 new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
 attach();
})();
