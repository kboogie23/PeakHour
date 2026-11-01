// PEAK HOUR follows the DJ software (VirtualDJ, Serato, djay) by itself, like the Mac app does. AXIOM only polls
// the live bridge once "DJ Auto" has been clicked AND the Performance tab is open (the Mac shell's native
// watchdog does the rest there, and Windows has none). So: switch DJ Auto on once at startup (unless the user
// switched it off themselves; that choice is remembered), and while the Performance tab is hidden or the window
// is in the background keep forcing the same poll the core's own 3.2 s timer runs when the tab is visible.
(function(){
 'use strict';
 const CHOICE_KEY='peakHourDjAutoUser',WATCH_MS=3200;
 const ready=()=>typeof window.performanceToggleSeratoBridge==='function'&&typeof window.performancePollSeratoBridge==='function'
  &&typeof performanceSeratoEnabled==='boolean'&&!!document.getElementById('tab-content-performance');  // none of these in AXIOM Lite
 const autoLiveAssist=()=>typeof performanceAutoLiveAssistEnabled==='function'&&performanceAutoLiveAssistEnabled();
 const store=(value)=>{try{value===null?localStorage.removeItem(CHOICE_KEY):localStorage.setItem(CHOICE_KEY,value);}catch(e){}};
 const choice=()=>{try{return localStorage.getItem(CHOICE_KEY);}catch(e){return null;}};
 if(!/Windows/i.test(navigator.userAgent||''))return;
 let automatic=false,wrapped=false;
 function wrapToggle(){
  if(wrapped)return;wrapped=true;
  const toggle=window.performanceToggleSeratoBridge;
  window.performanceToggleSeratoBridge=function(...args){
   const result=toggle.apply(this,args);
   if(!automatic)store(performanceSeratoEnabled?'on':'off');  // a click on the DJ Auto button: the user's own choice
   return result;
  };
 }
 function start(){
  if(!ready())return;
  wrapToggle();
  if(choice()!=='off'&&autoLiveAssist()&&!performanceSeratoEnabled){
   automatic=true;
   try{window.performanceToggleSeratoBridge();}finally{automatic=false;}
  }
  setInterval(()=>{
   if(!performanceSeratoEnabled||!autoLiveAssist())return;
   const tab=document.getElementById('tab-content-performance');
   if(!tab)return;
   if(tab.classList.contains('hidden')||document.hidden)window.performancePollSeratoBridge(true);  // visible: the core's own timer polls
  },WATCH_MS);
 }
 if(document.readyState==='complete')setTimeout(start,1000);
 else window.addEventListener('load',()=>setTimeout(start,1000));
})();
