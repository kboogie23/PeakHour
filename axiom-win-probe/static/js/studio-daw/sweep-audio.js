(function(){
  'use strict';
  let busy=false;
  const signature=p=>JSON.stringify({...p,localDraftId:undefined});
  function timing(p,fx,duration){
    const map=window.AxiomStudioDaw.compileTempoMap(p),start=fx.startBeat,end=start+fx.durationBeats,origin=map.beatToSeconds(start),length=map.beatToSeconds(end)-origin;
    const beats=[start,end,...map.segments.map(s=>s.beat).filter(b=>b>start&&b<end)];
    for(let b=start+1/16;b<end;b+=1/16)beats.push(b);
    return {durationBeats:fx.durationBeats,anchors:[...new Set(beats)].sort((a,b)=>a-b).map(b=>({beat:b-start,seconds:(map.beatToSeconds(b)-origin)/length*duration})),provenance:{region:JSON.parse(JSON.stringify(fx)),signal:'generated-sweep',duration}};
  }
  async function place(p,fx,current=()=>true,status=()=>{},replacePath=null){
    if(busy)throw new Error('A sweep is already being created.');
    if(p!==window.AxiomStudioDaw.activeProject||fx.type!=='gatedSweep'||!window.AxiomDawFx.validate(fx))throw new Error('Open the project and check the sweep settings.');
    const before=signature(p),snapshot=JSON.parse(JSON.stringify(p)),map=window.AxiomStudioDaw.compileTempoMap(snapshot),origin=map.beatToSeconds(fx.startBeat),seconds=map.beatToSeconds(fx.startBeat+fx.durationBeats)-origin;
    if(!(seconds>0&&seconds<=240))throw new Error('Create sweep clips up to four minutes long. Use fewer bars for this tempo.');
    const unchanged=()=>current()&&p===window.AxiomStudioDaw.activeProject&&signature(p)===before;
    const frames=Math.ceil(seconds*48000),ctx=new OfflineAudioContext(2,frames,48000),nodes=[];
    busy=true;
    try{
      status('Creating sweep waveform...');
      const renderProject={...snapshot,fxRegions:[{...fx,target:'master'}],automationLanes:(snapshot.automationLanes||[]).filter(l=>l.parameter==='bpm'||l.scope==='fx'&&l.targetId===fx.id)};
      await window.AxiomDawFx.prepare(ctx,renderProject);if(!unchanged())throw new Error('Sweep cancelled or project changed.');
      const input=ctx.createGain();nodes.push(input);
      window.AxiomDawFx.connect(ctx,input,ctx.destination,{sectionId:'master'},renderProject,-origin,node=>{nodes.push(node);return node;});
      const audio=await ctx.startRendering();if(!unchanged())throw new Error('Sweep cancelled or project changed.');
      const result=await window.AxiomDawExport.encode({audio,frames,trimFrames:0},()=>!unchanged());
      if(result.peak<1e-8)throw new Error('The sweep is silent. Raise Sweep loudness or choose another source.');
      status('Adding sweep audio to the project...');
      const variantLabel=window.AxiomDawSweeps?.variants?.[fx.sweepVariant]?.label;
      const name=fx.sweepSource?.title?'Sweep - '+fx.sweepSource.title.replace(/\.[^.]+$/,'').slice(0,180):variantLabel?'Sweep - '+variantLabel:fx.sweepPattern==='voiceBuild'?'Sweep - Short Short Long':'Sweep - Original';
      const form=new FormData();form.append('file',new Blob([result.buffer],{type:'audio/wav'}),name+'.wav');form.append('axiom_generated','1');
      const response=await fetch('/api/studio-daw/import',{method:'POST',body:form}),data=await response.json();if(!response.ok)throw new Error(data.error||'Sweep audio could not be saved.');
      if(!unchanged())throw new Error('Project changed during save. The sweep was not placed.');
      data.track.title=name;data.track.bpm=map.bpmAtBeat(fx.startBeat);
      const layer=Math.max(p.sampleLayerCount||1,...(p.arrangementClips||[]).filter(c=>c.sectionId==='samples').map(c=>(c.layerIndex||0)+1));
      const renderedFx=timing(snapshot,fx,result.duration);
      if(replacePath){if(!window.AxiomStudioDaw.replaceSweepSource(replacePath,data.track,renderedFx))throw new Error('The sweep changed before replacement.');}
      else window.AxiomStudioDaw.addTrackToProject(data.track,{placement:{sectionId:'samples',beat:fx.startBeat,layerIndex:layer},renderedFx,replaceFxId:fx.id});
      const clip=p.arrangementClips?.find(c=>c.path===data.track.path&&c.renderedFx?.signal==='generated-sweep');if(!clip)throw new Error('The sweep could not be placed on the timeline.');
      window.AxiomDawDrafts?.checkpoint();return clip;
    }finally{busy=false;for(const node of nodes){try{node.stop?.();}catch{}try{node.disconnect();}catch{}}}
  }
  async function replace(p,clip,file,status=()=>{}){
    if(busy)throw new Error('Wait for the current sweep to finish.');
    if(!clip?.renderedFx?.region||clip.renderedFx.signal!=='generated-sweep')throw new Error('Drop onto a generated sweep clip.');
    if(file.size>96*1024*1024||! /\.(mp3|mp4|m4a|wav|aiff?|flac|aac)$/i.test(file.name))throw new Error('Choose one sweep audio file under 96 MB.');
    const before=signature(p),current=()=>p===window.AxiomStudioDaw.activeProject&&signature(p)===before;
    status('Loading replacement sweep...');const form=new FormData();form.append('file',file);
    const response=await fetch('/api/studio-daw/import',{method:'POST',body:form}),data=await response.json();if(!response.ok)throw new Error(data.error||'Sweep import failed.');
    if(!current())throw new Error('Project changed. Drop the replacement again.');
    if(!(data.track?.durationSec>0&&data.track.durationSec<=60))throw new Error('Choose a replacement sweep up to 60 seconds long.');
    const region={...JSON.parse(JSON.stringify(clip.renderedFx.region)),sweepSource:{path:data.track.path,title:file.name.slice(0,256)}};
    await place(p,region,current,status,clip.path);status('Sweep sound replaced. Cuts and positions kept.');
  }
  window.AxiomDawSweepAudio={place,timing,replace};
})();
