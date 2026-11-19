// AI Assist (windows_ai.py): connect Claude or ChatGPT with your own API key, let it check release years,
// titles & artists, genres or energy, then review: nothing changes until you tick suggestions and Apply.
// Keys are typed here and sent only to this PC's PEAK HOUR, which stores them encrypted; they never come back.
(function(){
 'use strict';
 const api='/api/windows/ai';
 const $=(sel,root=document)=>root.querySelector(sel);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let state=null,timer=null,items=[],filter='pending';
 async function call(path,body){
  const r=await fetch(api+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({success:false,error:'PEAK HOUR did not answer.'}));
  if(!r.ok||data.success===false)throw new Error(data.error||'Something went wrong.');
  return data;
 }
 function modal(){
  let el=$('#ph-ai');
  if(el)return el;
  el=document.createElement('div');el.id='ph-ai';el.hidden=true;el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','AI Assist');
  el.innerHTML=`<div class="ph-ai-card">
   <header><div><small>PEAK HOUR</small><h2>AI ASSIST</h2></div><button type="button" class="ph-ai-close" aria-label="Close AI Assist">&times;</button></header>
   <p id="ph-ai-message" role="status" hidden></p>
   <nav class="ph-ai-tabs"><button type="button" data-tab="connect">1. Connect</button><button type="button" data-tab="run">2. Check my library</button><button type="button" data-tab="review">3. Review &amp; apply</button><button type="button" data-tab="playlist">4. Build a playlist</button></nav>
   <section data-panel="connect">
    <p class="ph-ai-note">Use your own Claude or ChatGPT <b>API key</b> (from console.anthropic.com or platform.openai.com). API use is billed by Anthropic or OpenAI to that account. Your key is saved encrypted on this PC only.</p>
    <div class="ph-ai-providers"></div>
   </section>
   <section data-panel="run" hidden>
    <div class="ph-ai-grid">
     <label>Check<select id="ph-ai-task"></select></label>
     <label>Which tracks<select id="ph-ai-scope"><option value="needs">Only the ones that need it</option><option value="all">All tracks</option></select></label>
     <label>Up to<input id="ph-ai-limit" type="number" min="1" max="5000" step="1" value="200"></label>
     <label>Use<select id="ph-ai-provider"></select></label>
    </div>
    <p id="ph-ai-preview" class="ph-ai-note"></p>
    <div class="ph-ai-actions"><button type="button" id="ph-ai-start" class="primary">Start</button><button type="button" id="ph-ai-stop" hidden>Stop</button></div>
    <div class="ph-ai-progress" hidden><div><span></span></div><p></p></div>
   </section>
   <section data-panel="review" hidden>
    <div class="ph-ai-reviewbar"><p id="ph-ai-summary"></p>
     <label>Show<select id="ph-ai-filter"><option value="pending">Waiting for review</option><option value="high">High confidence</option><option value="all">All</option></select></label></div>
    <div class="ph-ai-tablewrap"><table><thead><tr><th><input type="checkbox" id="ph-ai-all" aria-label="Select all shown"></th><th>Track</th><th>Now</th><th>Suggested</th><th>Sure?</th><th>Why</th></tr></thead><tbody></tbody></table></div>
    <div class="ph-ai-actions"><button type="button" id="ph-ai-apply" class="primary">Apply ticked</button><button type="button" id="ph-ai-skip">Skip ticked</button>
     <span class="ph-ai-note">Changes are saved in PEAK HOUR only. Your music files and DJ software are not touched; publish from Health when you are ready.</span></div>
   </section>
   <section data-panel="playlist" hidden>
    <label>Describe the playlist<textarea id="ph-ai-brief" rows="3" maxlength="600" placeholder="e.g. 90s East Coast hip-hop warm-up that builds into a peak, then 2000s club anthems"></textarea></label>
    <div class="ph-ai-grid">
     <label>Tracks<input id="ph-ai-count" type="number" min="5" max="100" value="25"></label>
     <label>BPM from<input id="ph-ai-bpm-min" type="number" min="40" max="200" placeholder="any"></label>
     <label>BPM to<input id="ph-ai-bpm-max" type="number" min="40" max="200" placeholder="any"></label>
     <label>Years from<input id="ph-ai-year-from" type="number" min="1900" max="2100" placeholder="any"></label>
     <label>Years to<input id="ph-ai-year-to" type="number" min="1900" max="2100" placeholder="any"></label>
     <label>Use<select id="ph-ai-pl-provider"></select></label>
    </div>
    <p class="ph-ai-note">The AI chooses only from your own library and puts the tracks in a playable order. You see the list before anything is saved.</p>
    <div class="ph-ai-actions"><button type="button" id="ph-ai-build" class="primary">Build playlist</button><span id="ph-ai-pl-status" class="ph-ai-note" role="status"></span></div>
    <div id="ph-ai-pl-result" hidden>
     <div class="ph-ai-grid"><label>Name<input id="ph-ai-pl-name" type="text" maxlength="80"></label></div>
     <p id="ph-ai-pl-notes" class="ph-ai-note"></p>
     <div class="ph-ai-tablewrap"><table><thead><tr><th>#</th><th>Track</th><th>BPM</th><th>Key</th><th>Year</th><th>Why</th></tr></thead><tbody id="ph-ai-pl-rows"></tbody></table></div>
     <div class="ph-ai-actions"><button type="button" id="ph-ai-pl-save" class="primary">Save to Playlists</button><span class="ph-ai-note">Saved like any PEAK HOUR set: open it in Playlists or Studio, or export it to Serato, VirtualDJ or djay from there.</span></div>
    </div>
   </section></div>`;
  document.body.appendChild(el);
  el.addEventListener('click',e=>{if(e.target===el)close();});
  $('.ph-ai-close',el).addEventListener('click',close);
  el.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
  ['#ph-ai-task','#ph-ai-scope'].forEach(s=>$(s,el).addEventListener('change',preview));
  $('#ph-ai-start',el).addEventListener('click',start);
  $('#ph-ai-stop',el).addEventListener('click',()=>call('/stop',{}).then(render).catch(fail));
  $('#ph-ai-filter',el).addEventListener('change',e=>{filter=e.target.value;table();});
  $('#ph-ai-all',el).addEventListener('change',e=>el.querySelectorAll('tbody input[type=checkbox]').forEach(c=>{c.checked=e.target.checked;}));
  $('#ph-ai-apply',el).addEventListener('click',()=>decide(false));
  $('#ph-ai-skip',el).addEventListener('click',()=>decide(true));
  $('#ph-ai-build',el).addEventListener('click',build);
  $('#ph-ai-pl-save',el).addEventListener('click',savePlaylist);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el.hidden)close();});
  return el;
 }
 // PEAK HOUR's own messages appear on the player bar, which is hidden while this window is open: say it here.
 function say(text,bad=false){const m=$('#ph-ai-message');if(!m)return;m.textContent=text;m.classList.toggle('bad',bad);m.hidden=!text;}
 function fail(error){say(error.message,true);}
 function tab(name){
  const el=modal();say('');
  el.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  el.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==name;});
  if(name==='review')loadSuggestions().then(()=>{if(state.reviewJob?.applying?.state==='running'){busy(true);watchApply();}else if(state.reviewJob?.applying?.state==='interrupted')say(`Saving stopped when PEAK HOUR closed: ${state.reviewJob.applying.applied.toLocaleString()} saved. Tick the rest and apply again.`,true);});
  if(name==='run')preview();
  if(name==='playlist')call('/playlist').then(r=>showPlaylist(r.playlist)).catch(()=>{});
 }
 let playlist=null,plTimer=null;
 const num=id=>{const v=Number($(id).value);return Number.isFinite(v)&&v>0?v:null;};
 async function build(){
  try{showPlaylist((await call('/playlist',{brief:$('#ph-ai-brief').value,count:num('#ph-ai-count')||25,bpm_min:num('#ph-ai-bpm-min'),bpm_max:num('#ph-ai-bpm-max'),
   year_from:num('#ph-ai-year-from'),year_to:num('#ph-ai-year-to'),provider:$('#ph-ai-pl-provider').value})).playlist);}catch(e){$('#ph-ai-pl-status').textContent=e.message;}
 }
 function showPlaylist(p){
  playlist=p;const status=$('#ph-ai-pl-status'),result=$('#ph-ai-pl-result');
  clearTimeout(plTimer);
  $('#ph-ai-build').disabled=Boolean(p&&p.state==='running');
  if(!p){status.textContent='';result.hidden=true;return;}
  if(p.state==='running'){
   status.textContent=`Building from ${p.candidates.toLocaleString()} matching tracks with ${p.model}… this can take a minute.`;result.hidden=true;
   plTimer=setTimeout(()=>call('/playlist').then(r=>showPlaylist(r.playlist)).catch(()=>{}),2000);return;
  }
  if(p.state==='failed'){status.textContent=p.error;result.hidden=true;return;}
  status.textContent=`${p.tracks.length} tracks${p.minutes?`, about ${p.minutes} minutes`:''}, chosen from ${p.candidates.toLocaleString()} of your tracks.`;
  if(!p.saved){$('#ph-ai-pl-name').value=p.name;}
  $('#ph-ai-pl-notes').textContent=p.notes||'';
  $('#ph-ai-pl-rows').innerHTML=p.tracks.map((t,i)=>`<tr><td>${i+1}</td><td><b>${esc(t.title)}</b><br><small>${esc(t.artist)}</small></td><td>${esc(t.bpm?Math.round(t.bpm):'')}</td><td>${esc(t.camelot||'')}</td><td>${esc(t.year||'')}</td><td><small>${esc(t.ai_reason)}</small></td></tr>`).join('');
  result.hidden=false;
 }
 function savePlaylist(){
  if(!playlist||playlist.state!=='done')return;
  if(typeof window.upsertSavedPlaylist!=='function'){fail(new Error('Playlists are not ready yet. Open Playlists once, then try again.'));return;}
  try{
   const tracks=playlist.tracks.map(({ai_reason,...track})=>track);
   const record=window.upsertSavedPlaylist($('#ph-ai-pl-name').value||playlist.name,tracks,{forceNew:true});
   if(!record)throw new Error('The playlist could not be saved.');
   playlist.saved=true;say(`"${record.name}" saved in Playlists (${record.tracks.length} tracks). Open it from Playlists, or export it to your DJ software from there.`);
  }catch(e){fail(e);}
 }
 function providers(){
  const box=$('.ph-ai-providers');
  box.innerHTML=Object.entries(state.providers).map(([id,p])=>`<article data-provider="${id}">
   <h3>${esc(p.name)} <span class="${p.key_set?'ok':''}">${p.key_set?'Key saved':'No key yet'}</span></h3>
   <label>API key<input type="password" autocomplete="off" spellcheck="false" placeholder="${p.key_set?'Saved. Paste a new key to replace it':'Paste your API key'}"></label>
   <label>Model<select>${p.models.map(m=>`<option value="${esc(m.id)}"${m.id===p.model?' selected':''}>${esc(m.label)}</option>`).join('')}</select></label>
   <div class="ph-ai-actions"><button type="button" data-act="save" class="primary">Save key</button><button type="button" data-act="test"${p.key_set?'':' disabled'}>Test</button><button type="button" data-act="remove"${p.key_set?'':' disabled'}>Remove key</button>
   <label class="ph-ai-default"><input type="radio" name="ph-ai-default" value="${id}"${state.provider===id?' checked':''}> Use by default</label></div>
   <p class="ph-ai-result" role="status"></p></article>`).join('');
  box.querySelectorAll('article').forEach(card=>{
   const id=card.dataset.provider,result=$('.ph-ai-result',card),input=$('input[type=password]',card);
   $('select',card).addEventListener('change',e=>call('/settings',{model:e.target.value}).then(s=>{state=s;}).catch(fail));
   $('input[type=radio]',card).addEventListener('change',()=>call('/settings',{provider:id}).then(s=>{state=s;fillRun();}).catch(fail));
   card.querySelector('[data-act=save]').addEventListener('click',async()=>{
    if(!input.value.trim()){result.textContent='Paste the key first.';return;}
    try{state=await call('/key',{provider:id,key:input.value.trim()});input.value='';providers();fillRun();say(`${state.providers[id].name} key saved on this PC.`);}catch(e){result.textContent=e.message;}
   });
   card.querySelector('[data-act=remove]').addEventListener('click',async()=>{
    try{state=await call('/key',{provider:id,key:''});providers();fillRun();}catch(e){result.textContent=e.message;}
   });
   card.querySelector('[data-act=test]').addEventListener('click',async()=>{
    result.textContent='Asking…';
    try{const r=await call('/test',{provider:id});result.textContent=`Working. ${r.model} says "Shook Ones, Pt. II" came out in ${r.year||'an unknown year'}.`;}catch(e){result.textContent=e.message;}
   });
  });
 }
 function fillRun(){
  const task=$('#ph-ai-task'),prov=$('#ph-ai-provider');
  if(!task.options.length)task.innerHTML=(state.task_order||Object.keys(state.tasks)).map(k=>`<option value="${k}">${esc(state.tasks[k])}</option>`).join('');
  $('#ph-ai-pl-provider').innerHTML=prov.innerHTML=Object.entries(state.providers).map(([id,p])=>`<option value="${id}"${id===state.provider?' selected':''}${p.key_set?'':' disabled'}>${esc(p.name)} (${esc(p.model)})${p.key_set?'':' - no key'}</option>`).join('');
 }
 async function preview(){
  const out=$('#ph-ai-preview');
  try{const r=await call(`/preview?task=${encodeURIComponent($('#ph-ai-task').value)}&scope=${encodeURIComponent($('#ph-ai-scope').value)}`);
   out.textContent=`${r.matching.toLocaleString()} of ${r.library.toLocaleString()} tracks match. Each request covers 40 tracks.`;}catch(e){out.textContent=e.message;}
 }
 async function start(){
  try{render(await call('/run',{task:$('#ph-ai-task').value,scope:$('#ph-ai-scope').value,limit:Number($('#ph-ai-limit').value)||200,provider:$('#ph-ai-provider').value}));}catch(e){fail(e);}
 }
 function render(s){
  state=s;const job=s.job,box=$('.ph-ai-progress');
  const running=job&&job.state==='running';
  $('#ph-ai-start').disabled=running;$('#ph-ai-stop').hidden=!running;
  box.hidden=!job;
  if(job){
   const pct=job.total?Math.round(job.done*100/job.total):0;
   $('span',box).style.width=`${pct}%`;
   $('p',box).textContent=running?`${state.tasks[job.task]}: ${job.done.toLocaleString()} of ${job.total.toLocaleString()} tracks checked (${pct}%) with ${job.model}.`
    :job.state==='failed'?`Stopped: ${job.error}`:job.state==='stopped'?`Stopped after ${job.done.toLocaleString()} tracks. The suggestions so far are ready to review.`
    :job.state==='interrupted'?`Stopped when PEAK HOUR closed, after ${job.done.toLocaleString()} of ${job.total.toLocaleString()} tracks. The suggestions so far are ready to review; you can start a new check.`
    :`Done: ${job.total.toLocaleString()} tracks checked. Open Review & apply.`;
  }
  clearTimeout(timer);
  if(running)timer=setTimeout(()=>call('/status').then(render).catch(()=>{}),1500);
 }
 async function loadSuggestions(){
  try{const r=await call('/suggestions');items=r.items||[];state.reviewJob=r.job;table();}catch(e){fail(e);}
 }
 function table(){
  const job=state.reviewJob,body=$('#ph-ai tbody');
  const shown=items.filter(i=>filter==='all'||(i.status==='pending'&&(filter==='pending'||i.confidence==='high')));
  const pending=items.filter(i=>i.status==='pending').length,applied=items.filter(i=>i.status==='applied').length;
  $('#ph-ai-summary').textContent=job?`${state.tasks[job.task]} with ${job.model}: ${items.length} suggestions, ${pending} waiting, ${applied} applied.`:'No suggestions yet. Run a check first.';
  body.innerHTML=shown.map(i=>`<tr data-id="${esc(i.id)}" class="status-${esc(i.status)}"><td>${i.status==='pending'?'<input type="checkbox" aria-label="Select">':esc(i.status)}</td>
   <td><b>${esc(i.title)}</b><br><small>${esc(i.artist)}</small></td><td>${esc(i.current)||'<i>none</i>'}</td>
   <td><b>${esc(i.suggested)}</b>${i.version_year&&i.version_year!==i.suggested?`<br><small>this version ${esc(i.version_year)}</small>`:''}${i.agrees_with_catalogue===true?'<br><small class="ok">matches the catalogue</small>':i.agrees_with_catalogue===false?'<br><small class="warn">differs from the catalogue</small>':''}</td>
   <td class="conf-${esc(i.confidence)}">${esc(i.confidence)}</td><td><small>${esc(i.reason)}${i.error?`<br><span class="warn">${esc(i.error)}</span>`:''}</small></td></tr>`).join('')||'<tr><td colspan="6">Nothing to show.</td></tr>';
  $('#ph-ai-all').checked=false;
 }
 async function decide(skip){
  const ids=[...document.querySelectorAll('#ph-ai tbody tr')].filter(r=>$('input[type=checkbox]',r)?.checked).map(r=>r.dataset.id);
  if(!ids.length){say('Tick the suggestions first.',true);return;}
  try{await call('/apply',{ids,skip});
   if(skip){say(`${ids.length} suggestion${ids.length===1?'':'s'} skipped.`);await loadSuggestions();return;}
   busy(true);say(`Saving 0 of ${ids.length}…`);watchApply();}catch(e){fail(e);}
 }
 // Applying runs on the server; show its progress until it finishes.
 let applyTimer=null;
 function busy(on){['#ph-ai-apply','#ph-ai-skip'].forEach(s=>{const b=$(s);if(b)b.disabled=on;});}
 async function watchApply(){
  clearTimeout(applyTimer);
  try{
   const r=await call('/suggestions');items=r.items||[];state.reviewJob=r.job;
   const p=r.job&&r.job.applying;
   if(p&&p.state==='running'){say(`Saving ${p.done.toLocaleString()} of ${p.total.toLocaleString()}… you can keep using PEAK HOUR.`);applyTimer=setTimeout(watchApply,1500);return;}
   busy(false);table();
   if(p&&p.state==='interrupted')say(`Saving stopped when PEAK HOUR closed: ${p.applied.toLocaleString()} saved. Tick the rest and apply again.`,true);
   else if(p){say(`${p.applied.toLocaleString()} change${p.applied===1?'':'s'} saved in PEAK HOUR.${p.failed?` ${p.failed} could not be saved; see the list.`:''}`,p.failed>0);if(p.applied)window.refreshLibrary?.();}
  }catch(e){busy(false);fail(e);}
 }
 async function open(name){
  const el=modal();el.hidden=false;document.body.classList.add('ph-ai-open');
  try{state=await call('/status');providers();fillRun();render(state);
   tab(name||(Object.values(state.providers).some(p=>p.key_set)?(state.job&&state.job.state!=='running'?'review':'run'):'connect'));}catch(e){fail(e);}
 }
 function close(){const el=modal();el.hidden=true;document.body.classList.remove('ph-ai-open');clearTimeout(timer);}
 window.PeakHourAI={open,close};
 document.addEventListener('DOMContentLoaded',()=>{document.getElementById('settings-ai-assist-open')?.addEventListener('click',()=>open());});
})();
