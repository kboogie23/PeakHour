(function(){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),daw=()=>window.AxiomStudioDaw;
  const signature=p=>JSON.stringify({...p,localDraftId:undefined});
  let job=null;
  function selected(){const clips=daw()?.selectedMixerClips;return clips?.length===1?clips[0]:null;}
  function current(p,before){return p===daw().activeProject&&signature(p)===before;}
  function cloneForClip(p,c,stem=null){
    const q=copy(p),clip=copy(c);
    // Freeze the source processing; leave mixer, fades and their automation editable.
    for(const k of ['volume','mixVolume','mixGainDb','mixLowDb','mixMidDb','mixHighDb','pan','mixPan','fadeInBeats','fadeOutBeats','mixMuted','mixSolo','muted'])delete clip[k];
    clip.volume=1;if(clip.keySync){clip.pitchSemitones=daw().playbackPitch(clip);delete clip.keySync;}
    q.arrangementClips=[clip];q.patternClips=[];q.drumSamples={};q.rowMixer={};q.masterMixer={};
    q.fxRegions=(q.fxRegions||[]).filter(f=>f.clipId===c.id);
    if(q.fxRegions.some(f=>f.type.startsWith('sidechain')))throw new Error('This clip effect uses another track as its trigger. Bypass the sidechain before preparing this clip.');
    const ids=new Set(q.fxRegions.map(f=>f.id));
    q.automationLanes=(q.automationLanes||[]).filter(l=>l.parameter==='bpm'||l.scope==='fx'&&ids.has(l.targetId)||!stem&&l.scope==='clip'&&l.targetId===c.id&&l.parameter.startsWith('stemGain_'));
    return q;
  }
  async function upload(buffer,name,signal){
    const form=new FormData();form.append('file',new Blob([buffer],{type:'audio/wav'}),name+'.wav');form.append('axiom_generated','1');
    const response=await fetch('/api/studio-daw/import',{method:'POST',body:form,signal}),data=await response.json();
    if(!response.ok||!data.track?.path)throw new Error(data.error||'Prepared audio could not be saved.');return data.track;
  }
  function frozenTiming(p,c,path,seconds){
    const map=daw().compileTempoMap(p),start=c.timelineStartBeat,end=start+c.timelineDurationBeats,origin=map.beatToSeconds(start),duration=map.beatToSeconds(end)-origin;
    const beats=[start,end,...map.segments.map(s=>s.beat).filter(b=>b>start&&b<end)];for(let b=start+1/16;b<end;b+=1/16)beats.push(b);
    return {source:'manual',mode:'fluid',trackPath:path,readOnly:true,beatAnchors:[...new Set(beats)].sort((a,b)=>a-b).map(b=>({beat:b-start,seconds:(map.beatToSeconds(b)-origin)/duration*seconds})),metadata:{clipLocalAnchor:true,frozen:true}};
  }
  async function freeze(p,c,status=()=>{},alive=()=>true){
    if(job)throw new Error('Wait for the current clip preparation.');
    if(!c||c.frozenClip)throw new Error('Select an unfrozen audio clip.');
    const before=signature(p),clock=daw().compileTempoMap(p),duration=clock.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats)-clock.beatToSeconds(c.timelineStartBeat);
    if(!(duration>0&&duration<=120))throw new Error('Freeze clips up to two minutes. Cut a shorter section first.');
    if((p.fxRegions||[]).some(f=>f.clipId===c.id&&f.tailBeats>0))throw new Error('Render the effect tail separately or set its tail to Off before freezing.');
    const original=copy(c),q=cloneForClip(p,c),ok=()=>alive()&&current(p,before),controller=new AbortController();job={cancel(){controller.abort();window.AxiomArrangement.stop(false,'freeze-cancel');}};
    try{
      status('Preparing clip...');
      const rendered=await window.AxiomArrangement.render(q,{startBeat:c.timelineStartBeat,endBeat:c.timelineStartBeat+c.timelineDurationBeats});
      if(!ok())throw new Error('Clip preparation cancelled or project changed.');
      const encoded=await window.AxiomDawExport.encode(rendered,()=>!ok());
      const track=await upload(encoded.buffer,'Frozen - '+(c.title||c.label||'Clip').slice(0,100),controller.signal);
      if(!ok())throw new Error('Project changed. Prepared copy was not placed.');
      const bakedFx=copy((p.fxRegions||[]).filter(f=>f.clipId===c.id)),ids=new Set(bakedFx.map(f=>f.id));
      const bakedAutomation=copy((p.automationLanes||[]).filter(l=>l.scope==='fx'&&ids.has(l.targetId)||l.scope==='clip'&&l.targetId===c.id&&l.parameter.startsWith('stemGain_')));
      const next={...c,path:track.path,assetIdentity:track.assetIdentity,durationSec:encoded.duration,bpm:clock.bpmAtBeat(c.timelineStartBeat),
        sourceStartBeat:0,sourceDurationBeats:c.timelineDurationBeats,beatgrid:frozenTiming(p,c,track.path,encoded.duration),fluidSync:false,pitchSemitones:0,reversed:false,sourceIntent:'trimmed',alignAudioStart:false,
        frozenClip:{version:1,original,bakedFx,bakedAutomation,durationBeats:c.timelineDurationBeats}};
      for(const k of Object.keys(next))if(k.startsWith('stem')||k==='nativeEffect'||k==='keySync'||k==='repeatSlice')delete next[k];
      const fx=(p.fxRegions||[]).filter(f=>!ids.has(f.id)),lanes=(p.automationLanes||[]).filter(l=>!bakedAutomation.some(b=>b.scope===l.scope&&b.targetId===l.targetId&&b.parameter===l.parameter));
      if(!daw().commitCreativeClip(p,before,c.id,next,fx,lanes))throw new Error('Project changed before placement.');
      status('Frozen. Mixer, fades and track effects remain editable.');return next;
    }finally{job=null;}
  }
  function restored(p,c){
    const r=c.frozenClip;if(!r||r.version!==1||r.original?.frozenClip)throw new Error('Invalid frozen clip receipt.');
    // Restore source processing after trims, splits and moves of the frozen copy.
    if(c.reversed||c.pitchSemitones||c.nativeEffect||c.keySync)throw new Error('Undo added pitch, reverse or native processing before unfreezing.');
    const o=copy(r.original),offset=c.sourceStartBeat,length=c.sourceDurationBeats,ratio=o.sourceDurationBeats/r.durationBeats;
    const next={...o,id:c.id,sectionId:c.sectionId,layerIndex:c.layerIndex,trackIndex:c.trackIndex,timelineStartBeat:c.timelineStartBeat,timelineDurationBeats:c.timelineDurationBeats,title:c.title,label:c.label,
      sourceStartBeat:o.sourceStartBeat+offset*ratio,sourceDurationBeats:length*ratio};delete next.frozenClip;
    for(const k of ['volume','mixVolume','mixGainDb','mixLowDb','mixMidDb','mixHighDb','pan','mixPan','fadeInBeats','fadeOutBeats','fadeCurve','muted','mixMuted','mixSolo']){if(Object.hasOwn(c,k))next[k]=c[k];else delete next[k];}
    const scale=c.timelineDurationBeats/length,shift=c.timelineStartBeat-offset*scale;
    const ids=new Map(),fx=r.bakedFx.flatMap(f=>{const a=Math.max(offset,f.startBeat-o.timelineStartBeat),b=Math.min(offset+length,f.startBeat+f.durationBeats-o.timelineStartBeat);if(b<=a)return [];const id=crypto.randomUUID();ids.set(f.id,{id,from:a-(f.startBeat-o.timelineStartBeat),to:b-(f.startBeat-o.timelineStartBeat)});return [{...copy(f),id,clipId:c.id,target:c.sectionId,startBeat:shift+a*scale,durationBeats:(b-a)*scale}];});
    const remap=(l,from,to)=>{const fallback=window.AxiomDawAutomation.definitions[l.parameter]?.[3]??1,at=b=>window.AxiomDawAutomation.valueAt({...l,enabled:true},b,fallback),curve=l.points.filter(pt=>pt.beat<=from).at(-1)?.curve||'hold';return [{beat:0,value:at(from),curve},...l.points.filter(pt=>pt.beat>from&&pt.beat<to).map(pt=>({...pt,beat:(pt.beat-from)*scale})),{beat:(to-from)*scale,value:at(to)}];};
    const lanes=r.bakedAutomation.flatMap(l=>{if(l.scope==='fx'){const match=ids.get(l.targetId);return match?[{...copy(l),targetId:match.id,points:remap(l,match.from,match.to)}]:[];}return [{...copy(l),targetId:c.id,points:remap(l,offset,offset+length)}];});
    return {clip:next,fx:[...(p.fxRegions||[]),...fx],lanes:[...(p.automationLanes||[]),...lanes]};
  }
  function unfreeze(p,c){const before=signature(p),r=restored(p,c);return daw().commitCreativeClip(p,before,c.id,r.clip,r.fx,r.lanes);}
  function slices(audio,count,mode='beats'){
    if(!Number.isInteger(count)||count<2||count>16||!['beats','attacks'].includes(mode)||audio.sampleRate!==48000)throw new Error('Choose 2 to 16 slices.');
    const n=audio.length,points=[0];
    if(mode==='attacks'){
      const hop=240,gap=4800,found=[];let previous=0;
      for(let at=hop;at<n-hop;at+=hop){let level=0;for(let c=0;c<audio.numberOfChannels;c++){const data=audio.getChannelData(c);for(let i=at;i<at+hop;i++)level+=Math.abs(data[i])/hop/audio.numberOfChannels;}const rise=level-previous;if(rise>.012&&level>previous*1.6)found.push({frame:at,score:rise});previous=level;}
      for(const hit of found.sort((a,b)=>b.score-a.score)){if(points.every(at=>Math.abs(at-hit.frame)>=gap)&&hit.frame<n-gap)points.push(hit.frame);if(points.length===count)break;}
    }
    if(points.length<count){for(let i=1;i<count;i++){const at=Math.round(n*i/count);if(points.every(p=>Math.abs(p-at)>=Math.min(480,n/count/4)))points.push(at);if(points.length===count)break;}}
    return [...points.sort((a,b)=>a-b),n];
  }
  function sliceAudio(audio,start,end){
    const frames=end-start,channels=[0,1].map(c=>audio.getChannelData(Math.min(c,audio.numberOfChannels-1)).slice(start,end)),fade=Math.min(96,Math.floor(frames/4));
    for(const data of channels)for(let i=0;i<fade;i++){data[i]*=i/fade;data[frames-1-i]*=i/fade;}
    return {length:frames,numberOfChannels:2,sampleRate:48000,getChannelData:c=>channels[c]};
  }
  async function chop(p,c,range,count=8,mode='beats',vocals=false,status=()=>{},alive=()=>true){
    if(job)throw new Error('Wait for the current clip preparation.');
    if(!Number.isInteger(count)||count<2||count>16)throw new Error('Choose 2 to 16 chops.');
    const before=signature(p),start=Math.max(c.timelineStartBeat,range?.start??c.timelineStartBeat),end=Math.min(c.timelineStartBeat+c.timelineDurationBeats,range?.end??c.timelineStartBeat+c.timelineDurationBeats),clock=daw().compileTempoMap(p);
    if(end-start<.25||clock.beatToSeconds(end)-clock.beatToSeconds(start)>16)throw new Error('Choose up to 16 seconds from one clip.');
    if(vocals&&!(c.stemState==='ready'&&c.stemJob))throw new Error('Prepare vocals first, or choose Current sound.');
    const reserved=new Set(Object.keys(p.drumSamples||{}));for(const pattern of [...(p.patternClips||[]),{steps:p.stepPattern||{}}])for(const [row,hits] of Object.entries(pattern.steps||{}))if(hits.length)reserved.add(row);
    const rows=Array.from({length:64},(_,i)=>i?'Vocal Chop '+(i+1):'Vocal Chop').filter(row=>!reserved.has(row));if(rows.length<count)throw new Error('Not enough free vocal pads. Remove unused samples first.');
    const ok=()=>alive()&&current(p,before),controller=new AbortController();job={cancel(){controller.abort();window.AxiomArrangement.stop(false,'chop-cancel');}};
    try{
      status('Preparing selected sound...');const q=cloneForClip(p,c,vocals?'vocals':null),r=await window.AxiomArrangement.render(q,{startBeat:start,endBeat:end,...(vocals?{stem:'vocals',clipId:c.id}:{})});
      if(!ok())throw new Error('Chopping cancelled or project changed.');
      const audio={length:r.frames,sampleRate:48000,numberOfChannels:2,getChannelData:ch=>r.audio.getChannelData(ch).subarray(r.trimFrames,r.trimFrames+r.frames)},points=slices(audio,count,mode),samples={...p.drumSamples},entries=[],steps={};
      for(let i=0;i<points.length-1;i++){
        if(!ok())throw new Error('Chopping cancelled or project changed.');status(`Saving chop ${i+1} of ${points.length-1}...`);
        const buffer=sliceAudio(audio,points[i],points[i+1]),encoded=await window.AxiomDawExport.encode({audio:buffer,frames:buffer.length,trimFrames:0},()=>!ok());
        const name='Chop '+(i+1)+' - '+(c.title||c.label||'Clip').slice(0,80),track=await upload(encoded.buffer,name,controller.signal),row=rows[i];
        samples[row]={path:track.path,name,assetIdentity:track.assetIdentity};entries.push({row,track,name});steps[row]=[1+Math.floor(points[i]/audio.length*64)];
      }
      if(!ok())throw new Error('Project changed. Chops were not assigned.');
      if(!daw().addPattern('drums',steps,{name:'Vocal Chops',samples,startBeat:start,lengthBeats:end-start}))throw new Error('Chops could not be assigned.');
      daw().selectSection('instruments');status(`${entries.length} chops ready. Tap the pads or edit their pattern.`);window.AxiomDawDrafts?.checkpoint();return entries;
    }finally{job=null;}
  }
  function pinnedAnchors(c,beat,seconds){
    const grid=daw().trackGrid(c);if(!grid||!Number.isFinite(beat)||!Number.isFinite(seconds))throw new Error('Prepare the grid first.');
    const anchors=grid.anchors.map(a=>({beat:a.beat,seconds:a.seconds}));
    // Pin adjacent numbered beats even when the source has only distant anchors.
    for(const b of [Math.floor(beat)-1,Math.ceil(beat)+1])if(!anchors.some(a=>a.beat===b)&&grid.beatToSeconds(b)>=0)anchors.push({beat:b,seconds:grid.beatToSeconds(b)});
    anchors.sort((a,b)=>a.beat-b.beat);return daw().correctBeatAnchor({beatAnchors:anchors},beat,seconds,'fixed');
  }
  function align(c,beat,seconds){const anchors=pinnedAnchors(c,beat,seconds),reference=daw().createBeatgridReference({...c.beatgrid,source:'manual',beatAnchors:anchors,metadata:{...c.beatgrid?.metadata,clipLocalAnchor:true,pinnedBeats:true}});return daw().applySourceGrid(c.id,anchors,reference,null,true);}
  function mountPads(root,p){
    const bank=root.querySelector('.studio-daw-pad-bank');if(!bank)return;const entries=Object.entries(p?.drumSamples||{});if(!entries.length)return;
    bank.replaceChildren();for(const [row,sample] of entries){const b=document.createElement('button');b.type='button';b.textContent=row==='Vocal Chop'?'Chop 1':row.startsWith('Vocal Chop ')?row.replace('Vocal Chop ','Chop '):row;b.title=sample.name||row;b.setAttribute('aria-label','Play '+row);b.onclick=()=>{if(p===daw().activeProject)window.AxiomBeatPreview.playPad(row);};bank.append(b);}
  }
  function open(action,c=selected(),range=null){
    const p=daw()?.activeProject;if(!p||!c){window.showToast?.('Select one audio clip.',true);return;}
    if(action==='unfreeze'){try{unfreeze(p,c);}catch(e){window.showToast?.(e.message,true);}return;}
    document.getElementById('daw-creative-tools')?.close();const dialog=document.createElement('dialog');dialog.id='daw-creative-tools';dialog.className='daw-fx-dialog';
    const title={freeze:'Freeze Clip',chop:'Chop to Pads',timing:'Fix Beat'}[action];if(!title)return;
    const heading=document.createElement('h2');heading.textContent=title;dialog.append(heading);
    const add=(label,type,value,min,max)=>{const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');Object.assign(input,{type,value,min,max});input.setAttribute('aria-label',label);row.append(input);dialog.append(row);return input;};
    let count,attacks,vocals,beat,seconds;
    if(action==='chop'){count=add('Number of chops','number',8,2,16);attacks=add('Slice at sound attacks','checkbox','');vocals=add('Use vocals only','checkbox','');vocals.disabled=!(c.stemState==='ready'&&c.stemJob);vocals.checked=!vocals.disabled;}
    if(action==='timing'){const at=daw().sourceCuePosition(c.id);beat=add('Beat to align','number',Math.round(at.beat),0,100000);beat.step='0.25';seconds=add('Source seconds','number',at.seconds,0,100000);seconds.step='0.001';}
    const text=document.createElement('p');text.textContent={freeze:'Prepare stems, timing and clip effects once. Unfreeze restores their settings. Mixer, fades and track effects stay editable. Up to two minutes.',chop:'Select up to 16 seconds. Creates new samples and a pattern without changing the song. Turn off attack slicing for equal pieces.',timing:'Place the waveform cursor on the late hit, then align its beat here. The neighbouring beats stay pinned. All stems follow together.'}[action];dialog.append(text);
    const status=document.createElement('output');status.setAttribute('role','status');dialog.append(status);const footer=document.createElement('footer'),cancel=document.createElement('button'),apply=document.createElement('button');cancel.textContent='Close';apply.textContent=title;footer.append(cancel,apply);dialog.append(footer);
    let busy=false;const close=()=>{if(busy)job?.cancel();dialog.close();};cancel.onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>dialog.remove());
    apply.onclick=async()=>{apply.disabled=true;busy=true;const alive=()=>dialog.isConnected&&dialog.open;
      try{if(p!==daw().activeProject||!(p.arrangementClips||[]).includes(c))throw new Error('Project or selected clip changed.');
        if(action==='freeze')await freeze(p,c,s=>status.textContent=s,alive);else if(action==='chop')await chop(p,c,range,Number(count.value),attacks.checked?'attacks':'beats',vocals.checked,s=>status.textContent=s,alive);else{align(c,Number(beat.value),Number(seconds.value));status.textContent='Beat aligned. Undo restores the previous timing.';}
        apply.hidden=true;cancel.textContent='Done';
      }catch(e){status.textContent=e.message;}finally{busy=false;apply.disabled=false;}};
    document.body.append(dialog);dialog.showModal();
  }
  window.AxiomCreativeTools={open,freeze,unfreeze,restored,cloneForClip,frozenTiming,slices,sliceAudio,pinnedAnchors,align,mountPads,signature};
})();
