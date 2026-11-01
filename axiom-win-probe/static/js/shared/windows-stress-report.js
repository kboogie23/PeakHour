// Settings > Library & Data > "Stress-Test Report" (windows_stress_report.py): make the zip, show progress, open its folder.
(function(){
 'use strict';
 const api='/api/windows/stress-report';
 const byId=id=>document.getElementById(id);
 const base="Checks how PEAK HOUR handles this PC's library: every file type, files that fail to open, slow screens and errors. Saves one zip to the Desktop to bring back. Nothing in your music or DJ software is changed.";
 let timer=null;
 function render(state){
  const start=byId('settings-stress-report-start'),show=byId('settings-stress-report-show'),title=byId('settings-stress-report-title'),copy=byId('settings-stress-report-copy');
  if(!start||!state)return;
  const running=state.state==='running';
  start.disabled=running;
  start.textContent=running?`${state.percent}%`:(state.state==='done'?'Make Another':'Make Report');
  show.hidden=state.state!=='done';
  if(running){title.textContent='Stress-Test Report: Working';copy.textContent=`${state.stage}... A big library can take a few minutes. You can keep using PEAK HOUR.`;}
  else if(state.state==='done'){title.textContent='Stress-Test Report: Saved';const name=String(state.path||'').split(/[\\/]/).pop();copy.textContent=`Saved on the Desktop as "${name}". Bring this one file back.`;}
  else if(state.state==='error'){title.textContent='Stress-Test Report';copy.textContent=state.error||base;}
  else{title.textContent='Stress-Test Report';copy.textContent=base;}
  clearTimeout(timer);
  if(running)timer=setTimeout(load,1000);
 }
 async function load(){
  try{const r=await fetch(api,{cache:'no-store'});if(r.ok)render(await r.json());}catch(error){}
 }
 async function post(url,fallback){
  const r=await fetch(url,{method:'POST'});const data=await r.json();
  if(!r.ok||data.success===false)throw new Error(data.error||fallback);
  return data;
 }
 async function start(){
  try{render(await post(api,'The report could not be started.'));window.showToast?.('Making the stress-test report.');}
  catch(error){window.showToast?.(error.message,true);}
 }
 async function show(){
  try{await post(`${api}/reveal`,'The report could not be shown.');}catch(error){window.showToast?.(error.message,true);}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  byId('settings-stress-report-start')?.addEventListener('click',start);
  byId('settings-stress-report-show')?.addEventListener('click',show);
  load();
 });
})();
