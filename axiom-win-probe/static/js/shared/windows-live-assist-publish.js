// Live Assist window: saves the rows it is showing, so PEAK HOUR Mini shows exactly the same list. Rejected songs,
// More Like This, Clean Only and the other refinements live only in this window's memory (live-assist-core.js).
(function(){
 'use strict';
 const key='peakhour.liveAssistVisibleRows';
 function publish(){
  if(typeof filteredSuggestions!=='function')return;
  try{
   const rows=filteredSuggestions().map(track=>({title:track.title,artist:track.artist,bpm:track.bpm,genre:track.genre,placement:AXIOMLiveAssistSimilarity.displayPlacement(track)}));
   localStorage.setItem(key,JSON.stringify({at:Date.now(),rows}));
  }catch(error){}
 }
 window.addEventListener('pagehide',()=>{try{localStorage.removeItem(key);}catch(error){}});
 publish();
 setInterval(publish,1500);
})();
