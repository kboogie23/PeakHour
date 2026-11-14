// PEAK HOUR (Windows): Ctrl+wheel, pinch and Ctrl +, -, 0 never zoom the whole window (Edge's page zoom, which it then
// remembers per site). Anywhere in the app they are cancelled. While the Studio DAW is showing they zoom the
// TIMELINE instead: Ctrl+wheel over the lanes or ruler zooms around the mouse pointer, Ctrl + and Ctrl - step the
// zoom, Ctrl 0 goes back to the whole arrangement (the toolbar's default). This also works with focus in a text box,
// slider or menu. Every PEAK HOUR window loads this file (Edge keeps ONE page zoom per host, so the Mini window and the coach
// prompt would otherwise zoom the main window too); without the DAW on the page it only cancels the page zoom. The launcher adds --disable-pinch and clears a page zoom Edge saved earlier (axiom_windows_launcher.py).
(function(){
 'use strict';
 const SOURCE_AREA='.daw-source-detail, .daw-source-zoom';  // the clip editor has its own wheel zoom (sourceWheel)
 const daw=()=>{const api=window.AxiomStudioDaw;return api&&api.surfaceVisible?api:null;};

 function laneRect(target){
  const el=target instanceof Element?target:null;
  const ruler=el?.closest('#studio-daw-ruler');
  const lane=el?.closest('.studio-daw-lane')||document.querySelector('#studio-daw-lanes .studio-daw-lane');
  const box=ruler||lane||document.getElementById('studio-daw-lanes');
  return box?box.getBoundingClientRect():null;
 }

 function onWheel(event){
  if(!event.ctrlKey)return;
  const target=event.target instanceof Element?event.target:null;
  const inSource=Boolean(target?.closest(SOURCE_AREA));
  if(!inSource)event.preventDefault();  // the clip editor's own handler cancels its wheel; onWheelLate covers the rest
  const api=daw();
  if(!api||inSource||!target?.closest('.studio-daw-timeline, #studio-daw-ruler'))return;
  event.stopPropagation();
  const rect=laneRect(target);
  if(!rect||!(rect.width>0))return;
  const unit=event.deltaMode===1?16:event.deltaMode===2?100:1;
  const delta=Number(event.deltaY||0)*unit;
  if(!Number.isFinite(delta)||Math.abs(delta)<0.01)return;
  const factor=Math.exp(Math.max(-.4,Math.min(.4,delta*.0025)));  // wheel up (negative) zooms in; a pinch sends small steps
  api.zoomTimelineBy(factor,(event.clientX-rect.left)/rect.width);
 }
 function onWheelLate(event){if(event.ctrlKey&&!event.defaultPrevented)event.preventDefault();}

 function zoomDirection(event){
  const key=String(event.key||''),code=String(event.code||'');
  if(key==='+'||key==='='||code==='NumpadAdd'||code==='Equal')return 1;
  if(key==='-'||key==='_'||code==='NumpadSubtract'||code==='Minus')return -1;
  if(key==='0'||code==='Digit0'||code==='Numpad0')return 0;
  return null;
 }
 function onKeydown(event){
  // Ctrl+Alt is AltGr on many keyboards: leave it to typing.
  if(!event.ctrlKey||event.altKey||event.metaKey)return;
  const direction=zoomDirection(event);
  if(direction===null)return;
  event.preventDefault();
  const api=daw();
  if(!api||event.target instanceof Element&&event.target.closest('dialog, [role="dialog"]'))return;
  event.stopImmediatePropagation();  // the DAW's own handler would step the zoom a second time
  api.zoomKey(direction);
 }

 window.addEventListener('wheel',onWheel,{capture:true,passive:false});
 window.addEventListener('wheel',onWheelLate,{capture:false,passive:false});
 window.addEventListener('keydown',onKeydown,{capture:true});
 // Pinch on a touch screen or a trackpad can arrive as Safari-style gesture events; none of them may zoom the page.
 for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,event=>event.preventDefault(),{passive:false});
})();
