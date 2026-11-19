// A "Mini" button beside Performance's Open Live Assist and in the Live Assist top bar (windows_live_assist_mini.py).
(function(){
 'use strict';
 async function open(){
  try{
   const response=await fetch('/api/windows/live-assist-mini/open',{method:'POST'});
   if(!response.ok)throw new Error('The small window could not open.');
  }catch(error){window.showToast?.(error.message,true);}
 }
 function button(className){
  const node=document.createElement('button');
  node.type='button';node.id='windows-live-assist-mini';node.className=className;node.textContent='Mini';
  node.title='Open a small window with the song playing and the next suggestions';
  node.addEventListener('click',open);
  return node;
 }
 function place(){
  if(document.getElementById('windows-live-assist-mini'))return true;
  const performance=document.getElementById('performance-live-assist');
  if(performance){performance.after(button('performance-topbar-action'));return true;}
  const pin=document.getElementById('pin-button');
  if(pin){
   const node=button('topbar-icon');  // a 28 px icon button like its neighbours
   node.setAttribute('aria-label',node.title);
   node.innerHTML='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 5h18v14H3z"/><path fill="currentColor" d="M12 12h7v5h-7z"/></svg>';
   pin.before(node);
   return true;
  }
  return false;
 }
 if(!place()){
  const watcher=new MutationObserver(()=>{if(place())watcher.disconnect();});
  watcher.observe(document.documentElement,{childList:true,subtree:true});
 }
})();
