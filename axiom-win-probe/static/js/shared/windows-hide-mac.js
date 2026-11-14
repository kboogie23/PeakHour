// PEAK HOUR (Windows): hide AXIOM features that only exist on a Mac, and the
// account / licence screens while activation is switched off.
//  Mac only: Command-F through macOS Accessibility (Settings, Performance and
//  Live Assist "Allow access"), Check For Updates (Mac App Store), Quit (the
//  Mac app's native bridge; closing the window quits on Windows) and the AXIOM Lite
//  import. (The streaming feed has a Windows version: windows_feed.py.)
//  Account & licence: Settings > Account & License, the sign-in window and the
//  activation window. They are only hidden while the app reports that no
//  sign-in is needed and access is full; if activation is switched on again
//  (AXIOM_LICENSE_REQUIRED=1) they show as before, so nothing can lock the app
//  behind a hidden window. The licence code itself is unchanged.
(function(){
 'use strict';
 const MAC_ONLY=['#settings-performance-accessibility','#performance-search-access','#assist-search-access','#lite-migration-settings-item'];
 const ACCOUNT=['#license-modal','#first-login-preview'];
 let hideAccount=false;
 const mark=node=>{if(node&&!node.classList.contains('ph-hidden'))node.classList.add('ph-hidden');};
 function apply(){
  MAC_ONLY.forEach(selector=>document.querySelectorAll(selector).forEach(mark));
  // Check For Updates (Mac App Store) and Quit (the Mac app's bridge; closing the window quits on Windows)
  document.querySelectorAll('[onclick^="checkForAxiomUpdate"],[onclick^="quitAxiomApp"]').forEach(button=>mark(button.closest('.settings-item')));
  if(!hideAccount)return;
  ACCOUNT.forEach(selector=>document.querySelectorAll(selector).forEach(mark));
  for(const heading of document.querySelectorAll('#settings-content h3')){
   if(heading.textContent.trim()!=='Account & License')continue;
   mark(heading);
   for(let next=heading.nextElementSibling;next&&next.matches('article.settings-item');next=next.nextElementSibling)mark(next);
  }
 }
 async function checkAccess(){  // account items are only marked once this says activation is off
  try{
   const [account,license]=await Promise.all(['/api/account/status','/api/license/status'].map(url=>fetch(url,{cache:'no-store'}).then(r=>r.json())));
   hideAccount=account?.login_required===false&&license?.access_tier==='full';
  }catch(error){hideAccount=false;}
  // Activation is off: runtime-foundation.js skips its online licence check (POST /api/license/validate answers 400 here).
  window.PeakHourActivationOff=hideAccount;
  if(hideAccount)apply();
 }
 const style=document.createElement('style');
 style.textContent='.ph-hidden{display:none!important}';
 (document.head||document.documentElement).append(style);
 new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener('DOMContentLoaded',()=>{apply();checkAccess();});
 apply();
})();
