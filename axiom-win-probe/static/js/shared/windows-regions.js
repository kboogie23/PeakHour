// PEAK HOUR: each inner page reps a hip-hop region (windows-theme-urban.css styles them).
// Library = East Coast, Studio = West Coast, Performance = Dirty South, Playlists = Texas,
// Health = Midwest. This marks <body data-ph-region="…"> for the page on screen and keeps a
// region sticker in the sidebar's empty space under the menu.
(function(){
 'use strict';
 // Health opens inside the Studio container, so it is checked first.
 const regions=[
  ['health-view','midwest','MIDWEST','CHICAGO · DETROIT'],
  ['tab-content-library','east','EAST COAST','NEW YORK'],
  ['tab-content-studio','west','WEST COAST','LOS ANGELES'],
  ['tab-content-performance','south','DIRTY SOUTH','ATLANTA'],
  ['tab-content-playlists','texas','TEXAS','HOUSTON'],
 ];
 function visible(el){
  if(!el||el.classList.contains('hidden'))return false;
  const box=el.getBoundingClientRect();
  return box.width>0&&box.height>0&&getComputedStyle(el).visibility!=='hidden';
 }
 function sticker(){
  // Health swaps the sidebar menu for its own, so the sticker sits under whichever menu is showing.
  const healthNav=document.body.classList.contains('health-workspace-active')&&document.getElementById('health-workspace-sidebar');
  const nav=healthNav||document.querySelector('#axiom-sidebar .axiom-sidebar-nav');
  if(!nav)return null;
  let tag=document.getElementById('ph-region-sticker');
  if(!tag){
   tag=document.createElement('div');tag.id='ph-region-sticker';tag.className='ph-region-sticker';tag.setAttribute('aria-hidden','true');
   tag.innerHTML='<strong></strong><small></small>';
  }
  if(nav.nextElementSibling!==tag)nav.after(tag);
  return tag;
 }
 function update(){
  // The entrance screen sits over the Studio page, so it counts as no region.
  const match=visible(document.getElementById('axiom-entrance'))?null:regions.find(([id])=>visible(document.getElementById(id)));
  const key=match?match[1]:'';
  if(document.body.dataset.phRegion!==key){
   if(key)document.body.dataset.phRegion=key;else delete document.body.dataset.phRegion;
  }
  const tag=sticker();
  if(!tag)return;
  // Performance collapses the sidebar to icons; the sticker would be clipped there.
  const sidebar=document.getElementById('axiom-sidebar');
  const narrow=!!sidebar&&sidebar.getBoundingClientRect().width<160;
  tag.hidden=!match||narrow;
  if(match&&tag.dataset.region!==key){
   tag.dataset.region=key;
   tag.querySelector('strong').textContent=match[2];
   tag.querySelector('small').textContent=match[3];
  }
 }
 setInterval(update,600);
 document.addEventListener('click',()=>setTimeout(update,50),true);
 update();
})();
