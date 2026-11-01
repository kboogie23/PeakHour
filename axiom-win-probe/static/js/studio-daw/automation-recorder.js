(function(){
  'use strict';
  const key=ref=>JSON.stringify([ref.scope,ref.targetId||'',ref.parameter]),copy=v=>JSON.parse(JSON.stringify(v));
  const tick=1/960;
  let armed=null,take=null;
  const api=()=>window.AxiomDawAutomation;
  function target(p,ref){
    if(ref.scope==='project')return p.masterMixer||{};
    if(ref.scope==='deck')return p.rowMixer?.[ref.targetId]||{};
    return (ref.scope==='clip'?p.arrangementClips:p.fxRegions)?.find(c=>c.id===ref.targetId);
  }
  function bounds(p,ref){
    const object=target(p,ref);
    return {start:ref.scope==='clip'?object?.timelineStartBeat:ref.scope==='fx'?object?.startBeat:0,
      length:ref.scope==='clip'?object?.timelineDurationBeats:ref.scope==='fx'?object?.durationBeats+(object?.tailBeats||0):Infinity};
  }
  function baseline(p,ref){
    const prop=ref.scope==='clip'&&!ref.parameter.startsWith('stemGain_')?'mix'+ref.parameter[0].toUpperCase()+ref.parameter.slice(1):ref.parameter;
    return target(p,ref)?.[prop]??api().definitions[ref.parameter][3];
  }
  function position(p,timeStamp){const at=window.AxiomArrangement?.automationPosition?.(timeStamp);return at?.project===p&&at.eligible?at:null;}
  function state(){
    const select=document.getElementById('daw-automation-mode');
    if(select){select.value=armed?'latch':'read';select.setAttribute('data-recording',String(Boolean(take)));}
  }
  function setArmed(p,on){
    if(on&&window.AxiomArrangement?.rendering)throw new Error('Finish exporting before arming automation.');
    finish();armed=on?p:null;state();return Boolean(armed);
  }
  function ready(p){return armed===p&&Boolean(position(p));}
  function live(p,ref){
    if(take?.p!==p)return undefined;
    return take.tracks.get(key(ref))?.points.at(-1)?.value;
  }
  function current(p,ref){
    const value=live(p,ref);if(value!==undefined)return value;
    const at=position(p),lane=p.automationLanes?.find(l=>key(l)===key(ref));
    return at&&lane?api().valueAt(lane,at.beat-bounds(p,ref).start,baseline(p,ref)):baseline(p,ref);
  }
  function write(p,ref,value,timeStamp){
    if(!ready(p))return false;
    api().normalize({...ref,points:[{beat:0,value}]});
    if(api().available&&!api().available(p,ref))throw new Error('Automation parameter is unavailable for this effect.');
    if(api().recordable&&!api().recordable(p,ref))throw new Error('Choose Fixed cutoff in the FX editor before recording cutoff automation.');
    const object=target(p,ref),range=bounds(p,ref),at=position(p,timeStamp);
    if(!at)return false;
    if(!object||!Number.isFinite(range.start))throw new Error('Automation target is unavailable.');
    if(ref.parameter.startsWith('stemGain_')&&(object.stemState!=='ready'||!object.stemJob))throw new Error('Separated stems are unavailable.');
    if(at.beat<range.start||at.beat>=range.start+range.length)return false;
    if(take&&(take.p!==p||take.cycle!==at.cycle)){finish(take.endBeat);return false;}
    let track=take?.tracks.get(key(ref));
    if(!track){
      const raw=p.automationLanes?.find(l=>key(l)===key(ref));
      if((raw?.points?.length||0)>2040)throw new Error('This automation lane is too dense to record. Simplify its points first.');
      track={ref:{...ref},original:raw?copy(raw):null,fallback:baseline(p,ref),range,points:[]};
      take||={p,cycle:at.cycle,endBeat:at.loopEndBeat,tracks:new Map()};take.tracks.set(key(ref),track);
    }
    const beat=at.beat-range.start,last=track.points.at(-1);
    if(last&&beat<last.beat){finish();return false;}
    if(last&&beat-last.beat<tick){last.value=value;}
    else if(last&&last.value===value&&track.points.length>1&&track.points.at(-2).value===value)last.beat=beat;
    else if(track.points.length>=Math.min(1800,2042-(track.original?.points?.length||0))){finish();throw new Error('Automation pass reached its point limit. Start another pass.');}
    else track.points.push({beat,value,curve:'linear'});
    state();window.AxiomArrangement?.mixerChanged(p);window.AxiomMixer?.refresh();return true;
  }
  // Preserve both sides of the recorded interval, including the original curve at punch-out.
  function splice(track,end){
    const source=track.original?.enabled!==false&&track.original?.points?.length?api().normalize(track.original):{...track.ref,enabled:true,points:[]};
    const begin=track.points[0].beat,finish=Math.min(track.range.length,end-track.range.start);
    if(finish-begin<tick)return null;
    const points=source.points.filter(point=>point.beat<begin||point.beat>finish).map(copy);
    const oldValue=beat=>api().valueAt(source,beat,track.fallback);
    const oldCurve=beat=>source.points.filter(point=>point.beat<=beat).at(-1)?.curve||'hold';
    const set=point=>{const index=points.findIndex(p=>p.beat===point.beat);if(index<0)points.push(point);else points[index]=point;};
    if(begin>0){
      if(!points.some(p=>p.beat===0))set({beat:0,value:oldValue(0),curve:oldCurve(0)});
      const before=Math.max(0,begin-tick);set({beat:before,value:oldValue(before),curve:'hold'});
    }
    for(const point of track.points)if(point.beat<finish)set({...point});
    const last=track.points.filter(point=>point.beat<finish).at(-1);
    set({beat:Math.max(begin,finish-tick),value:last.value,curve:'hold'});
    set({beat:finish,value:oldValue(finish),curve:oldCurve(finish)});
    return api().normalize({...track.ref,enabled:true,points});
  }
  function finish(endBeat){
    const old=take;take=null;armed=null;state();if(!old)return false;
    const at=position(old.p),end=Number.isFinite(endBeat)?endBeat:at&&at.cycle!==old.cycle?old.endBeat:at?.beat;
    if(!Number.isFinite(end))return false;
    try{
      const lanes=[];
      for(const track of old.tracks.values()){
        const current=old.p.automationLanes?.find(l=>key(l)===key(track.ref));
        if(JSON.stringify(current||null)!==JSON.stringify(track.original))throw new Error('Automation changed during recording. The pass was not applied.');
        const lane=splice(track,end);if(lane)lanes.push(lane);
      }
      const changed=lanes.length?api().commit(old.p,lanes):false;
      window.AxiomArrangement?.mixerChanged(old.p);window.AxiomMixer?.refresh();return changed;
    }catch(error){window.AxiomArrangement?.mixerChanged(old.p);window.showToast?.(error.message,true);return false;}
  }
  // Snapshot the audible pass without committing history or interrupting playback.
  function recoverySnapshot(p){
    if(take?.p!==p)return p;
    const at=position(p);
    const end=at&&at.cycle!==take.cycle?take.endBeat:at?.beat;
    if(!Number.isFinite(end))throw new Error('Automation recovery could not read the playback position.');
    const result=copy(p);
    for(const track of take.tracks.values()){
      const current=p.automationLanes?.find(l=>key(l)===key(track.ref));
      if(JSON.stringify(current||null)!==JSON.stringify(track.original))throw new Error('Automation changed during recording. Recovery was not overwritten.');
      const lane=splice(track,end);if(!lane)continue;
      const index=result.automationLanes.findIndex(l=>key(l)===key(track.ref));
      if(index<0)result.automationLanes.push(lane);else result.automationLanes[index]=lane;
    }
    return result;
  }
  function transportStop(reason){if(take||reason!=='play-start')finish();}
  function update(){
    if(!armed)return;
    if(armed!==window.AxiomStudioDaw.activeProject){finish();return;}
    const at=position(armed);
    if(take&&at&&take.cycle!==at.cycle)finish(take.endBeat);
  }
  window.AxiomAutomationRecorder={setArmed,ready,write,live,current,finish,splice,recoverySnapshot,transportStop,update,get armed(){return Boolean(armed);},get recording(){return Boolean(take);}};
  const host=document.querySelector('#daw-accessory-controls') || document.querySelector('.studio-daw-master-controls');
  if(host){
    const select=document.createElement('select');select.id='daw-automation-mode';select.setAttribute('aria-label','Automation recording mode');select.title='Automation recording mode';
    select.add(new Option('Read','read'));select.add(new Option('Latch','latch'));
    select.onchange=()=>{try{setArmed(window.AxiomStudioDaw.activeProject,select.value==='latch');}catch(error){state();window.showToast?.(error.message,true);}};host.append(select);
  }
})();
