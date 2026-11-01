(function () {
  'use strict';
  const names = ['vocals','other','bass','drums'];
  const operations = new Map();
  let warmupPending = null;
  let lastWarmup = -Infinity;
  function warmup() {
    if(document.body?.classList.contains('performance-mode-active'))return Promise.resolve();
    if(warmupPending)return warmupPending;
    if(Date.now()-lastWarmup<30000)return Promise.resolve();
    lastWarmup=Date.now();
    warmupPending=fetch('/api/studio-daw/stems/warmup',{method:'POST'})
      .then(response=>{if(!response.ok)lastWarmup=-Infinity;})
      .catch(()=>{lastWarmup=-Infinity;})
      .finally(()=>{warmupPending=null;});
    return warmupPending;
  }
  const mergeCoverage=(a,b)=>!a?b:!b?a:{start:Math.min(a.start,b.start),end:Math.max(a.end,b.end)};
  function currentCoverage(clip) {
    const start=window.AxiomStudioDaw.sourceBeatToSeconds?window.AxiomStudioDaw.sourceBeatToSeconds(clip,clip.sourceStartBeat):clip.sourceStartBeat*60/clip.bpm;
    const end=window.AxiomStudioDaw.sourceBeatToSeconds?window.AxiomStudioDaw.sourceBeatToSeconds(clip,clip.sourceStartBeat+clip.sourceDurationBeats):(clip.sourceStartBeat+clip.sourceDurationBeats)*60/clip.bpm;
    return Number.isFinite(start)&&Number.isFinite(end)?{start:Math.min(start,end),end:Math.max(start,end)}:null;
  }
  function beatFromSeconds(clip,seconds) {
    return window.AxiomStudioDaw.sourceSecondsToBeat?window.AxiomStudioDaw.sourceSecondsToBeat(clip,seconds):seconds*(clip.bpm||120)/60;
  }
  function rememberAutoRefresh(project,clip,coverage=null) {
    const group=clip.stemJob?(project?.arrangementClips||[]).filter(item=>item.path===clip.path&&item.stemJob===clip.stemJob):[clip];
    for(const item of group.length?group:[clip]){
      item.stemAutoRefreshQueued=true;
      const next=mergeCoverage(coverage,currentCoverage(item));
      if(next)item.stemAutoRefreshCoverage=mergeCoverage(item.stemAutoRefreshCoverage,next);
    }
  }
  function queuedCoverage(items) {
    return items.reduce((coverage,item)=>mergeCoverage(coverage,mergeCoverage(item.stemAutoRefreshCoverage,currentCoverage(item))),null);
  }
  function stop() {
    window.AxiomArrangement?.stopStemPreview?.();
  }
  function updateProgress(operation,data={}) {
    operation.progress={
      phase:String(data.phase||data.state||'starting'),
      mode:String(data.processing_mode||'checking'),
      detail:String(data.status_detail||'Starting the local stem engine.'),
      elapsedSeconds:Math.max(0,Number(data.elapsed_seconds)||0),
      fallback:Boolean(data.device_fallback),
    };
    window.AxiomStudioDaw.refreshStemPanel({progressOnly:true});
  }
  async function sendCancel(operation) {
    if (!operation.id || operation.cancelling) return operation.cancelling;
    operation.cancelling=(async()=>{
      try {
        const response=await fetch(`/api/studio-daw/stems/${operation.id}/cancel`,{method:'POST'});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error || 'Could not cancel separation.');
        return data;
      } catch(error) {
        operation.cancelRequested=false;
        operation.related().forEach(item=>{delete item.stemCancelRequested;});
        showToast(error.message || 'Could not cancel separation. Please retry.',true);
      } finally {
        operation.cancelling=null;
        window.AxiomStudioDaw.refreshStemPanel();
      }
    })();
    return operation.cancelling;
  }
  async function cancel(clip) {
    const operation=operations.get(clip.stemRequestKey);
    if(!operation || operation.cancelRequested)return false;
    operation.cancelRequested=true;
    operation.related().forEach(item=>{item.stemCancelRequested=true;});
    window.AxiomStudioDaw.refreshStemPanel();
    await sendCancel(operation);
    return true;
  }
  async function request(clip,options={}) {
    const project=options.project||window.AxiomStudioDaw.activeProject;
    if(!project?.arrangementClips?.includes(clip))throw new Error('The clip is no longer in this project.');
    if(options.autoRefresh)rememberAutoRefresh(project,clip,options.coverage);
    if (clip.stemState==='processing') return;
    const requestKey=`${Date.now()}-${Math.random()}`;
    clip.stemRequestKey=requestKey;
    if(options.restoreJob)for(const item of project.arrangementClips.filter(c=>c.path===clip.path&&c.stemJob===options.restoreJob)){item.stemRequestKey=requestKey;item.stemState='processing';}
    delete clip.stemCancelRequested;
    const related=()=> (project?.arrangementClips || []).filter(item=>item.stemRequestKey===requestKey);
    // A range refresh includes split siblings. Keep the entire group playable
    // until its new coverage is ready, without losing any saved stem choices.
    if(options.autoRefresh)for(const item of related())if(item.stemPlaybackMode!=='original'){
      item.stemPlaybackBeforeRefresh=item.stemPlaybackMode||'stems';
      item.stemPlaybackMode='original';
    }
    const operation={related,id:null,cancelRequested:false,cancelling:null};
    operations.set(requestKey,operation);
    clip.stemState='processing'; window.AxiomStudioDaw.refreshStemPanel();
    try {
      const time=beat=>window.AxiomStudioDaw.sourceBeatToSeconds ? window.AxiomStudioDaw.sourceBeatToSeconds(clip,beat) : beat*60/clip.bpm;
      const start=options.coverage?.start??(options.fullSource?0:time(clip.sourceStartBeat)),duration=options.coverage?options.coverage.end-start:options.fullSource?Number(clip.durationSec||clip.duration):time(clip.sourceStartBeat+clip.sourceDurationBeats)-start;
      const coverage={start,end:start+duration};
      const response = await fetch('/api/studio-daw/stems',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:clip.path,start:Math.max(0,start),duration,reuseExisting:true,...(options.fullSource?{fullSource:true}:{})})});
      let data = await response.json();
      if(!response.ok) {
        const build=data.identity?.build;
        throw new Error((data.error||'Stem separation could not start.')+(build?` Installed build: ${build}.`:''));
      }
      const id = data.id;
      operation.id=id;
      updateProgress(operation,data);
      if(operation.cancelRequested)await sendCancel(operation);
      let pollDelay=100;
      while(['queued','processing','cancelling'].includes(data.state)) {
        if(options.current&&!options.current()&&!operation.cancelRequested){operation.cancelRequested=true;await sendCancel(operation);}
        await new Promise(resolve=>setTimeout(resolve,pollDelay));
        pollDelay=Math.min(500,pollDelay*2);
        const status = await fetch(`/api/studio-daw/stems/${id}`);
        data=await status.json();
        if(!status.ok) throw new Error(data.error);
        updateProgress(operation,data);
      }
      if(data.state==='cancelled') {
        related().forEach(item=>{item.stemState='cancelled';});
        showToast('Stem separation cancelled.');
        return;
      }
      if(data.state!=='ready') throw new Error(data.error || 'Stem separation failed');
      if(Number.isFinite(data.sourceStart)&&Number.isFinite(data.sourceDuration)&&data.sourceStart>=0&&data.sourceDuration>0&&data.sourceStart<=start+1e-6&&data.sourceStart+data.sourceDuration>=coverage.end-1e-6){
        coverage.start=data.sourceStart;coverage.end=data.sourceStart+data.sourceDuration;
      }
      if(options.fullSource&&Number.isFinite(data.sourceDuration))coverage.end=coverage.start+data.sourceDuration;
      let autoRefreshItems=[];
      related().forEach(item=>{
        item.stemJob=id;item.stemSourceStart=beatFromSeconds(item,coverage.start);item.stemCoverage={...coverage};item.stemRecipe={start:coverage.start,duration:coverage.end-coverage.start};
        const seconds=beat=>window.AxiomStudioDaw.sourceBeatToSeconds?window.AxiomStudioDaw.sourceBeatToSeconds(item,beat):beat*60/item.bpm;
        item.stemState=seconds(item.sourceStartBeat)>=coverage.start-1e-6&&seconds(item.sourceStartBeat+item.sourceDurationBeats)<=coverage.end+(options.fullSource?.1:1e-6)?'ready':'stale';
        if(item.stemState==='ready'){
          if(item.stemPlaybackBeforeRefresh)item.stemPlaybackMode=item.stemPlaybackBeforeRefresh;
          delete item.stemPlaybackBeforeRefresh;delete item.stemAutoRefreshQueued;delete item.stemAutoRefreshCoverage;delete item.stemAutoRefreshAttempts;
        }else if(options.autoRefresh||item.stemAutoRefreshQueued)autoRefreshItems.push(item);
      });
      await window.AxiomStemCache?.hold(project);
      if(autoRefreshItems.length){
        const target=autoRefreshItems[0],attempt=Math.max(0,...autoRefreshItems.map(item=>item.stemAutoRefreshAttempts||0))+1;
        autoRefreshItems.forEach(item=>{item.stemAutoRefreshAttempts=attempt;});
        if(attempt<=3){
          showToast('Clip changed while stems were refreshing. Updating stems for the latest range.');
          await request(target,{autoRefresh:true,restoreJob:id,coverage:queuedCoverage(autoRefreshItems),current:options.current,project});
          return;
        }
      }
      if(related().length){
        const mode=operation.progress?.mode==='mps'?'GPU/MPS':operation.progress?.mode==='cpu'?'CPU':'';
        showToast(related().some(item=>item.stemState==='stale')?'Clip extended. Choose Create Stems again when you want to refresh stems.':`Stems ready for this clip${mode?` using ${mode} mode`:''}.`);
      }
    } catch(error) {related().forEach(item=>{item.stemState='failed';});showToast(error.message || 'Stem separation failed',true);}
    finally {
      operations.delete(requestKey);
      related().forEach(item=>{delete item.stemCancelRequested;});
      window.AxiomStudioDaw.refreshStemPanel();
      // Stale coverage is owner-controlled; never chain another hidden stem job.
    }
  }
  async function play(clip,ratio=0) {
    try {
      const project=window.AxiomStudioDaw.activeProject;
      if(!project?.arrangementClips?.includes(clip)||clip.stemState!=='ready'||!clip.stemJob)throw new Error('Select a clip with available separated stems.');
      if(!Number.isFinite(ratio)||ratio<0||ratio>=1)throw new Error('Choose a position inside the clip.');
      if(!window.AxiomArrangement?.auditionStems)throw new Error('The project audio engine is still loading.');
      return await window.AxiomArrangement.auditionStems(project,clip,ratio);
    }catch(error){showToast(error.message,true);return false;}
  }
  function setGain(clip,name,value) {
    if(!names.includes(name)||!Number.isFinite(value)) return;
    const p=window.AxiomStudioDaw.activeProject,key=`stemGain_${name}`,level=Math.max(0,Math.min(2,value));
    if(p?.arrangementClips?.includes(clip)&&window.AxiomMixerHistory)window.AxiomMixerHistory.write(p,[{scope:'clip',id:clip.id}],key,level);
    else clip[key]=level;
    if(window.AxiomArrangement?.playing)window.AxiomArrangement.mixerChanged(p);
  }
  window.AxiomStems=Object.freeze({request,cancel,play,stop,setGain,warmup,
    isProcessing:clip=>operations.has(clip?.stemRequestKey),
    progress:clip=>operations.get(clip?.stemRequestKey)?.progress||null,
    get playing(){return Boolean(window.AxiomArrangement?.stemPreviewPlaying);}});
  window.addEventListener('pagehide',stop);
  const shell=document.getElementById('studio-daw-shell');
  new MutationObserver(()=>{if(shell.classList.contains('hidden'))stop();}).observe(shell,{attributes:true,attributeFilter:['class']});
})();
