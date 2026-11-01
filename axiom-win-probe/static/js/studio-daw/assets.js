(function(){
  'use strict';
  const identity=value=>value&&/^[a-f0-9]{64}$/.test(value.sha256)&&Number.isSafeInteger(value.size)&&value.size>=0;
  const tracks=p=>[p.sourceTrack,...(p.sourceTracks||[]),...(p.arrangementClips||[]),...(p.arrangementClips||[]).map(c=>c.frozenClip?.original),...Object.values(p.drumSamples||{}),...(p.fxRegions||[]).map(f=>f.sweepSource)].filter(t=>t?.path);
  const snapshotOf=p=>JSON.stringify({...p,localDraftId:undefined});
  async function inspect(paths){
    const assets=[];
    for(let i=0;i<paths.length;i+=32){
      const response=await fetch('/api/studio-daw/assets/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:paths.slice(i,i+32)})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Audio check failed.');
      if(!Array.isArray(data.assets))throw new Error('Invalid audio check response.');
      assets.push(...data.assets);
    }
    return assets;
  }
  async function capture(p){
    const paths=[...new Set(tracks(p).map(t=>t.path))],before=JSON.stringify(p.assetIdentities||{});
    const results=await inspect(paths);
    if(p!==window.AxiomStudioDaw.activeProject||JSON.stringify(p.assetIdentities||{})!==before||JSON.stringify(paths)!==JSON.stringify([...new Set(tracks(p).map(t=>t.path))]))throw new Error('Project changed during the audio check. Try again.');
    const known={...p.assetIdentities};
    for(const asset of results){
      if(asset.status!=='ready')continue;
      if(!identity(asset))throw new Error('Invalid audio fingerprint.');
      if(known[asset.path]&&(known[asset.path].sha256!==asset.sha256||known[asset.path].size!==asset.size))asset.status='changed';
      else known[asset.path]={sha256:asset.sha256,size:asset.size};
    }
    p.assetIdentities=known;return results;
  }
  async function recoverStems(p,oldPath,path){
    const ids=[...new Set(tracks(p).filter(t=>t.path===oldPath&&t.stemJob).map(t=>t.stemJob))],ready=new Map();
    for(let i=0;i<ids.length;i+=32){
      const jobs=ids.slice(i,i+32);
      try{
        const response=await fetch('/api/studio-daw/stems/relink',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oldPath,path,jobs})}),data=await response.json();
        if(!response.ok||!Array.isArray(data.jobs))continue;
        for(const item of data.jobs)if(jobs.includes(item.previousId)&&item.state==='ready'&&typeof item.id==='string'&&/^(?:[a-f0-9]{64}|browser-[a-f0-9-]{36})$/.test(item.id))ready.set(item.previousId,item.id);
      }catch{}
    }
    return ready;
  }
  function recoveredMessage(p){
    const ready=new Set(tracks(p).filter(t=>t.stemState==='ready'&&t.stemJob).map(t=>t.stemJob)).size;
    const failed=tracks(p).some(t=>t.stemState==='failed');
    return 'Audio relinked in a separate recovered draft.'+(ready?` ${ready} verified stem set${ready===1?'':'s'} preserved.`:'')+(failed?' Some stems remain unavailable. Restore a portable stem backup or regenerate them in the desktop app.':'');
  }
  async function relink(p,oldPath,newPath,current=()=>true){
    const expected=p.assetIdentities?.[oldPath];
    if(!identity(expected))throw new Error('No saved fingerprint for this source. Restore the original location and check audio before relinking.');
    const snapshot=snapshotOf(p),[asset]=await inspect([newPath]);
    if(asset?.status!=='ready'||asset.sha256!==expected.sha256||asset.size!==expected.size)throw new Error('That file does not match the saved original. No clips were changed.');
    if(!current()||p!==window.AxiomStudioDaw.activeProject||snapshotOf(p)!==snapshot)throw new Error('Project changed during verification. Try again.');
    const stems=await recoverStems(p,oldPath,newPath);
    if(!current()||p!==window.AxiomStudioDaw.activeProject||snapshotOf(p)!==snapshot)throw new Error('Project changed during stem verification. Try again.');
    const next=JSON.parse(snapshot);delete next.localDraftId;
    let count=0;
    for(const track of tracks(next))if(track.path===oldPath){
      track.path=newPath;track.assetIdentity={...expected};
      if(track.beatgrid)track.beatgrid.trackPath=newPath;
      if(track.stemJob){
        if(stems.has(track.stemJob)){track.stemJob=stems.get(track.stemJob);track.stemState='ready';}
        else{delete track.stemJob;delete track.stemSourceStart;track.stemState='failed';}
      }
      count++;
    }
    if(!count)throw new Error('This source is no longer in the project.');
    delete next.assetIdentities[oldPath];next.assetIdentities[newPath]={...expected};
    if(next.anchorPath===oldPath)next.anchorPath=newPath;
    if(!await window.AxiomDawDrafts.checkpoint())throw new Error('Current project recovery could not be saved.');
    if(await window.AxiomStudioDaw.restoreProject(next)===false)throw new Error('Relinked project could not be opened.');
    window.AxiomDawDrafts.checkpoint();
    return next;
  }
  async function relinkFile(p,oldPath,file,current=()=>true){
    const expected=p.assetIdentities?.[oldPath],snapshot=snapshotOf(p);
    if(!identity(expected))throw new Error('No saved fingerprint for this source. Restore the original location and check audio before relinking.');
    if(!window.AxiomBrowserAudio?.withVerifiedSource)throw new Error('File recovery is unavailable in this browser.');
    return window.AxiomBrowserAudio.withVerifiedSource(file,{...expected},path=>{
      if(!current()||p!==window.AxiomStudioDaw.activeProject||snapshotOf(p)!==snapshot)throw new Error('Project changed or recovery was closed during verification. No clips were changed.');
      return relink(p,oldPath,path,current);
    });
  }
  async function open(){
    const p=window.AxiomStudioDaw?.activeProject;if(!p)return;
    document.getElementById('daw-assets-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='daw-assets-dialog';dialog.setAttribute('aria-label','Project Audio');
    dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:20px;border-radius:6px;width:640px;max-width:94vw;max-height:85vh;overflow:auto';
    const title=document.createElement('h2');title.textContent='Project Audio';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Checking audio...';
    const list=document.createElement('div'),close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.remove();
    dialog.append(title,status,list,close);document.body.append(dialog);dialog.showModal();
    try{
      const results=await capture(p);if(!dialog.isConnected)return;
      window.AxiomDawDrafts.checkpoint();
      status.textContent=`${results.filter(a=>a.status==='ready').length} available / ${results.length} audio files`;
      for(const asset of results){
        const row=document.createElement('div');row.style.cssText='border-top:1px solid #525852;padding:12px 0;overflow-wrap:anywhere';
        const name=document.createElement('p');name.textContent=asset.path;
        const state=document.createElement('output');state.textContent=asset.status==='changed'?'Changed since save':asset.status;
        row.append(name,state);
        if(asset.status!=='ready'){
          const button=document.createElement('button');button.textContent='Locate';button.style.cssText='margin-left:12px;background:var(--accent);color:#071005;padding:4px 12px';
          button.disabled=!identity(p.assetIdentities?.[asset.path]);
          button.title=button.disabled?'No original fingerprint is stored in this legacy project.':'Locate the unchanged original file';
          button.onclick=()=>{
            if(window.AxiomBrowserAudio?.withVerifiedSource){
              const picker=document.createElement('input');picker.type='file';picker.accept='.mp3,.mp4,.m4a,.wav,.aiff,.flac,.aac';
              picker.onchange=async()=>{
                const file=picker.files?.[0];if(!file)return;
                button.disabled=true;status.textContent='Verifying replacement audio...';
                try{
                  const next=await relinkFile(p,asset.path,file,()=>dialog.isConnected&&dialog.open);
                  dialog.remove();window.showToast?.(recoveredMessage(next));
                }catch(error){status.textContent=error.message;button.disabled=false;}
              };
              picker.click();return;
            }
            const input=document.createElement('input');input.placeholder='Finder path';input.setAttribute('aria-label','Replacement audio path');input.style.cssText='width:100%;box-sizing:border-box;background:#252925;color:#eee;margin:8px 0';
            const apply=document.createElement('button');apply.textContent='Verify and Relink';
            apply.onclick=async()=>{
              apply.disabled=true;
              try{const next=await relink(p,asset.path,input.value.trim(),()=>dialog.isConnected&&dialog.open);dialog.remove();window.showToast?.(recoveredMessage(next));}
              catch(error){status.textContent=error.message;apply.disabled=false;}
            };
            button.disabled=true;row.append(input,apply);input.focus();
          };row.append(button);
        }list.append(row);
      }
    }catch(error){status.textContent=error.message;}
  }
  let bundling=false;
  async function exportBundle(button){
    if(bundling)return;
    const p=window.AxiomStudioDaw.activeProject;if(!p)return;
    const buttonLabel=button?.textContent;
    bundling=true;if(button){button.disabled=true;button.textContent='Preparing portable project...';}window.showToast?.('Preparing portable project with audio and stems...');
    try{
      await window.AxiomStemCache?.ensure(p,()=>p===window.AxiomStudioDaw.activeProject,{all:true});
      if(p!==window.AxiomStudioDaw.activeProject)throw new Error('The active project changed. Export the current project again.');
      const snapshot=window.AxiomDawDrafts.serialize(p);
      if(window.AxiomBrowserBundle){
        const blob=await window.AxiomBrowserBundle.exportProject(JSON.parse(snapshot).project),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='AXIOM Project.axiom.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
        window.showToast?.('Portable project ready with browser audio copies.');return;
      }
      const response=await fetch('/api/studio-daw/project/bundle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(JSON.parse(snapshot).project)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Bundle failed.');
      if(typeof data.url!=='string'||!/^\/api\/studio-daw\/project\/bundle\/tmp[a-z0-9_-]+\.zip$/.test(data.url))throw new Error('Invalid bundle download.');
      const link=document.createElement('a');link.href=data.url;link.download='AXIOM Project.axiom.zip';document.body.append(link);link.click();link.remove();
      window.showToast?.('Portable project ready. It contains the snapshot taken when export started.');
    }catch(error){window.showToast?.(error.message,true);}finally{bundling=false;if(button){button.disabled=false;button.textContent=buttonLabel;}}
  }
  function openBundle(){
    const input=document.createElement('input');input.type='file';input.accept='.axiom.zip,.zip';
    input.onchange=async()=>{
      const file=input.files?.[0];if(!file)return;
      // Autosave may assign a draft ID during a long restore; that is not an edit.
      const p=window.AxiomStudioDaw.activeProject,snapshot=snapshotOf(p);
      window.showToast?.('Verifying and restoring portable audio...');
      try{
        const form=new FormData();form.append('file',file);
        let data;
        if(window.AxiomBrowserBundle)data={record:await window.AxiomBrowserBundle.importProject(file)};
        else{const response=await fetch('/api/studio-daw/project/unbundle',{method:'POST',body:form});data=await response.json();if(!response.ok)throw new Error(data.error||'Portable project could not open.');}
        if(p!==window.AxiomStudioDaw.activeProject||snapshotOf(p)!==snapshot)throw new Error('The current project changed while restoring. Open the bundle again when edits are finished.');
        await window.AxiomDawDrafts.importText(JSON.stringify(data.record));document.getElementById('daw-draft-dialog')?.remove();
        window.showToast?.('Portable project opened with independent audio and stem copies.');
      }catch(error){window.showToast?.(error.message,true);}
    };input.click();
  }
  window.AxiomDawAssets={capture,relink,relinkFile,open,exportBundle,openBundle};
})();
