// VirtualDJ versions of AXIOM's Serato crate exports (Windows): each Serato
// button gets a VirtualDJ button beside it that creates a new VirtualDJ list.
// Favorites use the page's favorites; no-cue and year-fix songs are chosen by
// windows_virtualdj_exports.py exactly as described there.
(function(){
 'use strict';
 const toast=(message,error)=>window.showToast?.(message,error);
 async function askName(title,defaultValue,count){
  if(typeof showAxiomTextPrompt==='function')return showAxiomTextPrompt({kicker:'VirtualDJ Handoff',title,
   copy:`Fully quit VirtualDJ first. PEAK HOUR adds ${count?count.toLocaleString()+' songs ':'the songs '}as a new list under Lists & Advice > My Lists. Existing lists are never replaced.`,
   defaultValue,placeholder:'VirtualDJ list name...',confirmText:'Add To VirtualDJ'});
  return window.prompt(title,defaultValue);
 }
 async function post(endpoint,body){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)throw new Error(data.error||'VirtualDJ list could not be created.');
  return data;
 }
 async function licensed(feature){return typeof ensureAxiomLicenseUsable!=='function'||await ensureAxiomLicenseUsable(feature);}
 async function favorites(button){
  if(!(await licensed('Export favorites to VirtualDJ')))return;
  button.disabled=true;
  try{
   const data=await (await fetch('/api/favorites')).json();
   const tracks=Array.isArray(data.tracks)?data.tracks:[];
   if(!tracks.length){toast('No favorites to export yet.',true);return;}
   await window.AxiomWindowsVirtualDJ?.exportList?.({name:'PEAK HOUR Favorites',tracks});
  }catch(error){toast(error.message,true);}
  finally{button.disabled=false;}
 }
 async function serverList(button,feature,title,defaultName,endpoint,body){
  if(!(await licensed(feature)))return;
  const name=await askName(title,defaultName);
  if(!name)return;
  button.disabled=true;
  try{
   const data=await post(endpoint,{...body,name});
   toast(`"${name}" added to VirtualDJ My Lists with ${Number(data.tracks||0).toLocaleString()} songs. Open VirtualDJ to use it.`);
  }catch(error){toast(error.message,true);}
  finally{button.disabled=false;}
 }
 function add(anchor,id,text,onclick,className){
  if(!anchor||document.getElementById(id))return;
  const button=document.createElement('button');button.type='button';button.id=id;button.textContent=text;
  button.className=className||anchor.className;button.onclick=()=>onclick(button);
  anchor.after(button);
 }
 function attach(){
  add(document.getElementById('btn-export-favorites-serato'),'btn-export-favorites-virtualdj','VirtualDJ',favorites);
  add(document.querySelector('button[onclick^="exportNoCuePointCrate"]'),'btn-export-no-cue-virtualdj','No-Cue List for VirtualDJ',
   button=>serverList(button,'VirtualDJ no-cue list','Name Your No-Cue List','PEAK HOUR - Needs Cue Points','/api/windows/virtualdj/export/no_cue',{}));
  add(document.querySelector('button[onclick^="exportYearFixesToSerato(this, true)"]'),'btn-export-years-virtualdj','Create VirtualDJ List',
   button=>serverList(button,'VirtualDJ year list','Name Your Year List',`PEAK HOUR Year Fixes ${new Date().toISOString().slice(0,10)}`,'/api/windows/virtualdj/export/year_fixes',{include_all_year_ready:true}));
 }
 new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
 attach();
})();
