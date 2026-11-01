// PEAK HOUR: Settings > Interface > Font Size makes all the text bigger or smaller.
// AXIOM's setting (--global-font-scale, 80-150%) only resized song titles and artists. Here it
// zooms the main area, which lays itself out again inside the window, so every page grows
// evenly without spilling off screen. The Settings window keeps its normal size so it always
// fits, and song titles stop growing twice (windows-theme-urban.css).
(function(){
 'use strict';
 function scale(){
  const fromStyle=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--global-font-scale'));
  let saved=NaN;
  try{saved=parseFloat(localStorage.getItem('smartLinksFontScale'));}catch(error){}
  const value=Number.isFinite(fromStyle)?fromStyle:saved;
  return Number.isFinite(value)?Math.min(1.6,Math.max(0.8,Math.round(value*100)/100)):1;
 }
 function apply(){
  const s=scale(),main=document.getElementById('main-content-wrapper'),settings=document.getElementById('master-hud');
  const zoom=Math.abs(s-1)<0.001?'':String(s);
  if(main&&main.style.zoom!==zoom)main.style.zoom=zoom;
  const counter=zoom?String(Math.round(1e4/s)/1e4):'';
  if(settings&&settings.style.zoom!==counter)settings.style.zoom=counter;
 }
 new MutationObserver(apply).observe(document.documentElement,{attributes:true,attributeFilter:['style']});
 document.addEventListener('DOMContentLoaded',apply);
 window.addEventListener('load',apply);
})();
