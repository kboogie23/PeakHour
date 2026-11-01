// Settings > System > "Open PEAK HOUR In" (windows_browser.py): Microsoft Edge or Google Chrome for
// PEAK HOUR's window, used from the next start. Browsers that are not installed are disabled.
(function(){
 'use strict';
 const api='/api/windows/window-browser';
 const base='The browser that shows PEAK HOUR\'s window. It opens as its own window, apart from your everyday tabs. Takes effect the next time PEAK HOUR starts.';
 let state=null;
 function render(){
  const select=document.getElementById('settings-window-browser'),copy=document.getElementById('settings-window-browser-copy');
  if(!select||!state)return;
  for(const option of select.options){
   const installed=state.installed[option.value];
   option.disabled=!installed;
   option.textContent=state.labels[option.value]+(installed?'':' (not installed)');
  }
  select.value=state.browser;
  const label=name=>state.labels[name]||'your default browser';
  copy.textContent=state.current&&state.current!==state.browser
   ?`${base} Now open in ${label(state.current)}; ${label(state.browser)} is used after you close and reopen PEAK HOUR.`
   :base;
 }
 async function load(){
  try{const response=await fetch(api);if(response.ok){state=await response.json();render();}}catch(_){}
 }
 async function change(event){
  const select=event.target;
  try{
   const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({browser:select.value})});
   const data=await response.json();
   if(!response.ok||!data.success)throw new Error(data.error||'The browser could not be changed.');
   state=data;render();
  }catch(error){await load();const copy=document.getElementById('settings-window-browser-copy');if(copy)copy.textContent=error.message;}
 }
 function setup(){
  const select=document.getElementById('settings-window-browser');
  if(!select)return;
  select.addEventListener('change',change);
  load();
  document.getElementById('settings-toggle')?.addEventListener('click',load);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
