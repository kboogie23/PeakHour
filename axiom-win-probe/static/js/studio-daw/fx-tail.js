(function(){
  'use strict';
  let active=null;
  function timing(p,fx,duration,reverse=false){
    const map=window.AxiomStudioDaw.compileTempoMap(p),start=fx.startBeat+fx.durationBeats,end=start+fx.tailBeats;
    const origin=map.beatToSeconds(start),length=map.beatToSeconds(end)-origin;
    if(!(length>0&&duration>0&&duration<=240))throw new Error('Tail copies must be between zero and four minutes.');
    const beats=[start,end,...map.segments.map(s=>s.beat).filter(b=>b>start&&b<end)];
    for(let b=start+1/16;b<end;b+=1/16)beats.push(b);
    let anchors=[...new Set(beats)].sort((a,b)=>a-b).map(b=>({beat:b-start,seconds:(map.beatToSeconds(b)-origin)/length*duration}));
    if(reverse)anchors=anchors.reverse().map(a=>({beat:fx.tailBeats-a.beat,seconds:duration-a.seconds}));
    return {durationBeats:fx.tailBeats,anchors};
  }
  function signature(p){const {localDraftId,...audio}=p;return JSON.stringify(audio);}
  function open(id){
    if(active)return;
    const p=window.AxiomStudioDaw.activeProject,fx=p?.fxRegions?.find(f=>f.id===id);
    if(!fx||!['echo','reverb','vintageReverb'].includes(fx.type)||!window.AxiomDawFx.validate(fx)||fx.tailBeats<=0)return;
    const dialog=document.createElement('dialog');dialog.id='daw-fx-tail-dialog';dialog.className='daw-fx-dialog';
    dialog.innerHTML='<h2>Render FX Tail</h2><label>Start bar <input data-start type="number" min="1" step="0.0625"></label><label><input data-reverse type="checkbox"> Reverse tail</label><p>FX return / Pre-mixer / Stereo WAV</p><output role="status">Ready</output><footer><button data-close>Cancel</button><button data-render>Render Copy</button></footer>';
    const start=dialog.querySelector('[data-start]'),reverse=dialog.querySelector('[data-reverse]'),action=dialog.querySelector('[data-render]'),status=dialog.querySelector('output');
    const place=()=>{start.value=(reverse.checked?Math.max(0,fx.startBeat-fx.tailBeats):fx.startBeat+fx.durationBeats)/4+1;};place();reverse.onchange=place;
    let closed=false,rendering=false;
    const close=()=>{closed=true;if(rendering)window.AxiomArrangement.stop(false,'fx-tail-cancel');active=null;dialog.remove();};
    active=close;dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    action.onclick=async()=>{
      const beat=(Number(start.value)-1)*4,backwards=reverse.checked;
      if(!start.value.trim()||!Number.isFinite(beat)||beat<0){status.textContent='Enter a valid start bar.';return;}
      if(p!==window.AxiomStudioDaw.activeProject){status.textContent='Project changed. Reopen the effect.';return;}
      const before=signature(p),snapshot=JSON.parse(JSON.stringify(p)),region=snapshot.fxRegions.find(f=>f.id===id);
      const unchanged=()=>!closed&&p===window.AxiomStudioDaw.activeProject&&signature(p)===before;
      action.disabled=true;start.disabled=true;reverse.disabled=true;rendering=true;status.textContent='Preparing and rendering tail...';
      try{
        const rendered=await window.AxiomArrangement.render(snapshot,{fxTailId:id});
        if(!unchanged())throw new Error('Project changed during rendering. Render the tail again.');
        if(rendered.frames/48000>240)throw new Error('Tail copies currently support up to four minutes.');
        const result=await window.AxiomDawExport.encode(rendered,()=>!unchanged(),backwards);
        if(result.peak<1e-8)throw new Error('This effect tail is silent. Check its target, active range and wet level.');
        const t=timing(snapshot,region,result.duration,backwards),name=(backwards?'Reversed ':'')+(region.type==='echo'?'Echo':'Reverb')+' Tail';
        status.textContent='Saving tail copy...';
        const form=new FormData();form.append('file',new Blob([result.buffer],{type:'audio/wav'}),name+'.wav');
        form.append('axiom_generated','1');
        const response=await fetch('/api/studio-daw/import',{method:'POST',body:form}),data=await response.json();if(!response.ok)throw new Error(data.error||'Tail could not be saved.');
        if(!unchanged())throw new Error('Project changed during save. The tail has not been placed.');
        data.track.title=name;data.track.bpm=window.AxiomStudioDaw.compileTempoMap(snapshot).bpmAtBeat(region.startBeat+region.durationBeats+(backwards?region.tailBeats:0));
        t.provenance={region,reverse:backwards,signal:'pre-mixer-fx-return',projectTitle:snapshot.title,duration:result.duration};
        const layer=Math.max(p.sampleLayerCount||1,...p.arrangementClips.filter(c=>c.sectionId==='samples').map(c=>(c.layerIndex||0)+1));
        window.AxiomStudioDaw.addTrackToProject(data.track,{placement:{sectionId:'samples',beat,layerIndex:layer},renderedFx:t});
        if(!p.arrangementClips.some(c=>c.path===data.track.path&&c.renderedFx))throw new Error('Tail could not be placed.');
        window.AxiomDawDrafts?.checkpoint();rendering=false;close();
      }catch(error){if(!closed)status.textContent=error.message;}
      finally{rendering=false;if(!closed){action.disabled=false;start.disabled=false;reverse.disabled=false;}}
    };
    document.body.append(dialog);dialog.showModal();
  }
  window.addEventListener('pagehide',()=>active?.());
  window.AxiomDawFxTail={open,timing};
})();
