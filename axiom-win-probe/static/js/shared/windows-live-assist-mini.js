// PEAK HOUR Mini (windows_live_assist_mini.py): shows the song playing and the songs Live Assist suggests next.
// Read-only: it only reads the state the main window publishes, and a read costs under a millisecond.
(function(){
 'use strict';
 const byId=id=>document.getElementById(id);
 const pinKey='peakhour.miniPinned';
 let shown='';
 function stored(){try{return localStorage.getItem(pinKey)!=='off';}catch(error){return true;}}
 const rowsKey='peakhour.liveAssistVisibleRows',rowsFreshMs=5000;
 const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:0;};
 function publishedRows(){  // the exact list an open Live Assist window is showing (windows-live-assist-publish.js)
  try{
   const saved=JSON.parse(localStorage.getItem(rowsKey)||'null');
   return saved&&Date.now()-saved.at<rowsFreshMs&&Array.isArray(saved.rows)?saved.rows:null;
  }catch(error){return null;}
 }
 // With Live Assist closed: its default rules (filteredSuggestions, trackFamilyKeys and songFamilyTitle in
 // live-assist-core.js): within 5 BPM of the tempo, DJ playlist tracks first, closest tempo first, one version per song.
 function familyTitle(value){
  let clean=String(value||'').trim().toLowerCase().replace(/\.[a-z0-9]{2,5}$/i,'').replace(/_/g,' ');
  clean=clean.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g,' ').replace(/\b(feat|ft|featuring)\.?\b.*$/i,' ');
  const versionWords=/\b(intro|outro|clean|dirty|explicit|radio|edit|remix|refix|rework|bootleg|mashup|transition|quick|short|long|extended|acap|acapella|instrumental|single|video|snipz|kidcutup|mrefresh|mfresh|markcutz|break|redrum|starter|throwback|version|club|mix)\b/i;
  const parts=clean.split(/\s+-\s+/);
  if(parts.length>1&&parts.slice(1).some(part=>versionWords.test(part)))clean=parts[0];
  clean=clean.replace(/\b(clean|dirty|explicit|intro|outro|radio|edit|remix|refix|rework|bootleg|mashup|transition|quick|short|long|extended|acap|acapella|instrumental|single|video|version|club|mix|hd|hq|xxx)\b/gi,' ');
  return clean.replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 }
 function familyKeys(track){
  const artist=String(track.artist||'').toLowerCase().replace(/\b(feat|ft|featuring)\.?\b.*$/i,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  const filename=String(track.path||'').split(/[\\/]/).pop().replace(/\.[^.]+$/,'');
  const titles=[track.title,filename],dash=filename.split(/\s+-\s+/),keys=[String(track.path||'').toLowerCase()];
  if(dash.length>1)titles.push(dash.slice(1).join(' - '));
  titles.forEach(value=>{
   const title=familyTitle(value);
   if(!title)return;
   keys.push(`song::${title}`);
   if(artist)keys.push(`song::${artist}::${title}`);
   const compact=title.replace(/\s+/g,'');
   if(compact.length>=6){keys.push(`songcompact::${compact}`);if(artist)keys.push(`songcompact::${artist.replace(/\s+/g,'')}::${compact}`);}
  });
  return keys.filter(Boolean);
 }
 function defaultRows(state){
  const anchor=state.anchor||{},context=state.bpm_context||{};
  const anchorBpm=number(context.live_bpm)||number(anchor.playing_bpm||anchor.serato_playing_bpm)||number(anchor.bpm||anchor.tempo||anchor.detected_bpm);
  const target=number(context.manual_bpm)||(state.tempo_intent==='half'&&anchorBpm?anchorBpm/2:0)||(state.tempo_intent==='double'&&anchorBpm?anchorBpm*2:0)||anchorBpm;
  const bpmOfRow=track=>number(track.bpm||track.tempo||track.detected_bpm);
  if((anchor.live_provider||['djay_live','serato_live'].includes(anchor.connected_from))&&!target)return [];
  const seen=new Set();
  return (Array.isArray(state.suggestions)?state.suggestions:[])
   .filter(track=>track.path&&(!target||(bpmOfRow(track)>0&&Math.abs(bpmOfRow(track)-target)<=5)))
   .map((track,index)=>({track,index}))
   .sort((left,right)=>{
    const dj=Number(Boolean(right.track.gig_profile))-Number(Boolean(left.track.gig_profile));
    if(dj)return dj;
    const distance=target?Math.abs((bpmOfRow(left.track)||target)-target)-Math.abs((bpmOfRow(right.track)||target)-target):0;
    return distance||left.index-right.index;
   }).map(item=>item.track)
   .filter(track=>{
    const keys=familyKeys(track);
    if(keys.some(item=>seen.has(item)))return false;
    keys.forEach(item=>seen.add(item));
    return true;
   });
 }
 function element(tag,className,text){const node=document.createElement(tag);node.className=className;node.textContent=text;return node;}
 function bpmOf(track){return Math.round(Number(track.playing_bpm||track.bpm||track.native_bpm||0));}
 function placement(track){  // Live Assist's own year label
  if(track.placement!==undefined)return track.placement;  // published by an open Live Assist
  try{return window.AXIOMLiveAssistSimilarity?.displayPlacement(track)||'';}catch(error){return '';}
 }
 function renderNow(anchor){
  const has=Boolean(anchor&&(anchor.title||anchor.path));
  const bpm=has?bpmOf(anchor):0;
  byId('mini-now-title').textContent=has?(anchor.title||anchor.filename||'Unknown song'):'Waiting for a song';
  const artist=has?(anchor.artist||'Unknown artist'):'Play a song in your DJ software.';
  byId('mini-now-artist').textContent=bpm?`${artist} · ${Number(anchor.playing_bpm||anchor.bpm||anchor.native_bpm).toFixed(1)} BPM`:artist;
  byId('mini-now-bpm').textContent=bpm?String(bpm):'';
 }
 function renderList(rows){
  const list=byId('mini-list');list.replaceChildren();
  byId('mini-count').textContent=rows.length?`(${rows.length})`:'';
  if(!rows.length){list.append(element('li','mini-empty','Suggestions appear here once a song is playing.'));return;}
  rows.forEach(track=>{
   const row=element('li','mini-row',''),meta=element('div','mini-row-meta','');
   const bpm=bpmOf(track),where=placement(track),genre=String(track.genre||'').trim();
   if(bpm)meta.append(element('span','',`${bpm} BPM`));
   if(where)meta.append(element('span','',String(where)));
   if(genre)meta.append(element('span','mini-row-genre',genre));
   row.append(element('div','mini-row-title',track.title||track.filename||'Unknown song'),element('div','mini-row-artist',track.artist||'Unknown artist'),meta);
   list.append(row);
  });
 }
 async function refresh(){
  try{
   const response=await fetch('/api/performance/live_assist/state',{cache:'no-store'});
   if(!response.ok)return;
   const state=await response.json();
   const rows=publishedRows()||defaultRows(state);
   const version=JSON.stringify([state.version,state.updated_at,rows.map(track=>[track.title,track.artist,track.bpm,track.genre,placement(track)])]);
   if(version===shown)return;
   shown=version;
   const anchor=state.anchor||null;
   byId('mini-source').textContent=anchor&&anchor.source_label?anchor.source_label:'';
   renderNow(anchor);
   renderList(rows);
  }catch(error){}  // the next refresh tries again
 }
 async function applyPin(on,attempts=4){
  const button=byId('mini-pin');
  button.setAttribute('aria-pressed',on?'true':'false');
  try{
   const response=await fetch('/api/windows/live-assist-mini/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on})});
   const data=await response.json();
   if(!data.success&&attempts>1)setTimeout(()=>applyPin(on,attempts-1),500);  // Edge shows the title a moment after loading
  }catch(error){}
 }
 byId('mini-pin').addEventListener('click',()=>{
  const on=byId('mini-pin').getAttribute('aria-pressed')!=='true';
  try{localStorage.setItem(pinKey,on?'on':'off');}catch(error){}
  applyPin(on);
 });
 applyPin(stored());
 refresh();
 setInterval(refresh,1500);
})();
