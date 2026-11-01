(function(){
  'use strict';
  const projects=new WeakMap();
  let running=false,timer=null;
  const daw=()=>window.AxiomStudioDaw;
  const visible=()=>!document.getElementById('studio-daw-shell')?.classList?.contains('hidden');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const clips=(p,path)=>(p?.arrangementClips||[]).filter(c=>c.path===path);
  const reviewFixture=()=>new URLSearchParams(location.search).has('review');
  const fixturePath=path=>/^preview:\/\//.test(String(path||''));
  const eligible=c=>{
    const duration=Number(c.durationSec||c.duration);
    return c.path&&['left-deck','right-deck'].includes(c.sectionId)&&!c.renderedFx&&(!Number.isFinite(duration)||duration>=2&&duration<=600);
  };
  const prepared=c=>c.fluidSync&&c.beatgrid?.metadata?.method==='axiom-snap';
  function state(p){if(!projects.has(p))projects.set(p,new Map());return projects.get(p);}
  function render(){
    const p=daw()?.activeProject,selected=daw()?.selectedMixerClips||[];
    const candidates=selected.length?selected.filter(c=>p?.arrangementClips?.includes(c)):p?.arrangementClips||[];
    const c=candidates.find(eligible);
    const job=c&&p&&state(p).get(c.path),button=document.getElementById('daw-steady-timing-button');
    if(!button)return;
    const working=job?.status==='working',failed=job?.status==='failed';
    button.disabled=false;
    const active=candidates.some(c=>eligible(c)&&prepared(c));
    button.textContent=working?'Snap: '+(job.message||'Preparing'):failed?'Retry AXIOM Snap':active?'AXIOM Snap On':'AXIOM Snap Off';
    button.title=(active?'Snap on: automatic timing is applied. ':'Snap off: no automatic timing applied. ')+(job?.error||(working?button.textContent:'Automatic timing follows the green Clip Start marker. Drag Clip Start to set bar 1. Undo restores the previous timing.'));
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-busy', String(working));
    button.setAttribute('aria-live','polite');
  }
  async function json(url,options={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{const response=await fetch(url,{...options,signal:controller.signal});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Snap preparation could not finish.'),{status:response.status});return data;}
    finally{clearTimeout(timeout);}
  }
  function queue(p){
    if(!p||p!==daw()?.activeProject||!visible())return;
    for(const c of p.arrangementClips||[]){
      if(reviewFixture()&&fixturePath(c.path))continue;
      if(eligible(c)&&!prepared(c)&&!state(p).has(c.path))state(p).set(c.path,{status:'queued'});
    }
    render();
    if(!running&&!timer)timer=setTimeout(()=>{timer=null;run();},250);
  }
  async function run(){
    if(running)return;
    const p=daw()?.activeProject;if(!p||!visible())return;
    const entry=[...state(p)].find(([path,j])=>j.status==='queued'&&clips(p,path).some(eligible));if(!entry)return;
    const [path,job]=entry;running=true;job.status='working';
    let snapJob=null,stemClip=null,applied=false;
    const current=()=>daw()?.activeProject===p&&visible()&&clips(p,path).some(eligible);
    const check=()=>{if(!current())throw new Error('Snap preparation stopped because the song was closed.');};
    const message=text=>{job.message=text;render();};
    async function startTiming(payload){
      const deadline=Date.now()+5000;
      while(true){
        check();
        try{return await json('/api/studio-daw/steady-timing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
        catch(error){if(error.status!==409||Date.now()>=deadline)throw error;await sleep(100);}
      }
    }
    try{
      message('Checking song');
      // Source checking can be superseded by a trim. Retry against current bounds,
      // rather than requiring the user to reconstruct an untrimmed clip.
      while(current()){
        try{await window.AxiomSourceBounds?.prepare(p,current,{clipIds:clips(p,path).map(c=>c.id)});break;}
        catch(error){if(error.code!=='AXIOM_SOURCE_CHECK_STALE')throw error;await sleep(250);}
      }
      check();
      while(clips(p,path).some(c=>['queued','running'].includes(c.importAnalysis?.state))){await sleep(500);check();}
      const target=()=>job.clipId?clips(p,path).find(c=>c.id===job.clipId):clips(p,path).filter(eligible).sort((a,b)=>a.sourceStartBeat-b.sourceStartBeat)[0];
      let clip=target();if(!clip)throw new Error('The selected clip was removed.');
      const duration=Number(clip.durationSec||clip.duration),bpm=Number(clip.bpm);
      if(!(duration>=2&&duration<=600))throw new Error('Automatic Snap supports songs from 2 seconds to 10 minutes.');
      if(!(bpm>=20&&bpm<=400)||clip.importAnalysis?.state==='needs_review'&&!clip.importAnalysis.bpmAvailable&&!clip.bpmCorrection)throw new Error('Set the song BPM, then choose Retry AXIOM Snap.');
      message('Checking saved beatgrid');
      let result=await json('/api/studio-daw/steady-timing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,bpm,availableOnly:true})});
      if(result.state!=='ready'){
        message('Following the beat');
        const anchorSeconds=daw().sourceBeatToSeconds(clip,clip.sourceStartBeat);
        result=await startTiming({path,bpm,directMix:true,anchorSeconds});
        snapJob=result.id;
        while(result.state==='processing'){await sleep(100);check();result=await json(`/api/studio-daw/steady-timing/${snapJob}`);}
      }
      check();
      if(result.state!=='ready'){
        message('Needs manual stems');
        while(clip.stemState==='processing'){await sleep(500);check();}
        const covered=()=>clip.stemState==='ready'&&clip.stemJob&&clip.stemCoverage?.start<=1/48000&&clip.stemCoverage?.end>=duration-.1;
        if(!covered())throw Object.assign(new Error('AXIOM Snap needs manual full-song stems. Choose Create Stems for the full song, then retry AXIOM Snap.'),{code:'AXIOM_SNAP_MANUAL_STEMS'});
        message('Following the beat');
        result=await startTiming({path,bpm,stemJob:clip.stemJob});
        snapJob=result.id;
        while(result.state==='processing'){await sleep(500);check();result=await json(`/api/studio-daw/steady-timing/${snapJob}`);}
      }
      check();
      if(result.state!=='ready'||!['drum-stem','dj-grid','mix-pulse'].includes(result.sourceKind)||result.reviewRequired!==false||!result.structure)throw new Error(result.error||'AXIOM Snap could not establish the drum pulse.');
      // A background result must never stop a playing or exporting project.
      message('Ready when playback stops');
      while(window.AxiomArrangement?.playing||!window.AxiomArrangement?.waitingForSnap&&(window.AxiomArrangement?.loading||window.AxiomArrangement?.rendering)){await sleep(100);check();}
      clip=target();if(!clip)throw new Error('The selected clip was removed.');
      if(Number(clip.bpm)!==bpm)throw new Error('The song BPM changed. Choose Retry AXIOM Snap.');
      if(!daw().applySteadyTiming(clip.id,result.structure,0,false,Boolean(job.clipId)))throw new Error('The song is no longer available.');
      // Playback prepares only its audible window. A full-song warm render here
      // blocked Play and made every edit wait on an obsolete whole-song render.
      applied=true;
      job.status='ready';window.showToast?.(result.structure.steadyBpm?'AXIOM Snap ready. Steady song timing is preserved.':'AXIOM Snap ready. Clip Start is bar 1; the song and stems share the grid.');
    }catch(error){job.status=current()?'failed':'queued';job.error=error.message;job.manualStemsRequired=error.code==='AXIOM_SNAP_MANUAL_STEMS';if(current()&&!(reviewFixture()&&fixturePath(path)))window.showToast?.('AXIOM Snap: '+error.message,true);}
    finally{
      if(!applied&&snapJob)fetch(`/api/studio-daw/steady-timing/${snapJob}`,{method:'DELETE'}).catch(()=>{});
      if(!current()&&stemClip?.stemState==='processing')window.AxiomStems.cancel(stemClip);
      running=false;render();queue(daw()?.activeProject);
    }
  }
  function open(){
    const p=daw()?.activeProject,selected=daw()?.selectedMixerClips||[];
    const clip=selected.length===1?selected[0]:p?.arrangementClips?.filter(eligible).length===1?p.arrangementClips.find(eligible):null;
    if(!clip){window.showToast?.('Select a song to view its Snap preparation.',true);return;}
    if(!eligible(clip)){window.showToast?.('Automatic Snap supports song clips from 2 seconds to 10 minutes. This clip keeps its existing timing.',true);return;}
    const job=state(p).get(clip.path);
    if(job?.status==='working'){window.showToast?.('AXIOM Snap: '+job.message+'. You can keep editing.');return;}
    if(prepared(clip)&&job?.status!=='failed'){
      document.getElementById('daw-snap-refresh')?.remove();
      const dialog=document.createElement('dialog');dialog.id='daw-snap-refresh';dialog.className='daw-fx-dialog';
      const title=document.createElement('h2');title.textContent='AXIOM Snap';
      const info=document.createElement('p');info.textContent=clip.beatgrid.metadata.steadyBpm?'This song uses a steady grid. Clip Start sets its first downbeat.':'Recheck this clip for steady or drifting timing. Your source audio and other clips stay unchanged.';
      const detail=document.createElement('p');detail.textContent='Rechecking replaces this clip’s grid while keeping source cuts, Clip Start and deliberate stretch. Undo restores the previous grid.';
      const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Recheck clip timing';
      const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>{dialog.close();dialog.remove();};
      refresh.onclick=()=>{dialog.close();dialog.remove();if(daw()?.activeProject!==p||!clips(p,clip.path).includes(clip))return;state(p).set(clip.path,{status:'queued',clipId:clip.id});queue(p);};
      const actions=document.createElement('footer');actions.append(close,refresh);
      dialog.append(title,info,detail,actions);document.body.appendChild(dialog);dialog.showModal();return;
    }
    state(p).set(clip.path,{status:'queued'});queue(p);
  }
  async function prepare(p,current,{clipIds,sectionId}={}){
    queue(p);
    while(current()){
      const waiting=(p.arrangementClips||[]).filter(c=>eligible(c)&&!prepared(c)&&!c.muted&&(!clipIds||clipIds.includes(c.id))&&(!sectionId||c.sectionId===sectionId))
        .map(c=>state(p).get(c.path)).filter(job=>job&&job.status!=='ready'&&!job.manualStemsRequired);
      // Undo is an explicit timing choice: never silently reapply Snap afterward.
      if(!waiting.length)return;
      const failed=waiting.find(job=>job.status==='failed');
      if(failed)throw new Error(failed.error||'AXIOM Snap needs attention before playback.');
      if(p!==daw()?.activeProject||!visible())throw new Error('Snap preparation stopped because the song was closed.');
      await sleep(50);
    }
    throw new Error('Playback cancelled');
  }
  window.AxiomSteadyTiming={open,queue,render,prepare};
  queue(daw()?.activeProject);
})();
