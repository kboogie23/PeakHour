(function(){
  'use strict';
  const observations=new WeakMap(),histories=new WeakMap(),pending=new WeakMap(),queued=new WeakMap();
  const cancelled=()=>Object.assign(new Error('Audio preparation cancelled.'),{code:'AXIOM_PREPARATION_CANCELLED'});
  const copy=value=>JSON.parse(JSON.stringify(value));
  const daw=()=>window.AxiomStudioDaw;
  const reviewFixture=()=>new URLSearchParams(location.search).has('review');
  const fixturePath=path=>/^preview:\/\//.test(String(path||''));
  function snapshot(p,path){return {
    source:path===null||p.sourceTrack?.path===path?p.sourceTrack:null,
    sources:(p.sourceTracks||[]).filter(t=>path===null||t.path===path),
    clips:(p.arrangementClips||[]).filter(c=>path===null||c.path===path),
  };}
  function review(p,path,duration){
    if(typeof path!=='string'||!path||!Number.isFinite(duration)||duration<=0||duration>86400)throw new Error('Invalid decoded source duration.');
    const state=snapshot(p,path),bounds=new Map();
    if(!state.clips.length)throw new Error('This source is no longer in the arrangement.');
    let extended=0;
    for(const clip of state.clips){
      const maximum=daw().sourceSecondsToBeat(clip,duration),ratio=clip.sourceDurationBeats/clip.timelineDurationBeats;
      if(!Number.isFinite(maximum)||!Number.isFinite(ratio)||ratio<=0)throw new Error('Correct the source grid before repairing clip ends.');
      if(clip.sourceStartBeat>=maximum)throw new Error(`${clip.title||'A clip'} starts beyond the decoded audio. Move or remove that clip first.`);
      if(clip.sourceStartBeat+clip.sourceDurationBeats>maximum){
        const sourceDurationBeats=maximum-clip.sourceStartBeat;
        if(sourceDurationBeats!==clip.sourceDurationBeats)bounds.set(clip.id,{sourceDurationBeats,timelineDurationBeats:sourceDurationBeats/ratio});
      }else if(clip.sourceIntent==='full-track'&&Math.abs(daw().sourceBeatToSeconds(clip,clip.sourceStartBeat))<1e-8&&maximum>clip.sourceStartBeat+clip.sourceDurationBeats+1e-6){
        const sourceDurationBeats=maximum-clip.sourceStartBeat;
        bounds.set(clip.id,{sourceDurationBeats,timelineDurationBeats:sourceDurationBeats/ratio});
        extended++;
      }
    }
    const changed=bounds.size>0||[state.source,...state.sources,...state.clips].filter(Boolean).some(track=>track.durationSec!==duration||['duration_sec','duration'].some(key=>typeof track[key]==='number'&&track[key]!==duration));
    return {state,bounds,trimmed:bounds.size-extended,extended,changed};
  }
  function plan(p,path,duration){
    const result=review(p,path,duration),before=copy(result.state),after=copy(before);
    for(const clip of after.clips)if(result.bounds.has(clip.id))Object.assign(clip,result.bounds.get(clip.id));
    for(const track of [after.source,...after.sources,...after.clips].filter(Boolean)){
      track.durationSec=duration;
      for(const key of ['duration_sec','duration'])if(typeof track[key]==='number')track[key]=duration;
    }
    return {before,after,trimmed:result.trimmed,changed:result.changed};
  }
  function restore(p,path,state){
    let source=0,clip=0;
    if(state.source)p.sourceTrack=copy(state.source);
    if(p.sourceTracks)p.sourceTracks=p.sourceTracks.map(t=>path===null||t.path===path?copy(state.sources[source++]):t);
    p.arrangementClips=p.arrangementClips.map(c=>path===null||c.path===path?copy(state.clips[clip++]):c);
  }
  function history(p){if(!histories.has(p))histories.set(p,{undo:[],redo:[]});return histories.get(p);}
  function apply(p,path,duration){
    if(p!==daw().activeProject)throw new Error('The active project changed.');
    const change=plan(p,path,duration);if(!change.changed)return false;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();
    restore(p,path,change.after);
    const h=history(p);h.undo.push({path,...change});if(h.undo.length>30)h.undo.shift();h.redo=[];
    window.AxiomEditHistory?.record(p,'source-bounds');daw().refreshArrangement();return true;
  }
  function undo(p,redo=false){
    const h=history(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,entry=from.at(-1);
    if(!entry||p!==daw().activeProject||JSON.stringify(snapshot(p,entry.path))!==JSON.stringify(entry[redo?'before':'after']))return false;
    window.AxiomArrangement?.stop(false);window.AxiomStems?.stop();restore(p,entry.path,entry[redo?'after':'before']);
    from.pop();to.push(entry);daw().refreshArrangement();return true;
  }
  function observe(p,path,duration){
    if(!p||!Number.isFinite(duration)||duration<=0)return;
    let paths=observations.get(p);if(!paths){paths=new Map();observations.set(p,paths);}
    paths.set(path,duration);
    // Waveform painting must never mutate clips or stop a running transport.
    // Reconcile observations as one transaction before the next audio plan.
  }
  function alignedStart(clip,audioStart){
    if(!Number.isFinite(audioStart)||audioStart<.02)return null;
    let seconds=audioStart;
    if(clip.beatgrid){
      const downbeat=daw().sourceBeatToSeconds(clip,0);
      if(downbeat>=0&&Math.abs(downbeat-audioStart)<=.1)seconds=downbeat;
    }
    const start=daw().sourceSecondsToBeat(clip,seconds),end=clip.sourceStartBeat+clip.sourceDurationBeats;
    if(start<clip.sourceStartBeat||start>=end)return null;
    return {sourceStartBeat:start,sourceDurationBeats:end-start,timelineDurationBeats:(end-start)*clip.timelineDurationBeats/clip.sourceDurationBeats,audioStartAligned:true};
  }
  function reconcile(p,durations,starts=new Map()){
    const next=copy(p),before=new Map((p.arrangementClips||[]).map(c=>[c.id,c]));
    for(const [path,duration] of durations)restore(next,path,plan(next,path,duration).after);
    // Generated sweeps already have exact timing, including their quiet attack.
    // Import-start metadata must not create an extra Undo after conversion.
    const renderedSweeps=new Set((next.arrangementClips||[]).filter(c=>c.renderedFx?.signal==='generated-sweep').map(c=>c.path));
    for(const track of [next.sourceTrack,...(next.sourceTracks||[]),...(next.arrangementClips||[])].filter(Boolean)){
      if(starts.has(track.path)&&!renderedSweeps.has(track.path))track.audioStartSeconds=starts.get(track.path);
    }
    for(const clip of next.arrangementClips||[]){
      if(clip.alignAudioStart&&durations.has(clip.path)){
        if(clip.sourceIntent==='full-track'&&['left-deck','right-deck'].includes(clip.sectionId)&&Math.abs(daw().sourceBeatToSeconds(clip,clip.sourceStartBeat))<1e-6){
          const aligned=alignedStart(clip,starts.get(clip.path));if(aligned)Object.assign(clip,aligned);
        }
        clip.alignAudioStart=false;
      }
    }
    // Only untouched automatic import placements follow a predecessor whose
    // provisional length changed. Deliberate moves, trims and overlaps stay put.
    const resolved=new Map();
    for(const clip of next.arrangementClips||[]){
      const old=before.get(clip.id),placement=old.intakePlacement;
      if(placement&&old.sourceIntent==='full-track'&&old.timelineStartBeat===placement.startBeat){
        const previous=resolved.get(placement.afterId),oldPrevious=before.get(placement.afterId);
        if(previous&&oldPrevious&&Math.abs(old.timelineStartBeat-oldPrevious.timelineStartBeat-oldPrevious.timelineDurationBeats)<1e-7){
          const end=previous.timelineStartBeat+previous.timelineDurationBeats;
          clip.timelineStartBeat=old.alignAudioStart?Math.ceil((end-1e-8)/4)*4:end;
        }
      }
      if(durations.has(clip.path))delete clip.intakePlacement;
      else if(clip.intakePlacement)clip.intakePlacement.startBeat=clip.timelineStartBeat;
      resolved.set(clip.id,clip);
    }
    return snapshot(next,null);
  }
  async function prepare(p,current=()=>true,selection=null){
    if(!p?.arrangementClips?.length)return false;
    const selected=Boolean(selection?.clipIds||selection?.sectionId);
    if(!current())throw cancelled();
    while(pending.has(p)){
      let completed=false;const previous=pending.get(p);
      previous.consumers.add(current);
      try{await previous.task;completed=true;}catch(error){if(!selected&&error.code!=='AXIOM_PREPARATION_CANCELLED')throw error;}
      finally{previous.consumers.delete(current);}
      if(!current())throw cancelled();
      if(completed&&!selected)return false;
      // A superseded seek owns the cancelled check, not the newest caller.
      if(pending.get(p)===previous)pending.delete(p);
    }
    const before=copy(snapshot(p,null)),signature=JSON.stringify(before);
    const consumers=new Set([current]),needed=()=>[...consumers].some(isCurrent=>isCurrent());
    const task=(async()=>{
      const paths=[...new Set(before.clips.filter(c=>!c.muted&&
        (!selection?.clipIds||selection.clipIds.includes(c.id))&&(!selection?.sectionId||c.sectionId===selection.sectionId)).map(c=>c.path))],durations=new Map(),starts=new Map();
      if(reviewFixture()&&paths.length&&paths.every(fixturePath))return false;
      for(let i=0;i<paths.length;i+=32){
        const batch=paths.slice(i,i+32),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),probeIds=new Set();
        try{
          let data;
          // Native checks acknowledge immediately and decode in one background
          // worker. Do not let a 30-second HTTP timeout become a song-length cap.
          clearTimeout(timer);
          do {
            if(!needed())throw cancelled();
            const timeout=setTimeout(()=>controller.abort(),30000);
            try {
              const response=await fetch('/api/studio-daw/assets/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:batch,metadataOnly:true,verifyDecoded:true}),signal:controller.signal});
              data=await response.json();
              if(!response.ok||!Array.isArray(data.assets))throw new Error(data.error||'Full-song audio information is unavailable.');
            } finally {clearTimeout(timeout);}
            for(const asset of data.assets)if(asset.probeId)probeIds.add(asset.probeId);
            const failed=data.assets.find(asset=>!['ready','pending'].includes(asset.status));
            if(failed)throw new Error(`${failed.path}: ${failed.reason||failed.status}. Source verification did not complete.`);
            if(data.assets.some(asset=>asset.status==='pending'))await new Promise(resolve=>setTimeout(resolve,250));
          } while(data.assets.some(asset=>asset.status==='pending'));
          for(const path of batch){
            const asset=data.assets.find(a=>a.path===path);
            if(asset?.status!=='ready'||!Number.isFinite(asset.durationSec)||asset.durationSec<=0)
              throw new Error(`${before.clips.find(c=>c.path===path)?.title||path}: ${asset?.reason||asset?.status||'audio duration unavailable'}. Reconnect or check this source before playing.`);
            // A native EOF receipt outranks preview-waveform observations and
            // rounded tags. Browser-only metadata keeps its existing fallback.
            durations.set(path,asset.decodedEOF?asset.durationSec:(observations.get(p)?.get(path)||asset.durationSec));
            if(asset.decodedEOF&&Number.isFinite(asset.audioStartSeconds)&&asset.audioStartSeconds>=0&&asset.audioStartSeconds<asset.durationSec)starts.set(path,asset.audioStartSeconds);
          }
        }catch(error){
          controller.abort();
          // A bad source must not cancel other songs' shared waveform probes.
          // Cancel the batch only when its consumers actually leave or stop.
          if(!needed()&&probeIds.size)fetch('/api/studio-daw/assets/probes/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...probeIds]})}).catch(()=>{});
          throw needed()?error:cancelled();
        }finally{clearTimeout(timer);}
        if(!needed())throw cancelled();
      }
      if(JSON.stringify(snapshot(p,null))!==signature)throw Object.assign(new Error('Project changed while checking full song lengths. Press Play to retry.'),{code:'AXIOM_SOURCE_CHECK_STALE'});
      const after=reconcile(p,durations,starts);
      if(JSON.stringify(after)===signature)return false;
      restore(p,null,after);
      if(p===daw().activeProject){
        const h=history(p);h.undo.push({path:null,before,after});if(h.undo.length>30)h.undo.shift();h.redo=[];
        window.AxiomEditHistory?.record(p,'source-bounds');daw().refreshArrangement();
        window.AxiomDawDrafts?.checkpoint?.();
      }
      return true;
    })();
    const owned={task,consumers};if(!selected)pending.set(p,owned);
    try{const changed=await task;if(!current())throw cancelled();return changed;}
    finally{consumers.delete(current);if(pending.get(p)===owned)pending.delete(p);}
  }
  function queue(p){
    const current=queued.get(p);
    if(current){current.again=true;return current.task;}
    const job={again:false};queued.set(p,job);
    job.task=(async()=>{
      do {
        job.again=false;
        try{await prepare(p,()=>p===daw()?.activeProject);}
        catch(error){
          if(p!==daw()?.activeProject)return;
          if(error.code==='AXIOM_SOURCE_CHECK_STALE')job.again=true;
          else {window.showToast?.(error.message,true);return;}
        }
        // Yield between retries so continuous editing cannot monopolize the UI.
        if(job.again)await new Promise(resolve=>setTimeout(resolve,100));
      }while(job.again&&p===daw()?.activeProject);
    })().finally(()=>{if(queued.get(p)===job)queued.delete(p);});
    return job.task;
  }
  function render(){
    const p=daw()?.activeProject,editor=document.getElementById('studio-daw-step-editor');
    const toolbar=editor?.querySelector('.daw-source-zoom'),canvas=editor?.querySelector('.daw-source-detail canvas[data-wave-path]');
    if(!toolbar||!canvas)return;
    const path=canvas.dataset.wavePath,duration=observations.get(p)?.get(path);let button=toolbar.querySelector('.daw-source-end');
    if(!duration){button?.remove();return;}
    let change,error;try{change=review(p,path,duration);}catch(e){error=e.message;}
    if(!change?.changed&&!error){button?.remove();return;}
    if(!button){button=document.createElement('button');button.type='button';button.className='daw-source-end';button.textContent='Use decoded end';toolbar.append(button);}
    button.disabled=Boolean(error);button.title=error||`Decoded end: ${duration.toFixed(3)} seconds. Shorten ${change.trimmed} clip(s) beyond the audio; keep clip starts and sync ratios. Undo is available.`;
    button.onclick=()=>{try{apply(p,path,duration);}catch(e){window.showToast?.(e.message,true);}};
  }
  window.AxiomSourceBounds={plan,apply,undo,observe,render,reconcile,prepare,queue,alignedStart};
  window.AxiomEditHistory?.register('source-bounds',undo);
})();
