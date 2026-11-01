(function(){
  'use strict';
  if(!['127.0.0.1','localhost','::1'].includes(window.location?.hostname))return;
  const route='/api/studio-daw/stems/cache-lease';
  let token=null,owner=null,queue=Promise.resolve();
  const keys=p=>[...new Set((p?.arrangementClips||[]).filter(c=>c.stemJob&&c.stemState==='ready').map(c=>c.stemJob))];
  const timingStale=new WeakSet();
  function reconcile(project){
    const daw=window.AxiomStudioDaw;let changed=0;
    if(!daw?.sourceBeatToSeconds||!daw?.sourceSecondsToBeat)return changed;
    for(const clip of project?.arrangementClips||[]){
      const range=clip.stemCoverage;
      if(!clip.stemJob||!range||!['ready','stale'].includes(clip.stemState))continue;
      const before=JSON.stringify([clip.stemState,clip.stemSourceStart,clip.stemPlaybackMode,clip.stemPlaybackBeforeRefresh]);
      let start=NaN,end=NaN;
      try{start=daw.sourceBeatToSeconds(clip,clip.sourceStartBeat);end=daw.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats);}catch{}
      const covered=Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Number.isFinite(range.start)&&Number.isFinite(range.end)&&range.start>=0&&range.end>range.start&&start>=range.start-1/48000&&end<=range.end+.1;
      if(covered){
        clip.stemSourceStart=daw.sourceSecondsToBeat(clip,range.start);
        // A cache discarded by export still needs backend verification first.
        if(!clip.stemCacheReleasedAfterExport&&timingStale.has(clip)){clip.stemState='ready';timingStale.delete(clip);if(clip.stemPlaybackBeforeRefresh){clip.stemPlaybackMode=clip.stemPlaybackBeforeRefresh;delete clip.stemPlaybackBeforeRefresh;}}
      }else{
        if(clip.stemState==='ready')timingStale.add(clip);
        clip.stemState='stale';
        if(clip.stemPlaybackMode!=='original'){clip.stemPlaybackBeforeRefresh=clip.stemPlaybackMode||'stems';clip.stemPlaybackMode='original';}
      }
      if(before!==JSON.stringify([clip.stemState,clip.stemSourceStart,clip.stemPlaybackMode,clip.stemPlaybackBeforeRefresh]))changed++;
    }
    return changed;
  }
  const markReleased=(project,removed)=>{
    const stale=new Set(removed||[]);
    if(!stale.size)return 0;
    let changed=0;
    for(const clip of project?.arrangementClips||[])if(stale.has(clip.stemJob)){
      clip.stemState='stale';
      clip.stemCacheReleasedAfterExport=true;
      changed++;
    }
    window.AxiomStudioDaw?.refreshStemPanel?.();
    window.AxiomStudioDaw?.refreshArrangement?.();
    return changed;
  };
  async function post(url,data,method='POST'){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Audio cache is unavailable.');
      return result;
    }finally{clearTimeout(timeout);}
  }
  async function stateOf(job){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/studio-daw/stems/'+encodeURIComponent(job),{signal:controller.signal});
      const state=await response.json();
      if(!response.ok&&response.status!==404)throw new Error(state.error||'Stem cache could not be checked.');
      return {response,state};
    }finally{clearTimeout(timeout);}
  }
  async function release(){const previous=token;token=null;owner=null;if(previous)await post(route,{token:previous},'DELETE');}
  function hold(project,options={}){
    const task=queue.then(async()=>{
      if(project!==window.AxiomStudioDaw?.activeProject)return;
      if(owner!==project)await release();
      const jobs=[];
      for(const job of keys(project)){
        if(options.excludedJobs?.has(job))continue;
        try{
          const {response,state}=await stateOf(job);
          if(response.ok&&state.state==='ready')jobs.push(job);
        }catch(error){
          if(!options.onFailure)throw error;
          for(const clip of project.arrangementClips.filter(c=>c.stemJob===job))options.onFailure(clip,error);
        }
      }
      if(!jobs.length){await release();return;}
      let result;
      try{result=await post(route,{keys:jobs,...(token?{token}:{})});}
      catch(error){if(!token)throw error;token=null;result=await post(route,{keys:jobs});}
      if(project!==window.AxiomStudioDaw?.activeProject){await post(route,{token:result.token},'DELETE');return;}
      token=result.token;owner=project;
    });
    queue=task.catch(()=>{});return task;
  }
  async function ensure(project,current=()=>project===window.AxiomStudioDaw?.activeProject,options={}){
    const required=Boolean(options.requireStems||options.forceStems||options.all||project!==window.AxiomStudioDaw?.activeProject);
    const clips=(project.arrangementClips||[]).filter(c=>c.stemJob&&(options.all||c.stemPlaybackMode!=='original'||options.forceStems||(required&&c.stemPlaybackBeforeRefresh))&&(!options.clipIds||options.clipIds.includes(c.id))&&(!options.sectionId||c.sectionId===options.sectionId)&&(options.all||!c.muted));
    if(required&&clips.some(c=>c.stemPlaybackBeforeRefresh))throw new Error('Stem refresh is incomplete. Choose Create Stems before exporting the saved stem mix.');
    const jobs=[...new Set(clips.map(c=>c.stemJob))];
    let fallbackCount=0;const failedJobs=new Set();
    const uncovered=[];
    const useOriginal=job=>{
      if(required)return;
      for(const clip of clips.filter(c=>c.stemJob===job&&['stale','failed','cancelled'].includes(c.stemState)&&c.stemPlaybackMode!=='original')){
        clip.stemPlaybackBeforeRefresh=clip.stemPlaybackMode||'stems';
        clip.stemPlaybackMode='original';fallbackCount++;
      }
    };
    for(const job of jobs){
      if(!current())throw new Error('Playback cancelled');
      let checked;
      try{checked=await stateOf(job);}catch(error){
        if(!current())throw new Error('Playback cancelled');
        if(required||!options.onFailure)throw error;
        failedJobs.add(job);
        for(const clip of clips.filter(c=>c.stemJob===job)){timingStale.delete(clip);options.onFailure(clip,error);}
        continue;
      }
      const {response,state}=checked;
      if(!current())throw new Error('Playback cancelled');
      for(const clip of clips.filter(c=>c.stemJob===job))timingStale.delete(clip);
      if(!required)for(const clip of clips.filter(c=>c.stemJob===job&&c.stemState==='processing')){
        if(!window.AxiomStems?.isProcessing?.(clip))clip.stemState='stale';
      }
      if(response.ok&&state.state==='ready'){
        for(const clip of clips.filter(c=>c.stemJob===job&&c.stemState==='ready')){
          // A ready cache can outlive a trim, grid change or recovered draft.
          // Verify the current source seconds, not just the job's existence.
          const coverage=Number.isFinite(state.sourceStart)&&Number.isFinite(state.sourceDuration)
            ? {start:state.sourceStart,end:state.sourceStart+state.sourceDuration}
            : clip.stemCoverage;
          const time=window.AxiomStudioDaw?.sourceBeatToSeconds;
          if(!coverage||!time)continue;
          const start=time(clip,clip.sourceStartBeat),end=time(clip,clip.sourceStartBeat+clip.sourceDurationBeats);
          if(start>=coverage.start-1/48000&&end<=coverage.end+.1){
            if(!required&&Number.isFinite(state.sourceStart)){clip.stemCoverage={...coverage};delete clip.stemCacheReleasedAfterExport;}
            continue;
          }
          const label=clip.label||clip.title||'This clip';
          if(required)throw new Error(`${label}: the saved stems no longer cover this clip's timing. Choose Create Stems again. Your edits and stem levels are kept.`);
          clip.stemState='stale';uncovered.push(label);
        }
        useOriginal(job);continue;
      }
      if(response.status!==404){
        if(required)throw new Error(state.error||'Stem preparation is still running.');
        // Reopened drafts can still say ready after a backend job failed or
        // was cancelled. Do not send playback to audio that no longer exists.
        for(const clip of clips.filter(c=>c.stemJob===job&&c.stemState==='ready'))
          clip.stemState=['failed','cancelled'].includes(state.state)?state.state:'stale';
        useOriginal(job);
        continue;
      }
      project.arrangementClips.filter(c=>c.stemJob===job).forEach(clip=>{clip.stemState='stale';});
      useOriginal(job);
      if(project===window.AxiomStudioDaw?.activeProject)window.AxiomStudioDaw.refreshStemPanel?.();
      if(!required)continue;
      throw new Error('Stem audio is unavailable. Choose Create Stems to regenerate it. Your saved stem levels and edits were kept.');
    }
    if(fallbackCount){
      window.AxiomStudioDaw.refreshStemPanel?.();
      window.showToast?.(uncovered.length
        ? `Saved stems no longer cover ${[...new Set(uncovered)].join(', ')}. Playing original audio temporarily; Create Stems restores your saved stem mix.`
        : 'Some stems are unavailable. Playing original audio temporarily; Create Stems restores your saved stem mix.');
    }
    if(!current())throw new Error('Playback cancelled');
    await hold(project,{excludedJobs:failedJobs,onFailure:required?undefined:options.onFailure});
    if(!current())throw new Error('Playback cancelled');
  }
  async function discardAfterExport(project){
    const jobs=keys(project);
    if(!jobs.length)return {removed:[],busy:[],missing:[],bytesFreed:0,clipsUpdated:0};
    await release();
    const result=await post('/api/studio-daw/stems/discard',{keys:jobs});
    result.clipsUpdated=markReleased(project,result.removed);
    return result;
  }
  async function maintain(){
    try{await hold(window.AxiomStudioDaw?.activeProject);}catch{return;}
    for(const kind of ['stems','stretch','plugins']){
      try{await post('/api/studio-daw/'+kind+'/cache-lease/cleanup',{});}catch{ /* Retain caches when cleanup cannot be verified. */ }
    }
  }
  window.AxiomStemCache={ensure,hold,maintain,discardAfterExport,reconcile};
  setInterval(maintain,30000);
  window.addEventListener('pagehide',()=>{if(token)fetch(route,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),keepalive:true}).catch(()=>{});token=null;});
})();
