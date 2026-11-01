// AXIOM on other laptops (Windows hub, windows_remote_hub.py).
// On a laptop: shows whose library this is and adds "upload your DJ database"
// cards to the library source picker (VirtualDJ database.xml, Serato
// database V2; rekordbox XML uses AXIOM's own card).
// On the AXIOM PC: adds a card with the address other laptops open.
(function(){
 'use strict';
 let info=null;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 function card(grid,id,title,copy,action,onclick){
  if(grid.querySelector('#'+id))return;
  const section=el('section',undefined,'library-source-choice');
  const icon=el('div',undefined,'library-source-choice-icon');icon.setAttribute('aria-hidden','true');
  const img=el('img');img.src='/static/icons/database.svg';img.alt='';icon.append(img);
  const button=el('button',action,'library-source-choice-action');button.type='button';button.id=id;button.onclick=onclick;
  section.append(icon,el('h4',title),el('p',copy,'library-source-choice-copy'),button);grid.append(section);
 }
 function upload(source,accept){
  const input=el('input');input.type='file';input.accept=accept;input.hidden=true;
  input.onchange=async()=>{
   const file=input.files?.[0];input.remove();if(!file)return;
   if(typeof closeLibrarySourcePicker==='function')closeLibrarySourcePicker();
   const form=new FormData();form.append('file',file);form.append('source',source);
   window.showToast?.(`Reading ${file.name}… Your music files stay on your laptop.`);
   try{
    const response=await fetch('/api/library/connect_dj_source',{method:'POST',body:form});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.success===false)throw new Error(data.error||'That database could not be read.');
    window.showToast?.(data.message||'Library loaded.');
    if(typeof loadLibraryStats==='function')await loadLibraryStats();
    if(typeof runSearch==='function')runSearch();
   }catch(error){window.showToast?.(error.message,true);}
  };
  document.body.append(input);input.click();
 }
 function decorate(modal){
  const grid=modal.querySelector('.library-source-choice-grid');if(!grid||!info)return;
  if(info.remote){
   card(grid,'remote-upload-virtualdj','VirtualDJ on this laptop','Upload database.xml from your VirtualDJ folder (Documents or AppData\\Local\\VirtualDJ). BPM, key, year, genre and cues come with it.','Upload VirtualDJ Database',()=>upload('virtualdj','.xml,text/xml'));
   card(grid,'remote-upload-serato','Serato on this laptop','Upload the file named "database V2" from your _Serato_ folder (in your Music folder).','Upload Serato Database',()=>upload('serato',''));
  }else if(info.hub_url){
   if(grid.querySelector('#remote-hub-info'))return;
   const section=el('section',undefined,'library-source-choice');section.id='remote-hub-info';
   section.append(el('h4','Other laptops'),el('p',`On your home Wi-Fi, open ${info.hub_url} on another laptop. Each laptop keeps its own separate library here.`,'library-source-choice-copy'));
   if(info.libraries?.length)section.append(el('p','Laptop libraries: '+info.libraries.join(', '),'library-source-choice-readonly'));
   grid.append(section);
  }
 }
 function banner(){
  if(!info?.remote||document.getElementById('axiom-remote-banner'))return;
  const bar=el('div',`${info.name||'Laptop'} library · your music stays on your laptop; upload your DJ database from Library > Add music.`);
  bar.id='axiom-remote-banner';
  bar.style.cssText='position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:9999;padding:6px 12px;border-radius:999px;background:#22301c;color:#eef5e9;font:12px system-ui;opacity:.92;pointer-events:none;max-width:calc(100% - 32px);text-align:center';
  document.body.append(bar);
 }
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
  const modal=node.id==='library-source-modal'?node:node.querySelector?.('#library-source-modal');if(modal)decorate(modal);}})
  .observe(document.documentElement,{childList:true,subtree:true});
 fetch('/api/windows/remote/whoami').then(r=>r.ok?r.json():null).then(data=>{
  info=data;banner();const modal=document.getElementById('library-source-modal');if(modal)decorate(modal);
 }).catch(()=>{});
})();
