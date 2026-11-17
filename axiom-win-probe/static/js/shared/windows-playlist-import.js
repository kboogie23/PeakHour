// Playlists > Import Playlist (Windows). "Import Sets" only reads PEAK HOUR's own .json backups; this adds a button (and
// drag and drop) for ordinary playlist files: .m3u .m3u8 .pls .txt .csv, Rekordbox .xml, Serato .crate, VirtualDJ .vdjfolder.
// The server (windows_playlist_import.py) reads the file and matches its songs to the library; nothing is written there.
// The sets are saved in the browser with the page's own upsertSavedPlaylist (the same place Import Sets saves to).
// playlists.html and playlists.js are shared with macOS and are not edited.
(() => {
 'use strict';
 const ROUTE='/api/windows/playlists/import';
 const MAX_SET_SONGS=3000;
 let busy=false, blocks=[], working='';

 function toast(message,isError){if(typeof showToast==='function')showToast(message,Boolean(isError))}
 function tab(){return document.getElementById('tab-content-playlists')}
 function fileInput(){return document.getElementById('ph-playlist-import-input')}
 function plural(count,one,many){return `${count.toLocaleString()} ${count===1?one:many}`}

 function ensureControls(){
  const host=tab();
  if(!host)return;
  if(!fileInput()){
   const input=document.createElement('input');
   input.id='ph-playlist-import-input';input.type='file';input.multiple=true;input.hidden=true;
   input.accept='.m3u,.m3u8,.pls,.txt,.csv,.xml,.crate,.vdjfolder,.json';
   input.setAttribute('aria-label','Choose playlist files');
   input.addEventListener('change',()=>{
    const files=Array.from(input.files||[]);
    input.value='';
    if(files.length)run(files);
   });
   document.body.appendChild(input);
  }
  if(document.getElementById('ph-playlist-import-btn'))return;
  const actions=host.querySelector('.playlist-toolbar-actions');
  const neighbour=actions&&Array.from(actions.querySelectorAll('button')).find(b=>/importPlaylistFiles\s*\(/.test(b.getAttribute('onclick')||''));
  if(!neighbour)return;
  const button=document.createElement('button');
  button.id='ph-playlist-import-btn';button.type='button';button.textContent='Import Playlist';
  button.className=neighbour.className.split(/\s+/).filter(name=>name&&name!=='transition-all').join(' ');
  button.addEventListener('click',()=>{
   if(guest())return toast('Sign in to save playlists.',true);
   const input=fileInput();
   if(input)input.click();
  });
  neighbour.insertAdjacentElement('afterend',button);
 }

 function guest(){return window.AXIOM_ACCESS_CONTEXT&&window.AXIOM_ACCESS_CONTEXT.mode==='guest'}

 // ---- result panel (everything is built with textContent; file content never goes through innerHTML)
 function panel(){
  let node=document.getElementById('ph-playlist-import-result');
  if(node)return node;
  const host=tab();
  if(!host)return null;
  node=document.createElement('section');
  node.id='ph-playlist-import-result';node.setAttribute('role','status');node.setAttribute('aria-live','polite');
  const body=document.createElement('div');body.className='ph-pi-body';
  const close=document.createElement('button');close.type='button';close.className='ph-pi-close';close.textContent='Close';
  close.addEventListener('click',()=>{blocks=[];working='';if(node.parentNode)node.parentNode.removeChild(node)});
  node.append(body,close);
  const shell=host.querySelector('.playlists-shell');
  if(shell&&shell.parentNode===host)host.insertBefore(node,shell);else host.appendChild(node);
  return node;
 }
 function line(text,className){
  const p=document.createElement('p');p.className='ph-pi-line'+(className?' '+className:'');p.textContent=text;return p;
 }
 function render(){
  const node=panel();
  if(!node)return;
  const body=node.querySelector('.ph-pi-body');
  body.textContent='';
  blocks.forEach(block=>body.append(...block));
  if(working)body.appendChild(line(working,'is-working'));
 }
 // Songs found in the library. The server returns at most 3,001 rows of a big playlist and says the full count in matched_total.
 function matchedCount(item,fallback){
  if(!item)return fallback;
  const full=Number(item.matched_total);
  return Number.isFinite(full)&&full>=0?full:(item.tracks||[]).length;
 }
 function resultBlock(name,saved,total,item){
  const parts=[line(`Imported '${name}': ${saved.toLocaleString()} of ${total.toLocaleString()} songs.`)];
  const matched=matchedCount(item,saved);
  if(matched>saved)parts.push(line(`${plural(matched-saved,'repeated song was','repeated songs were')} saved once.`,'ph-pi-sub'));
  const missing=item?item.unmatched_total:0;
  if(missing){
   parts.push(line(`${missing.toLocaleString()} ${missing===1?'was':'were'} not found in your library:`,'ph-pi-sub'));
   const details=document.createElement('details');details.open=true;
   const summary=document.createElement('summary');summary.textContent='Songs not found';
   const list=document.createElement('ul');
   item.unmatched.forEach(entry=>{const li=document.createElement('li');li.textContent=`${entry.line} — ${entry.reason}`;list.appendChild(li)});
   details.append(summary,list);
   if(missing>item.unmatched.length){
    const more=document.createElement('li');more.textContent=`and ${(missing-item.unmatched.length).toLocaleString()} more`;list.appendChild(more);
   }
   parts.push(details);
  }
  return parts;
 }

 // ---- saving
 function uniqueName(name){
  loadSavedPlaylists();
  const taken=new Set((typeof savedPlaylists!=='undefined'&&Array.isArray(savedPlaylists)?savedPlaylists:[]).map(set=>String(set&&set.name||'').trim().toLowerCase()));
  if(!taken.has(name.toLowerCase()))return name;
  for(let n=2;;n++){const candidate=`${name} (${n})`;if(!taken.has(candidate.toLowerCase()))return candidate}
 }
 function saveFailure(error){
  if(error&&(error.name==='QuotaExceededError'||/quota/i.test(String(error.message))))return 'the browser has no room left to store it. Delete a set you no longer need and try again.';
  return String(error&&error.message||'something went wrong while saving.').replace(/\s+/g,' ').trim();
 }
 // One returned playlist -> the lines for the panel; saves it unless it is empty or too big for a set.
 function keep(name,tracks,total,item){
  if(!tracks.length)return [line(total?`'${name}' was not imported: none of its ${total.toLocaleString()} songs are in your PEAK HOUR library. Add the music first (Library), then import again.`:`'${name}' was not imported: it has no songs.`,'is-problem')];
  const matched=matchedCount(item,tracks.length);
  if(matched>MAX_SET_SONGS||tracks.length>MAX_SET_SONGS)return [line(`'${name}' has ${Math.max(matched,tracks.length).toLocaleString()} songs. PEAK HOUR saves sets of up to ${MAX_SET_SONGS.toLocaleString()} songs; split it in your DJ software and import the parts.`,'is-problem')];
  const finalName=uniqueName(name);
  try{
   const record=upsertSavedPlaylist(finalName,tracks,{forceNew:true,setBrief:{}});  // an empty brief opens as the default one; the brief open on the page is not copied into an imported set
   if(!record)return [line(`'${name}' could not be saved: it has no songs PEAK HOUR can store.`,'is-problem')];
   return resultBlock(record.name,record.tracks.length,total,item);
  }catch(error){
   try{loadSavedPlaylists();refreshPlaylistsView()}catch(_){}
   return [line(`'${name}' could not be saved: ${saveFailure(error)}`,'is-problem')];
  }
 }

 function nameOf(file){return String(file.name||'playlist').replace(/\.[^.]*$/,'').slice(0,120)||'Imported playlist'}
 function readText(file){
  return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(String(reader.result));
   reader.onerror=()=>reject(new Error('read'));
   reader.readAsText(file);
  });
 }

 async function importOne(file){
  if(/\.json$/i.test(file.name)){
   let parsed;
   try{parsed=JSON.parse(await readText(file))}catch(_){return [line(`'${file.name}': This file could not be read as a PEAK HOUR set backup.`,'is-problem')]}
   const tracks=Array.isArray(parsed)?parsed:(parsed&&Array.isArray(parsed.tracks)?parsed.tracks:null);
   if(!tracks)return [line(`'${file.name}': This file could not be read as a PEAK HOUR set backup.`,'is-problem')];
   const clean=tracks.filter(track=>track&&typeof track==='object');
   return keep(nameOf(file),clean,clean.length,null);
  }
  const form=new FormData();
  form.append('file',file,file.name);
  let data;
  try{
   const response=await fetch(ROUTE,{method:'POST',body:form});
   data=await response.json().catch(()=>null);
   if(!data||!data.success)return [line(`'${file.name}': ${data&&data.error?data.error:'PEAK HOUR could not import this file.'}`,'is-problem')];
  }catch(_){return [line(`'${file.name}': PEAK HOUR could not be reached. Check that it is still running and try again.`,'is-problem')]}
  const out=[];
  (data.playlists||[]).forEach(item=>out.push(...keep(String(item.name||nameOf(file)),item.tracks||[],item.total||0,item)));
  if(data.skipped_playlists)out.push(line(`${plural(data.skipped_playlists,'more playlist in this file was','more playlists in this file were')} not imported (limit 25 per file).`,'is-problem'));
  return out;
 }

 async function run(fileList){
  const files=Array.from(fileList||[]);
  if(!files.length)return;
  if(guest())return toast('Sign in to save playlists.',true);
  if(busy)return toast('An import is already running.',true);
  busy=true;blocks=[];
  try{
   for(const file of files){
    working=`Importing '${file.name}'…`;render();
    let block;
    try{block=await importOne(file)}catch(error){block=[line(`'${file.name}': PEAK HOUR could not import this file.`,'is-problem')]}
    blocks.push(block);
   }
  }finally{
   working='';busy=false;render();
  }
 }

 // ---- drag and drop on the Playlists page
 function wireDrop(){
  const host=tab();
  if(!host||host.dataset.phDropWired)return;
  host.dataset.phDropWired='1';
  const hasFiles=event=>Boolean(event.dataTransfer&&Array.from(event.dataTransfer.types||[]).includes('Files'));
  host.addEventListener('dragover',event=>{if(!hasFiles(event))return;event.preventDefault();host.classList.add('ph-drop')});
  host.addEventListener('dragleave',event=>{if(!event.relatedTarget||!host.contains(event.relatedTarget))host.classList.remove('ph-drop')});
  host.addEventListener('drop',event=>{
   host.classList.remove('ph-drop');
   if(!hasFiles(event))return;
   event.preventDefault();
   run(event.dataTransfer.files);
  });
 }

 function start(){ensureControls();wireDrop()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
