// PEAK HOUR (Windows): keeps the page quiet while the Studio DAW plays, so the audio scheduler is never starved.
//
// Measured on a 45-clip mixtape (a 3-hour set): with the song rows of the Studio set on the page, the button-typography
// observer (features/cta-typography.js) answers every childList or class/hidden/aria change anywhere in the body with a pass
// over all buttons (selector matching and getComputedStyle on each, then inline font writes that restyle the page). A toast,
// a sticker or a progress label was enough to start one; during playback those passes took up to 90% of the main thread, the
// 60 ms scheduler tick ran up to a second late and the next clip's audio arrived too late ("Audio scheduling fell behind").
// Button typography does not need to follow a playing mix: the observer is paused while the DAW plays (checked twice a
// second, because the observer re-attaches itself whenever anything else asks for a pass) and one pass runs when playback
// stops, so every button added meanwhile gets its typography then.
(function(){
 'use strict';
 let paused=false;
 function tick(){
  const cta=window.__AXIOM_CTA_TYPOGRAPHY__,transport=window.AxiomArrangement;
  if(!cta||!cta.observer||!transport)return;
  if(transport.playing){
   cta.observer.disconnect();paused=true;
  }else if(paused){
   paused=false;
   if(typeof cta.reconcile==='function')cta.reconcile();
  }
 }
 setInterval(tick,500);
 window.AxiomWindowsStudioPlayback=Object.freeze({get paused(){return paused;}});
})();
