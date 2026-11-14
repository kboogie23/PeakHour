// Library > Type (windows_filetypes.py): show all files, only audio, only video, or one file type. The choice is
// added to every Library list and search request (through appendLibraryRootParams, which they all use) and kept.
(function(){
 'use strict';
 const key='peakhour.libraryFileType';
 const labels={audio:'All audio',video:'All video'};
 let current='';
 try{current=localStorage.getItem(key)||'';}catch(_){}
 const original=window.appendLibraryRootParams;
 if(typeof original==='function'){
  window.appendLibraryRootParams=function(url){
   const out=original(url);
   if(!current||!/^\/(get-tracks|api\/library\/search)\b/.test(out))return out;
   return `${out}${out.includes('?')?'&':'?'}filetype=${encodeURIComponent(current)}`;
  };
 }
 // A filtered list answers with the filtered count (windows_filetypes.py sets total_tracks to it), so "All audio" on an
 // all-video library says 0. AXIOM reads that as "no music is connected" and shows "Connect your music" instead of the
 // Library, and the choice is kept across restarts. Only /api/library/stats (never filtered) may decide that.
 const readiness=window.handleLibraryBpmReadiness;
 if(typeof readiness==='function'){
  window.handleLibraryBpmReadiness=function(data,navigate){
   if(current&&data&&Array.isArray(data.tracks))return true;
   return readiness.apply(this,arguments);
  };
 }
 async function fill(select,tries=6){
  try{
   const r=await fetch('/api/windows/library/types',{cache:'no-store'});const d=await r.json();
   if(!r.ok||!d.success)throw new Error('not ready');
   const option=(value,text)=>`<option value="${value}"${value===current?' selected':''}>${text}</option>`;
   const types=d.types.filter(t=>t.group!=='other');
   select.innerHTML=option('','All files')+option('audio',`${labels.audio} (${d.audio.toLocaleString()})`)+option('video',`${labels.video} (${d.video.toLocaleString()})`)
    +types.map(t=>option(t.type,`${t.type.toUpperCase()} (${t.count.toLocaleString()})`)).join('');
   if(current&&select.value!==current){select.add(new Option(current.toUpperCase()+' (0)',current));select.value=current;}  // text, never HTML: the value comes from localStorage
  }catch(_){if(tries>1)setTimeout(()=>fill(select,tries-1),3000);}  // PEAK HOUR may still be starting
 }
 // A kept Type that matches nothing ("MP3" on an all-video library) lands in the Library on "No Matching Records":
 // say why, and offer the way out.
 function hint(){
  const box=document.querySelector('#search-results .library-no-results');
  const done=document.getElementById('ph-filetype-hint');
  if(!current){done?.remove();return;}
  // only when Type is the one thing narrowing the list: not for a search or an era / BPM / folder / preparation filter
  const other=()=>{
   if((document.getElementById('main-search')?.value||'').trim())return true;
   try{if(typeof activeEra!=='undefined'&&activeEra&&activeEra!=='All')return true;}catch(_){}
   try{if(typeof activeLibraryBpmFilter!=='undefined'&&activeLibraryBpmFilter&&activeLibraryBpmFilter!=='all')return true;}catch(_){}
   try{if(typeof activeLibraryRootFilter!=='undefined'&&activeLibraryRootFilter)return true;}catch(_){}
   try{if(typeof activeLibraryPreparationFilter!=='undefined'&&activeLibraryPreparationFilter&&activeLibraryPreparationFilter!=='all')return true;}catch(_){}
   return false;
  };
  if(!box||other()){done?.remove();return;}
  if(done&&done.parentNode===box.parentNode)return;
  done?.remove();
  const note=document.createElement('div');note.id='ph-filetype-hint';note.className='ph-filetype-hint';
  const name=current==='audio'?'All audio':current==='video'?'All video':current.toUpperCase();
  note.innerHTML=`<p>Type is set to <b></b>. Nothing in your library matches it.</p><button type="button" class="library-empty-primary">Show all files</button>`;
  note.querySelector('b').textContent=name;
  note.querySelector('button').addEventListener('click',()=>{
   const select=document.getElementById('ph-library-filetype');
   current='';try{localStorage.setItem(key,'');}catch(_){}
   if(select)select.value='';
   document.querySelector('.ph-library-filetype')?.classList.remove('active');
   note.remove();window.refreshLibrary?.();
  });
  box.after(note);
 }
 function mount(){
  hint();
  const bar=document.getElementById('library-top-sort-bar');
  if(!bar||document.getElementById('ph-library-filetype'))return;
  const label=document.createElement('label');label.className='ph-library-filetype';
  label.innerHTML='<span>Type</span><select id="ph-library-filetype" aria-label="Show file type"><option value="">All files</option></select>';
  const status=document.getElementById('library-top-sort-status');
  bar.insertBefore(label,status||null);
  const select=label.querySelector('select');
  select.addEventListener('change',()=>{
   current=select.value;
   try{localStorage.setItem(key,current);}catch(_){}
   label.classList.toggle('active',Boolean(current));
   window.refreshLibrary?.();
  });
  label.classList.toggle('active',Boolean(current));
  label.addEventListener('pointerenter',()=>fill(select,1));  // counts follow new imports (before the list opens)
  fill(select);
 }
 document.addEventListener('DOMContentLoaded',()=>{
  mount();
  new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});
 });
})();
