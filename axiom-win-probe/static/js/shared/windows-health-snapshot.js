// Health on Windows (windows_health_snapshot.py). When Health opens, PEAK HOUR answers with the count it saved
// ("from_snapshot": true, "computed_at") instead of counting the whole library again. This shows when that count
// was made, with a Refresh link that counts again. It watches the answers of /api/library/health, so AXIOM's own
// Health scripts are not changed. Colors are inherited from the page, so day and night mode both stay readable.
(() => {
 'use strict';
 const HEALTH=/\/api\/library\/health(\?|$)/;
 let note=null, button=null, when=null, saved=false, text='';
 function ago(date){
  if(!(date instanceof Date)||isNaN(date))return 'earlier';
  const time=date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}), now=new Date();
  const days=Math.round((new Date(now.getFullYear(),now.getMonth(),now.getDate())-new Date(date.getFullYear(),date.getMonth(),date.getDate()))/86400000);
  if(days<=0)return `today at ${time}`;
  if(days===1)return `yesterday at ${time}`;
  return `${date.toLocaleDateString([],{month:'short',day:'numeric'})} at ${time}`;
 }
 function build(){
  if(note&&note.isConnected)return note;
  const anchor=document.getElementById('health-readiness-copy');
  if(!anchor)return null;
  if(!document.getElementById('health-snapshot-style')){
   const style=document.createElement('style');style.id='health-snapshot-style';
   style.textContent='#health-snapshot-note{margin:6px 0 0;font-size:.85rem;color:inherit}'
    +'#health-snapshot-note button{background:none;border:0;padding:0;margin:0;font:inherit;font-weight:700;color:inherit;text-decoration:underline;cursor:pointer}'
    +'#health-snapshot-note button:focus-visible{outline:2px solid currentColor;outline-offset:2px}'
    +'#health-snapshot-note button:disabled{opacity:.6;cursor:default}';
   document.head.appendChild(style);
  }
  note=document.createElement('p');note.id='health-snapshot-note';note.hidden=true;note.setAttribute('role','status');
  when=document.createElement('span');
  button=document.createElement('button');button.type='button';button.textContent='Refresh';
  button.title='Count the whole library again';
  button.addEventListener('click',()=>{
   if(typeof runLibraryHealthCheck!=='function')return;
   button.disabled=true;
   Promise.resolve(runLibraryHealthCheck({force:true})).catch(()=>{}).finally(()=>{button.disabled=false});
  });
  note.append(when,document.createTextNode(' · '),button);
  anchor.insertAdjacentElement('afterend',note);
  return note;
 }
 function fixHeader(){  // AXIOM writes "Just Now" there whenever an answer arrives, including a saved one
  const element=document.getElementById('health-inbox-last-checked');
  if(saved&&element&&element.textContent!==text)element.textContent=text;
 }
 function update(payload){
  saved=!!(payload&&payload.from_snapshot);
  const element=build();
  if(!element)return;
  if(saved){
   text=ago(new Date(payload.computed_at||payload.completed_at||''));
   when.textContent=`Last checked ${text}`;
   element.hidden=false;
   setTimeout(fixHeader,0);
  }else element.hidden=true;
 }
 const header=document.getElementById('health-inbox-last-checked');
 if(header)new MutationObserver(fixHeader).observe(header,{childList:true,characterData:true,subtree:true});
 const nativeFetch=window.fetch.bind(window);
 window.fetch=function(input,init){
  const pending=nativeFetch(input,init);
  try{
   const url=typeof input==='string'?input:(input&&(input.href||input.url))||'';
   if(HEALTH.test(url))pending.then(response=>response.clone().json()).then(update).catch(()=>{});
  }catch(_){}
  return pending;
 };
})();
