// "Send to DJ software" (Windows): one dialog that puts a set or saved playlist into VirtualDJ, Serato and/or djay
// as a playlist/crate inside folders. Always previews first; sending needs the confirm button; an existing list is
// only replaced when its Replace box is ticked. If a program is open the write is queued (windows-dj-queue.js shows
// the waiting pill) and PEAK HOUR writes it after the program is closed.
// Reached from the sidebar Export menu ("Send to DJ software") and the saved playlist Export dialog.
(function(){
 'use strict';
 const PROGRAMS=[
  {id:'virtualdj',label:'VirtualDJ',api:'/api/windows/virtualdj/folders/'},
  {id:'serato',label:'Serato',api:'/api/windows/serato/folders/'},
  {id:'djay',label:'djay',api:'/api/windows/djay/folders/'}];
 const FORBIDDEN=/[<>:"\/\\|?*\x00-\x1f]/;
 const toast=(text,bad)=>window.showToast?.(text,bad);
 function el(tag,text,props){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(props)Object.assign(e,props);return e;}
 async function post(url,body){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return {status:response.status,ok:response.ok&&data.success!==false,data};
 }
 // "Folder / Subfolder" + playlist name -> ["Folder","Subfolder","Name"], or an error text per program.
 function parsePath(folderText,name){
  const folders=String(folderText||'').split(' / ').map(s=>s.trim()).filter(Boolean);
  const list=String(name||'').trim();
  if(!list)return {error:'Enter a playlist name.'};
  return {parts:[...folders,list]};
 }
 function checkName(program,parts){
  for(const part of parts){
   if(part.length>120)return `${program.label}: "${part.slice(0,20)}..." is too long (120 letters at most).`;
   if(program.id==='djay'){if(/[\x00-\x1f\x7f]/.test(part))return 'djay: names cannot contain control characters.';continue;}
   if(FORBIDDEN.test(part))return `${program.label}: "${part}" cannot contain < > : " / \\ | ? * (use " / " between folders).`;
   if(part.endsWith('.'))return `${program.label}: "${part}" cannot end with a dot.`;
   if(program.id==='serato'&&part.includes('%%'))return 'Serato: names cannot contain %%.';
  }
  return '';
 }
 function body(program,state,replace){
  const common={tracks:state.paths};
  if(program.id==='virtualdj')return {...common,path:state.parts,style:state.style,...(replace?{replace:true}:{})};
  if(program.id==='serato')return {...common,path_parts:state.parts,...(replace?{overwrite:true}:{})};
  return {...common,path:state.parts,...(replace?{replace:true,confirm_replace:true}:{})};
 }
 // What a preview says in plain words, and whether an existing list would be replaced.
 function describe(program,data,state){
  const name=state.parts[state.parts.length-1],where=state.parts.slice(0,-1).join(' / ');
  const into=where?` inside ${where}`:'';
  if(program.id==='virtualdj'){
   const folders=(data.folders_to_create||[]).length;
   return {exists:!!data.list_exists,
    text:data.list_exists?`A VirtualDJ list named "${name}" already exists${into}.`
     :`PEAK HOUR will create "${name}"${into} with ${data.tracks} song${data.tracks===1?'':'s'}${folders?` and ${folders} new folder${folders===1?'':'s'}`:''}.`};
  }
  if(program.id==='serato'){
   const made=(data.will_create||[]).length;
   if(data.unchanged)return {exists:false,text:`Serato already has "${name}" with these songs. Nothing to write.`};
   return {exists:!!data.leaf_exists,
    text:data.leaf_exists?`A Serato crate named "${name}" already exists${into}.`
     :`PEAK HOUR will create ${made} crate${made===1?'':'s'}${into}, ending in "${name}", with ${data.tracks} song${data.tracks===1?'':'s'}.`};
  }
  const plan=data.playlist||{},songs=data.counts?data.counts.songs:(data.songs||[]).length;
  const skipped=data.counts?data.counts.skipped:0,newFolders=data.counts?data.counts.folders_to_create:0;
  if(plan.action==='unchanged')return {exists:false,text:`djay already has "${name}" with these songs. Nothing to write.`};
  const tail=`${songs} song${songs===1?'':'s'}${skipped?` (${skipped} not in the djay library, left out)`:''}${newFolders?`, ${newFolders} new folder${newFolders===1?'':'s'}`:''}`;
  if(plan.action==='replace')return {exists:true,text:`PEAK HOUR will replace the songs of "${name}"${into} with ${tail}.`};
  const renamed=plan.final_name&&plan.final_name!==plan.name;
  return {exists:!!renamed,
   text:renamed?`A djay playlist named "${name}" already exists${into}. Without Replace, PEAK HOUR adds "${plan.final_name}" instead.`
    :`PEAK HOUR will create "${name}"${into} with ${tail}.`};
 }
// One line per program: how many songs go, how many are left out, and (to show on request) which and why.
 function summarize(program,data,said){
  const skipped=(Array.isArray(data.skipped)?data.skipped:[]).map(item=>({title:String(item.title||item.path||''),reason:String(item.reason||'')}));
  const drives=Array.isArray(data.drives)?data.drives:null;
  let count=drives?drives.reduce((total,item)=>total+Number(item.songs_to_write||0),0)
   :Number(data.songs_to_write??(program.id==='serato'?data.tracks:data.counts&&data.counts.songs)??0);
  if(data.nothing_to_send||data.unchanged)count=0;
  const unit=(n)=>`${n.toLocaleString()} song${n===1?'':'s'}`;
  let text=drives&&drives.length>1?drives.map(item=>`${Number(item.songs_to_write||0).toLocaleString()} on ${item.drive}`).join(', ')
   :count?unit(count):data.unchanged?'already there':'nothing to send';
  const notInDjay=skipped.filter(item=>/^not in djay/i.test(item.reason)).length;
  if(program.id==='djay'&&notInDjay){
   text+=`; ${notInDjay.toLocaleString()} not in djay yet`;
   if(skipped.length>notInDjay)text+=`; ${(skipped.length-notInDjay).toLocaleString()} skipped`;
  }else if(skipped.length)text+=`; ${skipped.length.toLocaleString()} skipped`;
  return {count,text,skipped};
 }
 function skippedToggle(line,skipped){
  if(!skipped.length)return;
  const list=el('ul',undefined,{className:'axiom-dj-send-skipped'});list.hidden=true;
  for(const item of skipped.slice(0,500))list.append(el('li',`${item.title} — ${item.reason}`));
  if(skipped.length>500)list.append(el('li',`...and ${skipped.length-500} more`));
  const toggle=el('button','show skipped',{type:'button',className:'axiom-dj-send-toggle'});
  toggle.onclick=()=>{list.hidden=!list.hidden;toggle.textContent=list.hidden?'show skipped':'hide skipped';};
  line.append(document.createTextNode(' '),toggle,list);
 }
 async function open(source){
  if(typeof ensureAxiomLicenseUsable==='function'&&!(await ensureAxiomLicenseUsable('Send to DJ software')))return;
  const tracks=(source&&source.tracks)||(typeof getActiveStudioOutputTracks==='function'?getActiveStudioOutputTracks():[])||[];
  const paths=tracks.map(t=>typeof t==='string'?t:t&&t.path).filter(Boolean);
  if(!paths.length){toast('Choose a set or playlist with songs first.',true);return;}
  document.getElementById('axiom-dj-send')?.remove();
  const box=el('dialog',undefined,{id:'axiom-dj-send',className:'axiom-vdj-inspect axiom-dj-send'});
  box.setAttribute('aria-labelledby','axiom-dj-send-title');
  const title=el('h2','Send to DJ software',{id:'axiom-dj-send-title'});
  const intro=el('p',`PEAK HOUR will put ${paths.length.toLocaleString()} song${paths.length===1?'':'s'} into the programs you tick, as a playlist inside folders. `+
   'Preview first. If a program is open, PEAK HOUR writes it after you close that program. Your music files are not changed.');
  const programBox=el('div',undefined,{className:'axiom-dj-send-programs'});
  const folderInput=el('input',undefined,{type:'text',id:'axiom-dj-send-folder',placeholder:'Folder / Subfolder (optional)',maxLength:400});
  folderInput.setAttribute('aria-label','Folder path, folders separated by " / "');
  const nameInput=el('input',undefined,{type:'text',id:'axiom-dj-send-name',maxLength:120,value:(source&&source.name)||`PEAK HOUR ${new Date().toISOString().slice(0,10)}`});
  nameInput.setAttribute('aria-label','Playlist name');
  const styleSelect=el('select',undefined,{id:'axiom-dj-send-style'});
  styleSelect.append(el('option','VirtualDJ: M3U playlists (recommended)',{value:'m3u'}),el('option','VirtualDJ: MyLists',{value:'mylists'}));
  styleSelect.setAttribute('aria-label','VirtualDJ list style');
  const results=el('div',undefined,{id:'axiom-dj-send-results',className:'axiom-dj-send-results'});
  results.setAttribute('role','status');
  const previewButton=el('button','Preview',{type:'button',id:'axiom-dj-send-preview'});
  const sendButton=el('button','Send',{type:'button',id:'axiom-dj-send-go',disabled:true});
  const closeButton=el('button','Close',{type:'button'});
  const actions=el('div',undefined,{className:'axiom-vdj-actions'});
  actions.append(closeButton,previewButton,sendButton);
  box.append(title,intro,programBox,el('label','Folder / Subfolder'),folderInput,el('label','Playlist name'),nameInput,styleSelect,results,actions);
  document.body.append(box);
  closeButton.onclick=()=>{box.close();box.remove();};
  box.addEventListener('cancel',()=>box.remove());
  const checks={};
  const found=await fetch('/api/windows/dj-queue/programs').then(r=>r.ok?r.json():{programs:[]}).catch(()=>({programs:[]}));
  const info=Object.fromEntries((found.programs||[]).map(p=>[p.id,p]));
  for(const program of PROGRAMS){
   const status=info[program.id]||{};
   const label=el('label');
   const check=el('input',undefined,{type:'checkbox',value:program.id,disabled:!status.installed,checked:!!status.installed});
   checks[program.id]=check;
   label.append(check,document.createTextNode(` ${program.label}${status.installed?(status.running?' (open now, will wait)':''):' (not found on this PC)'}`));
   programBox.append(label);
  }
  const syncStyle=()=>{styleSelect.hidden=!checks.virtualdj.checked||checks.virtualdj.disabled;};
  checks.virtualdj.addEventListener('change',syncStyle);syncStyle();
  let previewed=null;
  const invalidate=()=>{previewed=null;sendButton.disabled=true;};
  for(const node of [folderInput,nameInput,styleSelect,...Object.values(checks)])node.addEventListener('input',invalidate);
  function row(program,text,className){
   const line=el('div',undefined,{className:'axiom-dj-send-row '+(className||'')});
   line.dataset.program=program.id;line.append(el('strong',program.label+': '),el('span',text));
   return line;
  }
  function chosen(){return PROGRAMS.filter(p=>checks[p.id].checked&&!checks[p.id].disabled);}
  function state(){
   const parsed=parsePath(folderInput.value,nameInput.value);
   if(parsed.error){results.replaceChildren(row({id:'',label:'PEAK HOUR'},parsed.error,'axiom-dj-send-bad'));return null;}
   return {paths,parts:parsed.parts,style:styleSelect.value};
  }
  previewButton.onclick=async()=>{
   const picked=chosen(),current=state();
   results.replaceChildren();invalidate();
   if(!picked.length){results.append(row({id:'',label:'PEAK HOUR'},'Tick at least one program.','axiom-dj-send-bad'));return;}
   if(!current)return;
   previewButton.disabled=true;
   const plans=[];
   for(const program of picked){
    const problem=checkName(program,current.parts);
    if(problem){results.append(row(program,problem,'axiom-dj-send-bad'));continue;}
    try{
     const reply=await post(program.api+'preview',body(program,current,false));
     if(!reply.ok){results.append(row(program,reply.data.error||'Preview failed.','axiom-dj-send-bad'));continue;}
     const said=describe(program,reply.data,current);
     const sum=summarize(program,reply.data,said);
     const line=row(program,sum.text);
     if(sum.count<1){
      line.append(el('small',` ${program.label} has nothing to send, so PEAK HOUR leaves it out.`));
      skippedToggle(line,sum.skipped);results.append(line);continue;
     }
     line.append(el('div',said.text,{className:'axiom-dj-send-detail'}));
     let replace=null;
     if(said.exists){
      const label=el('label',undefined,{className:'axiom-dj-send-replace'});
      replace=el('input',undefined,{type:'checkbox'});
      label.append(replace,document.createTextNode(` Replace the existing one in ${program.label} (PEAK HOUR keeps a backup)`));
      line.append(label);
     }
     skippedToggle(line,sum.skipped);
     results.append(line);plans.push({program,replace});
    }catch(error){results.append(row(program,error.message,'axiom-dj-send-bad'));}
   }
   previewButton.disabled=false;
   if(plans.length){previewed={plans,state:current};sendButton.disabled=false;}
  };
  sendButton.onclick=async()=>{
   if(!previewed)return;
   const {plans,state:current}=previewed;
   sendButton.disabled=true;previewButton.disabled=true;results.replaceChildren();
   for(const {program,replace} of plans){
    try{
     const reply=await post(program.api+'apply',{...body(program,current,!!(replace&&replace.checked)),confirm:true});
     if(reply.status===202&&reply.data.queued){
      results.append(row(program,`Queued until ${program.label} closes. ${reply.data.message||''}`,'axiom-dj-send-queued'));
      toast(reply.data.message||`${program.label} is open — PEAK HOUR will write this after you close it.`);
     }else if(reply.ok){
      const done=row(program,reply.data.message||`Written to ${program.label}.`,'axiom-dj-send-done');
      const backupId=reply.data.backup_id;
      if(backupId){
       done.append(el('small',` Undo id: ${backupId} `));
       const undo=el('button','Undo',{type:'button',className:'axiom-dj-send-undo'});
       undo.title=`Put ${program.label} back the way it was before this write (close ${program.label} first).`;
       undo.onclick=async()=>{
        undo.disabled=true;
        try{
         const back=await post(program.api+'undo',{backup_id:backupId});
         if(!back.ok)throw new Error(back.data.error||'Could not undo.');
         undo.remove();done.append(el('small',' Undone.'));toast(`${program.label} restored. PEAK HOUR undid this write.`);
        }catch(error){undo.disabled=false;toast(error.message,true);}
       };
       done.append(undo);
      }
      results.append(done);
      toast(`Written to ${program.label}. PEAK HOUR kept a backup.`);
     }else{
      results.append(row(program,reply.data.error||'Could not write.','axiom-dj-send-bad'));
     }
    }catch(error){results.append(row(program,error.message,'axiom-dj-send-bad'));}
   }
   previewButton.disabled=false;previewed=null;
  };
  box.showModal();
  nameInput.select();
 }
 function addSidebarItem(){
  const anchor=document.getElementById('sidebar-export-virtualdj')||document.querySelector('[onclick="openSidebarExport(\'djay\')"]');
  if(!anchor||document.getElementById('sidebar-export-dj-send'))return;
  const item=el('button');item.type='button';item.id='sidebar-export-dj-send';item.className=anchor.className.replace('is-featured','').trim();
  item.setAttribute('role','menuitem');item.setAttribute('aria-label','Send to DJ software');
  const brand=el('span','Send to DJ software',{className:'sidebar-export-brand text-primary-contrast'});brand.style.fontWeight='900';
  item.append(brand,el('small','Folders into VirtualDJ, Serato, djay'));
  item.onclick=()=>{if(typeof closeSidebarDropdowns==='function')closeSidebarDropdowns();open(null);};
  anchor.after(item);
 }
 function wrapPlaylistExport(){
  if(typeof window.exportSavedPlaylist!=='function'||window.exportSavedPlaylist.djsend)return;
  const original=window.exportSavedPlaylist;
  const wrapped=function(id){
   const result=original.apply(this,arguments);
   const sets=typeof savedPlaylists!=='undefined'?savedPlaylists:[];
   const set=sets.find(item=>item.id===id);
   const actions=document.querySelector('.playlist-export-choice [data-export-target="djay"]')?.parentElement;
   if(set&&actions&&!actions.querySelector('[data-export-target="dj-send"]')){
    const button=el('button','Send to DJ software',{type:'button',className:'axiom-dialog-btn'});button.dataset.exportTarget='dj-send';
    button.addEventListener('click',e=>{e.stopImmediatePropagation();if(typeof closeAxiomDialog==='function')closeAxiomDialog();
     open(JSON.parse(JSON.stringify({tracks:set.tracks,name:set.name})));},true);
    actions.append(button);
   }
   return result;
  };
  wrapped.virtualdj=window.exportSavedPlaylist.virtualdj;wrapped.djsend=true;window.exportSavedPlaylist=wrapped;
 }
 const attach=()=>{addSidebarItem();wrapPlaylistExport();};
 new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
 attach();
 window.AxiomDJSend={open,parsePath,checkName};
})();
