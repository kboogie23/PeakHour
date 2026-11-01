// Big libraries on Windows: AXIOM's color-laws.js checked the contrast of every text element on the page
// every 2 seconds (getComputedStyle on each one and up its whole parent chain) and used the result only in
// its debug mode, which is off. With 20,000 tracks that froze Health for about 250 ms every 2 seconds.
// The check now starts only when its debug mode is switched on (window.toggleColourDebug()).
(function(){
 'use strict';
 if(typeof ColourLawsEnforcer!=='function')return;
 const proto=ColourLawsEnforcer.prototype;
 const startChecking=proto.setupContrastChecking,toggle=proto.toggleDebugMode;
 proto.setupContrastChecking=function(){
  if(this.debugMode&&!this.windowsContrastChecking){this.windowsContrastChecking=true;return startChecking.call(this);}
 };
 proto.toggleDebugMode=function(...args){
  const result=toggle.apply(this,args);
  this.setupContrastChecking();
  return result;
 };
})();
