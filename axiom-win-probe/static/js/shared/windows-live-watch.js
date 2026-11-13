// PEAK HOUR follows the DJ software (VirtualDJ, Serato, djay) by itself, like the Mac app does. AXIOM only polls
// the live bridge once "DJ Auto" has been clicked AND the Performance tab is open (the Mac shell's native
// watchdog does the rest there, and Windows has none). So: switch DJ Auto on once at startup (unless the user
// switched it off themselves; that choice is remembered), and while the Performance tab is hidden or the window
// is in the background keep forcing the same poll the core's own 3.2 s timer runs when the tab is visible.
//
// A song only becomes the Playing Now anchor (and so reaches Live Assist and PEAK HOUR Mini) when the poll says
// fresh_event:true, and the core says that once per song, to whoever asks first, and only within 30 s of the
// song starting. A song already playing when PEAK HOUR opens, a poll that was slow or failed, a second reader
// (another window, a manual check) or a late poll all lose it for good. So for VirtualDJ a song that is still
// playing and has not been taken yet is handed to the core as fresh, once per page.
(function(){
 'use strict';
 const CHOICE_KEY='peakHourDjAutoUser',WATCH_MS=3200;
 const ready=()=>typeof window.performanceToggleSeratoBridge==='function'&&typeof window.performancePollSeratoBridge==='function'
  &&typeof performanceSeratoEnabled==='boolean'&&!!document.getElementById('tab-content-performance');  // none of these in AXIOM Lite
 const autoLiveAssist=()=>typeof performanceAutoLiveAssistEnabled==='function'&&performanceAutoLiveAssistEnabled();
 const store=(value)=>{try{value===null?localStorage.removeItem(CHOICE_KEY):localStorage.setItem(CHOICE_KEY,value);}catch(e){}};
 const choice=()=>{try{return localStorage.getItem(CHOICE_KEY);}catch(e){return null;}};
 if(!/Windows/i.test(navigator.userAgent||''))return;
 let automatic=false,wrapped=false,wrappedRead=false;
 const taken=new Set();  // event ids this page has already made the anchor (or been told were fresh)
 const stillPlaying=(track)=>{
  const now=Date.now()/1000,start=Number(track.start_time||track.observed_at||0),end=Number(track.end_time||0);
  if(!start)return false;
  return end>start?now<=end+120:now-start<=600;  // no length known: ten minutes
 };
 function adopt(data){
  if(!data||data.success!==true||!data.track||data.track.live_provider!=='virtualdj')return data;
  const id=String(data.event_id||'');
  if(!id)return data;
  if(data.fresh_event===true){taken.add(id);return data;}
  if(taken.has(id)||!stillPlaying(data.track))return data;
  taken.add(id);
  return Object.assign({},data,{fresh_event:true});
 }
 function wrapRead(){
  if(wrappedRead||typeof window.performanceReadSeratoBridgePayload!=='function')return;
  wrappedRead=true;
  const read=window.performanceReadSeratoBridgePayload;
  window.performanceReadSeratoBridgePayload=async function(...args){return adopt(await read.apply(this,args));};
 }
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
  wrapToggle();wrapRead();
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
