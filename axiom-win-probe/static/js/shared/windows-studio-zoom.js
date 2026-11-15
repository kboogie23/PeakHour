// PEAK HOUR (Windows): Ctrl+wheel, pinch and Ctrl +, -, 0 never zoom the whole window (Edge's page zoom, which it then
// remembers per site). Anywhere in the app they are cancelled. While the Studio DAW is showing they zoom the
// TIMELINE instead: Ctrl+wheel over the lanes or ruler zooms around the mouse pointer, Ctrl + and Ctrl - step the
// zoom, Ctrl 0 goes back to the whole arrangement (the toolbar's default). This also works with focus in a text box,
// slider or menu. Every PEAK HOUR window loads this file (Edge keeps ONE page zoom per host, so the Mini window and the coach
// prompt would otherwise zoom the main window too); without the DAW on the page it only cancels the page zoom. The launcher clears a page zoom Edge saved earlier (axiom_windows_launcher.py).
// A touchpad pinch reaches the page as ctrl+wheel events (so it is cancelled and used here like Ctrl+wheel, scaled by its size).
// The launcher must NOT pass --disable-pinch: with it Edge delivers a touchpad pinch to the page as nothing at all.
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
  const fraction=(event.clientX-rect.left)/rect.width;
  // A touchpad pinch reaches the page as many small FRACTIONAL ctrl+wheel events (deltaY about -50 over a pinch that doubles the
  // distance); a mouse wheel notch is one big whole number (+-100 / +-120). The pinch scales with its size, so the timeline
  // follows the fingers; a notch is a fixed step.
  const pinch=event.deltaMode===0&&(Math.abs(delta)<30||!Number.isInteger(delta));
  if(!pinch){api.zoomTimelineBy(Math.exp(Math.max(-.4,Math.min(.4,delta*.0025))),fraction);return;}  // wheel up (negative) zooms in
  pending.factor*=Math.exp(Math.max(-.5,Math.min(.5,delta*PINCH_RATE)));
  pending.fraction=fraction;
  if(!pending.frame)pending.frame=requestAnimationFrame(flushPinch);  // one redraw per frame, not one per event
 }
 const PINCH_RATE=.014;
 const pending={factor:1,fraction:.5,frame:0};
 function flushPinch(){
  const {factor,fraction}=pending;
  pending.factor=1;
  pending.frame=0;
  const api=daw();
  if(api&&Math.abs(factor-1)>1e-6)api.zoomTimelineBy(factor,fraction);
 }

 // A touch screen pinch: two fingers on the lanes or the ruler zoom the timeline around the midpoint between them. The lanes
 // keep touch-action pan-x pan-y (one finger still scrolls); the second finger's touchstart is cancelled so the pinch is ours.
 let touch=null;
 const timelineTouch=event=>event.target instanceof Element&&Boolean(event.target.closest('.studio-daw-timeline, #studio-daw-ruler'));
 function span(event){
  const [a,b]=[event.touches[0],event.touches[1]];
  return {distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),x:(a.clientX+b.clientX)/2};
 }
 function onTouchStart(event){
  if(event.touches.length!==2||!daw()||!timelineTouch(event)){if(event.touches.length<2)touch=null;return;}
  if(event.cancelable)event.preventDefault();
  const now=span(event);
  touch=now.distance>8?now:null;
  // Touch events keep going to the element the touch began on, and zooming redraws the lanes (that element leaves the page and
  // its events no longer reach window), so the pinch listens on the element itself until the fingers lift.
  if(touch&&event.target instanceof Element){
   const element=event.target;
   const done=()=>{if(touch&&touch.element===element)touch=null;element.removeEventListener('touchmove',onTouchMove,true);element.removeEventListener('touchend',onTouchEnd,true);element.removeEventListener('touchcancel',onTouchEnd,true);};
   touch.element=element;touch.done=done;
   element.addEventListener('touchmove',onTouchMove,{capture:true,passive:false});
   element.addEventListener('touchend',onTouchEnd,true);
   element.addEventListener('touchcancel',onTouchEnd,true);
  }
 }
 function onTouchMove(event){
  if(!touch||event.touches.length<2)return;
  if(event.cancelable)event.preventDefault();
  const api=daw(),now=span(event),rect=laneRect(document.querySelector('#studio-daw-lanes .studio-daw-lane'));
  if(!api||!rect||!(rect.width>0)||!(now.distance>8))return;
  const factor=touch.distance/now.distance;  // fingers apart -> the span shrinks = zoom in
  touch.distance=now.distance;
  api.zoomTimelineBy(Math.max(.5,Math.min(2,factor)),(now.x-rect.left)/rect.width);
 }
 function onTouchEnd(event){if(event.touches.length<2&&touch)touch.done();}
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
 window.addEventListener('touchstart',onTouchStart,{capture:true,passive:false});
 // No page can be pinch-zoomed on a touch screen either (scrolling by one finger stays); the lanes' own rule is in windows-studio-daw.css.
 const lock=document.createElement('style');
 lock.textContent='html{touch-action:pan-x pan-y}';
 (document.head||document.documentElement).appendChild(lock);
 // Pinch on a touch screen or a trackpad can arrive as Safari-style gesture events; none of them may zoom the page.
 for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,event=>event.preventDefault(),{passive:false});
})();
