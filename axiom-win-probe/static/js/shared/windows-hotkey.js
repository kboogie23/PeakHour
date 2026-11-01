// Settings > Workflow > "Ctrl+F Shows Live Assist" (windows_hotkey.py): on/off, and when it last worked.
(function(){
 'use strict';
 const api='/api/windows/live-assist-hotkey';
 const byId=id=>document.getElementById(id);
 function render(state){
  const toggle=byId('settings-live-assist-hotkey-toggle'),title=byId('settings-live-assist-hotkey-title'),copy=byId('settings-live-assist-hotkey-copy');
  if(!toggle||!state)return;
  toggle.setAttribute('aria-pressed',state.enabled?'true':'false');
  title.textContent=`Ctrl+F Shows Live Assist ${state.enabled?'On':'Off'}`;
  const base='Press Ctrl+F to search in Serato, VirtualDJ or djay and PEAK HOUR brings Live Assist up beside it. Your search keeps typing into the DJ software.';
  copy.textContent=state.last_trigger?`${base} Last used ${new Date(state.last_trigger*1000).toLocaleTimeString()}.`:base;
 }
 async function load(){
  try{const r=await fetch(api,{cache:'no-store'});if(r.ok)render(await r.json());}catch(error){}
 }
 async function toggle(){
  const button=byId('settings-live-assist-hotkey-toggle');
  const enabled=button.getAttribute('aria-pressed')!=='true';
  try{
   const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});
   const data=await r.json();if(!r.ok||data.success===false)throw new Error(data.error||'Could not change this setting.');
   render(data);window.showToast?.(`Ctrl+F Live Assist ${enabled?'on':'off'}.`);
  }catch(error){window.showToast?.(error.message,true);}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  byId('settings-live-assist-hotkey-toggle')?.addEventListener('click',toggle);
  load();
 });
})();
