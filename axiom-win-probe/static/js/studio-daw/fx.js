(function () {
  'use strict';
  const types={...(window.AxiomDawDjFx?.types||{}),tapeStop:'AXIOM Tape Stop',lowpass:'Low-pass sweep',highpass:'High-pass sweep',echo:'Echo',reverb:'Reverb',vintageReverb:'AXIOM Vintage Reverb',enhance:'AXIOM Mix Enhance'};
  const isReverb=type=>['reverb','vintageReverb'].includes(type);
  const hasTail=type=>type==='echo'||isReverb(type);
  const regionLabel=fx=>fx.type==='echo'&&fx.echoOut?'Echo Out':types[fx.type]||'Effect';
  const targetLabels={master:'Whole mix','left-deck':'Left Deck','right-deck':'Right Deck',samples:'Samples',recordings:'Recordings',instruments:'Drums / Instruments'};
  const enhanceComparisons=new WeakMap();
  function compareEnhance(p,id,settings){
    if(!p?.fxRegions?.some(f=>f.id===id&&f.type==='enhance'))return false;
    if(settings&&(typeof settings.original!=='boolean'||settings.wet!==undefined&&(!Number.isFinite(settings.wet)||settings.wet<0||settings.wet>1)))return false;
    if(settings){if(!enhanceComparisons.has(p))enhanceComparisons.set(p,new Map());enhanceComparisons.get(p).set(id,{...settings});}
    else enhanceComparisons.get(p)?.delete(id);
    window.AxiomArrangement?.mixerChanged?.(p);renderToolbar(p);return true;
  }
  function projectEnd(p){
    return Math.max(.25,...(p.arrangementClips||[]).map(c=>c.timelineStartBeat+c.timelineDurationBeats),
      ...(window.AxiomPatterns?.list(p)||p.patternClips||[]).map(c=>c.startBeat+c.durationBeats),
      ...(p.fxRegions||[]).filter(f=>f.coverage!=='project').map(f=>f.startBeat+f.durationBeats+(f.tailBeats||0)));
  }
  function effectiveRegion(p,fx){return fx.coverage==='project'?{...fx,startBeat:0,durationBeats:projectEnd(p),tailBeats:0}:fx;}
  function rangeTargets(p,start,end){
    const targets=new Set((p.arrangementClips||[]).filter(c=>c.timelineStartBeat<end&&c.timelineStartBeat+c.timelineDurationBeats>start).map(c=>c.sectionId));
    if((window.AxiomPatterns?.list(p)||[]).some(c=>c.startBeat<end&&c.startBeat+c.durationBeats>start))targets.add('instruments');
    return Object.keys(targetLabels).filter(id=>id!=='master'&&targets.has(id));
  }
  function quickApply(type,range,target){
    const p=project();if(!p||!range)return false;
    const {start,end}=range;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.25||end-start>1024)return false;
    const audible=rangeTargets(p,start,end);
    if(!Object.hasOwn(targetLabels,target)||!audible.length||target!=='master'&&!audible.includes(target)){
      window.showToast?.('Select bars that overlap audio on this track.',true);return false;
    }
    return applyQuickRegions(p,[quickRegion(type,start,end,target)]);
  }
  function quickRegion(type,start,end,target){
    const echoOut=type==='echoOut';
    const fx={id:crypto.randomUUID(),type:echoOut?'echo':type,target,startBeat:start,durationBeats:end-start,tailBeats:0,wet:1,reverse:false};
    if(echoOut||type==='echo')Object.assign(fx,{wet:.65,feedback:.5,delayBeats:1,tailBeats:8,...(echoOut?{echoOut:true}:{})});
    if(isReverb(type))Object.assign(fx,{wet:.35,tailBeats:8});
    if(type==='enhance')fx.wet=.5;
    if(type==='saturate')fx.wet=.35;
    if(type==='bitcrush')fx.wet=.5;
    return fx;
  }
  function applyQuickRegions(p,regions){
    if(project()!==p||!regions.length||regions.some(fx=>!validate(fx))){window.showToast?.('Select audio between 1/16 and 256 bars per effect.',true);return false;}
    const before=snapshot(p);p.fxRegions=[...(p.fxRegions||[]),...regions];
    selectedIds=new Set(regions.map(fx=>fx.id));selection={p,id:regions[0].id};
    changed(p,before);
    window.AxiomStudioDaw.selectSection?.('fx');
    const targets=[...new Set(regions.map(fx=>targetLabels[fx.target]))].join(', ');
    window.showToast?.(`${regionLabel(regions[0])} added to ${targets}${regions.length>1?` (${regions.length} regions)`:''}. Double-click the effect to adjust it; Undo removes it.`);
    return true;
  }
  const clipBoundSections=new Set(['samples','recordings','instruments']);
  const clipBoundLabel=fx=>fx?.clipId?'Selected clip':'Layer / track';
  const clipScoped=fx=>typeof fx?.clipId==='string'&&/^[a-zA-Z0-9_-]+$/.test(fx.clipId);
  function quickApplyClips(type,ids,options={}){
    const p=project();if(!p||!Array.isArray(ids)||!ids.length)return false;
    const unique=new Set(ids),clips=(p.arrangementClips||[]).filter(c=>unique.has(c.id));
    if(clips.length!==unique.size)return false;
    const ranges=[];
    for(const clip of clips.slice().sort((a,b)=>String(a.sectionId).localeCompare(String(b.sectionId))||a.timelineStartBeat-b.timelineStartBeat)){
      let start=clip.timelineStartBeat;const end=start+clip.timelineDurationBeats,target=clip.sectionId;
      if(type==='tapeStop')start=Math.max(start,end-4);
      if(target==='master'||!Object.hasOwn(targetLabels,target)||![start,end].every(Number.isFinite)||start<0||end<=start)return false;
      if(options.scope==='clip'){ranges.push({target,start,end,clipId:clip.id});continue;}
      const last=ranges.at(-1);
      // Adjacent/overlapping selected clips share one effect; separated clips
      // retain separate regions so gaps do not feed unrelated audio into FX.
      if(last&&last.target===target&&start<=last.end)last.end=Math.max(last.end,end);
      else ranges.push({target,start,end});
    }
    return applyQuickRegions(p,ranges.map(({start,end,target,clipId})=>({...quickRegion(type,start,end,target),...(clipId?{clipId}:{})})));
  }
  const compressorDelay=.006;
  const echoModules=new WeakMap();
  const vintageModules=new WeakMap();
  function openMasterLimiter(dialog=null){
    if(!window.AxiomMasterLimiter?.open){window.showToast?.('Master Limiter is unavailable. Reload AXIOM and try again.',true);return false;}
    dialog?.close?.();
    window.AxiomMasterLimiter.open();
    return true;
  }
  async function prepare(ctx,p){
    await window.AxiomTapeStop?.prepare(ctx,p);
    await window.AxiomDawSweeps?.prepare(ctx,p);
    if(p.fxRegions?.some(fx=>fx.type==='vintageReverb')){
      if(!ctx.audioWorklet)throw new Error('Vintage Reverb needs audio-worklet support.');
      if(!vintageModules.has(ctx))vintageModules.set(ctx,ctx.audioWorklet.addModule('/static/js/studio-daw/vintage-reverb-worklet.js?v=1').catch(error=>{vintageModules.delete(ctx);throw error;}));
      await vintageModules.get(ctx);
    }
    if(!ctx.audioWorklet||!window.AxiomPcmSource?.enabled||!p.fxRegions?.some(fx=>fx.type==='echo'))return;
    if(!echoModules.has(ctx))echoModules.set(ctx,ctx.audioWorklet.addModule('/static/js/studio-daw/echo-worklet.js?v=1').catch(error=>{echoModules.delete(ctx);throw error;}));
    await echoModules.get(ctx);
  }
  const reductionGraphs=new WeakMap();
  const matchGraphs=new WeakMap();
  function clearReduction(ctx,owned){
    if(!owned){reductionGraphs.delete(ctx);matchGraphs.delete(ctx);return;}
    const graph=reductionGraphs.get(ctx);if(graph)for(const node of owned)graph.delete(node);
    const matches=matchGraphs.get(ctx);if(matches)for(const node of owned)matches.delete(node);
  }
  function matchSource(ctx,p,id){
    if(!ctx||ctx.state!=='running')return null;
    return [...(matchGraphs.get(ctx)?.values()||[])].filter(r=>r.project===p&&r.id===id&&ctx.currentTime>=r.start&&ctx.currentTime<r.end).sort((a,b)=>b.start-a.start)[0]||null;
  }
  function readReduction(ctx,p,id){
    if(!ctx||ctx.state!=='running')return null;
    const now=ctx.currentTime,records=[...(reductionGraphs.get(ctx)?.values()||[])].filter(r=>r.project===p&&r.id===id&&now>=r.start&&now<r.end);
    if(!records.length)return null;
    const origin=Math.max(...records.map(r=>r.origin)),current=records.filter(r=>r.origin===origin);
    if(current.some(r=>!Number.isFinite(r.node.reduction)))return null;
    return {mode:current[0].mode,bands:current.map(r=>({name:r.name,db:Math.min(0,r.node.reduction)}))};
  }
  const bandThresholds=['enhanceLowThresholdDb','enhanceMidThresholdDb','enhanceHighThresholdDb'];
  const enhancementControls=[
    ['enhanceBodyDb','Body (dB)',-12,12,.1,-1.5],['enhanceAirDb','Air (dB)',-12,12,.1,1],
    ['enhanceThresholdDb','Threshold (dB)',-60,0,.1,-18],['enhanceRatio','Ratio',1,20,.1,2],
    ['enhanceAttackMs','Attack (ms)',.1,200,.1,20],['enhanceReleaseMs','Release (ms)',10,1000,1,150],
    ['enhanceOutputDb','Output trim (dB)',-12,12,.1,0],
    ['enhanceLowThresholdDb','Low threshold (dB)',-60,0,.1,-18],
    ['enhanceMidThresholdDb','Mid threshold (dB)',-60,0,.1,-18],
    ['enhanceHighThresholdDb','High threshold (dB)',-60,0,.1,-18],
  ];
  const impulseCaches=new WeakMap(),impulseCacheLimit=8*1024*1024;
  function reverbImpulse(ctx,length){
    let cache=impulseCaches.get(ctx);if(!cache){cache={buffers:new Map(),bytes:0,builds:0,hits:0};impulseCaches.set(ctx,cache);}
    if(cache.buffers.has(length)){const buffer=cache.buffers.get(length);cache.buffers.delete(length);cache.buffers.set(length,buffer);cache.hits++;return buffer;}
    const bytes=length*2*4;
    while(cache.bytes+bytes>impulseCacheLimit&&cache.buffers.size){const oldest=cache.buffers.keys().next().value;cache.buffers.delete(oldest);cache.bytes-=oldest*2*4;}
    const buffer=ctx.createBuffer(2,length,ctx.sampleRate);
    for(let c=0;c<2;c++){const data=buffer.getChannelData(c);let seed=12345+c;for(let i=0;i<length;i++){seed=(seed*16807)%2147483647;data[i]=(seed/2147483647*2-1)*Math.pow(1-i/length,3);}}
    cache.builds++;if(bytes<=impulseCacheLimit){cache.buffers.set(length,buffer);cache.bytes+=bytes;}return buffer;
  }
  function reverbCacheStats(ctx){const cache=impulseCaches.get(ctx);return {bytes:cache?.bytes||0,builds:cache?.builds||0,hits:cache?.hits||0,limit:impulseCacheLimit};}
  const echoDivisions=[[.25,'1/16'],[1/3,'1/8 triplet'],[.375,'1/16 dotted'],[.5,'1/8'],[2/3,'1/4 triplet'],[.75,'1/8 dotted'],[1,'1/4'],[4/3,'1/2 triplet'],[1.5,'1/4 dotted'],[2,'1/2'],[8/3,'1 bar triplet'],[3,'1/2 dotted'],[4,'1 bar']];
  function changeTiming(id,factor){
    const p=project(),fx=p?.fxRegions?.find(f=>f.id===id);if(fx?.type!=='echo'||![.5,2].includes(factor))return false;
    const next=(fx.delayBeats??.5)*factor;
    if(!echoDivisions.some(([value])=>value===next))return false;
    const before=snapshot(p);fx.delayBeats=next;
    window.AxiomArrangement?.mixerChanged?.(p);
    return changed(p,before,false);
  }
  function echoTiming(clock,fx,fromBeat=fx.startBeat,sampleRate=48000){
    const division=fx.delayBeats??.5,endBeat=fx.startBeat+fx.durationBeats+fx.tailBeats;
    const first=Math.max(fx.startBeat,fromBeat),last=clock.beatToSeconds(endBeat);
    if(first>=endBeat)return [];
    const delayAt=seconds=>{
      const previous=clock.secondsToBeat(seconds)-division;
      const delay=seconds-(previous<0?previous*60/clock.bpmAtBeat(0):clock.beatToSeconds(previous));
      if(!Number.isFinite(delay)||delay<=0||delay>=180)throw new Error('Echo division exceeds the supported delay range at this tempo.');
      return delay;
    };
    // Read the sample one division earlier on the project clock, including across tempo changes.
    const boundaries=[first,endBeat,...(clock.segments||[]).flatMap(s=>[s.beat,s.beat+division])].filter(b=>b>=first&&b<=endBeat);
    const times=[...new Set(boundaries.map(b=>clock.beatToSeconds(b)))].sort((a,b)=>a-b);
    const points=[{seconds:times[0],delay:delayAt(times[0])}];
    function segment(a,b,depth=0){
      const probes=[.25,.5,.75].map(f=>({seconds:a.seconds+(b.seconds-a.seconds)*f,expected:a.delay+(b.delay-a.delay)*f}));
      if(probes.some(pt=>Math.abs(delayAt(pt.seconds)-pt.expected)>.25/sampleRate)){
        if(depth>=24||points.length>100000)throw new Error('Echo tempo map is too complex to schedule safely.');
        const seconds=(a.seconds+b.seconds)/2,mid={seconds,delay:delayAt(seconds)};segment(a,mid,depth+1);segment(mid,b,depth+1);
      }else points.push(b);
    }
    for(const seconds of times.slice(1))segment(points.at(-1),{seconds:Math.min(last,seconds),delay:delayAt(seconds)});
    return points;
  }
  function cutoffCurve(p,fx){
    const clock=window.AxiomStudioDaw.compileTempoMap(p),start=clock.beatToSeconds(fx.startBeat),duration=clock.beatToSeconds(fx.startBeat+fx.durationBeats)-start,a=fx.reverse?18000:80,b=fx.reverse?80:18000;
    return beat=>fx.cutoffHz??a*Math.pow(b/a,Math.max(0,Math.min(1,(clock.beatToSeconds(Math.max(0,beat))-start)/duration)));
  }
  function latency(p){const regions=(p.fxRegions||[]).filter(fx=>fx.type==='enhance');if(regions.some(fx=>!validate(fx)))throw new Error('Invalid mix enhancement region.');return regions.length*compressorDelay;}
  function warmup(p,{preMaster=false,preparedPcm=false}={}){
    const regions=(p.fxRegions||[]).filter(fx=>fx.type==='enhance'&&(!preMaster||fx.target!=='master'));
    if(!regions.length)return 0;
    if(regions.some(fx=>!validate(fx)))throw new Error('Invalid mix enhancement region.');
    // The shorter native startup is verified for one graph with release <=150 ms.
    if(!preparedPcm||regions.length!==1)return 2;
    const fx=regions[0],release=fx.enhanceReleaseMs??150;
    const points=(p.automationLanes||[]).filter(l=>l.scope==='fx'&&l.targetId===fx.id&&l.parameter==='enhanceReleaseMs').flatMap(l=>l.points||[]);
    return release<=150&&points.every(pt=>Number.isFinite(pt.value)&&pt.value>=10&&pt.value<=150)?1:2;
  }
  function enhancement(ctx,input,own,fx,timing,controlled,p,clock){
    const rumble=own(ctx.createBiquadFilter());rumble.type='highpass';rumble.frequency.value=25;rumble.Q.value=.707;
    const body=own(ctx.createBiquadFilter());body.type='peaking';body.frequency.value=260;body.Q.value=.7;body.gain.value=-1.5;
    const air=own(ctx.createBiquadFilter());air.type='highshelf';air.frequency.value=7000;air.gain.value=1;
    const makeup=own(ctx.createGain());makeup.gain.value=1.12;
    const bind=(param,name)=>{
      const fallback=enhancementControls.find(control=>control[0]===name)[5];
      const output=name==='enhanceOutputDb',milliseconds=['enhanceAttackMs','enhanceReleaseMs'].includes(name);
      const transform=milliseconds?value=>value/1000:output?value=>1.12*Math.pow(10,value/20):value=>value;
      param.value=transform(fx[name]??fallback);
      // Pre-compressor changes enter before its lookahead; output trim follows the delayed signal.
      controlled(fx,param,name,output?timing:{...timing,origin:timing.origin-compressorDelay},fallback,transform);
    };
    bind(body.gain,'enhanceBodyDb');bind(air.gain,'enhanceAirDb');bind(makeup.gain,'enhanceOutputDb');
    const compress=(source,threshold)=>{
      const compressor=own(ctx.createDynamicsCompressor());compressor.knee.value=12;
      for(const [parameter,name] of [['threshold',threshold],['ratio','enhanceRatio'],['attack','enhanceAttackMs'],['release','enhanceReleaseMs']])bind(compressor[parameter],name);
      source.connect(compressor).connect(makeup);
      if(!reductionGraphs.has(ctx))reductionGraphs.set(ctx,new Map());
      reductionGraphs.get(ctx).set(compressor,{node:compressor,project:p,id:fx.id,mode:fx.enhanceDynamicsMode||'broadband',name:threshold,
        origin:timing.origin,start:timing.origin+clock.beatToSeconds(timing.startBeat),end:timing.origin+clock.beatToSeconds(timing.endBeat)});
    };
    if(fx.enhanceDynamicsMode==='multiband'){
      // Residual bands reconstruct the input at unity: low + (upper-low) + (input-upper).
      // Parallel native compressors share one lookahead, including the dry path.
      const low=own(ctx.createBiquadFilter()),upper=own(ctx.createBiquadFilter());
      for(const [filter,hz] of [[low,200],[upper,3000]]){filter.type='lowpass';filter.frequency.value=hz;filter.Q.value=0;air.connect(filter);}
      const mid=own(ctx.createGain()),high=own(ctx.createGain()),invertLow=own(ctx.createGain()),invertUpper=own(ctx.createGain());
      invertLow.gain.value=-1;invertUpper.gain.value=-1;
      upper.connect(mid);low.connect(invertLow).connect(mid);
      air.connect(high);upper.connect(invertUpper).connect(high);
      [low,mid,high].forEach((band,index)=>compress(band,bandThresholds[index]));
    }else compress(air,'enhanceThresholdDb');
    const guard=own(ctx.createWaveShaper()),curve=new Float32Array(4097);
    for(let i=0;i<curve.length;i++){const x=2*i/(curve.length-1)-1,a=Math.abs(x);curve[i]=Math.sign(x)*(a<=.8?a:.8+.18*Math.tanh((a-.8)/.18));}
    guard.curve=curve;
    input.connect(rumble).connect(body).connect(air);makeup.connect(guard);
    return guard;
  }
  const project=()=>window.AxiomStudioDaw.activeProject;
  const refresh=()=>window.AxiomStudioDaw.refreshArrangement();
  const histories=new WeakMap();
  let selection=null,clipboard=null,selectedIds=new Set();
  function select(id,event){event?.stopPropagation();window.AxiomStudioDaw.selectSection?.('fx');selectedIds.clear();selectedIds.add(id);selection={p:project(),id};refresh();}
  function selectAll(options={}){
    const p=project();if(!p)return 0;
    selectedIds=new Set((p.fxRegions||[]).map(fx=>fx.id));
    selection=selectedIds.size?{p,id:[...selectedIds][0]}:null;
    if(options.render!==false)refresh();
    return selectedIds.size;
  }
  function clearSelection(){selectedIds.clear();selection=null;}
  function selectedIdsForProject(){const p=project();return selection?.p===p?[...selectedIds]:[];}
  function copySelected(){
    const p=project(),fx=selection?.p===p&&selectedIds.size===1&&p.fxRegions?.find(f=>f.id===selection.id);
    if(!fx||fx.coverage==='project'||window.AxiomStudioDaw.expandedSection!=='fx')return false;
    clipboard={p,fx:JSON.parse(JSON.stringify(fx)),automation:JSON.parse(JSON.stringify((p.automationLanes||[]).filter(l=>l.scope==='fx'&&l.targetId===fx.id)))};return true;
  }
  function paste(){
    if(!clipboard||clipboard.p!==project()||window.AxiomStudioDaw.expandedSection!=='fx')return false;
    return apply({...clipboard.fx,id:crypto.randomUUID(),startBeat:Math.max(0,project().editCursorBeat||0)},clipboard.automation);
  }
  function resized(fx,edge,beat){
    if(fx.coverage==='project')return false;
    const next={...fx},end=fx.startBeat+fx.durationBeats;
    if(edge==='left'){next.startBeat=Math.max(0,Math.min(end-.25,beat));next.durationBeats=end-next.startBeat;}
    else if(edge==='right')next.durationBeats=Math.max(.25,beat-fx.startBeat);
    else if(edge==='tail'&&hasTail(fx.type))next.tailBeats=Math.max(0,beat-end);
    else return null;
    return validate(next)?next:null;
  }
  function resize(id,edge,beat){const fx=project()?.fxRegions?.find(f=>f.id===id),next=fx&&resized(fx,edge,beat);return next?apply(next):false;}
  function dragResize(event,id,edge){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const p=project(),fx=p.fxRegions?.find(f=>f.id===id),lanes=document.getElementById('studio-daw-lanes');
    if(!fx||fx.coverage==='project'||!lanes)return;
    const rect=lanes.getBoundingClientRect(),span=Number(lanes.dataset.viewBeats),before=JSON.stringify(fx);
    if(!(rect.width>0&&span>0))return;
    const handle=event.currentTarget,article=handle.closest('.daw-fx-region'),originalStyle=article?.getAttribute('style'),viewStart=Number(lanes.dataset.viewStart||0);
    const origin=edge==='left'?fx.startBeat:fx.startBeat+fx.durationBeats+(edge==='tail'?fx.tailBeats:0);
    let next=null;
    const move=e=>{
      if(Math.abs(e.clientX-event.clientX)<3)return;
      const beat=window.AxiomStudioDaw.snapBeat(origin+(e.clientX-event.clientX)/rect.width*span,e);
      next=resized(fx,edge,beat);
      if(next){
        handle.title=`${next.durationBeats/4} active bars; ${next.tailBeats/4} tail bars`;
        if(article){article.style.left=`${(Math.max(viewStart,next.startBeat)-viewStart)/span*100}%`;article.style.width=`${(Math.min(viewStart+span,next.startBeat+next.durationBeats+next.tailBeats)-Math.max(viewStart,next.startBeat))/span*100}%`;}
      }
    };
    const clean=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',clean);if(article&&originalStyle!==null)article.setAttribute('style',originalStyle);};
    const end=e=>{move(e);clean();if(next&&project()===p&&JSON.stringify(p.fxRegions.find(f=>f.id===id))===before)apply(next);};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',clean);
  }
  function move(id,startBeat){
    const p=project(),fx=p?.fxRegions?.find(f=>f.id===id);
    if(!fx||fx.coverage==='project'||!Number.isFinite(startBeat)||startBeat<0||startBeat===fx.startBeat)return false;
    return apply({...fx,startBeat});
  }
  function dragMove(event,id){
    if(event.button!==0||event.target.closest?.('button,.daw-echo-timing'))return;
    event.stopPropagation();
    const p=project(),fx=p?.fxRegions?.find(f=>f.id===id),lanes=document.getElementById('studio-daw-lanes');
    if(!fx||fx.coverage==='project'||!lanes)return;
    const article=event.currentTarget,rect=article.parentElement.getBoundingClientRect(),span=Number(lanes.dataset.viewBeats),viewStart=Number(lanes.dataset.viewStart||0);
    if(!(rect.width>0&&span>0))return;
    const before=JSON.stringify(fx),originalStyle=article.getAttribute('style');let next=null;
    const moving=e=>{
      if(Math.abs(e.clientX-event.clientX)<3)return;
      e.preventDefault();next=Math.max(0,window.AxiomStudioDaw.snapBeat(fx.startBeat+(e.clientX-event.clientX)/rect.width*span,e));
      article.style.left=(Math.max(viewStart,next)-viewStart)/span*100+'%';
      article.style.width=Math.max(0,Math.min(viewStart+span,next+fx.durationBeats+fx.tailBeats)-Math.max(viewStart,next))/span*100+'%';
    };
    const clean=()=>{document.removeEventListener('pointermove',moving);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',clean);if(originalStyle!==null)article.setAttribute('style',originalStyle);};
    const end=e=>{moving(e);clean();if(next!==null&&project()===p&&JSON.stringify(p.fxRegions.find(f=>f.id===id))===before)move(id,next);};
    document.addEventListener('pointermove',moving);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',clean);
  }
  const snapshot=p=>JSON.stringify({regions:p.fxRegions||[],automation:p.automationLanes||[]});
  function history(p){if(!histories.has(p))histories.set(p,{undo:[],redo:[]});return histories.get(p);}
  function validate(fx){
    if(fx?.type==='tapeStop'&&!window.AxiomTapeStop?.validate(fx))return false;
    if(fx?.coverage!==undefined&&(fx.type!=='enhance'||!['project','range'].includes(fx.coverage)||fx.coverage==='project'&&(fx.startBeat!==0||fx.tailBeats!==0)))return false;
    if(fx?.echoOut!==undefined&&(fx.type!=='echo'||typeof fx.echoOut!=='boolean'))return false;
    if(fx?.clipId!==undefined&&(!clipScoped(fx)||fx.target==='master'||fx.coverage==='project'))return false;
    if(fx&&Object.hasOwn(window.AxiomDawDjFx?.types||{},fx.type)&&!window.AxiomDawDjFx.validate(fx))return false;
    if(fx?.sweepVariant!==undefined&&(fx.type!=='gatedSweep'||!Object.hasOwn(window.AxiomDawSweeps?.variants||{},fx.sweepVariant)))return false;
    if(fx?.sweepPattern!==undefined&&(fx.type!=='gatedSweep'||!['voiceBuild','halfBars'].includes(fx.sweepPattern)))return false;
    if(fx?.sweepSpeed!==undefined&&(fx.type!=='gatedSweep'||!['auto','steady','double','fast'].includes(fx.sweepSpeed)))return false;
    if(fx?.sweepWindow!==undefined&&(fx.type!=='gatedSweep'||!Array.isArray(fx.sweepWindow)||fx.sweepWindow.length!==2||!fx.sweepWindow.every(Number.isFinite)||fx.sweepWindow[0]<0||fx.sweepWindow[1]>1||fx.sweepWindow[0]>=fx.sweepWindow[1]||fx.durationBeats/(fx.sweepWindow[1]-fx.sweepWindow[0])>1024.000001))return false;
    return fx&&Object.hasOwn(types,fx.type)&&(fx.type!=='enhance'||fx.target==='master')&&(!fx.sweepSource||fx.type==='gatedSweep'&&window.AxiomDawSweeps?.validateSource(fx.sweepSource))&&['master','left-deck','right-deck','samples','recordings','instruments'].includes(fx.target)&&typeof fx.id==='string'&&/^[a-zA-Z0-9_-]+$/.test(fx.id)&&
      ['startBeat','durationBeats','tailBeats','wet'].every(key=>Number.isFinite(fx[key]))&&fx.startBeat>=0&&fx.durationBeats>=.25&&(fx.type==='enhance'||fx.durationBeats<=1024)&&fx.tailBeats>=0&&fx.tailBeats<=256&&fx.wet>=0&&fx.wet<=1&&
      (fx.feedback===undefined||Number.isFinite(fx.feedback)&&fx.feedback>=0&&fx.feedback<=.9)&&
      (fx.delayBeats===undefined||echoDivisions.some(([value])=>value===fx.delayBeats))&&
      (fx.decaySeconds===undefined||Number.isFinite(fx.decaySeconds)&&fx.decaySeconds>=.1&&fx.decaySeconds<=(fx.type==='vintageReverb'?30:8))&&
      (fx.vintageMode===undefined||['hall','plate','chamber'].includes(fx.vintageMode))&&
      [['vintageSize',.5,2],['vintageModMs',0,5],['vintageLowCutHz',20,1000],['vintageWidth',0,150],['vintageColor',0,100]].every(([key,min,max])=>fx[key]===undefined||Number.isFinite(fx[key])&&fx[key]>=min&&fx[key]<=max)&&
      (fx.preDelayMs===undefined||Number.isFinite(fx.preDelayMs)&&fx.preDelayMs>=0&&fx.preDelayMs<=250)&&
      (fx.dampingHz===undefined||Number.isFinite(fx.dampingHz)&&fx.dampingHz>=200&&fx.dampingHz<=20000)&&
      (fx.resonanceDb===undefined||Number.isFinite(fx.resonanceDb)&&fx.resonanceDb>=-12&&fx.resonanceDb<=24)&&
      (fx.cutoffHz===undefined||Number.isFinite(fx.cutoffHz)&&fx.cutoffHz>=20&&fx.cutoffHz<=20000)&&
      (fx.enhanceDynamicsMode===undefined||['broadband','multiband'].includes(fx.enhanceDynamicsMode))&&
      (fx.enhanceMatchDb===undefined||Number.isFinite(fx.enhanceMatchDb)&&Math.abs(fx.enhanceMatchDb)<=12)&&
      enhancementControls.every(([name,,min,max])=>fx[name]===undefined||Number.isFinite(fx[name])&&fx[name]>=min&&fx[name]<=max);
  }
  function changed(p,before,stopPlayback=true){
    const after=snapshot(p);if(before===after)return false;
    const h=history(p);h.undo.push({before,after});if(h.undo.length>100)h.undo.shift();h.redo=[];
    window.AxiomEditHistory?.record(p,'fx');
    if(stopPlayback)window.AxiomArrangement?.stop(false);window.AxiomStudioDaw.clearRange?.();refresh();return true;
  }
  function apply(region,automation=[]){
    const p=project();if(!p||!validate(region))return false;
    const before=snapshot(p),fx={...region,tailBeats:hasTail(region.type)?region.tailBeats:0,reverse:['lowpass','highpass'].includes(region.type)&&Boolean(region.reverse)};
    if(!fx.clipId)delete fx.clipId;
    if(fx.gateSteps)fx.gateSteps=[...fx.gateSteps];
    if(fx.sweepSource)fx.sweepSource={...fx.sweepSource};
    if(fx.sweepWindow)fx.sweepWindow=[...fx.sweepWindow];
    p.fxRegions ||= [];const index=p.fxRegions.findIndex(f=>f.id===fx.id);
    if(index<0)p.fxRegions.push(fx);else p.fxRegions[index]=fx;
    if(window.AxiomDawAutomation?.available)p.automationLanes=(p.automationLanes||[]).filter(l=>l.scope!=='fx'||l.targetId!==fx.id||window.AxiomDawAutomation.available(p,l));
    if(automation.length)p.automationLanes=[...(p.automationLanes||[]),...JSON.parse(JSON.stringify(automation)).map(l=>({...l,targetId:fx.id}))];
    return changed(p,before);
  }
  function undo(redo=false){
    if(window.AxiomEditHistory&&!window.AxiomEditHistory.dispatching)return window.AxiomEditHistory.undo(project(),redo);
    const p=project();if(!p)return false;const h=history(p),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo,entry=from.at(-1);
    if(!entry)return false;
    if(snapshot(p)!==entry[redo?'before':'after']){window.showToast?.('FX changed outside this history. Undo cannot safely replace them.',true);return false;}
    window.AxiomArrangement?.stop(false);const state=JSON.parse(entry[redo?'after':'before']);p.fxRegions=state.regions;p.automationLanes=state.automation;from.pop();to.push(entry);refresh();return true;
  }
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function explainControls(form,type){
    const echo=type==='echo',reverb=isReverb(type);
    const effectHelp={
      gatedSweep:'Adds a rising, rhythmically chopped whoosh over the music. It gets brighter and chops faster near the end, then fades out. The movement is already programmed.',
      echo:'Repeats the sound in time with your project. Set the loudness, spacing and fade of those repeats below.',
      reverb:'Adds a sense of room and space around the sound, with a fading wash afterward.',
      vintageReverb:'Original AXIOM hall, plate and chamber spaces with a moving, vintage-coloured decay.',
      tranceGate:'Chops the sound into your chosen rhythm. Lit steps let sound through; dark steps turn it down.',
      lowpass:'Removes high frequencies for a darker, muffled sound. Sweep the filter or hold it at one frequency.',
      highpass:'Removes low frequencies for a thinner sound. Sweep the filter or hold it at one frequency.',
      filter:'Move one control either way to remove treble or bass. Centre leaves the sound unchanged.',
      sidechainHard:'Makes this track dip firmly when another track plays, for a stronger pumping effect.',
      sidechainSoft:'Makes this track dip gently when another track plays, to leave more room for that sound.',
      amplify:'Raises the volume of this track during the effect region.',
      brighten:'Adds brightness and clarity to the upper frequencies.',
      limiter:'Controls loud sample peaks so the processed sound stays under your chosen output ceiling.',
      enhance:'Shapes warmth and brightness, then controls loud peaks to balance the mix.',
    };
    const help={
      type:['Effect',effectHelp[type]||'Choose the sound or processing to add.'],
      target:['Apply to','Choose which track gets the effect. Master applies it to the whole mix.'],
      start:['Start at bar','Move this earlier or later to choose when the effect begins.'],
      length:[echo||reverb?'Feed effect for (bars)':'Effect duration (bars)',echo||reverb?'How long audio enters the effect. Overlap this region with the sample; the tail follows afterward.':'More bars keeps the effect active longer. Fewer bars ends it sooner.'],
      tail:[echo?'Echo tail (bars)':'Reverb tail (bars)',echo?'More bars allows a longer echo after the active region. Repeat strength controls how quickly it fades.':'More bars allows the reverb to ring out longer after the active region. Decay controls how quickly it fades.'],
      wet:[type==='gatedSweep'?'Sweep loudness':echo?'Echo loudness (wet)':reverb?'Reverb loudness (wet)':'Effect blend (wet)',type==='gatedSweep'?'Turn up for a stronger whoosh; turn down to tuck it behind the song. The original music stays at its own level.':echo?'Turn up for louder echoes; turn down for subtler echoes. The original sample stays at its own level.':reverb?'Turn up for a louder, roomier reverb; turn down for a drier sound. The original stays at its own level.':'Turn up to hear more of the processed sound; turn down to hear more of the original.'],
      feedback:['Repeat strength (feedback)','Higher values keep repeats louder for longer and make the echo more intense. Lower values fade faster; 0 gives one repeat.'],
      delayBeats:['Repeat spacing','1/16 gives fast, close repeats. 1/2 or 1 bar leaves more space between echoes. Timing follows the project BPM.'],
      reverse:['Reverse sweep direction','Flip which way the automatic filter moves during the effect.'],
      cutoffMode:['Filter movement','Sweep moves the filter over time. Fixed holds it at the frequency you choose.'],
      resonanceDb:['Filter emphasis (resonance)','Higher values make the sound around the cutoff more pronounced and sharper. Lower values make it smoother.'],
      cutoffHz:['Filter frequency (Hz)',type==='highpass'?'Raise this to remove more bass and thin the sound. Lower it to let more bass through.':'Lower this to remove more treble and darken the sound. Raise it to let more detail through.'],
      decayMode:['Reverb fade mode',`Follow tail derives the fade from the tail length, up to ${type==='vintageReverb'?30:8} seconds. Custom lets you set the fade time yourself.`],
      decaySeconds:['Reverb fade time (seconds)','Higher values make the reverb fade more slowly. The tail must be long enough to let it finish.'],
      preDelayMs:['Gap before reverb (ms)','Higher values leave more space between the original sound and the reverb. Lower values bring them closer together.'],
      dampingHz:['Reverb brightness (Hz)','Lower values soften and darken the reverb. Higher values keep more high-frequency detail.'],
      vintageMode:['Space character','Hall is spacious and moving; Plate is bright and dense; Chamber is tighter and more intimate.'],
      vintageSize:['Space size','Higher values spread reflections farther apart for a larger space. Lower values make it tighter.'],
      vintageModMs:['Tail movement (ms)','Turn up for more pitch movement and shimmer in the reverb. Turn down for a steadier tail.'],
      vintageLowCutHz:['Remove bass below (Hz)','Raise this to keep bass out of the reverb and leave the kick clearer.'],
      vintageWidth:['Stereo width (%)','0 centres the reverb. 100 gives its natural stereo spread; higher values widen it.'],
      vintageColor:['Vintage warmth (%)','Turn up for a darker, softer decay. Turn down for a clearer, brighter space.'],
      gateDepth:['Chop strength (%)','100 silences closed steps. Lower values leave more of the original sound underneath.'],
      gateAttackMs:['Step fade-in (ms)','Shorter values give sharper starts. Longer values soften each opening.'],
      gateDecayMs:['Step decay (ms)','Sets how quickly each opening settles from its initial peak to the hold level.'],
      gateSustain:['Step hold level (%)','Lower values make the opening fade quieter while a step stays on. 100 keeps it fully open.'],
      gateReleaseMs:['Step fade-out (ms)','Shorter values give tighter cuts. Longer values smooth each closing.'],
      gateStepBeats:['Step length','Choose how quickly the pattern moves. Smaller note values chop faster and follow project tempo.'],
      gateSwing:['Swing (%)','Delays every second step for a more shuffled rhythm. 0 keeps straight timing.'],
      sweepVariant:['Sweep character','Choose the generated sweep tone. Bright Rise is the classic whoosh; Warm Lift is rounder, Air Cut is thinner, and Tight Build is sharper.'],
      sweepPattern:['Build rhythm','Short - short - long repeats two brief bursts and one held sweep. This rhythm doubles in speed halfway through, then doubles again for the final quarter. Timing follows your project BPM.'],
      sweepSpeed:['Chop speed','Build automatically changes the rhythm as the sweep rises. Choose Faster or Fastest chops to hear them throughout this section. After adding it, split and move the waveform pieces on the timeline to bring the faster chops in earlier.'],
      enhanceDynamicsMode:['Compression mode','Broadband controls the whole mix together. Three-band controls bass, mids and highs separately.'],
      enhanceBodyDb:['Body / warmth (dB)','Turn up for more low-mid fullness; turn down to reduce thickness or muddiness.'],
      enhanceAirDb:['Air / brightness (dB)','Turn up for more sparkle in the highs; turn down for a softer top end.'],
      enhanceThresholdDb:['Compression starts at (dB)','Lower this toward -60 to compress more of the mix. Raise it toward 0 to catch only louder peaks.'],
      enhanceRatio:['Compression strength (ratio)','Higher values control loud peaks more firmly. Lower values leave more of the original dynamics.'],
      enhanceAttackMs:['Compression response (ms)','Lower values catch peaks faster. Higher values let more of the initial drum hit through.'],
      enhanceReleaseMs:['Compression recovery (ms)','Lower values release the compression faster. Higher values hold it longer between hits.'],
      enhanceOutputDb:['Final level (dB)','Turn up to make the processed mix louder; turn down to reduce its level.'],
      enhanceMatchDb:['Loudness match adjustment (dB)','Adjust the measured loudness correction. Positive values raise the processed level; negative values lower it.'],
      enhanceLowThresholdDb:['Bass compression starts at (dB)','Lower values compress more of the bass. Higher values catch only its louder peaks.'],
      enhanceMidThresholdDb:['Mid compression starts at (dB)','Lower values compress more of the vocals and midrange. Higher values catch only louder peaks.'],
      enhanceHighThresholdDb:['High compression starts at (dB)','Lower values compress more of the treble. Higher values catch only its louder peaks.'],
      filterPosition:['Filter position','0 leaves the sound unchanged. Negative values remove treble; positive values remove bass. Further from 0 is more extreme.'],
      fxAmount:[type==='brighten'?'Brightness (%)':'Ducking strength (%)',type==='brighten'?'Turn up to add more high-frequency clarity. Turn down for less added brightness.':'Turn up to dip this track more strongly when the trigger track plays. Turn down for a gentler dip.'],
      driveDb:['Level boost (dB)',type==='limiter'?'Turn up to push the sound harder into the limiter for a denser, more intense result.':'Turn up to make this track louder. Use a limiter afterward if you need to control peaks.'],
      ceilingDb:['Maximum output level (dB)','Lower values set a quieter limit for sample peaks. Values nearer 0 allow a louder output.'],
      limiterReleaseMs:['Limiter recovery (ms)','Lower values restore the level faster after a peak. Higher values keep it reduced for longer.'],
      sidechainSource:['Track that triggers the dip','Audio from this track turns down the effect target. The trigger is read before its deck effects and volume fader.'],
    };
    if(echo&&form.elements.namedItem('echoOut')?.checked){
      help.wet=['Echo amount','Turn up for louder repeats; turn down for subtler repeats. The original fades automatically.'];
      help.length=['Fade out over (bars)','The original fades across these bars, then only the echo tail remains.'];
    }
    for(const [name,[label,description]] of Object.entries(help)){
      const control=form.elements.namedItem(name);if(!control)continue;
      const row=control.parentElement;
      const caption=[...row.childNodes].find(node=>node.nodeType===3&&node.textContent.trim());
      if(caption)caption.textContent=label;
      let hint=row.querySelector('.daw-fx-control-help');
      if(!hint){hint=document.createElement('small');hint.className='daw-fx-control-help';hint.id='daw-fx-help-'+name;row.append(hint);}
      const customHelp=['length','tail'].includes(name)?` Use a button or type a custom length, up to ${control.max} bars.`:'';
      hint.textContent=description+customHelp;control.title=description+customHelp;control.setAttribute('aria-label',label);control.setAttribute('aria-describedby',hint.id);
    }
    const legacyHelp=form.querySelector('.daw-dj-fx-help');if(legacyHelp)legacyHelp.hidden=true;
  }
  function edit(id,selection={}) {
    const p=project();if(!p) return;
    const selectedRange=window.AxiomStudioDaw.selectedRange;
    p.fxRegions ||= [];
    const existing=p.fxRegions.find(f=>f.id===id);
    const fx=existing?{...existing,...selection}:{type:'echo',target:'master',startBeat:p.editCursorBeat || 0,durationBeats:4,tailBeats:8,reverse:false,wet:.35,...selection};
    document.getElementById('daw-fx-editor')?.close();
    const dialog=document.createElement('dialog');dialog.id='daw-fx-editor';dialog.className='daw-fx-dialog';
    dialog.innerHTML=`<form method="dialog"><h2>${existing?'Edit':'Add'} FX Region</h2><label>Effect<select name="type">${Object.entries(types).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Target<select name="target">${['master','left-deck','right-deck','samples','recordings','instruments'].map(value=>`<option value="${value}">${value==='instruments'?'Drums / Instruments':value.replace('-',' ')}</option>`).join('')}</select></label><label>Start bar<input name="start" type="number" min="1" step="0.0625" required></label><label>Active bars<input name="length" type="number" min="0.0625" max="256" step="0.0625" required></label><label>Tail bars<input name="tail" type="number" min="0" max="64" step="0.0625" required></label><label>Wet level<input name="wet" type="range" min="0" max="1" step="0.01"></label><label><input name="reverse" type="checkbox">Reverse sweep direction</label><footer><button value="cancel">Cancel</button><button value="save">Apply</button></footer></form>`;
    const form=dialog.querySelector('form');
    const masterLimiter=document.createElement('section');masterLimiter.className='daw-fx-master-limiter-callout';
    masterLimiter.innerHTML='<div><strong>Master Limiter</strong><small>Open the whole-mix limiter with the Amount dial. This is separate from timeline FX regions.</small></div>';
    const masterLimiterButton=document.createElement('button');masterLimiterButton.type='button';masterLimiterButton.textContent='Open Master Limiter';masterLimiterButton.onclick=event=>{event.preventDefault();openMasterLimiter(dialog);};
    masterLimiter.append(masterLimiterButton);form.querySelector('h2').after(masterLimiter);
    let creatingSweep=false,coverage=fx.coverage||(!existing&&fx.type==='enhance'?(selectedRange?'selected':'project'):'range');
    const sweepStatus=document.createElement('output');sweepStatus.setAttribute('role','status');form.querySelector('footer').before(sweepStatus);
    const divisionRow=document.createElement('label');divisionRow.textContent='Echo division';const division=document.createElement('select');division.name='delayBeats';
    for(const [value,label] of echoDivisions){const option=document.createElement('option');option.value=value;option.textContent=label;division.append(option);}division.value=String(fx.delayBeats??.5);divisionRow.append(division);form.querySelector('footer').before(divisionRow);
    const modeRow=document.createElement('label');modeRow.textContent='Cutoff';const mode=document.createElement('select');mode.name='cutoffMode';
    for(const [value,label] of [['sweep','Sweep'],['fixed','Fixed']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);}mode.value=fx.cutoffHz===undefined?'sweep':'fixed';modeRow.append(mode);form.querySelector('footer').before(modeRow);
    const decayRow=document.createElement('label');decayRow.textContent='Decay';const decayMode=document.createElement('select');decayMode.name='decayMode';
    for(const [value,label] of [['tail','Follow tail'],['custom','Custom']]){const option=document.createElement('option');option.value=value;option.textContent=label;decayMode.append(option);}decayMode.value=fx.decaySeconds===undefined?'tail':'custom';decayRow.append(decayMode);form.querySelector('footer').before(decayRow);
    for(const [name,label,min,max,step,value] of [['feedback','Echo feedback',0,.9,.01,fx.feedback??.45],['resonanceDb','Resonance (dB)',-12,24,.1,fx.resonanceDb??1],['cutoffHz','Cutoff (Hz)',20,20000,1,fx.cutoffHz??(fx.reverse?18000:80)],['decaySeconds','Decay (seconds)',.1,8,.01,fx.decaySeconds??2],['preDelayMs','Pre-delay (ms)',0,250,1,fx.preDelayMs??0],['dampingHz','Reverb tone (Hz)',200,20000,1,fx.dampingHz??20000]]){
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.name=name;input.min=min;input.max=max;input.step=step;input.value=value;input.required=true;row.append(input);form.querySelector('footer').before(row);
    }
    const fields=Object.fromEntries(['type','target','start','length','tail','wet','reverse','feedback','delayBeats','resonanceDb','cutoffMode','cutoffHz','decayMode','decaySeconds','preDelayMs','dampingHz'].map(name=>[name,form.elements.namedItem(name)]));
    const clipScopeRow=document.createElement('label');clipScopeRow.textContent='Apply to';
    const clipScope=document.createElement('select');clipScope.name='clipScope';clipScope.setAttribute('aria-label','Effect scope');
    for(const [value,label] of [['layer','Layer / track'],['clip','Selected clip only']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;clipScope.append(option);
    }
    clipScope.value=fx.clipId?'clip':'layer';clipScopeRow.append(clipScope);fields.target.parentElement.after(clipScopeRow);
    const selectedClipId=typeof selection.clipId==='string'?selection.clipId:fx.clipId;
    const echoOutRow=document.createElement('label');echoOutRow.textContent='Fade original out';
    const echoOutControl=document.createElement('input');echoOutControl.type='checkbox';echoOutControl.name='echoOut';echoOutControl.checked=Boolean(fx.echoOut);echoOutRow.append(echoOutControl);form.querySelector('footer').before(echoOutRow);
    const echoOutHelp=document.createElement('small');echoOutHelp.className='daw-fx-control-help';echoOutHelp.textContent='Fade the original across the selected bars, then leave only echoes during the tail. If the track continues after the tail, normal audio resumes.';echoOutRow.append(echoOutHelp);
    echoOutControl.addEventListener('change',()=>explainControls(form,fields.type.value));
    for(const [name,label,min,max,step,fallback] of enhancementControls){
      const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');
      Object.assign(input,{type:'number',name,min,max,step,value:fx[name]??fallback,required:true});
      row.append(input);form.querySelector('footer').before(row);fields[name]=input;
    }
    const dynamicsRow=document.createElement('label');dynamicsRow.textContent='Dynamics';const dynamics=document.createElement('select');dynamics.name='enhanceDynamicsMode';
    for(const [value,label] of [['broadband','Broadband'],['multiband','Three-band']]){const option=document.createElement('option');option.value=value;option.textContent=label;dynamics.append(option);}
    dynamics.value=fx.enhanceDynamicsMode||'broadband';dynamicsRow.append(dynamics);fields.enhanceBodyDb.parentElement.before(dynamicsRow);
    const matchRow=document.createElement('label');matchRow.textContent='Match gain (dB)';const matchGain=document.createElement('input');
    let exactMatchGain=fx.enhanceMatchDb??0;
    Object.assign(matchGain,{type:'number',name:'enhanceMatchDb',min:-12,max:12,step:'any',value:exactMatchGain.toFixed(2)});matchRow.append(matchGain);form.querySelector('footer').before(matchRow);
    matchGain.addEventListener('input',()=>{exactMatchGain=Number(matchGain.value);});
    fields.type.value=fx.type;fields.target.value=fx.target;fields.start.value=fx.startBeat/4+1;fields.length.value=fx.durationBeats/4;fields.tail.value=fx.tailBeats/4;fields.wet.value=fx.wet;fields.reverse.checked=fx.reverse;
    for(const name of ['length','tail']){
      const input=fields[name],presets=document.createElement('span');
      presets.className='daw-fx-bar-presets';presets.setAttribute('role','group');presets.setAttribute('aria-label',name==='tail'?'Tail length in bars':'Effect duration in bars');
      const choices=[[.25,'¼'],[.5,'½'],[1,'1'],[2,'2'],[4,'4'],[8,'8']];
      if(name==='tail')choices.unshift([0,'Off']);
      for(const [value,label] of choices){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.bars=value;
        button.setAttribute('aria-label',`${name==='tail'?'Tail':'Duration'}: ${value} ${value===1?'bar':'bars'}`);
        button.title=value===0?'End the effect without a tail':`Set ${name==='tail'?'the tail':'effect duration'} to ${label} ${value===1?'bar':'bars'}`;
        button.addEventListener('click',event=>{event.preventDefault();input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
        presets.append(button);
      }
      const sync=()=>{for(const button of presets.children)button.setAttribute('aria-pressed',String(input.value!==''&&Number(input.value)===Number(button.dataset.bars)));};
      input.addEventListener('input',sync);input.addEventListener('change',sync);input.after(presets);sync();
    }
    function controls(){const sweep=['lowpass','highpass'].includes(fields.type.value),enhance=fields.type.value==='enhance',reverb=isReverb(fields.type.value);fields.reverse.disabled=!sweep||mode.value==='fixed';fields.reverse.parentElement.hidden=!sweep;fields.tail.disabled=sweep||enhance;fields.target.disabled=enhance;if(enhance)fields.target.value='master';for(const [name,on] of [['feedback',fields.type.value==='echo'],['delayBeats',fields.type.value==='echo'],['resonanceDb',sweep],['cutoffMode',sweep],['cutoffHz',sweep&&mode.value==='fixed'],['decayMode',reverb],['decaySeconds',reverb&&decayMode.value==='custom'],['preDelayMs',reverb],['dampingHz',reverb],...enhancementControls.map(([name])=>[name,enhance])]){fields[name].disabled=!on;fields[name].parentElement.hidden=!on;}}
    const djControls=window.AxiomDawDjFx?.editor(form,fx,fields);
    const tapeControls=window.AxiomTapeStop?.editor(form,fx,fields);
    const creativeControls=window.AxiomCreativeFx?.editor(form,fx,fields);
    const sweepControls=window.AxiomDawSweeps?.editor(form,fields,fx);
    const vintageControls=[['vintageSize','Space size',.5,2,.05,1],['vintageModMs','Tail movement (ms)',0,5,.1,1.2],['vintageLowCutHz','Remove bass below (Hz)',20,1000,1,120],['vintageWidth','Stereo width (%)',0,150,1,100],['vintageColor','Vintage warmth (%)',0,100,1,45]];
    const vintageModeRow=document.createElement('label');vintageModeRow.textContent='Space character';const vintageMode=document.createElement('select');vintageMode.name='vintageMode';
    for(const [value,label] of [['hall','Hall'],['plate','Plate'],['chamber','Chamber']]){const option=document.createElement('option');option.value=value;option.textContent=label;vintageMode.append(option);}vintageMode.value=fx.vintageMode||'hall';vintageModeRow.append(vintageMode);form.querySelector('footer').before(vintageModeRow);
    const vintageFields=[];
    for(const [name,label,min,max,step,value] of vintageControls){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');Object.assign(input,{type:'number',name,min,max,step,value:fx[name]??value,required:true});row.append(input);form.querySelector('footer').before(row);vintageFields.push(input);}
    fields.target.addEventListener('change',()=>explainControls(form,fields.type.value));
    function dynamicsControls(){
      masterLimiter.hidden=fields.type.value==='tapeStop'||Object.hasOwn(window.AxiomCreativeFx?.types||{},fields.type.value);
      const heading=form.querySelector('h2');
      heading.textContent=fields.type.value==='tapeStop'||Object.hasOwn(window.AxiomCreativeFx?.types||{},fields.type.value)?types[fields.type.value]:'Edit FX Region';
      echoOutRow.hidden=fields.type.value!=='echo';echoOutControl.disabled=fields.type.value!=='echo';
      const vintage=fields.type.value==='vintageReverb';
      for(const input of [vintageMode,...vintageFields]){input.disabled=!vintage;input.parentElement.hidden=!vintage;}
      fields.decaySeconds.max=vintage?'30':'8';
      controls();const enhance=fields.type.value==='enhance',multiband=dynamics.value==='multiband';dynamicsRow.hidden=!enhance;dynamics.disabled=!enhance;matchRow.hidden=!enhance;matchGain.disabled=!enhance;
      for(const name of ['enhanceThresholdDb',...bandThresholds]){const on=enhance&&(bandThresholds.includes(name)?multiband:!multiband);fields[name].disabled=!on;fields[name].parentElement.hidden=!on;}
      djControls?.update();tapeControls?.update();creativeControls?.update();fields.tail.parentElement.hidden=!hasTail(fields.type.value);explainControls(form,fields.type.value);
      const scopeAvailable=Boolean(selectedClipId)&&(clipBoundSections.has(fields.target.value)||(fields.type.value==='tapeStop'||Object.hasOwn(window.AxiomCreativeFx?.types||{},fields.type.value))&&p.arrangementClips?.some(c=>c.id===selectedClipId&&c.sectionId===fields.target.value))&&fields.type.value!=='enhance'&&fields.type.value!=='gatedSweep';
      clipScope.disabled=!scopeAvailable;clipScopeRow.hidden=!scopeAvailable;
      if(!scopeAvailable)clipScope.value='layer';
      const sweep=fields.type.value==='gatedSweep';fields.target.parentElement.hidden=sweep;if(sweep)fields.target.value='master';form.querySelector('[value="save"]').textContent=sweep?(existing?'Turn into audio clip':'Add sweep to timeline'):'Apply';
      if(sweep&&!creatingSweep)sweepStatus.textContent='Creates a waveform clip on a Samples layer. Split and move its pieces directly on the timeline.';
      else if(!creatingSweep)sweepStatus.textContent='';
    }
    fields.type.addEventListener('change',dynamicsControls);fields.target.addEventListener('change',dynamicsControls);mode.addEventListener('change',dynamicsControls);decayMode.addEventListener('change',dynamicsControls);dynamics.addEventListener('change',dynamicsControls);dynamicsControls();
    form.addEventListener('submit',event=>{
      if(event.submitter?.value!=='save') return;
      if(creatingSweep){event.preventDefault();return;}
      const values=[Number(fields.start.value),Number(fields.length.value),Number(fields.tail.value),Number(fields.wet.value)];
      if(!values.every(Number.isFinite)) {event.preventDefault();return;}
      const region={id:fx.id || crypto.randomUUID(),type:fields.type.value,target:fields.target.value,startBeat:(values[0]-1)*4,durationBeats:values[1]*4,tailBeats:hasTail(fields.type.value)?values[2]*4:0,wet:values[3],reverse:fields.reverse.checked};
      if(clipScope.value==='clip'&&selectedClipId)region.clipId=selectedClipId;
      if(region.type==='echo'){region.feedback=Number(fields.feedback.value);region.delayBeats=Number(fields.delayBeats.value);if(echoOutControl.checked)region.echoOut=true;}
      if(isReverb(region.type)){region.preDelayMs=Number(fields.preDelayMs.value);region.dampingHz=Number(fields.dampingHz.value);if(decayMode.value==='custom')region.decaySeconds=Number(fields.decaySeconds.value);}
      if(region.type==='enhance'){
        region.coverage=coverage==='project'?'project':'range';
        if(region.coverage==='project')Object.assign(region,{startBeat:0,durationBeats:.25,tailBeats:0});
        region.enhanceDynamicsMode=dynamics.value;region.enhanceMatchDb=exactMatchGain;for(const [name] of enhancementControls)region[name]=Number(fields[name].value);}
      if(['lowpass','highpass'].includes(region.type))region.resonanceDb=Number(fields.resonanceDb.value);
      if(['lowpass','highpass'].includes(region.type)&&mode.value==='fixed')region.cutoffHz=Number(fields.cutoffHz.value);
      djControls?.read(region);
      tapeControls?.read(region);creativeControls?.read(region);
      try{sweepControls?.read(region);}catch(error){event.preventDefault();window.showToast?.(error.message,true);return;}
      if(region.type==='vintageReverb'){region.vintageMode=vintageMode.value;for(const input of vintageFields)region[input.name]=Number(input.value);}
      if(project()!==p||!validate(region)){event.preventDefault();window.showToast?.('FX region was not saved. Check the values and active project.',true);return;}
      if(region.type==='gatedSweep'){
        event.preventDefault();creatingSweep=true;const button=form.querySelector('[value="save"]');button.disabled=true;
        window.AxiomDawSweepAudio.place(p,region,()=>dialog.isConnected&&dialog.open,text=>sweepStatus.textContent=text)
          .then(()=>dialog.close()).catch(error=>{if(dialog.isConnected)sweepStatus.textContent=error.message;})
          .finally(()=>{creatingSweep=false;if(dialog.isConnected)button.disabled=false;});return;
      }
      if(apply(region)&&region.type==='enhance'&&existing?.type!=='enhance')dialog.addEventListener('close',()=>setTimeout(()=>{if(project()===p)edit(region.id);},0),{once:true});
    });
    const fieldArea=document.createElement('div');fieldArea.className='daw-fx-fields';
    for(const label of [...form.children].filter(el=>el.tagName==='LABEL'||el.classList.contains('daw-gate-editor')||el.classList.contains('daw-sweep-source')))fieldArea.append(label);
    form.querySelector('footer').before(fieldArea);
    let enhanceCompare=null;
    fields.type.addEventListener('change',()=>{
      if(fields.type.value==='enhance'&&fx.type!=='enhance')edit(id,{type:'enhance',target:'master',startBeat:(Number(fields.start.value)-1)*4,durationBeats:Number(fields.length.value)*4,tailBeats:0,wet:Number(fields.wet.value)});
    });
    if(fx.type==='enhance'){
      const existingEnhance=existing?.type==='enhance';
      const advanced=document.createElement('details');advanced.className='daw-fx-advanced';
      const summary=document.createElement('summary');summary.textContent='More settings';advanced.append(summary);
      const detailFields=document.createElement('div');detailFields.className='daw-fx-fields';advanced.append(detailFields);
      for(const child of [...fieldArea.children])if(child!==fields.wet.parentElement)detailFields.append(child);
      fieldArea.append(advanced);
      const heading=form.querySelector('h2'),context=document.createElement('p');context.className='daw-fx-quick-context';
      heading.textContent='AXIOM Mix Enhance';
      heading.after(context);
      const coverageRow=document.createElement('label');coverageRow.textContent='Apply to master';
      const coverageSelect=document.createElement('select');coverageSelect.name='enhanceCoverage';coverageSelect.setAttribute('aria-label','Mix Enhance coverage');
      for(const [value,label] of [['project','Entire project'],['selected','Selected area'],['range','Custom bar range']]){
        const option=document.createElement('option');option.value=value;option.textContent=label;option.disabled=value==='selected'&&!selectedRange;coverageSelect.append(option);
      }
      coverageSelect.value=coverage;coverageRow.append(coverageSelect);fieldArea.prepend(coverageRow);
      fields.length.removeAttribute('max');
      if(fx.coverage==='project'){fields.start.value=1;fields.length.value=projectEnd(p)/4;}
      const lengthHelp=fields.length.parentElement.querySelector('.daw-fx-control-help');if(lengthHelp)lengthHelp.textContent='Choose how many bars of the master mix to process.';
      function updateCoverage(){
        coverage=coverageSelect.value;const all=coverage==='project';
        if(coverage==='selected'&&selectedRange){fields.start.value=selectedRange.start/4+1;fields.length.value=(selectedRange.end-selectedRange.start)/4;}
        for(const input of [fields.start,fields.length]){input.disabled=all;input.parentElement.hidden=all;}
        fields.type.parentElement.hidden=true;fields.target.parentElement.hidden=true;
        context.textContent=all?'EQ and compression on the master for the entire project. Follows the mix length as you add or remove clips.':`EQ and compression on the master · Bars ${Number(Number(fields.start.value).toFixed(3))}–${Number((Number(fields.start.value)+Number(fields.length.value)).toFixed(3))}. Only this area is processed.`;
      }
      coverageSelect.addEventListener('change',()=>{updateCoverage();if(coverage==='range')advanced.open=true;});fields.start.addEventListener('input',updateCoverage);fields.length.addEventListener('input',updateCoverage);updateCoverage();
      const caption=[...fields.wet.parentElement.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());if(caption)caption.textContent='Enhance amount';
      fields.wet.type='range';fields.wet.min=0;fields.wet.max=1;fields.wet.step=.01;fields.wet.setAttribute('aria-label','Enhance amount');
      const amount=document.createElement('output');amount.textContent=Math.round(Number(fields.wet.value)*100)+'%';fields.wet.after(amount);
      const help=fields.wet.parentElement.querySelector('.daw-fx-control-help');if(help)help.textContent='Blend in more or less EQ and compression. Louder does not always mean better—compare both versions.';
      const compare=document.createElement('section');compare.className='daw-enhance-compare';compare.setAttribute('aria-label','Compare Mix Enhance');
      const play=document.createElement('button');play.type='button';play.textContent=existingEnhance?(fx.coverage==='project'?'Play project':'Play this section'):'Apply to enable comparison';play.disabled=!existingEnhance;
      const original=document.createElement('button'),enhanced=document.createElement('button');
      for(const [button,label] of [[original,'Original'],[enhanced,'Enhanced']]){button.type='button';button.textContent=label;button.disabled=!existingEnhance;button.setAttribute('aria-pressed',String(button===enhanced));}
      const status=document.createElement('output');status.setAttribute('role','status');
      compare.append(play,original,enhanced,status);fieldArea.before(compare);
      const state={original:false};
      const update=()=>{original.setAttribute('aria-pressed',String(state.original));enhanced.setAttribute('aria-pressed',String(!state.original));compareEnhance(p,fx.id,state);};
      original.onclick=()=>{state.original=true;update();};enhanced.onclick=()=>{state.original=false;update();};
      play.onclick=()=>{if(project()===p)window.AxiomArrangement.play(p,window.AxiomStudioDaw.compileTempoMap(p).beatToSeconds(fx.startBeat));};
      fields.wet.addEventListener('input',()=>{amount.textContent=Math.round(Number(fields.wet.value)*100)+'%';state.wet=Number(fields.wet.value);update();});
      enhanceCompare={state,status,play,existing:existingEnhance,advancedChanged:false};
      dialog.addEventListener('close',()=>compareEnhance(p,fx.id,null));
      fields.type.addEventListener('change',()=>{advanced.open=true;compare.hidden=fields.type.value!=='enhance';heading.textContent=types[fields.type.value];compareEnhance(p,fx.id,null);});
      form.addEventListener('invalid',()=>{advanced.open=true;},true);
    }
    if(existing&&fx.type==='echo'){
      const advanced=document.createElement('details');advanced.className='daw-fx-advanced';
      const summary=document.createElement('summary');summary.textContent='More settings';advanced.append(summary);
      const detailFields=document.createElement('div');detailFields.className='daw-fx-fields';advanced.append(detailFields);
      for(const child of [...fieldArea.children])if(![fields.wet.parentElement,fields.delayBeats.parentElement].includes(child))detailFields.append(child);
      fieldArea.append(advanced);
      const heading=form.querySelector('h2'),context=document.createElement('p');context.className='daw-fx-quick-context';
      context.textContent=`${targetLabels[fx.target]} · ${clipBoundLabel(fx)} · Bar ${Number((fx.startBeat/4+1).toFixed(3))}–${Number(((fx.startBeat+fx.durationBeats)/4+1).toFixed(3))}`;
      heading.textContent=regionLabel(fx);heading.after(context);
      fields.type.addEventListener('change',()=>{heading.textContent=fields.type.value==='echo'&&echoOutControl.checked?'Echo Out':types[fields.type.value];advanced.open=true;});
      echoOutControl.addEventListener('change',()=>{heading.textContent=echoOutControl.checked?'Echo Out':'Echo';});
      form.addEventListener('invalid',()=>{advanced.open=true;},true);
    }
    const reduction=document.createElement('section');reduction.className='daw-enhance-reduction';reduction.setAttribute('aria-label','Gain reduction');
    reduction.hidden=fields.type.value!=='enhance';
    fields.type.addEventListener('change',()=>{reduction.hidden=fields.type.value!=='enhance';});
    reduction.innerHTML='<h3>Gain reduction</h3><div class="daw-enhance-reduction-bands"></div>';
    const meterRows=[['enhanceThresholdDb','Full mix'],['enhanceLowThresholdDb','Low'],['enhanceMidThresholdDb','Mid'],['enhanceHighThresholdDb','High']].map(([name,label])=>{
      const row=document.createElement('div'),caption=document.createElement('span'),meter=document.createElement('meter'),output=document.createElement('output');
      caption.textContent=label;meter.min=0;meter.max=60;meter.value=0;meter.setAttribute('aria-label',label+' gain reduction (dB)');output.textContent='--';
      row.append(caption,meter,output);reduction.lastElementChild.append(row);return {name,row,meter,output};
    });
    fieldArea.before(reduction);
    let meterSettingsChanged=false;
    let matching=false;
    const matchButton=document.createElement('button');matchButton.type='button';matchButton.textContent='Match volume';matchButton.dataset.quickMatch='';matchButton.title='Measure two seconds during playback to match the processed loudness to the original, so you can compare the sound fairly. Apply to save the adjustment.';
    const matchStatus=document.createElement('output');matchStatus.className='daw-enhance-match-status';
    reduction.append(matchButton,matchStatus);
    matchButton.addEventListener('click',async()=>{
      if(matching||meterSettingsChanged||enhanceCompare?.state.original||project()!==p)return;
      matching=true;matchButton.disabled=true;matchStatus.textContent='Measuring...';
      try{
        const current=()=>dialog.isConnected&&!meterSettingsChanged&&project()===p?window.AxiomArrangement?.enhancementMatchSource?.(p,fx.id):null;
        const measured=await window.AxiomEnhanceMatch.measure(current(),current);
        if(!dialog.isConnected||meterSettingsChanged||project()!==p)return;
        exactMatchGain=measured.db;matchGain.value=measured.db.toFixed(2);meterSettingsChanged=true;if(enhanceCompare)enhanceCompare.advancedChanged=true;matchStatus.textContent=`${measured.db.toFixed(2)} dB RMS match — Apply to keep it`;
      }catch(error){if(dialog.isConnected)matchStatus.textContent=error.message;}finally{matching=false;}
    });
    const dirty=event=>{meterSettingsChanged=true;if(enhanceCompare&&event.target!==fields.wet)enhanceCompare.advancedChanged=true;};
    form.addEventListener('input',dirty);form.addEventListener('change',dirty);
    const drawReduction=()=>{
      if(!dialog.isConnected){clearInterval(meterTimer);return;}
      if(document.hidden)return;
      reduction.hidden=fields.type.value!=='enhance';if(reduction.hidden)return;
      const active=window.AxiomArrangement?.enhancementMatchSource?.(p,fx.id);
      if(enhanceCompare){enhanceCompare.status.textContent=!enhanceCompare.existing?'Apply to add Mix Enhance, then compare.':!active?(window.AxiomArrangement?.loading?'Preparing audio…':window.AxiomArrangement?.playing?'Outside this effect’s bars. Use Play this section.':(fx.coverage==='project'?'Press Play project to compare.':'Press Play this section to compare.')):(enhanceCompare.state.original?'Listening to Original — Mix Enhance bypassed.':enhanceCompare.advancedChanged?'Apply to hear the changed technical settings.':meterSettingsChanged?'Previewing amount. Apply to keep it.':'Listening to Enhanced.');enhanceCompare.play.disabled=window.AxiomArrangement?.loading||!enhanceCompare.existing;}
      matchButton.disabled=matching||meterSettingsChanged||enhanceCompare?.state.original||!existing||!active;
      const reading=project()===p&&existing&&!meterSettingsChanged?window.AxiomArrangement?.enhancementReduction?.(p,fx.id):null;
      for(const {name,row,meter,output} of meterRows){
        row.hidden=bandThresholds.includes(name)!==(dynamics.value==='multiband');
        const db=reading?.mode===dynamics.value?reading.bands.find(b=>b.name===name)?.db:undefined;
        const text=Number.isFinite(db)?`${(Math.abs(db)<.05?0:db).toFixed(1)} dB`:'--';meter.value=Number.isFinite(db)?Math.min(60,-db):0;
        meter.setAttribute('aria-valuetext',Number.isFinite(db)?text:'Unavailable');if(output.textContent!==text)output.textContent=text;
      }
    };
    const meterTimer=setInterval(drawReduction,100);
    dialog.addEventListener('close',()=>{if(matching)window.AxiomEnhanceMatch?.cancel();clearInterval(meterTimer);dialog.remove();});document.body.append(dialog);dialog.showModal();drawReduction();
  }
  function split(id){
    const p=project(),fx=p?.fxRegions?.find(f=>f.id===id),beat=p?.editCursorBeat;
    if(fx?.type!=='gatedSweep'||!validate(fx))return false;
    const cut=beat-fx.startBeat;
    if(!Number.isFinite(cut)||cut<.25||fx.durationBeats-cut<.25){window.showToast?.('Place the playhead inside the sweep, leaving at least 1/16 bar on each side.',true);return false;}
    const before=snapshot(p),[a,b]=fx.sweepWindow||[0,1],middle=a+(b-a)*cut/fx.durationBeats;
    const right={...JSON.parse(JSON.stringify(fx)),id:crypto.randomUUID(),startBeat:beat,durationBeats:fx.durationBeats-cut,sweepWindow:[middle,b]};
    const left={...fx,durationBeats:cut,sweepWindow:[a,middle]};if(!validate(left)||!validate(right))return false;
    const lanes=[];
    for(const lane of p.automationLanes||[]){
      if(lane.scope!=='fx'||lane.targetId!==id){lanes.push(lane);continue;}
      const fallback=fx[lane.parameter]??window.AxiomDawAutomation.definitions[lane.parameter][3];
      const value=window.AxiomDawAutomation.valueAt({...lane,enabled:true},cut,fallback),curve=lane.points.filter(point=>point.beat<=cut).at(-1)?.curve||'hold';
      lanes.push({...lane,points:[...lane.points.filter(point=>point.beat<cut).map(point=>({...point})),{beat:cut,value,curve}]});
      lanes.push({...lane,targetId:right.id,points:[{beat:0,value,curve},...lane.points.filter(point=>point.beat>cut).map(point=>({...point,beat:point.beat-cut}))]});
    }
    p.fxRegions=p.fxRegions.flatMap(region=>region===fx?[left,right]:[region]);p.automationLanes=lanes;
    selectedIds=new Set([right.id]);selection={p,id:right.id};return changed(p,before);
  }
  function action(id,command) {
    if(command==='split')return split(id);
    const p=project(),fx=p?.fxRegions?.find(f=>f.id===id);if(!fx) return false;
    if(!['duplicate','reverse','delete'].includes(command)||(command==='reverse'&&(!['lowpass','highpass'].includes(fx.type)||fx.cutoffHz!==undefined)))return false;
    const before=snapshot(p);
    if(command==='duplicate'){
      if(fx.coverage==='project')return false;
      const id=crypto.randomUUID();p.fxRegions.push({...JSON.parse(JSON.stringify(fx)),id,startBeat:fx.startBeat+fx.durationBeats});
      p.automationLanes=[...(p.automationLanes||[]),...JSON.parse(JSON.stringify((p.automationLanes||[]).filter(l=>l.scope==='fx'&&l.targetId===fx.id))).map(l=>({...l,targetId:id}))];
      selectedIds=new Set([id]);selection={p,id};
    }
    else if(command==='reverse') fx.reverse=!fx.reverse;
    else if(command==='delete'){p.fxRegions=p.fxRegions.filter(f=>f!==fx);p.automationLanes=(p.automationLanes||[]).filter(l=>l.scope!=='fx'||l.targetId!==fx.id);selectedIds.delete(fx.id);if(selection?.id===fx.id)selection=selectedIds.size?{p,id:[...selectedIds][0]}:null;}
    return changed(p,before);
  }
  function deleteSelected(options={}){
    const p=project(),ids=selectedIdsForProject();if(!p||!ids.length)return false;
    const before=snapshot(p);
    p.fxRegions=p.fxRegions.filter(fx=>!selectedIds.has(fx.id));
    p.automationLanes=(p.automationLanes||[]).filter(l=>l.scope!=='fx'||!selectedIds.has(l.targetId));
    clearSelection();
    if(options.record===false)return true;
    return changed(p,before);
  }
  function menu(event,id) {
    event.preventDefault();event.stopPropagation();
    document.getElementById('daw-fx-menu')?.remove();
    const element=document.createElement('div');element.id='daw-fx-menu';element.className='studio-daw-context-menu';element.setAttribute('role','menu');
    for(const [label,command] of [['Edit effect','edit'],['Split sweep at playhead','split'],['Automate effect','automation'],['Render tail copy','tail'],['Duplicate','duplicate'],['Reverse sweep','reverse'],['Delete','delete']]) {
      const fx=project()?.fxRegions?.find(f=>f.id===id);
      if(command==='duplicate'&&fx?.coverage==='project')continue;
      if(command==='split'&&fx?.type!=='gatedSweep')continue;
      if(command==='reverse'&&(!['lowpass','highpass'].includes(fx?.type)||fx.cutoffHz!==undefined))continue;
      if(command==='tail'&&(!hasTail(fx?.type)||!fx.tailBeats))continue;
      const button=document.createElement('button');button.textContent=label;button.setAttribute('role','menuitem');
      button.onclick=()=>{element.remove();command==='edit'?edit(id):command==='tail'?window.AxiomDawFxTail?.open(id):command==='automation'?window.AxiomDawAutomation?.edit([{scope:'fx',targetId:id}],fx.type==='tapeStop'?'tapeSpeed':window.AxiomDawDjFx?.controls[fx.type]?.[0]?.[0]||'wet'):action(id,command);};element.append(button);
    }
    for(const [label,redo] of [['Undo Last Edit',false],['Redo Last Edit',true]]){const button=document.createElement('button');button.textContent=label;button.setAttribute('role','menuitem');button.disabled=window.AxiomEditHistory?!window.AxiomEditHistory.canUndo(project(),redo):!history(project())[redo?'redo':'undo'].length;button.onclick=()=>{element.remove();undo(redo);};element.append(button);}
    element.style.left=Math.max(8,Math.min(event.clientX,innerWidth-240))+'px';element.style.top=Math.max(8,Math.min(event.clientY,innerHeight-280))+'px';
    document.body.append(element);return false;
  }
  document.addEventListener('click',()=>document.getElementById('daw-fx-menu')?.remove());
  function renderToolbar(p) {
    const button=document.getElementById?.('daw-fx-button');
    if(!button?.setAttribute)return;
    const active=(p?.fxRegions||[]).some(fx=>{
      if(!validate(fx))return false;
      const comparison=fx.type==='enhance'&&enhanceComparisons.get(p)?.get(fx.id);
      if(comparison?.original)return false;
      if(comparison?.wet!==undefined)return comparison.wet>0;
      // Echo Out still fades the dry signal at zero wet; automation may raise a dry effect later.
      return fx.wet>0||fx.echoOut||(p.automationLanes||[]).some(lane=>lane.scope==='fx'&&lane.targetId===fx.id&&lane.parameter==='wet'&&lane.enabled!==false&&lane.points?.some(point=>point.value>0));
    });
    button.setAttribute('aria-pressed',String(active));
    button.title=active?'FX on: effects are applied to this project. Open effects.':'FX off: no active effects applied. Add an effect and choose its target track.';
  }
  function render(p,start,span) {
    renderToolbar(p);
    const expanded=window.AxiomStudioDaw.expandedSection==='fx';
    return (p.fxRegions||[]).map((stored,index)=>{
      const fx=effectiveRegion(p,stored);
      const end=fx.startBeat+fx.durationBeats+fx.tailBeats;
      if(end<=start || fx.startBeat>=start+span) return '';
      const left=(Math.max(start,fx.startBeat)-start)/span*100,right=(Math.min(start+span,end)-start)/span*100;
      const tail=Math.max(0,Math.min(start+span,end)-Math.max(start,fx.startBeat+fx.durationBeats))/span*100;
      const handles=fx.coverage==='project'?'':[['left',fx.startBeat],['right',fx.startBeat+fx.durationBeats],...(hasTail(fx.type)?[['tail',end]]:[])].filter(([,beat])=>beat>=start&&beat<=start+span).map(([edge,beat])=>`<button type="button" class="daw-fx-resize ${edge}" aria-label="Resize FX ${edge}" title="Drag ${edge==='tail'?'tail length':edge+' edge'}" style="left:clamp(4px,${((beat-start)/span*100-left)/(right-left)*100}%,calc(100% - 4px))" onpointerdown="AxiomDawFx.dragResize(event,'${escape(fx.id)}','${edge}')" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"></button>`).join('');
      const division=fx.delayBeats??.5;
      const timing=fx.type==='echo'?`<span class="daw-echo-timing" onpointerdown="event.stopPropagation()" ondblclick="event.stopPropagation()" onkeydown="event.stopPropagation()">${[.5,2].map(factor=>`<button type="button" aria-label="${factor===.5?'Faster echo':'Slower echo'}" title="${factor===.5?'Half the time between repeats':'Double the time between repeats'}" ${echoDivisions.some(([value])=>value===division*factor)?'':'disabled'} onclick="event.stopPropagation();AxiomDawFx.changeTiming('${escape(fx.id)}',${factor})">${factor===.5?'&#8592;':'&#8594;'}</button>`).join(`<output>${escape(echoDivisions.find(([value])=>value===division)?.[1]||'')}</output>`)}</span>`:'';
      return `<article class="studio-daw-clip daw-fx-region${selection?.p===p&&selectedIds.has(fx.id)?' selected':''}" role="button" tabindex="0" aria-label="Edit ${escape(regionLabel(fx))} effect" title="${fx.coverage==='project'?'Entire project: follows mix length; double-click to edit':escape(targetLabels[fx.target])+' · '+escape(clipBoundLabel(fx))+': drag to move; double-click to edit; right-click to duplicate'}" style="left:${left}%;width:${right-left}%;--layer-index:${expanded?index:0}" onpointerdown="AxiomDawFx.dragMove(event,'${escape(fx.id)}')" onclick="AxiomDawFx.select('${escape(fx.id)}',event)" ondblclick="AxiomDawFx.edit('${escape(fx.id)}')" onkeydown="if(event.key==='Enter') AxiomDawFx.edit('${escape(fx.id)}')" oncontextmenu="return AxiomDawFx.menu(event,'${escape(fx.id)}')"><strong>${escape(regionLabel(fx))}</strong>${fx.clipId?'<small>Clip</small>':''}<span class="daw-fx-tail" style="width:${tail/(right-left)*100}%" title="Effect tail"></span>${handles}${timing}</article>`;
    }).join('');
  }
  function connect(ctx,input,output,clip,p,origin,own,capture=null,updates=null,routing=null) {
    const clock=window.AxiomStudioDaw.compileTempoMap(p),now=ctx.currentTime;
    routing={...routing,project:p};
    function controlled(fx,param,parameter,timing,fallback,transform=value=>value,fallbackSchedule=null){
      const end=timing.origin+clock.beatToSeconds(timing.endBeat);
      const apply=(initial=false)=>{
        if(ctx.currentTime>=end)return;
        if(window.AxiomDawAutomation?.schedule(ctx,param,p,{scope:'fx',targetId:fx.id},parameter,timing,fx[parameter]??fallback,transform))return;
        if(fallbackSchedule){fallbackSchedule();return;}
        const at=Math.max(ctx.currentTime,timing.origin+clock.beatToSeconds(timing.startBeat));param.cancelScheduledValues(at);
        if(!initial&&at===ctx.currentTime&&param.setTargetAtTime)param.setTargetAtTime(transform(fx[parameter]??fallback),at,.01);
        else param.setValueAtTime(transform(fx[parameter]??fallback),at);
      };apply(true);updates?.push(()=>apply());
    }
    // Clip and layer graphs are separate stages; never repeat layer inserts
    // or sends on each clip before that clip reaches the shared layer bus.
    const storedRegions=(p.fxRegions||[]).filter(fx=>fx.target===clip.sectionId&&(clip.id?fx.clipId===clip.id:fx.clipId===undefined));
    for(const fx of storedRegions)if(!validate(fx))throw new Error('Invalid FX region. Correct it before playback.');
    const regions=storedRegions.map(fx=>effectiveRegion(p,fx));
    // Filters are serial inserts. Complementary gains remove the unfiltered bypass at full wet.
    for(const fx of regions.filter(fx=>['lowpass','highpass','enhance','tapeStop'].includes(fx.type)||Object.hasOwn(window.AxiomDawDjFx?.types||{},fx.type))){
      if(fx.type==='tapeStop'){
        input=window.AxiomTapeStop.connect(ctx,input,own,fx,p,{origin,startBeat:fx.startBeat,endBeat:fx.startBeat+fx.durationBeats},controlled,routing,clock);continue;
      }
      const enhance=fx.type==='enhance';
      if(enhance)origin+=compressorDelay;
      const start=origin+clock.beatToSeconds(fx.startBeat),end=origin+clock.beatToSeconds(fx.startBeat+fx.durationBeats);
      let bypass=input;
      if(enhance){bypass=own(ctx.createDelay(.1));bypass.delayTime.value=compressorDelay;input.connect(bypass);}
      if(end<=now){if(enhance)input=bypass;continue;}
      const sum=own(ctx.createGain()),dry=own(ctx.createGain()),wet=own(ctx.createGain());
      dry.gain.value=1;wet.gain.value=0;
      const timing={origin,startBeat:fx.startBeat,endBeat:fx.startBeat+fx.durationBeats};
      const comparison=()=>enhance&&routing?.preview?enhanceComparisons.get(p)?.get(fx.id):null;
      const applyWet=(initial=false)=>{
        if(ctx.currentTime>=end)return;
        const preview=comparison(),amount=preview?.original?0:preview?.wet??fx.wet;
        for(const [param,transform,outside] of [[wet.gain,v=>v,0],[dry.gain,v=>1-v,1]]){
          if(preview&&(preview.original||preview.wet!==undefined)||!window.AxiomDawAutomation?.schedule(ctx,param,p,{scope:'fx',targetId:fx.id},'wet',timing,fx.wet,transform)){
            const at=Math.max(ctx.currentTime,start);param.cancelScheduledValues(at);
            if(!initial&&at===ctx.currentTime&&param.setTargetAtTime)param.setTargetAtTime(transform(amount),at,.01);
            else param.setValueAtTime(transform(amount),at);
          }
          param.setValueAtTime(outside,end);
        }
      };applyWet(true);updates?.push(()=>applyWet());
      let processed;
      if(Object.hasOwn(window.AxiomDawDjFx?.types||{},fx.type))processed=window.AxiomDawDjFx.connect(ctx,input,own,fx,timing,controlled,routing,clock);
      else if(enhance)processed=enhancement(ctx,input,own,fx,timing,controlled,p,clock);
      else{
        const filter=own(ctx.createBiquadFilter());filter.type=fx.type;
        controlled(fx,filter.Q,'resonanceDb',timing,1);
        if(fx.cutoffHz!==undefined)controlled(fx,filter.frequency,'cutoffHz',timing,fx.cutoffHz);
        else{
          const curve=cutoffCurve(p,fx),ref={scope:'fx',targetId:fx.id};
          const applyCutoff=()=>{
            const at=Math.max(ctx.currentTime,start);if(at>=end)return;
            const raw=p.automationLanes?.find(l=>l.scope==='fx'&&l.targetId===fx.id&&l.parameter==='cutoffHz'),lane=raw&&raw.enabled!==false&&raw.points.length?window.AxiomDawAutomation.normalize(raw):null;
            const first=lane?.points[0],firstBeat=first?fx.startBeat+first.beat:timing.endBeat,autoEnd=Math.min(end,origin+clock.beatToSeconds(firstBeat));
            filter.frequency.cancelScheduledValues(at);
            // Retain the automatic time-based sweep up to the first custom point.
            if(at<autoEnd){filter.frequency.setValueAtTime(curve(clock.secondsToBeat(Math.max(0,at-origin))),at);filter.frequency.exponentialRampToValueAtTime(curve(clock.secondsToBeat(Math.max(0,autoEnd-origin))),autoEnd);}
            if(first&&firstBeat<=timing.endBeat)window.AxiomDawAutomation.schedule(ctx,filter.frequency,p,ref,'cutoffHz',{...timing,startBeat:firstBeat,preScheduled:true},first.value);
          };applyCutoff();updates?.push(applyCutoff);
        }
        input.connect(filter);processed=filter;
      }
      bypass.connect(dry).connect(sum);processed.connect(wet).connect(sum);input=sum;
      if(enhance){
        if(!matchGraphs.has(ctx))matchGraphs.set(ctx,new Map());matchGraphs.get(ctx).set(sum,{ctx,project:p,id:fx.id,start,end,dry:bypass,wet:sum});
        if(fx.enhanceMatchDb){
          const matched=own(ctx.createGain());matched.gain.value=1;
          const applyMatch=(initial=false)=>{if(ctx.currentTime>=end)return;const at=Math.max(ctx.currentTime,start),value=comparison()?.original?1:Math.pow(10,fx.enhanceMatchDb/20);matched.gain.cancelScheduledValues(at);if(!initial&&at===ctx.currentTime&&matched.gain.setTargetAtTime)matched.gain.setTargetAtTime(value,at,.01);else matched.gain.setValueAtTime(value,at);matched.gain.setValueAtTime(1,end);};applyMatch(true);updates?.push(()=>applyMatch());
          sum.connect(matched);input=matched;
        }
      }
    }
    // Echo Out attenuates the dry branch only. Its send still hears the source,
    // and existing Echo regions keep their original additive behaviour.
    let dryOutput=input;
    for(const fx of regions.filter(fx=>fx.type==='echo'&&fx.echoOut)){
      const start=origin+clock.beatToSeconds(fx.startBeat),end=origin+clock.beatToSeconds(fx.startBeat+fx.durationBeats),finish=origin+clock.beatToSeconds(fx.startBeat+fx.durationBeats+fx.tailBeats);
      if(now>=finish)continue;
      const dry=own(ctx.createGain());dry.gain.value=1;
      dry.gain.setValueAtTime(Math.max(0,1-(Math.max(now,start)-start)/(end-start)),Math.max(now,start));
      if(now<end)dry.gain.linearRampToValueAtTime(0,end);
      dry.gain.setValueAtTime(0,finish);dry.gain.linearRampToValueAtTime(1,finish+.01);
      dryOutput.connect(dry);dryOutput=dry;
    }
    dryOutput.connect(output);
    for(const fx of regions.filter(fx=>hasTail(fx.type))) {
      const start=origin+clock.beatToSeconds(fx.startBeat),end=origin+clock.beatToSeconds(fx.startBeat+fx.durationBeats),finish=origin+clock.beatToSeconds(fx.startBeat+fx.durationBeats+fx.tailBeats);
      if(finish<=now) continue;
      const gate=own(ctx.createGain()),wet=own(ctx.createGain());gate.gain.value=0;wet.gain.value=fx.wet;
      gate.gain.setValueAtTime(1,Math.max(now,start));gate.gain.setValueAtTime(0,Math.max(now,end));
      if(fx.type==='echo'&&fx.echoOut){
        gate.gain.cancelScheduledValues(now);
        gate.gain.setValueAtTime(Math.max(0,1-(Math.max(now,start)-start)/(end-start)),Math.max(now,start));
        if(now<end)gate.gain.linearRampToValueAtTime(0,end);
      }
      const tail=own(ctx.createGain());tail.gain.setValueAtTime(1,Math.max(now,finish-.02));tail.gain.linearRampToValueAtTime(0,Math.max(now+.001,finish));
      window.AxiomDawAutomation?.schedule(ctx,wet.gain,p,{scope:'fx',targetId:fx.id},'wet',{origin,endBeat:fx.startBeat+fx.durationBeats+fx.tailBeats},fx.wet);
      updates?.push(()=>{if(ctx.currentTime<finish&&!window.AxiomDawAutomation?.schedule(ctx,wet.gain,p,{scope:'fx',targetId:fx.id},'wet',{origin,endBeat:fx.startBeat+fx.durationBeats+fx.tailBeats},fx.wet)){wet.gain.cancelScheduledValues(ctx.currentTime);wet.gain.setTargetAtTime(fx.wet,ctx.currentTime,.01);}});
      input.connect(gate);wet.connect(tail);tail.connect(output);
      if(capture?.id===fx.id)tail.connect(capture.output);
      if(fx.type==='echo') {
        const points=echoTiming(clock,fx,clock.secondsToBeat(Math.max(0,now-origin)),ctx.sampleRate||48000);
        // Reserve the full timing range so the arrows can update a running
        // delay without rebuilding playback or losing its stored echoes.
        const maxDelay=echoTiming(clock,{...fx,delayBeats:4},clock.secondsToBeat(Math.max(0,now-origin)),ctx.sampleRate||48000).reduce((max,point)=>Math.max(max,point.delay),0);
        const bindTiming=params=>{
          let last;
          const update=()=>{
            const division=fx.delayBeats??.5;if(last===division||ctx.currentTime>=finish)return;
            const curve=last===undefined?points:echoTiming(clock,fx,clock.secondsToBeat(Math.max(0,ctx.currentTime-origin)),ctx.sampleRate||48000);
            for(const [param,offset=0,minimum=0] of params){
              const value=delay=>Math.max(minimum,delay-offset);param.cancelScheduledValues(ctx.currentTime);
              if(last===undefined)param.value=value(curve[0].delay);
              param.setValueAtTime(value(curve[0].delay),Math.max(ctx.currentTime,origin+curve[0].seconds));
              for(const point of curve.slice(1))param.linearRampToValueAtTime(value(point.delay),origin+point.seconds);
            }
            last=division;
          };update();updates?.push(update);
        };
        if(ctx.audioWorklet&&window.AxiomPcmSource?.enabled){
          if(!echoModules.has(ctx))throw new Error('Echo audio engine was not prepared. Retry playback.');
          // WebKit drops DelayNode history when a finite source ends. Own the
          // delay memory until the region tail finishes, including silent input.
          const echo=own(new AudioWorkletNode(ctx,'axiom-echo',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{maxDelay,endFrame:Math.ceil(finish*ctx.sampleRate)}}));
          bindTiming([[echo.parameters.get('delayTime')]]);
          controlled(fx,echo.parameters.get('feedback'),'feedback',{origin,startBeat:fx.startBeat,endBeat:fx.startBeat+fx.durationBeats+fx.tailBeats},.45);
          echo.stop=()=>{echo.port.postMessage({type:'stop'});echo.port.close();};
          gate.connect(echo).connect(wet);
          continue;
        }
        const quantum=(ctx.renderQuantumSize||128)/(ctx.sampleRate||48000);
        if(points.some(point=>point.delay<=2*quantum))throw new Error('Echo division is too short for this audio engine at the project tempo.');
        const delay=own(ctx.createDelay(Math.min(180,maxDelay+.01))),feedback=own(ctx.createGain());feedback.gain.value=fx.feedback??.45;
        // Isolate the first tap; compensate the feedback cycle's quantum without shifting that tap.
        const repeatDelay=own(ctx.createDelay(Math.min(180,maxDelay+.01)));
        const feedbackEntry=own(ctx.createDelay(quantum*2));feedbackEntry.delayTime.value=quantum;
        bindTiming([[delay.delayTime],[repeatDelay.delayTime,quantum,quantum]]);
        controlled(fx,feedback.gain,'feedback',{origin,startBeat:fx.startBeat,endBeat:fx.startBeat+fx.durationBeats+fx.tailBeats},.45);
        gate.connect(delay);delay.connect(feedbackEntry).connect(feedback).connect(repeatDelay);repeatDelay.connect(feedback);delay.connect(wet);repeatDelay.connect(wet);
      } else if(fx.type==='vintageReverb') {
        if(!vintageModules.has(ctx))throw new Error('Vintage Reverb was not prepared. Retry playback.');
        const node=own(new AudioWorkletNode(ctx,'axiom-vintage-reverb',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{mode:fx.vintageMode||'hall',size:fx.vintageSize??1,endFrame:Math.ceil(finish*ctx.sampleRate)}}));
        node.onprocessorerror=()=>routing?.onerror?.();node.stop=()=>{node.port.postMessage({type:'stop'});node.port.close();};
        const timing={origin,startBeat:fx.startBeat,endBeat:fx.startBeat+fx.durationBeats+fx.tailBeats};
        for(const [key,value] of [['decaySeconds',fx.decaySeconds??Math.min(30,Math.max(.1,finish-end))],['dampingHz',fx.dampingHz??12000],['vintageModMs',1.2],['vintageLowCutHz',120],['vintageWidth',100],['vintageColor',45]])controlled(fx,node.parameters.get(key),key,timing,value);
        const pre=own(ctx.createDelay(.251));controlled(fx,pre.delayTime,'preDelayMs',timing,0,v=>v/1000);gate.connect(pre).connect(node).connect(wet);
      } else if(fx.type==='reverb') {
        const convolver=own(ctx.createConvolver());const length=Math.max(1,Math.ceil((fx.decaySeconds??Math.min(8,Math.max(.1,finish-end)))*ctx.sampleRate));
        const impulse=reverbImpulse(ctx,length);
        const preDelay=own(ctx.createDelay(.251)),tone=own(ctx.createBiquadFilter());tone.type='lowpass';tone.Q.value=-3;
        const timing={origin,startBeat:fx.startBeat,endBeat:fx.startBeat+fx.durationBeats+fx.tailBeats};
        controlled(fx,preDelay.delayTime,'preDelayMs',timing,0,value=>value/1000);
        controlled(fx,tone.frequency,'dampingHz',timing,20000);
        convolver.buffer=impulse;gate.connect(preDelay).connect(convolver).connect(tone).connect(wet);
      }
    }
    return Math.max(0,...regions.filter(fx=>hasTail(fx.type)).map(fx=>fx.startBeat+fx.durationBeats+fx.tailBeats));
  }
  window.AxiomDawFx={projectEnd,effectiveRegion,label:type=>types[type]||'Effect',regionLabel,targetLabels,rangeTargets,quickApply,quickApplyClips,changeTiming,openMasterLimiter,prepare,edit,action,render,connect,menu,apply,undo,validate,select,selectAll,clearSelection,selectedIdsForProject,deleteSelected,copySelected,paste,resize,dragResize,move,dragMove,compareEnhance,latency,warmup,cutoffCurve,echoTiming,reverbCacheStats,enhancementControls,readReduction,clearReduction,matchSource};
  window.AxiomEditHistory?.register('fx',(p,redo)=>undo(redo));
})();
