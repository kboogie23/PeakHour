/* Experimental read-only VirtualDJ inspection, enabled only when configured. */
(() => {
 const api='/api/windows/virtualdj/'; let database='', list='', offset=0, next=null, busy=false, generation=0, dialog, status, results, dbLabel, listLabel, inspectButton, nextButton;
 function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
 function controls(value){busy=value;dialog.querySelectorAll('button').forEach(b=>{if(b.dataset.close!=='yes')b.disabled=value});if(!value){inspectButton.disabled=!database;nextButton.disabled=next===null;}}
 async function request(endpoint,data){
  const response=await fetch(api+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  let payload;try{payload=await response.json()}catch(_){throw new Error('VirtualDJ service returned an invalid response')}
  if(!response.ok)throw new Error(payload.error||'VirtualDJ inspection failed');return payload;
 }
 function label(path){return String(path).split(/[\\/]/).pop()||path;}
 async function choose(kind){
  const current=generation;controls(true);status.textContent='Choose a file in the Windows dialog…';
  try{const data=await request('choose',{kind});if(current!==generation)return;if(data.cancelled){status.textContent='Selection cancelled.';return}
   if(kind==='database'){database=data.path;dbLabel.textContent=label(database)}else{list=data.path;listLabel.textContent=label(list)}
   offset=0;next=null;results.replaceChildren();status.textContent='Ready to inspect.';
  }catch(error){if(current===generation)status.textContent=error.message}finally{if(current===generation)controls(false)}
 }
 async function inspect(page=0){
  if(!database)return;const current=generation;controls(true);status.textContent='Reading VirtualDJ files…';
  try{const data=await request('inspect',{database_path:database,list_path:list||undefined,offset:page,limit:100});
   if(current!==generation)return;
   offset=page;next=data.next_offset;results.replaceChildren();
   const summary=data.summary;status.textContent=list?`${summary.matched} matched · ${summary.missing} missing · ${summary.ambiguous} ambiguous · ${summary.unresolved} unresolved`:`${data.total} database tracks`;
   for(const item of data.items){const row=element('li');const track=item.track||item;const entry=item.list_entry||{};const description=track.title||label(track.path||entry.path||'Unknown track');
    row.textContent=(item.status?`${item.status.toUpperCase()} · `:'')+description;results.append(row)}
  }catch(error){if(current===generation)status.textContent=error.message}finally{if(current===generation)controls(false)}
 }
 function setup(){
  dialog=document.createElement('dialog');dialog.className='axiom-vdj-inspect';dialog.setAttribute('aria-labelledby','axiom-vdj-title');
  const head=element('header'), heading=element('h2','Inspect VirtualDJ');heading.id='axiom-vdj-title';const close=element('button','Close');close.type='button';close.dataset.close='yes';close.setAttribute('aria-label','Close VirtualDJ inspection');close.onclick=()=>dialog.close();head.append(heading,close);
  const intro=element('p','Read-only preview. This does not import or change your VirtualDJ files.');
  const db=element('button','Choose database.xml');db.type='button';db.onclick=()=>choose('database');dbLabel=element('span','No database selected');dbLabel.className='axiom-vdj-selection';
  const pl=element('button','Choose list (optional)');pl.type='button';pl.onclick=()=>choose('list');listLabel=element('span','No list selected');listLabel.className='axiom-vdj-selection';
  const actions=element('div');actions.className='axiom-vdj-actions';inspectButton=element('button','Inspect');inspectButton.type='button';inspectButton.onclick=()=>inspect(0);inspectButton.disabled=true;
  nextButton=element('button','Next 100');nextButton.type='button';nextButton.disabled=true;nextButton.onclick=()=>inspect(next);actions.append(inspectButton,nextButton);
  status=element('p','Choose a database to begin.');status.setAttribute('role','status');results=element('ol');results.className='axiom-vdj-results';
  dialog.append(head,intro,db,dbLabel,pl,listLabel,actions,status,results);document.body.append(dialog);
  dialog.addEventListener('close',()=>{generation+=1;database='';list='';offset=0;next=null;dbLabel.textContent='No database selected';listLabel.textContent='No list selected';results.replaceChildren();status.textContent='Choose a database to begin.';controls(false)});
 }
 window.AxiomWindowsVirtualDJ={open(){if(!dialog)setup();if(!dialog.open)dialog.showModal()}};
 // VirtualDJ as a music source: AXIOM's chooser offers Music Folder and Serato only, so a
 // VirtualDJ card is added whenever the chooser opens. It reads VirtualDJ's own databases
 // (home folder and each drive) and merges the tracks into the AXIOM library.
 async function connectLibrary(){
  if(typeof closeLibrarySourcePicker==='function')closeLibrarySourcePicker();
  const overlay=(fn,options)=>{if(typeof window[fn]==='function')window[fn](options)};
  overlay('showMusicIntakeOverlay',{indexed:0,total:0,folderName:'VirtualDJ',stage:'Reading VirtualDJ',message:'PEAK HOUR is reading your VirtualDJ databases. VirtualDJ files stay untouched.'});
  try{
   const response=await fetch(api+'connect_library',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.success===false)throw new Error(data.error||data.message||'VirtualDJ connection paused.');
   const total=Number(data.total_tracks||data.scanned_count||0);
   overlay('completeMusicIntakeOverlay',{indexed:total,total,folderName:'VirtualDJ',stage:'VirtualDJ Ready',message:data.message});
   if(typeof showToast==='function')showToast(data.message||'VirtualDJ connected.');
   if(typeof loadLibraryStats==='function')await loadLibraryStats();
   if(typeof runSearch==='function')runSearch();
  }catch(error){
   overlay('completeMusicIntakeOverlay',{indexed:0,total:0,folderName:'VirtualDJ',stage:'VirtualDJ Connection Paused',message:error.message});
   if(typeof showToast==='function')showToast(error.message,true);
  }
 }
 function addSourceCard(modal){
  const grid=modal.querySelector('.library-source-choice-grid');
  if(!grid||grid.querySelector('#virtualdj-library-open'))return;
  const card=element('section');card.className='library-source-choice';
  const icon=element('div');icon.className='library-source-choice-icon';icon.setAttribute('aria-hidden','true');
  const img=element('img');img.src='/static/icons/audio-waveform.svg';img.alt='';icon.append(img);
  const copy=element('p','Bring in your VirtualDJ library: title, artist, BPM, key, year and cues from every drive.');copy.className='library-source-choice-copy';
  const readonly=element('p','Database is read-only');readonly.className='library-source-choice-readonly';
  const button=element('button','Connect VirtualDJ');button.type='button';button.id='virtualdj-library-open';button.className='library-source-choice-action';button.onclick=connectLibrary;
  card.append(icon,element('h4','VirtualDJ Library'),copy,readonly,button);grid.append(card);
 }
 function watchSourcePicker(){
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
   const modal=node.id==='library-source-modal'?node:node.querySelector?.('#library-source-modal');if(modal)addSourceCard(modal)}}).observe(document.body,{childList:true,subtree:true});
 }
 // VirtualDJ as an export destination: AXIOM offers Serato and djay Pro only. A VirtualDJ
 // entry is added to the sidebar Export menu (current Studio set) and to a saved playlist's
 // Export dialog. It creates a new list in VirtualDJ's MyLists and never overwrites one.
 function askListName(defaultName,count){
  return new Promise(resolve=>{
   const box=document.createElement('dialog');box.className='axiom-vdj-inspect';box.setAttribute('aria-labelledby','axiom-vdj-export-title');
   const heading=element('h2','Name your VirtualDJ list');heading.id='axiom-vdj-export-title';
   const intro=element('p',`Fully quit VirtualDJ first. PEAK HOUR adds ${count} track${count===1?'':'s'} as a new list under Lists & Advice > My Lists, in this order. Existing lists are never replaced.`);
   const input=element('input');input.type='text';input.value=defaultName;input.maxLength=120;input.setAttribute('aria-label','VirtualDJ list name');
   const actions=element('div');actions.className='axiom-vdj-actions';
   const cancel=element('button','Cancel');cancel.type='button';const ok=element('button','Add to VirtualDJ');ok.type='button';
   // Finish from the handlers themselves: a dialog's 'close' event can arrive late or not at all in a background window.
   let done=false;const finish=value=>{if(done)return;done=true;if(box.open)box.close();box.remove();resolve(value||null)};
   cancel.onclick=()=>finish(null);ok.onclick=()=>{const value=input.value.trim();if(value)finish(value)};
   input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();ok.click()}});
   actions.append(cancel,ok);box.append(heading,intro,input,actions);document.body.append(box);
   box.addEventListener('cancel',()=>finish(null));box.addEventListener('close',()=>finish(null));box.showModal();input.select();
  });
 }
 async function exportToVirtualDJ(selection){
  if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('export')))return;
  if(typeof requirePaidStudioFeature==='function'&&!requirePaidStudioFeature('Export'))return;
  const tracks=(selection?selection.tracks:(typeof getActiveStudioOutputTracks==='function'?getActiveStudioOutputTracks():[]))||[];
  const paths=tracks.map(t=>t&&t.path).filter(Boolean);
  if(!paths.length){if(typeof showToast==='function')showToast('Set is empty.',true);return}
  const name=await askListName(selection?.name||`PEAK HOUR ${new Date().toISOString().slice(0,10)}`,paths.length);
  if(!name)return;
  try{
   const response=await fetch(api+'lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,paths})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.success===false)throw new Error(data.error||'VirtualDJ export could not finish.');
   if(typeof showToast==='function')showToast(`"${name}" added to VirtualDJ My Lists. Open VirtualDJ to use it.`);
  }catch(error){if(typeof showToast==='function')showToast(error.message,true)}
 }
 function addSidebarExport(){
  const djay=document.querySelector('[onclick="openSidebarExport(\'djay\')"]');
  if(!djay||document.getElementById('sidebar-export-virtualdj'))return;
  const item=element('button');item.type='button';item.id='sidebar-export-virtualdj';item.className=djay.className.replace('is-featured','').trim();
  item.setAttribute('role','menuitem');item.setAttribute('aria-label','Export to VirtualDJ');
  const brand=element('span','VirtualDJ');brand.className='sidebar-export-brand text-primary-contrast';brand.style.fontWeight='900';
  item.append(brand,element('small','Handoff to VirtualDJ'));
  item.onclick=()=>{if(typeof closeSidebarDropdowns==='function')closeSidebarDropdowns();exportToVirtualDJ(null)};
  djay.after(item);
 }
 function wrapPlaylistExport(){
  if(typeof window.exportSavedPlaylist!=='function'||window.exportSavedPlaylist.virtualdj)return;
  const original=window.exportSavedPlaylist;
  const wrapped=function(id,event){
   const result=original.apply(this,arguments);
   const sets=typeof savedPlaylists!=='undefined'?savedPlaylists:[];  // AXIOM's top-level let, not a window property
   const set=sets.find(item=>item.id===id);
   const actions=document.querySelector('.playlist-export-choice [data-export-target="djay"]')?.parentElement;
   if(set&&actions&&!actions.querySelector('[data-export-target="virtualdj"]')){
    const button=element('button','Export to VirtualDJ');button.type='button';button.className='axiom-dialog-btn';button.dataset.exportTarget='virtualdj';
    button.addEventListener('click',e=>{e.stopImmediatePropagation();if(typeof closeAxiomDialog==='function')closeAxiomDialog();
     exportToVirtualDJ(JSON.parse(JSON.stringify({tracks:set.tracks,name:set.name})))},true);
    actions.querySelector('[data-export-target="djay"]').before(button);
   }
   return result;
  };
  wrapped.virtualdj=true;window.exportSavedPlaylist=wrapped;
 }
 window.AxiomWindowsVirtualDJ.exportList=exportToVirtualDJ;
 fetch(api+'capabilities').then(r=>r.ok?r.json():null).then(data=>{if(data?.read_only&&data?.chooser){const button=document.getElementById('connect-virtualdj-inspect');if(button)button.hidden=false}
  if(data?.connect_library)watchSourcePicker();
  if(data?.create_lists){addSidebarExport();wrapPlaylistExport()}}).catch(()=>{});
})();
