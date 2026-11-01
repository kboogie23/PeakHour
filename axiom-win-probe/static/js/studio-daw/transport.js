(function () {
  'use strict';
  let context, master, timer, clock, generation=0, origin=0, cursor=0, project=null, running=false, loading=false;
  const nodes=new Set();
  const downloads=new Set();
  const channels=[];
  const stemGains=[];
  const fxUpdates=[];
  let loop=null,loopClock=null,recordingJob=null,stemPreview=false,auditionClipIds=null,clockResyncCleanup=null;
  let streamingState=null;
  let cacheLease=null,browserPreparation=null,ratePreparation=null;
  let exportJob=null;
  let renderingProject=false;
  let masterLimiterPresent=false;
  let playheadFrame=null;
  const timingDiagnostics={ticks:0,frames:0,maxTickGapMs:0,lastStopReason:'',lastTickAt:0};
  let patternMonitor=null;
  let waitingForSnap=false;
  let keyPreparation=null,omittedStems=[];
  const reversedBuffers=new WeakMap();
  const stemNames=['vocals','other','bass','drums'];
  function readyStemOrigin(c,p){
    const range=c.stemCoverage;
    if(!c.stemJob||c.stemState!=='ready'||!Number.isFinite(range?.start)||!Number.isFinite(range?.end)||range.start<0||range.end<=range.start||c.reversed||c.nativeEffect?.enabled)return null;
    const request=stretchRequest(c,p);
    if(request.pitch!==0||request.start<range.start-1/48000||request.start+request.duration>range.end+1/48000||request.anchors.some(a=>Math.round(a.source*48000)!==Math.round(a.target*48000)))return null;
    return range.start;
  }
  function neededStems(p,c){
    if(p.midiMappings?.length||window.AxiomAutomationRecorder?.armed)return stemNames;
    return stemNames.filter(stem=>Number(c['stemGain_'+stem]??1)>0 || (p.automationLanes||[]).some(l=>l.scope==='clip'&&l.targetId===c.id&&l.parameter==='stemGain_'+stem&&l.enabled!==false&&l.points?.some(point=>point.value>0)));
  }
  function preparationStatus(message){
    const banner=document.getElementById('daw-preparation-status'),text=document.getElementById('daw-preparation-message');
    if(banner){
      banner.hidden=!message;banner.setAttribute('aria-busy',String(Boolean(message)));
      if(banner.dataset){
        if(message)banner.dataset.tone=/\bstem(?:med)?\b|separat/i.test(message)?'stem':'working';
        else delete banner.dataset.tone;
      }
    }
    if(text){text.textContent=message?(message.includes('Key Sync')?'Preparing Key Sync…':'Preparing audio…'):'';text.title=message||'';}
  }
  const hasPatternAudio=p=>window.AxiomBeatPreview?.hasSamples(p)||window.AxiomInstruments?.hasNotes(p);
  function audibleClockTime() {
    if(!context)return 0;
    const current=Number(context.currentTime)||0;
    const latency=Math.max(0,Math.min(.5,Number(context.outputLatency)||Number(context.baseLatency)||0));
    let output=current-latency;
    try{
      const stamp=typeof context.getOutputTimestamp==='function'?context.getOutputTimestamp():null;
      const perfNow=typeof performance!=='undefined'&&performance.now?performance.now():NaN;
      const stampTime=Number(stamp?.contextTime),stampPerformance=Number(stamp?.performanceTime);
      if(Number.isFinite(stampTime)&&Number.isFinite(stampPerformance)&&Number.isFinite(perfNow)){
        const projected=stampTime+(perfNow-stampPerformance)/1000;
        // Older native WebKit can report contextTime divided by sampleRate
        // while audio/currentTime keep advancing. Reject implausible or stale
        // output timestamps and retain the latency-adjusted audio clock.
        const age=perfNow-stampPerformance;
        if(stampTime>=0&&age>=0&&age<=1000&&Number.isFinite(projected)&&projected>=current-1&&projected<=current+.05)
          output=Math.min(output,projected,current);
      }
    }catch{}
    return Math.max(0,output);
  }
  function position() {
    const value=Math.max(cursor,audibleClockTime()-origin);
    if(!loopClock||value<loopClock.end)return value;
    return loopClock.start+(value-loopClock.end)%(loopClock.end-loopClock.start);
  }
  function setLoop(p,startBeat,endBeat) {
    if(!p||!Number.isFinite(startBeat)||!Number.isFinite(endBeat)||startBeat<0||endBeat-startBeat<1)throw new Error('Select at least one beat to loop.');
    stop(false);loop={project:p,startBeat,endBeat};project=p;cursor=seconds(startBeat,p);
  }
  function clearLoop(){stop(false);loop=null;loopClock=null;}
  // Crop prepared segments without losing the integral of a tempo ramp.
  function cropEntries(entries,preparedFrom,start,end) {
    return entries.flatMap(entry=>{
      const absolute=preparedFrom+entry.when,a=Math.max(start,absolute),b=Math.min(end,absolute+entry.duration);
      if(b<=a)return [];
      const elapsed=a-absolute,k=Math.log(entry.rateEnd/entry.rate)/entry.duration;
      const travel=t=>Math.abs(k)<1e-12?entry.rate*t:entry.rate*Math.expm1(k*t)/k;
      const offset=entry.reversed?entry.offset+sourceSpan(entry)-travel(b-absolute):entry.offset+travel(elapsed);
      return [{...entry,when:a-start,offset,duration:b-a,rate:entry.rate*Math.exp(k*elapsed),rateEnd:entry.rate*Math.exp(k*(b-absolute))}];
    });
  }
  function sourceSpan(entry){
    const k=Math.log(entry.rateEnd/entry.rate)/entry.duration;
    return Math.abs(k)<1e-12?entry.rate*entry.duration:entry.rate*Math.expm1(k*entry.duration)/k;
  }
  function reversedBuffer(ctx,buffer){
    if(reversedBuffers.has(buffer))return reversedBuffers.get(buffer);
    const copy=ctx.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){
      const source=buffer.getChannelData(ch),target=copy.getChannelData(ch);
      for(let i=0,last=source.length-1;i<source.length;i++)target[i]=source[last-i];
    }
    reversedBuffers.set(buffer,copy);return copy;
  }
  function pcmEntries(entry,streamRates=false){
    // Reopening a rate-shifted BufferSource resets its resampling phase.
    if(entry.rate!==1||entry.rateEnd!==1){
      const k=Math.log(entry.rateEnd/entry.rate)/entry.duration;
      const span=Math.abs(k)<1e-12?entry.rate*entry.duration:entry.rate*Math.expm1(k*entry.duration)/k;
      if(span>7.9&&streamRates){
        const total=Math.round(entry.duration*48000),result=[];
        if(total>4800*48000)throw new Error('Rate streaming exceeds the prepared source and playback-rate limits.');
        const rateStream={when:entry.when,offset:entry.offset,duration:entry.duration,rate:entry.rate,rateEnd:entry.rateEnd};
        for(let offset=0;offset<total;offset+=192000){
          const frames=Math.min(192000,total-offset);
          result.push({...entry,when:entry.when+offset/48000,offset:0,duration:frames/48000,rate:1,rateEnd:1,pcmBlock:true,rateStream,rateOffset:offset,rateFrames:frames,rateFinal:offset+frames===total});
        }
        return result;
      }
      return [span<=7.9?{...entry,pcmBlock:true}:entry];
    }
    const span=4,result=[];
    const count=Math.ceil(entry.duration/span);
    if(count>100000)throw new Error('Clip PCM scheduling limit exceeded.');
    for(let i=0;i<count;i++){
      const start=entry.when+i*span,end=entry.when+Math.min(entry.duration,(i+1)*span);
      const cut=cropEntries([entry],0,start,end)[0];if(cut)result.push({...cut,when:start,pcmBlock:true});
    }
    return result;
  }
  const db=value=>Number.isFinite(Number(value))?Math.max(-24,Math.min(12,Number(value))):0;
  function anySolo(p) {return Object.values(p.rowMixer||{}).some(row=>row.solo) || p.arrangementClips.some(c=>c.mixSolo);}
  function audible(p,c) {return !anySolo(p) || p.rowMixer?.[c.sectionId]?.solo || c.mixSolo;}
  function smooth(param,value,ctx) {if(param.setTargetAtTime){param.cancelScheduledValues?.(ctx.currentTime);param.setTargetAtTime(value,ctx.currentTime,.01);}else param.value=value;}
  function channel(ctx,output,settings,level,owner=own,automation=null,postFader=null) {
    const input=owner(ctx.createGain()),fader=owner(ctx.createGain());
    const filters=[['lowshelf',200,'lowDb'],['peaking',1000,'midDb'],['highshelf',5000,'highDb']].map(([type,hz,key])=>{
      const node=owner(ctx.createBiquadFilter());node.type=type;node.frequency.value=hz;node.Q.value=.7;return {node,key};
    });
    let tail=input;filters.forEach(({node})=>{tail.connect(node);tail=node;});
    const clipFilterControls=[];
    if(automation?.ref.scope==='clip'&&automation.p.automationLanes?.some(l=>l.scope==='clip'&&l.targetId===automation.ref.targetId&&l.parameter==='filterPosition'&&l.enabled!==false&&l.points?.length)){
      // Sum this clip's active stems before filtering; adjacent/overlapping
      // clips keep their own channel and never enter this filter graph.
      if(!window.AxiomDawDjFx?.connect)throw new Error('Clip filter is unavailable. Reopen the DAW and try again.');
      tail=window.AxiomDawDjFx.connect(ctx,tail,owner,{type:'filter',filterPosition:0},automation.timing,(_fx,param,key,_timing,fallback,transform)=>clipFilterControls.push({param,key,fallback,transform}));
    }
    tail.connect(fader);
    const final=postFader?postFader(fader):fader;final.connect(output);
    const apply=(initial=false)=>{
      const s=settings()||{},set=(param,value,key,transform=v=>v)=>{
        if(automation&&window.AxiomDawAutomation?.schedule(ctx,param,automation.p,automation.ref,key,automation.timing,value,transform))return;
        initial?param.value=transform(value):smooth(param,transform(value),ctx);
      };
      set(input.gain,db(s.gainDb),'gainDb',v=>Math.pow(10,v/20));filters.forEach(({node,key})=>set(node.gain,db(s[key]),key));set(fader.gain,s.volume??1,'volume',v=>level(v));
      clipFilterControls.forEach(({param,key,fallback,transform})=>set(param,fallback,key,transform));
    };
    const analysers=[];
    if(ctx.createAnalyser){const splitter=owner(ctx.createChannelSplitter(2));final.connect(splitter);for(let i=0;i<2;i++){const analyser=owner(ctx.createAnalyser());analyser.fftSize=256;splitter.connect(analyser,i);analysers.push(analyser);}}
    const samples=new Float32Array(256);
    apply(true);const result={input,fader,apply,filters,level(){let peak=0;for(const analyser of analysers){analyser.getFloatTimeDomainData(samples);for(const value of samples)peak=Math.max(peak,Math.abs(value));}return peak;}};channels.push(result);return result;
  }
  const clipSettings=c=>({volume:c.mixVolume??1,gainDb:c.mixGainDb,lowDb:c.mixLowDb,midDb:c.mixMidDb,highDb:c.mixHighDb});
  const volume=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):1;
  const rowLevel=(p,id,value=p.rowMixer?.[id]?.volume??1)=>p.rowMixer?.[id]?.muted?0:volume(value);
  const clipLevel=(c,value=c.mixVolume??1)=>c.mixMuted?0:volume(value);
  const masterLevel=(p,value=p?.masterMixer?.volume??1)=>p?.masterMixer?.muted?0:volume(value);
  function mixerChanged(p) {
    if(project!==p || !context) return;
    if((running||loading)&&!renderingProject&&masterLimiterPresent!==Boolean(p.masterMixer?.limiter)){
      play(p,running?position():cursor,auditionClipIds,false,null,stemPreview);return;
    }
    if((running||loading)&&!renderingProject&&omittedStems.some(({clip,stem})=>neededStems(p,clip).includes(stem))){
      const from=running?position():cursor,ids=auditionClipIds,isolated=stemPreview;
      play(p,from,ids,false,null,isolated);return;
    }
    channels.forEach(c=>c.apply());
    stemGains.forEach(entry=>applyStemGain(entry));
    fxUpdates.forEach(apply=>apply());
  }
  function applyStemGain({node,clip,stem,timing}) {
    const parameter='stemGain_'+stem,value=volume(clip[parameter]??1);
    if(!window.AxiomDawAutomation?.schedule(context,node.gain,project,{scope:'clip',targetId:clip.id},parameter,timing,value))smooth(node.gain,value,context);
  }
  let preparation=null;
  let cancelEngineWait=null;
  async function waitForEngine(operation,token,message){
    const pending=Promise.resolve(operation);
    if(token!==generation){pending.catch(()=>{});return false;}
    let timeout,cancel;
    const cancelled=new Promise(resolve=>{cancel=()=>resolve(false);});cancelEngineWait=cancel;
    try{
      return await Promise.race([pending.then(()=>true),cancelled,new Promise((resolve,reject)=>{timeout=setTimeout(()=>reject(new Error(message)),5000);})]);
    }finally{clearTimeout(timeout);if(cancelEngineWait===cancel)cancelEngineWait=null;}
  }
  async function resumeEngine(sampleRate,token){
    if(token!==generation)return false;
    if(sampleRate&&context&&context.sampleRate!==sampleRate){
      const previous=context;context=null;
      if(previous.state!=='closed'&&!await waitForEngine(previous.close?.(),token,'Audio output could not reset. Check the device and press Play again.'))return false;
    }
    // A cancelled device reset must not replace a newer playback or export context.
    if(token!==generation)return false;
    if(!context||context.state==='closed'||context.startRendering){
      context=new AudioContext(sampleRate?{sampleRate}:undefined);const ownedContext=context;
      context.addEventListener?.('statechange',()=>{
        if(context!==ownedContext||(!running&&!loading)||ownedContext.state==='running')return;
        stop(false,'audio-context-'+ownedContext.state);
        const title=document.getElementById('ap-title');
        if(title){title.textContent='Audio paused: check output, then press Play';title.setAttribute('role','status');}
        else window.showToast?.('Audio engine interrupted. Playback is paused at your position. Check the output device, then press Play to resume.',true);
      });
    }
    const ownedContext=context;
    try {
      if(!await waitForEngine(ownedContext.resume(),token,'Audio could not start. Check the output device and press Play again.'))return false;
      if(token!==generation||context!==ownedContext)return false;
      if(ownedContext.state&&ownedContext.state!=='running')throw new Error('Audio output is unavailable. Check the output device and press Play again.');
      return true;
    }catch(error){
      // Never reuse a failed engine, or retire a newer attempt when an old promise rejects.
      if(token===generation&&context===ownedContext){
        context=null;
        try{Promise.resolve(ownedContext.close?.()).catch(()=>{});}catch{}
      }
      throw error;
    }
  }
  function stop(reset=true,reason='user-or-edit') {
    if(playheadFrame!==null)window.cancelAnimationFrame?.(playheadFrame);
    playheadFrame=null;
    timingDiagnostics.lastStopReason=reason;
    patternMonitor?.stop();patternMonitor=null;
    if(keyPreparation&&reason!=='play-start'){
      keyPreparation.cancelled=true;
      if(keyPreparation.id)fetch(`/api/studio-daw/stretch/${keyPreparation.id}`,{method:'DELETE'}).catch(()=>{});
      keyPreparation=null;
    }
    omittedStems=[];
    if(!keyPreparation)preparationStatus('');
    cancelEngineWait?.();cancelEngineWait=null;
    window.AxiomEnhanceMatch?.cancel();
    window.AxiomAutomationRecorder?.transportStop(reason);
    const exporting=exportJob;exportJob=null;exporting?.stop(reason);
    cacheLease?.release();cacheLease=null;
    browserPreparation?.release();browserPreparation=null;
    ratePreparation?.destroy();ratePreparation=null;
    const player=document.getElementById('audio-player');
    if(player){player.dataset.transportState='stopped';player.dataset.transportStopReason=reason;}
    generation++; clearInterval(timer);
    if(clockResyncCleanup){clockResyncCleanup();clockResyncCleanup=null;}
    for(const controller of downloads)controller.abort();downloads.clear();
    window.AxiomNativeEffects?.cancel();
    if(preparation){fetch(`/api/studio-daw/stretch/${preparation.id}`,{method:'DELETE'}).catch(()=>{});preparation=null;}
    if(running && context) cursor=position();
    loopClock=null;
    running=false;loading=false;renderingProject=false;waitingForSnap=false;stemPreview=false;auditionClipIds=null;
    streamingState=null;
    const recording=recordingJob;recordingJob=null;
    if(recording){if(recording.armed&&!recording.cancelled)recording.recorder?.stop(reason);else recording.recorder?.abort();}
    for(const node of nodes) {try {node.stop?.();} catch {} try {node.disconnect();} catch {}}
    nodes.clear();
    master=null;
    channels.length=0;
    stemGains.length=0;
    fxUpdates.length=0;
    window.AxiomDawFx?.clearReduction?.(context);
    window.AxiomMasterLimiter?.clear?.(context);
    window.AxiomMixer?.meter?.([]);
    if(reset) cursor=0;
    update();
  }
  function update() {
    window.AxiomAutomationRecorder?.update();
    window.AxiomMixer?.meter?.(channels);
    try{drawPlayhead();}
    catch(error){timingDiagnostics.lastRenderError=String(error.message||error);}
    // A background export may keep running, but Library owns its own player
    // title and buttons after the preview handoff.
    if(window.getAxiomPreviewPlayerContext && window.getAxiomPreviewPlayerContext()!=='studio-daw-preview')return;
    const button=document.querySelector('#audio-player .player-left-zone button:not(.daw-stop-button):not(.daw-pause-button)');
    button?.setAttribute('aria-label',loading?'Cancel audio preparation':running?'Pause project':'Play project');
    button?.setAttribute('aria-pressed',String(running));
    button?.setAttribute('aria-busy',String(loading));
    const toolbarPlay=document.getElementById('daw-toolbar-play');
    if(toolbarPlay){const icon=loading?'×':running?'Ⅱ':'▶';if(toolbarPlay.textContent!==icon)toolbarPlay.innerHTML=`<span aria-hidden="true">${icon}</span>`;toolbarPlay.setAttribute('aria-label',loading?'Cancel audio preparation':running?'Pause project':'Play project');toolbarPlay.setAttribute('aria-pressed',String(running));}
  }
  function drawPlayhead() {
    if(!project||!clock||project!==window.AxiomStudioDaw?.activeProject)return;
    const shell=document.getElementById('studio-daw-shell');
    if(!shell||shell.classList.contains('hidden'))return;
    const currentPosition=running?position():cursor,beat=clock.secondsToBeat(currentPosition);
    shell.style.setProperty('--project-playhead',String(currentPosition));
    if(running){
      if(!window.getAxiomPreviewPlayerContext||window.getAxiomPreviewPlayerContext()==='studio-daw-preview'){
        const title=document.getElementById('ap-title');if(title)title.textContent=project.title;
      }
      window.AxiomStudioDaw.updateAnchorStatus?.(beat);
    }
    window.AxiomStudioDaw.followPlayhead?.(beat);
    const lanes=document.getElementById('studio-daw-lanes'),line=lanes?.querySelector('.studio-daw-playhead');
    if(!line)return;
    const percent=(beat-Number(lanes.dataset.viewStart||0))/Number(lanes.dataset.viewBeats||64)*100;
    line.style.left=`${percent}%`;
    line.style.display=percent>=0&&percent<=100?'':'none';
  }
  const own=node=>{nodes.add(node);return node;};
  function seconds(beat,p) {return window.AxiomStudioDaw.compileTempoMap(p).beatToSeconds(beat);}
  function fadeEnvelope(clip,map,from=0){
    const start=clip.timelineStartBeat,duration=clip.timelineDurationBeats,end=start+duration;
    let fadeIn=Math.max(0,Math.min(duration,Number(clip.fadeInBeats)||0)),fadeOut=Math.max(0,Math.min(duration,Number(clip.fadeOutBeats)||0));
    if(fadeIn+fadeOut>duration){const scale=duration/(fadeIn+fadeOut);fadeIn*=scale;fadeOut*=scale;}
    const points=[{time:map.beatToSeconds(start),value:fadeIn?0:1}];
    if(fadeIn)points.push({time:map.beatToSeconds(start+fadeIn),value:1});
    if(fadeOut)points.push({time:map.beatToSeconds(end-fadeOut),value:1});
    points.push({time:map.beatToSeconds(end),value:fadeOut?0:1});
    let unique=points.filter((point,index)=>!index||point.time!==points[index-1].time);
    if(clip.fadeCurve==='equal-power'){
      const curved=[unique[0]];
      for(let i=1;i<unique.length;i++){
        const a=unique[i-1],b=unique[i],steps=a.value===b.value?1:64;
        for(let step=1;step<=steps;step++){const t=step/steps;curved.push({time:a.time+(b.time-a.time)*t,value:Math.sin((a.value+(b.value-a.value)*t)*Math.PI/2)});}
      }
      unique=curved;
    }
    let value=unique[0].value;
    for(let i=1;i<unique.length;i++){const a=unique[i-1],b=unique[i];if(from>=b.time)value=b.value;else if(from>=a.time){value=a.value+(b.value-a.value)*(from-a.time)/(b.time-a.time);break;}}
    return [{time:Math.max(from,unique[0].time),value},...unique.filter(point=>point.time>Math.max(from,unique[0].time))];
  }
  function plan(p,from=0,excluded=null) {
    const map=window.AxiomStudioDaw.compileTempoMap(p),fromBeat=map.secondsToBeat(from);
    return p.arrangementClips.filter(c=>!c.muted && c.timelineDurationBeats>0&&!excluded?.has(c.id)).flatMap(c=>{
      if(c.gridStatus==='invalid') throw new Error('Invalid source beatgrid. Reconnect a verified grid before playback.');
      const grid=window.AxiomStudioDaw.trackGrid?.(c);
      const start=c.timelineStartBeat,end=start+c.timelineDurationBeats,ratio=c.sourceDurationBeats/c.timelineDurationBeats;
      if(!Number.isFinite(ratio) || ratio<=0) throw new Error('Invalid clip duration.');
      const sourceEnd=c.sourceStartBeat+c.sourceDurationBeats;
      const sourceAt=beat=>window.AxiomStudioDaw.sourceBeatToSeconds(c,c.reversed?sourceEnd-(beat-start)*ratio:c.sourceStartBeat+(beat-start)*ratio);
      const boundaries=[start,end,...map.segments.map(s=>s.beat),...(grid?.anchors || []).map(a=>start+(c.reversed?sourceEnd-a.beat:a.beat-c.sourceStartBeat)/ratio),fromBeat]
        .filter(beat=>beat>=start && beat<=end).sort((a,b)=>a-b);
      const unique=[...new Set(boundaries)];
      return unique.slice(0,-1).flatMap((beat,i)=>{
        const next=unique[i+1];if(next<=fromBeat) return [];
        const slope=(sourceAt(next)-sourceAt(beat))/(next-beat);
        const segment=map.segments.find(s=>beat>=s.beat && beat<s.end);
        const bpmEnd=segment.value+segment.slope*(next-segment.beat);
        return [{clip:c,reversed:Boolean(c.reversed),when:Math.max(0,map.beatToSeconds(beat)-from),offset:sourceAt(c.reversed?next:beat),duration:map.beatToSeconds(next)-map.beatToSeconds(beat),rate:Math.abs(slope*map.bpmAtBeat(beat)/60),rateEnd:Math.abs(slope*bpmEnd/60)}];
      });
    }).filter(item=>item.duration>0);
  }
  function stretchRequest(c,p) {
    if(c.gridStatus==='invalid') throw new Error('Correct the source beatgrid before preparing audio.');
    const map=window.AxiomStudioDaw.compileTempoMap(p),grid=window.AxiomStudioDaw.trackGrid(c);
    const start=c.timelineStartBeat,end=start+c.timelineDurationBeats,ratio=c.sourceDurationBeats/c.timelineDurationBeats;
    const sourceEnd=c.sourceStartBeat+c.sourceDurationBeats;
    const sourceAt=beat=>window.AxiomStudioDaw.sourceBeatToSeconds(c,c.reversed?sourceEnd-(beat-start)*ratio:c.sourceStartBeat+(beat-start)*ratio);
    const sourceStart=sourceAt(c.reversed?end:start),targetStart=map.beatToSeconds(start),targetEnd=map.beatToSeconds(end);
    const boundaries=[start,end,...map.segments.map(s=>s.beat),...(grid?.anchors||[]).map(a=>start+(c.reversed?sourceEnd-a.beat:a.beat-c.sourceStartBeat)/ratio)].filter(b=>b>=start && b<=end);
    // Sample curved project timing at 1/16 beat, retaining exact source-grid boundaries.
    for(const segment of map.segments) {
      if(!segment.slope)continue;
      for(let beat=Math.max(start,segment.beat)+1/16;beat<Math.min(end,segment.end);beat+=1/16) {
        boundaries.push(beat);if(boundaries.length>32768)throw new Error('Split this clip into shorter regions before pitch-preserving preparation.');
      }
    }
    // Preparation is forward PCM; mirror its timing map before reversing it so
    // source-grid changes and project tempo ramps retain their timeline positions.
    const anchors=[...new Set(boundaries)].sort((a,b)=>c.reversed?b-a:a-b).map(beat=>({source:sourceAt(beat)-sourceStart,target:c.reversed?targetEnd-map.beatToSeconds(beat):map.beatToSeconds(beat)-targetStart}));
    // Window seconds converted back to beats can land just before a grid line.
    // Both points then name the same source/output sample. Keep one instead of
    // sending a zero-length interval to the 48 kHz stretch engine.
    const sampleAnchors=anchors.filter((a,i)=>!i||Math.round(a.source*48000)!==Math.round(anchors[i-1].source*48000)||Math.round(a.target*48000)!==Math.round(anchors[i-1].target*48000));
    return {path:c.path,start:sourceStart,duration:sourceAt(c.reversed?start:end)-sourceStart,pitch:window.AxiomStudioDaw.playbackPitch(c),anchors:sampleAnchors};
  }
  function timingWindow(c,p,startSeconds,endSeconds){
    const map=window.AxiomStudioDaw.compileTempoMap(p),start=map.secondsToBeat(startSeconds),end=map.secondsToBeat(endSeconds);
    const ratio=c.sourceDurationBeats/c.timelineDurationBeats;
    return {...c,timelineStartBeat:start,timelineDurationBeats:end-start,
      sourceStartBeat:c.sourceStartBeat+(start-c.timelineStartBeat)*ratio,sourceDurationBeats:(end-start)*ratio};
  }
  function continuousSources(p){
    // A split is an editing boundary, not a new decoder/stretch origin. Share
    // preparation across consecutive pieces, while retaining each clip's mix.
    const groups=new Map(),tails=new Map();
    for(const c of [...p.arrangementClips].sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat)){
      const ratio=c.sourceDurationBeats/c.timelineDurationBeats;
      const key=JSON.stringify([c.path,c.sectionId,c.beatgrid,c.fluidSync,c.bpm,c.reversed,
        window.AxiomStudioDaw.playbackPitch(c),c.stemJob,c.stemSourceStart]);
      const previous=tails.get(key),last=previous?.clips.at(-1);
      const connected=last&&!c.nativeEffect?.enabled&&!last.nativeEffect?.enabled&&
        Math.abs(last.timelineStartBeat+last.timelineDurationBeats-c.timelineStartBeat)<1e-9&&
        Math.abs(c.reversed?c.sourceStartBeat+c.sourceDurationBeats-last.sourceStartBeat:last.sourceStartBeat+last.sourceDurationBeats-c.sourceStartBeat)<1e-9&&
        Math.abs(last.sourceDurationBeats/last.timelineDurationBeats-ratio)<1e-10;
      const group=connected?previous:{clip:{...c},clips:[]};
      if(connected){
        const low=Math.min(group.clip.sourceStartBeat,c.sourceStartBeat),high=Math.max(group.clip.sourceStartBeat+group.clip.sourceDurationBeats,c.sourceStartBeat+c.sourceDurationBeats);
        group.clip.timelineDurationBeats=c.timelineStartBeat+c.timelineDurationBeats-group.clip.timelineStartBeat;
        group.clip.sourceStartBeat=low;group.clip.sourceDurationBeats=high-low;
      }
      group.clips.push(c);groups.set(c,group);tails.set(key,group);
    }
    return groups;
  }
  function editEdges(p,groups,c){
    const peers=groups.get(c)?.clips||[],index=peers.indexOf(c);
    const sameMix=other=>other&&!other.muted&&!c.muted&&
      JSON.stringify(clipSettings(other))===JSON.stringify(clipSettings(c))&&
      other.stemPlaybackMode===c.stemPlaybackMode&&other.stemState===c.stemState&&
      stemNames.every(s=>(other['stemGain_'+s]??1)===(c['stemGain_'+s]??1))&&
      ![other,c].some(clip=>clip.fadeInBeats>0||clip.fadeOutBeats>0||
        (p.automationLanes||[]).some(l=>l.scope==='clip'&&l.targetId===clip.id&&l.enabled!==false));
    return {in:!sameMix(peers[index-1]),out:!sameMix(peers[index+1])};
  }
  function edgeEnvelope(c,map,from,edges){
    const start=map.beatToSeconds(c.timelineStartBeat),end=map.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats);
    // Three milliseconds removes a hard edit discontinuity without moving the
    // cut, stretching a beat or adding an audible musical fade.
    const span=Math.min(.003,(end-start)/2),points=[{time:start,value:edges.in?0:1}];
    if(edges.in)points.push({time:start+span,value:1});
    if(edges.out)points.push({time:end-span,value:1});
    points.push({time:end,value:edges.out?0:1});
    const at=Math.max(start,from);let value=points[0].value;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(at>=b.time)value=b.value;else if(at>=a.time){value=a.value+(b.value-a.value)*(at-a.time)/(b.time-a.time);break;}}
    return [{time:at,value},...points.filter(point=>point.time>at)];
  }
  function playbackWindows(c,p,from=0,to=Infinity,opening=8,separated=Boolean(c.stemJob)){
    const map=window.AxiomStudioDaw.compileTempoMap(p),start=map.beatToSeconds(c.timelineStartBeat),end=map.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats);
    const sourceTime=seconds=>map.beatToSeconds(Math.max(0,c.timelineStartBeat+(window.AxiomStudioDaw.sourceSecondsToBeat(c,seconds)-c.sourceStartBeat)*c.timelineDurationBeats/c.sourceDurationBeats));
    // Warm the decoder/DSP before the first audible cut as well as later windows.
    // Seeking MP3 decoding directly to a cut can lose its opening attack. Context
    // is never played and stays inside the full file or captured stem coverage.
    const sourceStart=separated
      ? Number.isFinite(c.stemCoverage?.start)&&c.stemCoverage.start>=0?sourceTime(c.stemCoverage.start)
        :Number.isFinite(c.stemSourceStart)?sourceTime(window.AxiomStudioDaw.sourceBeatToSeconds(c,c.stemSourceStart)):start
      :sourceTime(0);
    const sourceEnd=separated
      ? Number.isFinite(c.stemCoverage?.end)?sourceTime(c.stemCoverage.end):end
      :Number.isFinite(c.durationSec)?sourceTime(c.durationSec)
      : end;
    const first=from<start+opening?0:1+Math.floor((from-start-opening)/8),windows=[];
    // One second of DSP context on either side; adjacent audible windows crossfade
    // over 20 ms. Every stem uses precisely the same project/source time bounds.
    for(let i=first;;i++){
      const a=start+(i?opening+(i-1)*8:0);if(a>=Math.min(end,to))break;
      const b=Math.min(end,a+(i?8:opening)),left=i>0,right=b<end;
      const audibleStart=Math.max(start,a-(left?.01:0)),audibleEnd=Math.min(end,b+(right?.01:0));
      const preparedStart=Math.max(sourceStart,a-1),preparedEnd=Math.min(sourceEnd,a+(i?8:opening)+1);
      windows.push({start:Math.max(from,audibleStart),end:Math.min(to,audibleEnd),preparedStart,
        clip:timingWindow(c,p,preparedStart,preparedEnd),fadeIn:left&&i>first?[a-.01,a+.01]:null,fadeOut:right?[b-.01,b+.01]:null});
    }
    return windows.filter(w=>w.end>w.start);
  }
  async function prepareClip(c,p,token,stem=null,warm=null) {
    const cancelled=()=>warm?warm.cancelled:token!==generation;
    if(!warm&&keyPreparation){await keyPreparation.done;if(cancelled())throw new Error('Playback cancelled');}
    if(cancelled())throw new Error('Playback cancelled');
    let payload;
    if(p.playbackMode==='preserve-pitch')payload=stretchRequest(c,p);
    else {
      const start=window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat);
      const duration=window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat+c.sourceDurationBeats)-start;
      payload={path:c.path,start,duration,pitch:0,mode:'resample-source',anchors:[{source:0,target:0},{source:duration,target:duration}]};
    }
    if(stem){payload.stemJob=c.stemJob;payload.stem=stem;}
    if(window.AxiomBrowserStretch){
      browserPreparation ||= window.AxiomBrowserStretch.create();
      return browserPreparation.prepare(payload);
    }
    let response,job;
    const handoverDeadline=Date.now()+5000;
    do{
      if(cancelled())throw new Error('Playback cancelled');
      response=await fetch('/api/studio-daw/stretch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      job=await response.json();
      // Stop/seek cancels asynchronously. Give that worker time to release its
      // slot instead of turning a rapid restart into a false playback failure.
      if(response.status!==409||Date.now()>=handoverDeadline)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(true);
    if(!response.ok)throw new Error(job.error || 'Audio preparation is unavailable.');
    if(cancelled()) {
      if(response.status===202)await fetch(`/api/studio-daw/stretch/${job.id}`,{method:'DELETE'});
      if(preparation?.token===token)preparation=null;
      throw new Error('Playback cancelled');
    }
    if(warm)warm.id=job.id;
    else if(response.status===202) preparation={id:job.id,token};
    const deadline=Date.now()+20*60*1000;
    let pollDelay=100;
    while(job.state!=='ready') {
      if(['failed','cancelled'].includes(job.state))throw new Error(job.error || 'Preparation cancelled.');
      if(Date.now()>deadline)throw new Error('Audio preparation timed out.');
      await new Promise(resolve=>setTimeout(resolve,pollDelay));
      pollDelay=Math.min(500,pollDelay*2);
      if(cancelled())throw new Error('Playback cancelled');
      const status=await fetch(`/api/studio-daw/stretch/${job.id}`);job=await status.json();
      if(!status.ok)throw new Error(job.error || 'Preparation status unavailable.');
    }
    if(preparation?.token===token)preparation=null;
    return `/api/studio-daw/stretch/${job.id}/audio`;
  }
  function warmKeySync(p,c,purpose='Key Sync'){
    if(window.AxiomBrowserStretch||!(c.keySync||purpose==='AXIOM Snap'&&c.fluidSync))return Promise.resolve(false);
    const task={cancelled:false,id:null,done:null};keyPreparation=task;
    const title=c.title||c.label||'Right deck';
    preparationStatus(`Preparing ${purpose}: ${title}. You can keep editing; Play will start when ready.`);
    task.done=(async()=>{
      try{
        const original=JSON.parse(JSON.stringify(c));
        const originalStems=original.stemState==='ready'&&original.stemJob&&original.stemPlaybackMode!=='original';
        const copy=original.nativeEffect?.enabled?original:playbackWindows(original,p,0,Infinity,originalStems?8:4)[0]?.clip;
        if(!copy)return false;
        const separated=copy.stemState==='ready'&&copy.stemJob&&copy.stemPlaybackMode!=='original';
        const stems=separated?neededStems(p,copy):[null];
        for(let i=0;i<stems.length;i++){
          if(task.cancelled)return false;
          preparationStatus(`Preparing ${purpose}: ${title}${stems[i]?' · '+stems[i]:''} (${i+1}/${stems.length}). ${loading?'Playback starts automatically when ready.':'Press Play when you want to start.'}`);
          await prepareClip(copy,p,null,stems[i],task);
        }
        if(!task.cancelled&&!loading)window.showToast?.(`${purpose} ready. Press Play to hear the mix.`);
        return !task.cancelled;
      }catch(error){if(!task.cancelled&&!loading)window.showToast?.(purpose+' preparation paused: '+error.message+'. Press Play to retry.',true);return false;}
      finally{if(keyPreparation===task){keyPreparation=null;if(!loading)preparationStatus('');}}
    })();
    return task.done;
  }
  function renderBounds(p,options={}) {
    const map=window.AxiomStudioDaw.compileTempoMap(p);
    const startBeat=Number(options.startBeat),endBeat=Number(options.endBeat);
    const startSeconds=Number.isFinite(Number(options.startSeconds))?Number(options.startSeconds):Number.isFinite(startBeat)?map.beatToSeconds(Math.max(0,startBeat)):0;
    const endSeconds=Number.isFinite(Number(options.endSeconds))?Number(options.endSeconds):Number.isFinite(endBeat)?map.beatToSeconds(Math.max(0,endBeat)):Infinity;
    if(!Number.isFinite(startSeconds)||startSeconds<0)throw new Error('Invalid render In point.');
    if(endSeconds!==Infinity&&(!Number.isFinite(endSeconds)||endSeconds<=startSeconds))throw new Error('Render Out must be after Render In.');
    return {startSeconds,endSeconds};
  }
  function renderLength(p,streaming=false,startSeconds=0,endSeconds=Infinity){
    const map=window.AxiomStudioDaw.compileTempoMap(p);
    const beat=Math.max(0,...p.arrangementClips.map(c=>c.timelineStartBeat+c.timelineDurationBeats),...(p.fxRegions||[]).map(f=>f.startBeat+f.durationBeats+f.tailBeats),...(window.AxiomPatterns?.list(p)||[]).map(c=>c.startBeat+c.durationBeats));
    const duration=Math.min(map.beatToSeconds(beat),endSeconds)-startSeconds;
    if(!Number.isFinite(duration)||duration<=0||(!streaming&&duration>600))throw new Error('Offline export requires a nonempty project of at most 10 minutes. Choose Real-time for a longer mix.');
    return duration;
  }
  function renderPolicy(p,options={}) {
    const bounds=renderBounds(p,options);
    const duration=renderLength(p,true,bounds.startSeconds,bounds.endSeconds),map=window.AxiomStudioDaw.compileTempoMap(p);
    const diskEncoding=Boolean(window.AxiomStreamExport?.canEncodeOffline?.());
    let buffered=Boolean(options.buffered!==false&&diskEncoding&&window.AxiomPcm&&!window.AxiomBrowserStretch&&window.Worker&&typeof OfflineAudioContext!=='undefined'&&OfflineAudioContext?.prototype?.suspend&&OfflineAudioContext?.prototype?.resume);
    let sourceBytes=0;const windows=[];
    for(const c of p.arrangementClips){
      if(c.muted||(options.sectionId&&c.sectionId!==options.sectionId)||(options.stem&&c.id!==options.clipId))continue;
      const start=window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat);
      const end=window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat+c.sourceDurationBeats);
      if(end-start<.02)buffered=false;
      const timeline=map.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats)-map.beatToSeconds(c.timelineStartBeat);
      // Prepared stems are separate stereo buffers. Rate conversion can retain
      // timeline-sized blocks; a non-PCM decoder may retain the whole source.
      const span=Math.max(end-start,timeline,Number(c.duration)||0,Number(c.durationSec)||0);
      if(!Number.isFinite(span)||span<=0)throw new Error('Resolve the full clip duration before exporting.');
      const voices=options.stem?1:c.stemState==='ready'&&c.stemJob&&c.stemPlaybackMode!=='original'?4:1;
      sourceBytes+=(span+8)*48000*8*voices;
      // A twelve-second lookahead retains bounded four-second PCM blocks,
      // with extra room for boundaries and the rate converter's input window.
      const weight=Math.min(span+8,24)*48000*8*voices;
      windows.push([Math.max(0,map.beatToSeconds(c.timelineStartBeat)-12),weight],[map.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats)+4,-weight]);
    }
    // Disk-backed encoding retains the offline output plus a bounded writer
    // block. The legacy in-memory encoder also allocates a WAV and Blob copy.
    let activeBytes=0,peakSourceBytes=0;
    windows.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
    for(const [,weight] of windows){activeBytes+=weight;peakSourceBytes=Math.max(peakSourceBytes,activeBytes);}
    const retainedSourceBytes=buffered?peakSourceBytes:sourceBytes;
    const estimatedBytes=retainedSourceBytes+duration*48000*8*(diskEncoding?1:3)+(diskEncoding?1024*1024:0);
    const reason=duration>(buffered?1200:600)?'mix length':retainedSourceBytes>384*1024*1024||estimatedBytes>640*1024*1024?'estimated audio memory':'';
    return {mode:reason?'realtime':'offline',reason,duration,sourceBytes,estimatedBytes,buffered,peakSourceBytes,startSeconds:bounds.startSeconds,endSeconds:bounds.endSeconds};
  }
  async function play(p,from=cursor,clipIds=null,offline=false,recording=null,forceStems=false,sourceCue=null) {
    window.AxiomSourceAudition?.stop();
    stop(false,'play-start'); cursor=from;
    if(!p) return;
    project=p;const token=++generation;loading=true;renderingProject=Boolean(offline);recordingJob=recording;auditionClipIds=offline?null:clipIds;update();
    const isolatedPlayback=!offline&&!recording&&!clipIds&&!forceStems,failedClips=new Map();let activePasses=null;
    timingDiagnostics.clipFailures=[];
    function isolateClip(c,error){
      if(!isolatedPlayback||token!==generation)throw error;
      if(failedClips.has(c.id))return;
      failedClips.set(c.id,String(error.message||error));
      timingDiagnostics.clipFailures=[...failedClips].map(([id,reason])=>({id,reason}));
      for(const pass of activePasses||[])pass.skipClip?.(c);
      const reason=/PCM|sample-rate conversion|audio block/.test(String(error.message))?'AXIOM could not load this section of its audio.':String(error.message||'Its audio could not be prepared.');
      const recovery=/effect/i.test(reason)?'Bypass the affected effect, then press Play to retry.':c.stemJob?'Choose Create Stems for this clip, then press Play to retry.':'Reconnect its audio or correct the clip, then press Play to retry.';
      const remaining=hasPatternAudio(p)||p.arrangementClips.some(clip=>!clip.muted&&!failedClips.has(clip.id)&&clip.timelineDurationBeats>0);
      window.showToast?.(`${c.label||c.title||'A clip'} paused: ${reason} ${remaining?(running?'Other clips keep playing. ':'AXIOM will try the remaining clips. '):''}${recovery}`,true);
      if(running&&!p.arrangementClips.some(clip=>!clip.muted&&!failedClips.has(clip.id)&&clip.timelineDurationBeats>0)&&!hasPatternAudio(p))stop(false,'no-playable-clips');
    }
    const phase=name=>{try{offline?.onPhase?.(name);}catch{/* Diagnostics must never interrupt audio. */}};
    try {
      phase('sources');
      // Resolve complete source boundaries before computing export length,
      // tempo segments or scheduled buffers, independently of waveform paint.
      if(!window.AxiomSourceBounds?.prepare&&p.arrangementClips.some(c=>c.sourceIntent==='full-track'))
        throw new Error('Full-song preparation did not load. Save your draft and reload AXIOM before playing.');
      if(window.AxiomSourceBounds?.prepare){
        // Intake checks can overlap a move, trim or BPM correction. Retry the
        // current arrangement, never schedule the superseded snapshot.
        const groups=isolatedPlayback?[...new Set(p.arrangementClips.filter(c=>!c.muted).map(c=>c.path))].map(path=>p.arrangementClips.filter(c=>c.path===path&&!c.muted)): [null];
        for(const group of groups)for(let attempt=0;;attempt++){
          try{await window.AxiomSourceBounds.prepare(p,()=>token===generation,{clipIds:group?group.map(c=>c.id):clipIds,sectionId:offline?.sectionId});break;}
          catch(error){
            if(token!==generation)return;
            if(error.code==='AXIOM_SOURCE_CHECK_STALE'&&attempt<2)continue;
            if(!group)throw error;
            for(const clip of group)isolateClip(clip,error);break;
          }
        }
      }
      if(token!==generation)return;
      if(window.AxiomSteadyTiming?.prepare && offline){
        phase('timing');
        waitingForSnap=true;
        preparationStatus('Preparing AXIOM Snap. Playback starts automatically when the timing is ready.');
        try{await window.AxiomSteadyTiming.prepare(p,()=>token===generation,{clipIds,sectionId:offline?.sectionId});}
        finally{if(token===generation)waitingForSnap=false;}
        if(token!==generation)return;
      } else window.AxiomSteadyTiming?.queue?.(p);
      if(sourceCue!==null){
        const c=p.arrangementClips.find(c=>c.id===clipIds?.[0]);
        if(!c?.fluidSync||!Number.isFinite(sourceCue))throw new Error('Enable AXIOM Snap before comparing corrected playback.');
        const ratio=(window.AxiomStudioDaw.sourceSecondsToBeat(c,sourceCue)-c.sourceStartBeat)/c.sourceDurationBeats;
        if(ratio<0||ratio>=1)throw new Error('Choose a comparison point inside this clip.');
        from=seconds(c.timelineStartBeat+c.timelineDurationBeats*ratio,p);cursor=from;
      }
      const requireSeparatedStems=Boolean(forceStems||offline);
      phase('stems');
      if(window.AxiomStemCache)await window.AxiomStemCache.ensure(p,()=>token===generation,{forceStems:forceStems||Boolean(offline?.stem),requireStems:requireSeparatedStems,clipIds,sectionId:offline?.sectionId,onFailure:isolatedPlayback?isolateClip:undefined});
      if(token!==generation)return;
      if(offline&&p.arrangementClips.some(c=>c.stemPlaybackBeforeRefresh&&!c.muted&&(!clipIds||clipIds.includes(c.id))&&(!offline.sectionId||c.sectionId===offline.sectionId)))
        throw new Error('Stem refresh is incomplete. Wait for stems to finish or choose Create Stems again before exporting the saved stem mix.');
      const pendingClips=p.arrangementClips.filter(c=>c.stemJob&&c.stemState!=='ready'&&c.stemPlaybackMode!=='original'&&!c.muted&&!failedClips.has(c.id)&&(!clipIds||clipIds.includes(c.id))&&(!offline?.sectionId||c.sectionId===offline.sectionId));
      if(isolatedPlayback&&(hasPatternAudio(p)||p.arrangementClips.some(c=>!c.muted&&!failedClips.has(c.id)&&c.timelineDurationBeats>0&&!pendingClips.includes(c))))for(const c of pendingClips)isolateClip(c,new Error(c.stemState==='processing'?'Stem separation is still running.':'Separated audio is unavailable.'));
      const pendingStems=pendingClips.find(c=>!failedClips.has(c.id));
      if(pendingStems){
        if(pendingStems.stemState==='processing'&&!offline&&!recording){
          preparationStatus('Stemmed clips can make playback take longer than usual. Please be patient, it will play when the stems are ready.');
          while(token===generation&&pendingStems.stemState==='processing')await new Promise(resolve=>setTimeout(resolve,250));
          if(token!==generation)return;
          return play(p,from,clipIds,offline,recording,forceStems,sourceCue);
        }
        const message=pendingStems.stemState==='processing'?'Updating stems for the extended clip. Your stem mix is kept; press Play when separation finishes.':'Separated audio is unavailable for this clip. Choose Create Stems again; your stem mix is kept.';
        throw new Error(message);
      }
      if(forceStems){
        const clip=p.arrangementClips.find(c=>c.id===clipIds?.[0]);
        if(offline||recording||clipIds?.length!==1||clip?.stemState!=='ready'||!clip.stemJob)throw new Error('Choose a clip with available separated stems.');
        stemPreview=true;
      }
      if(recording&&loop?.project===p)throw new Error('Turn off project looping before recording a take.');
      const exportSection=offline?.sectionId||null;
      const exportStem=offline?.stem||null;
      const tailRegion=offline?.fxTailId?p.fxRegions?.find(f=>f.id===offline.fxTailId):null;
      if(offline?.fxTailId&&(!tailRegion||!['echo','reverb','vintageReverb'].includes(tailRegion.type)||!window.AxiomDawFx.validate(tailRegion)||tailRegion.tailBeats<=0||exportStem||exportSection||clipIds))throw new Error('Choose an echo or reverb region with a nonempty tail.');
      const preMaster=Boolean(offline&&offline.masterProcessing===false);
      // Native compressors initialize their detector differently from its
      // settled silent state. Prime the graph before either render mode starts.
      const graphWarmup=window.AxiomDawFx?.warmup?window.AxiomDawFx.warmup(p,{preMaster,preparedPcm:Boolean(window.AxiomPcmSource?.enabled&&typeof AudioWorkletNode==='function')}):(p.fxRegions||[]).some(f=>f.type==='enhance'&&(!preMaster||f.target!=='master'))?2:0;
      phase('preparation');
      const policy=offline?.auto?renderPolicy(p,offline):null;
      const streamExport=Boolean(offline?.streaming||policy?.mode==='realtime');
      const bufferedOffline=Boolean(!streamExport&&policy?.buffered);
      if(policy)offline.onMode?.(policy);
      if(streamExport&&(tailRegion||recording))throw new Error('Streaming export cannot record input or render isolated FX tails.');
      if(tailRegion&&preMaster)throw new Error('FX return rendering requires the source processing graph.');
      if(exportSection&&!['left-deck','right-deck','samples','recordings','instruments'].includes(exportSection))throw new Error('Invalid export track.');
      if(exportStem){
        const clip=p.arrangementClips.find(c=>c.id===clipIds?.[0]);
        if(exportSection||clipIds?.length!==1||!['vocals','other','bass','drums'].includes(exportStem)||!clip||clip.stemState!=='ready'||!clip.stemJob)throw new Error('Choose a clip with available separated stems.');
      }
      window.AxiomDawAutomation?.validateProject(p);
      masterLimiterPresent=Boolean(p.masterMixer?.limiter);
      if(masterLimiterPresent){
        if(!window.AxiomMasterLimiter)throw new Error('Master limiter is unavailable. Reload AXIOM before playing this project.');
        window.AxiomMasterLimiter.validate(p.masterMixer.limiter);
      }
      for(const c of p.arrangementClips.filter(c=>!c.muted&&!failedClips.has(c.id))){
        try{
          if(p.playbackMode!=='preserve-pitch'&&window.AxiomStudioDaw.playbackPitch(c)!==0)throw new Error('This clip has a pitch shift. Choose Preserve Pitch to play it.');
          if(c.stemState==='ready'&&c.stemPlaybackMode!=='original'&&!c.stemJob)throw new Error('The separated stems are unavailable. Choose Create Stems again.');
          plan({...p,arrangementClips:[c]},from);
        }catch(error){isolateClip(c,error);}
      }
      let exportDuration=0,exportLatency=0,renderEndSeconds=Infinity;
      if(offline){
        window.AxiomPcm?.clearPlaybackCache?.();
        const bounds=renderBounds(p,{startSeconds:from,endSeconds:offline?.endSeconds});
        from=bounds.startSeconds;renderEndSeconds=bounds.endSeconds;
        exportDuration=renderLength(p,streamExport||bufferedOffline,from,renderEndSeconds);exportLatency=preMaster||tailRegion&&tailRegion.target!=='master'?0:window.AxiomDawFx?.latency?.(p)||0;
        if(tailRegion)exportDuration=seconds(tailRegion.startBeat+tailRegion.durationBeats+tailRegion.tailBeats,p);
        const previous=context;context=null;
        if(previous&&previous.state!=='closed'&&!await waitForEngine(previous.close?.(),token,'Audio output could not reset for rendering. Check the device and retry.'))throw new Error('Export cancelled');
        if(token!==generation)throw new Error('Export cancelled');
        if(streamExport){if(!await resumeEngine(48000,token))throw new Error('Export cancelled');}
        else context=new OfflineAudioContext(2,Math.max(1,Math.round(exportDuration*48000)+Math.round((exportLatency+graphWarmup)*48000)),48000);
      }else if(!await resumeEngine(recording||p.playbackMode==='preserve-pitch'||window.AxiomPcm&&!window.AxiomBrowserStretch?48000:undefined,token))return;
      if(token!==generation)return;
      if(context.audioWorklet&&window.AxiomPcmSource?.enabled){
        await window.AxiomPcmSource.prepare(context);if(token!==generation)return;
      }
      await window.AxiomDawFx?.prepare?.(context,p);if(token!==generation)return;
      await window.AxiomDawDjFx?.prepare(context,p);if(token!==generation)return;
      if(!clipIds&&(!exportSection||exportSection==='instruments'))await window.AxiomBeatPreview?.prepare?.(p);if(token!==generation)return;
      window.AxiomBeatPreview?.stop();
      await window.stopAxiomAudioPlayback?.('arrangement_play');
      if(token!==generation)return;
      clock=window.AxiomStudioDaw.compileTempoMap(p);
      const repeat=!offline&&!clipIds&&loop?.project===p?{start:clock.beatToSeconds(loop.startBeat),end:clock.beatToSeconds(loop.endBeat)}:null;
      if(repeat&&(from<repeat.start||from>=repeat.end))from=repeat.start;
      cursor=from;
      const initialFrom=from;
      const tapeSeeds=new Map(),tapeRanges=[];
      for(const destination of new Set([initialFrom,...(repeat?[repeat.start]:[])])){
        const start=window.AxiomTapeStop?.rewind(p,destination,{clipIds,sectionId:exportSection})??destination;
        if(start<destination)tapeRanges.push({start,destination});
      }
      const renderLimit=offline&&!tailRegion?from+exportDuration:Infinity;
      if(repeat)from=repeat.start;
      const plannedFrom=Math.min(from,...tapeRanges.map(r=>r.start));from=plannedFrom;
      const rolling=(!offline||streamExport||bufferedOffline)&&!repeat,lookAhead=12;
      const rollingPatterns=rolling||Boolean(repeat);
      const patternEndSeconds=Math.max(from,...(window.AxiomPatterns?.list(p)||[]).map(c=>clock.beatToSeconds(c.startBeat+c.durationBeats)));
      const patternWindowEnd=(start,limit=Infinity)=>Math.max(start,Math.min(repeat?repeat.end:patternEndSeconds,start+lookAhead,limit,renderLimit));
      const initialPatternEnd=rollingPatterns?patternWindowEnd(initialFrom,repeat?.end):patternEndSeconds;
      if(!clipIds&&(!exportSection||exportSection==='instruments')){
        await window.AxiomInstruments?.prepare(p,initialFrom,initialPatternEnd,()=>token!==generation);if(token!==generation)return;
      }
      const entries=plan(p,from,failedClips).filter(entry=>(!exportSection||entry.clip.sectionId===exportSection)&&(!clipIds || clipIds.includes(entry.clip.id))&&(!repeat||from+entry.when<repeat.end)),cache=new Map();let bytes=0;
      const audioContext=context,preparedURLs=new Map(),pcmInfo=new Map(),pcmReads=new Map(),cacheEnds=new Map(),loopCacheEnds=new Map(),loopClipEnds=new Map();
      const sourcePCM=Boolean(audioContext.sampleRate===48000&&window.AxiomPcm&&!window.AxiomBrowserStretch);
      const sourcePCMClips=new Set(sourcePCM?entries.map(e=>e.clip).filter(c=>{
        if(c.reversed)return false;
        const span=window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat+c.sourceDurationBeats)-window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat);
        return Number.isFinite(span)&&span>=.02;
      }):[]);
      const leases=window.AxiomPreparedCache?.create(error=>{if(token===generation){stop(false,'cache-lease-failed');window.showToast?.(error.message,true);}});cacheLease=leases;
      const clipEnds=new Map(entries.map(e=>[e.clip.id,clock.beatToSeconds(e.clip.timelineStartBeat+e.clip.timelineDurationBeats)-from]));
      const stats={decodedBytes:0,peakDecodedBytes:0,decodedSources:0,decodedBlocks:0,preparedSources:0,scheduledEntries:0,pendingEntries:0,resamplerBytes:0,peakResamplerBytes:0,workletSourceEntries:0,nativeSourceEntries:0};
      if(rollingPatterns)streamingState=stats;
      for(const c of new Set(entries.map(entry=>entry.clip))){
        if(!c.nativeEffect)continue;
        try{
        if(!window.AxiomNativeEffects)throw new Error('Native effect support is unavailable. Reload the DAW.');
        window.AxiomNativeEffects.validate(c.nativeEffect);
        if(c.nativeEffect.enabled&&p.playbackMode!=='preserve-pitch')throw new Error('Audio Unit effects require Preserve Pitch mode. Change mode or bypass the effect.');
        if(c.nativeEffect.enabled&&(forceStems||exportStem||c.stemState==='ready'&&c.stemPlaybackMode!=='original'))throw new Error('Audio Unit effects process the original clip mix. Bypass the effect before auditioning or exporting isolated stems.');
        }catch(error){isolateClip(c,error);}
      }
      function retain(decoded,key){
        bytes+=decoded.length*decoded.numberOfChannels*4;
        if(bytes>512*1024*1024)throw new Error('Active audio exceeds the current 512 MB decoded-audio limit.');
        cache.set(key,decoded);stats.decodedBytes=bytes;stats.peakDecodedBytes=Math.max(stats.peakDecodedBytes,bytes);stats.decodedSources++;
        return decoded;
      }
      async function buffer(url,entry) {
        if(entry.rateStream){
          if(!ratePreparation){
            const module=await import('/static/js/studio-daw/rate-stream.mjs?v=3');
            if(token!==generation)throw new Error('Streaming rate preparation cancelled.');
            ratePreparation=module.create(audioContext);
          }
          const key=JSON.stringify([url,entry.rateStream,entry.rateOffset,entry.rateVoiceId||'']);
          let decoded=cache.get(key);
          if(!decoded){
            const result=await ratePreparation.read(url,entry);
            if(token!==generation)throw new Error('Streaming rate preparation cancelled.');
            decoded=retain(result.buffer,key);stats.decodedBlocks++;stats.resamplerBytes=result.memoryBytes;stats.peakResamplerBytes=Math.max(stats.peakResamplerBytes,result.memoryBytes);
          }
          cacheEnds.set(key,Math.max(cacheEnds.get(key)||0,entry.when+entry.duration));
          return {buffer:decoded,startSeconds:0,key};
        }
        if(cache.has(url)) return {buffer:cache.get(url),startSeconds:0,key:url};
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);downloads.add(controller);
        try{
          if(entry.pcmBlock&&window.AxiomPcm?.supports(url)){
            // Share verification while bounded stem reads overlap. Each Play
            // still obtains fresh metadata; no previous generation authorizes it.
            if(!pcmInfo.has(url))pcmInfo.set(url,window.AxiomPcm.describe(url,controller.signal));
            const info=await pcmInfo.get(url);
            if(info.sampleRate!==audioContext.sampleRate&&!entry.rawStem)throw new Error('Prepared audio sample rate changed. Restart playback before continuing.');
            // A failed range must never fetch/decode a multi-gigabyte source.
            // PCM range handles sub-frame rounding; real bounds failures remain
            // explicit instead of becoming an unbounded browser allocation.
            const range = window.AxiomPcm.range(url,info,entry,audioContext.sampleRate);
            if (range) {
              let decoded=cache.get(range.key);
              if(!decoded){
                if(!pcmReads.has(range.key))pcmReads.set(range.key,(async()=>{
                  const audio=await window.AxiomPcm.read(audioContext,info,range,controller.signal,{reuse:!offline});
                  if(token!==generation||controller.signal.aborted)throw new Error('PCM playback cancelled');
                  retain(audio,range.key);stats.decodedBlocks++;return audio;
                })().finally(()=>pcmReads.delete(range.key)));
                decoded=await pcmReads.get(range.key);
              }
              cacheEnds.set(range.key,Math.max(cacheEnds.get(range.key)||0,entry.when+entry.duration));
              return {buffer:decoded,startSeconds:range.startSeconds,key:range.key};
            }
          }
          let response=await fetch(url,{signal:controller.signal});
          if(!response.ok){
            const detail=await response.json().catch(()=>({}));
            throw new Error(detail.error||`Audio loading failed (${response.status}).`);
          }
          if(response.headers?.get('Content-Type')?.includes('application/json')){
            const resolved=await response.json();
            if(!url.startsWith('/api/library/stream?')||resolved.success!==true||resolved.needs_browser_folder||typeof resolved.resolved_path!=='string'||!resolved.resolved_path)throw new Error('Reconnect the browser music folder before playing this project.');
            const address=new URL(resolved.resolved_path,window.location.origin);
            const local=address.origin===window.location.origin&&['blob:','http:','https:'].includes(address.protocol)&&address.pathname!=='/api/library/stream';
            const inline=/^data:audio\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(address.href);
            if(!local&&!inline)throw new Error('The browser audio address is unavailable. Reconnect the music folder.');
            response=await fetch(address.href,{signal:controller.signal});
            if(!response.ok)throw new Error('The browser audio file is unavailable. Reconnect the music folder.');
          }
          const raw=await response.arrayBuffer();
          if(token!==generation) throw new Error('Playback cancelled');
          const decoded=await audioContext.decodeAudioData(raw);
          if(token!==generation)throw new Error('Playback cancelled');
          if(controller.signal.aborted)throw new Error('Audio loading timed out. Press Play to retry.');
          return {buffer:retain(decoded,url),startSeconds:0,key:url};
        }catch(error){if(error.name==='AbortError')throw new Error('Audio loading cancelled or timed out. Press Play to retry.');throw error;}
        finally{clearTimeout(timeout);downloads.delete(controller);}
      }
      const prepared=[];let deferred=[],progressiveAudio=false;
      const continuous=continuousSources(failedClips.size?{...p,arrangementClips:p.arrangementClips.filter(c=>!failedClips.has(c.id))}:p);
      const preparationKey=(c,stem)=>JSON.stringify([c.id,stem,c.timelineStartBeat,c.timelineDurationBeats]);
      async function preparedURL(c,stem){
        const key=preparationKey(c,stem);
        if(preparedURLs.has(key))return preparedURLs.get(key);
        if(loading)preparationStatus(stem
          ? `Stemmed clips can make playback take longer than usual. Please be patient, it will play: ${c.title||c.label||'Clip'} · ${stem}.`
          : `${c.keySync?'Preparing Key Sync':'Preparing audio'}: ${c.title||c.label||'Clip'}. Playback starts automatically when ready.`);
        let url=await prepareClip(c,p,token,stem);
        if(c.nativeEffect?.enabled)url=await window.AxiomNativeEffects.prepare(c,url,()=>token!==generation,p);
        if(token!==generation)throw new Error('Playback cancelled');
        await leases?.hold(url);
        if(token!==generation)throw new Error('Playback cancelled');
        preparedURLs.set(key,url);stats.preparedSources++;return url;
      }
      if(p.playbackMode==='preserve-pitch') {
        const clips=[...new Set(entries.map(entry=>entry.clip))];
        for(let i=0;i<clips.length;i++) {
          const c=clips[i];
          const shared=continuous.get(c)?.clip||c,request=stretchRequest(shared,p);
          const separated=forceStems||Boolean(exportStem)||c.stemState==='ready'&&c.stemPlaybackMode!=='original';
          const progressive=!c.reversed&&audioContext.sampleRate===48000&&!c.nativeEffect?.enabled&&
            (!offline&&separated||request.pitch!==0||request.anchors.some(a=>Math.abs(a.source-a.target)>1/48000)||Number.isFinite(c.beatgrid?.metadata?.steadyBpm)&&request.anchors.at(-1).target>10||!separated&&request.start>0&&shared.timelineStartBeat>0);
          progressiveAudio ||= progressive;
          if(separated&&!c.stemJob)throw new Error('The separated stems are unavailable. Separate the clip again.');
          const selectedStems=exportStem?[exportStem]:separated?(recording?stemNames:neededStems(p,c)):[null];
          if(separated&&!exportStem)omittedStems.push(...stemNames.filter(stem=>!selectedStems.includes(stem)).map(stem=>({clip:c,stem})));
          const neutralFrozen=c.frozenClip?.version===1&&!separated&&!c.reversed&&!c.nativeEffect?.enabled&&sourcePCM&&request.pitch===0&&request.anchors.every(a=>Math.abs(a.source-a.target)<=1/48000);
          if(neutralFrozen){
            progressiveAudio=true;
            const start=clock.beatToSeconds(c.timelineStartBeat),end=clock.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats),source=window.AxiomStudioDaw.sourceBeatToSeconds(c,c.sourceStartBeat);
            deferred.push({clip:c,pcm:true,rawFrozen:true,when:Math.max(0,start-from),offset:source+Math.max(0,from-start),duration:end-Math.max(start,from),rate:1,rateEnd:1,gain:1,resolve:async()=>`/api/library/stream?path=${encodeURIComponent(c.path)}`});
            continue;
          }
          const readyOrigin=!offline&&!recording&&separated&&window.AxiomPcm&&!window.AxiomBrowserStretch?readyStemOrigin(c,p):null;
          if(readyOrigin!==null){
            progressiveAudio=true;
            for(const entry of entries.filter(e=>e.clip===c))for(const stem of selectedStems){
              // Use the exact source position from the compiled entry. A tiny
              // grid-rate residue within one sample is the neutral timing case.
              deferred.push({...entry,stem,pcm:true,rawStem:true,offset:Math.max(0,entry.offset-readyOrigin),rate:1,rateEnd:1,
                gain:c['stemGain_'+stem]??1,resolve:async()=>{const url=`/api/studio-daw/stems/${encodeURIComponent(c.stemJob)}/${stem}`;await leases?.hold(url);return url;}});
            }
            continue;
          }
          for(const stem of selectedStems) {
            const start=clock.beatToSeconds(c.timelineStartBeat),end=clock.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats);
            if(progressive){
              for(const w of playbackWindows(shared,p,from,repeat?.end,separated?8:4,separated)){
                const a=Math.max(start,w.start),b=Math.min(end,w.end);if(b<=a)continue;
                deferred.push({clip:c,stem,pcm:true,reversed:Boolean(c.reversed),preparationKey:preparationKey(w.clip,stem),
                  when:a-from,offset:a-w.preparedStart,duration:b-a,rate:1,rateEnd:1,
                  joinIn:w.fadeIn,joinOut:w.fadeOut,gain:stem?(c['stemGain_'+stem]??1):1,resolve:()=>preparedURL(w.clip,stem)});
              }
            }else deferred.push({clip:c,stem,pcm:true,reversed:Boolean(c.reversed),when:Math.max(0,start-from),offset:c.reversed?clock.beatToSeconds(shared.timelineStartBeat+shared.timelineDurationBeats)-end:Math.max(start,from)-clock.beatToSeconds(shared.timelineStartBeat),duration:end-Math.max(start,from),rate:1,rateEnd:1,gain:stem?(c['stemGain_'+stem]??1):1,resolve:()=>preparedURL(shared,stem)});
          }
        }
      } else for(const entry of entries) {
        const c=entry.clip;
        if(sourcePCMClips.has(c)){
          const shared=continuous.get(c)?.clip||c;
          const separated=forceStems||exportStem||c.stemState==='ready'&&c.stemJob&&c.stemPlaybackMode!=='original';
          const sourceStart=window.AxiomStudioDaw.sourceBeatToSeconds(shared,shared.sourceStartBeat);
          const selectedStems=exportStem?[exportStem]:separated?(recording?stemNames:neededStems(p,c)):[null];
          if(separated&&!exportStem)omittedStems.push(...stemNames.filter(stem=>!selectedStems.includes(stem)).map(stem=>({clip:c,stem})));
          for(const stem of selectedStems){
            const readyOrigin=!offline&&!recording&&separated&&entry.rate===1&&entry.rateEnd===1?readyStemOrigin(c,p):null;
            if(readyOrigin!==null){
              progressiveAudio=true;
              deferred.push({...entry,stem,pcm:true,rawStem:true,offset:Math.max(0,entry.offset-readyOrigin),gain:c['stemGain_'+stem]??1,
                resolve:async()=>{const url=`/api/studio-daw/stems/${encodeURIComponent(c.stemJob)}/${stem}`;await leases?.hold(url);return url;}});
            }else if(separated&&!offline&&!c.nativeEffect?.enabled&&entry.rate===1&&entry.rateEnd===1){
              // Unit-rate stems need the opening range, not a decoded copy of
              // the whole selection. Rate-shifted voices keep their established
              // continuous resampler origin to avoid resetting its phase.
              progressiveAudio=true;
              for(const w of playbackWindows(shared,p,from,repeat?.end,8,true)){
                const a=Math.max(entry.when,w.start-from),b=Math.min(entry.when+entry.duration,w.end-from);
                const cut=cropEntries([entry],0,a,b)[0];if(!cut)continue;
                const windowStart=window.AxiomStudioDaw.sourceBeatToSeconds(w.clip,w.clip.sourceStartBeat);
                deferred.push({...cut,when:a,stem,pcm:true,offset:Math.max(0,cut.offset-windowStart),
                  preparationKey:preparationKey(w.clip,stem),
                  joinIn:w.fadeIn,joinOut:w.fadeOut,gain:c['stemGain_'+stem]??1,resolve:()=>preparedURL(w.clip,stem)});
              }
            }else deferred.push({...entry,stem,pcm:true,offset:Math.max(0,entry.offset-sourceStart),gain:stem?(c['stemGain_'+stem]??1):1,resolve:()=>preparedURL(shared,stem)});
          }
        } else if(forceStems||exportStem||c.stemState==='ready' && c.stemJob && c.stemPlaybackMode!=='original') {
          const selectedStems=exportStem?[exportStem]:recording?stemNames:neededStems(p,c);
          if(!exportStem)omittedStems.push(...stemNames.filter(stem=>!selectedStems.includes(stem)).map(stem=>({clip:c,stem})));
          for(const stem of selectedStems) {
            const stemStart=Number.isFinite(c.stemCoverage?.start)&&c.stemCoverage.start>=0?c.stemCoverage.start:
              window.AxiomStudioDaw.sourceBeatToSeconds ? window.AxiomStudioDaw.sourceBeatToSeconds(c,c.stemSourceStart||0) : (c.stemSourceStart||0)*60/(c.bpm||120);
            deferred.push({...entry,stem,offset:entry.offset-stemStart,gain:c['stemGain_'+stem]??1,resolve:async()=>`/api/studio-daw/stems/${encodeURIComponent(c.stemJob)}/${stem}`});
          }
        } else deferred.push({...entry,gain:1,resolve:async()=>`/api/library/stream?path=${encodeURIComponent(c.path)}`});
        if(token!==generation) return;
      }
      const chunkEntries=list=>audioContext.sampleRate===48000&&window.AxiomPcm?list.flatMap(entry=>entry.pcm&&!entry.reversed?pcmEntries(entry,Boolean(window.Worker&&!window.AxiomBrowserStretch)):[entry]):list;
      const historyEntries=deferred;
      from=repeat?repeat.start:initialFrom;
      deferred=cropEntries(deferred,plannedFrom,from,repeat?.end??renderLimit);
      for(const c of entries.map(e=>e.clip))clipEnds.set(c.id,clock.beatToSeconds(c.timelineStartBeat+c.timelineDurationBeats)-from);
      const loopEntries=repeat?deferred:null;
      deferred=chunkEntries(deferred);
      deferred.sort((a,b)=>a.when-b.when);let queued=0;
      async function loadReady(entry){
        if(failedClips.has(entry.clip.id))return null;
        try{
          const url=await entry.resolve(),decoded=await buffer(url,entry);
          if(token!==generation)throw new Error('Playback cancelled');
          if(!entry.pcmBlock){leases?.forget(url);browserPreparation?.forget(url);}
          return {...entry,buffer:decoded.buffer,offset:entry.offset-decoded.startSeconds,cacheKey:decoded.key};
        }catch(error){isolateClip(entry.clip,error);return null;}
      }
      async function prepareUntil(until,append=null){
        while(queued<deferred.length&&deferred[queued].when<until){
          const entry=deferred[queued],pending=[];let consumed=0;
          if(!offline&&entry.pcmBlock&&!entry.rateStream){
            // The backend retains its single DSP worker. Resolve preparations
            // in order, but overlap completed PCM reads with the next preparation.
            // Four is the existing server reader limit; publish a cohort only
            // when every required voice is ready, preserving all-or-nothing starts.
            for(let i=queued;i<deferred.length&&i<queued+4&&deferred[i].when<until;i++){
              const next=deferred[i];if(!next.pcmBlock||next.rateStream)break;
              if(failedClips.has(next.clip.id)){pending.push(Promise.resolve(null));consumed++;continue;}
              let url;
              try{url=await next.resolve();}catch(error){isolateClip(next.clip,error);pending.push(Promise.resolve(null));consumed++;continue;}
              const read=buffer(url,next).then(decoded=>{
                if(token!==generation)throw new Error('Playback cancelled');
                return {...next,buffer:decoded.buffer,offset:next.offset-decoded.startSeconds,cacheKey:decoded.key};
              }).catch(error=>{isolateClip(next.clip,error);return null;});
              // A later preparation can fail before this batch is awaited.
              read.catch(()=>{});pending.push(read);consumed++;
            }
          }else{pending.push(loadReady(entry));consumed=1;}
          const ready=await Promise.all(pending);
          if(token!==generation)throw new Error('Playback cancelled');
          for(const item of ready)if(item&&!failedClips.has(item.clip.id)){if(append)append(item);else prepared.push(item);}
          queued+=consumed;stats.scheduledEntries=queued;stats.pendingEntries=deferred.length-queued;
        }
      }
      let loopSequence=0;
      function loopQueue(passFrom){
        // A new pass must not resume a previous pass's sequential resampler.
        const voiceId='loop-'+(++loopSequence),entries=chunkEntries(cropEntries(loopEntries,from,passFrom,repeat.end)).map(entry=>entry.rateStream?{...entry,rateVoiceId:voiceId}:entry).sort((a,b)=>a.when-b.when);
        let index=0;
        return {needs:until=>index<entries.length&&entries[index].when<until,async fill(until,append){
          while(index<entries.length&&entries[index].when<until){
            const entry=entries[index],ready=await loadReady(entry);
            if(token!==generation)throw new Error('Loop audio preparation cancelled');
            if(ready&&!failedClips.has(entry.clip.id))append(ready);
            index++;stats.scheduledEntries++;stats.pendingEntries=entries.length-index;
          }
        }};
      }
      const firstLoopQueue=repeat?loopQueue(initialFrom):null;
      if(firstLoopQueue)await firstLoopQueue.fill(lookAhead,entry=>prepared.push(entry));
      // Plain playback needs one PCM block before starting. Keep the longer
      // rolling buffer for refills, exports and pitch/effect preparation.
      else await prepareUntil(rolling?(!offline&&progressiveAudio?2:!offline&&p.playbackMode!=='preserve-pitch'?4:lookAhead):Infinity);
      if(token!==generation) return;
      if(failedClips.size&&!p.arrangementClips.some(c=>!c.muted&&!failedClips.has(c.id)&&c.timelineDurationBeats>0)&&!hasPatternAudio(p))throw new Error(`No playable clips remain. ${[...failedClips.values()][0]} Retry Play after reconnecting the audio or recreating the affected stems.`);
      if(!offline&&omittedStems.some(({clip,stem})=>neededStems(p,clip).includes(stem)))return play(p,from,clipIds,offline,recording,forceStems);
      let capture=null;
      if(streamExport){
        if(!window.AxiomStreamExport)throw new Error('Streaming export is unavailable. Reload the DAW.');
        capture=await window.AxiomStreamExport.create(context,exportDuration,offline.onProgress);
        if(token!==generation){capture.abort();throw new Error('Export cancelled');}
        exportJob=capture;
      }
      const audioEnd=deferred.reduce((end,entry)=>Math.max(end,from+entry.when+entry.duration),from);
      const latency=preMaster?0:window.AxiomDawFx?.latency?.(p)||0;
      function schedulePass(passFrom,limit,base,passPrepared=prepared,audioQueue=null,passContext=audioContext,options={}) {
      const context=passContext,audioContext=passContext;
      const owned=new Set(),passFx=[];
      const updateFx={push(apply){passFx.push(apply);fxUpdates.push(apply);}};
      const own=node=>{nodes.add(node);owned.add(node);return node;};
      const from=passFrom,origin=base-from;
      const pass=passPrepared;
      const patternEnd=window.AxiomPatterns?Math.max(0,...window.AxiomPatterns.list(p).map(c=>c.startBeat+c.durationBeats)):4;
      const inputEnd=recording?.recorder?.endSeconds;
      if(inputEnd!==undefined&&(!Number.isFinite(inputEnd)||inputEnd<=from))throw new Error('Invalid MIDI recording range.');
      const endBeat=clock.secondsToBeat(Math.max(audioEnd,inputEnd||0,seconds(!clipIds&&hasPatternAudio(p)?patternEnd:4,p),...(p.fxRegions||[]).map(f=>seconds(f.startBeat+f.durationBeats+f.tailBeats,p))));
      const timing={origin,endBeat:repeat?clock.secondsToBeat(limit):endBeat},automation=(scope,targetId='')=>({p,ref:{scope,targetId},timing});
      const output=repeat||tailRegion?own(context.createGain()):(capture?.input||context.destination);
      const fxCapture=tailRegion?{id:tailRegion.id,output:context.destination}:null;
      if(repeat){output.connect(context.destination);output.gain.setValueAtTime(0,base+limit-from+latency);}
      const masterAutomation={p,ref:{scope:'project',targetId:''},timing:{...timing,origin:origin+latency}};
      const limited=!preMaster&&masterLimiterPresent;
      let masterOutput=output;
      if(limited&&!offline){
        // Listening volume follows the limiter, so changing the speaker level
        // cannot change the amount of limiting or the exported mix.
        const monitor=own(context.createGain()),apply=()=>smooth(monitor.gain,Number(document.getElementById('ap-volume')?.value??1)*.7,context);
        apply();updateFx.push(apply);monitor.connect(output);masterOutput=monitor;
      }
      const masterChannel=channel(context,masterOutput,()=>preMaster?{}:p.masterMixer,v=>preMaster?1:(limited||offline?1:Number(document.getElementById('ap-volume')?.value??1)*.7)*masterLevel(p,v),own,preMaster?null:masterAutomation,
        limited?input=>window.AxiomMasterLimiter.connect(context,input,own,p,updateFx,Boolean(!offline),()=>{if(token===generation){stop(false,'master-limiter-failed');window.showToast?.('Master limiter failed. Playback stopped; retry from this position.',true);}}):null);master=masterChannel.fader;masterChannel.sectionId='master';
      const mix=own(context.createGain());
      const taps=new Map();
      if((p.fxRegions||[]).some(f=>f.type==='sidechainHard'||f.type==='sidechainSoft'))for(const id of ['left-deck','right-deck','samples','recordings','instruments'])taps.set(id,own(context.createGain()));
      const routing={taps,preview:!offline,tapeSeeds:tapeSeeds.get(passFrom),tapeCapture:options.tapeCapture,tapeResume:passFrom,onerror(){if(options.priming){options.tapeCapture.fail(new Error('Effect history processing failed.'));return;}if(token===generation){stop(false,'effect-processor-failed');window.showToast?.('Effect processing failed. Playback stopped; retry from this position.',true);}}};
      const clipRouting=c=>({...routing,onerror(){if(token!==generation)return;if(isolatedPlayback&&!options.priming)isolateClip(c,new Error('Clip effect processing failed.'));else routing.onerror();}});
      if(window.AxiomDawFx&&!preMaster)window.AxiomDawFx.connect(context,mix,masterChannel.input,{sectionId:'master'},p,origin,own,fxCapture,updateFx,routing);
      else mix.connect(masterChannel.input);
      const buses=new Map();
      function bus(sectionId) {
        if(!buses.has(sectionId)) {
          const node=taps.get(sectionId)||own(context.createGain()),strip=channel(context,mix,()=>p.rowMixer?.[sectionId],v=>rowLevel(p,sectionId,v),own,automation('deck',sectionId));
          strip.sectionId=sectionId;
          if(window.AxiomDawFx)window.AxiomDawFx.connect(context,node,strip.input,{sectionId},p,origin,own,fxCapture,updateFx,{...routing,onerror(){
            if(token!==generation)return;
            if(!isolatedPlayback||options.priming){routing.onerror();return;}
            for(const c of p.arrangementClips.filter(c=>c.sectionId===sectionId&&!c.muted))isolateClip(c,new Error('Deck effect processing failed.'));
          }});
          else node.connect(strip.input);
          buses.set(sectionId,node);
        }
        return buses.get(sectionId);
      }
      let end=Math.max(inputEnd||from,!clipIds && hasPatternAudio(p)?Math.max(from,seconds(patternEnd,p)):from,audioEnd);
      const clipBuses=new Map(),voices=new Map();
      function trackVoice(source,gain,finish,extra=[],clip=null){
        if(!rollingPatterns)return;
        const release=()=>{
          source.onended=null;source.buffer=null;voices.delete(source);
          for(const node of [source,gain,...extra]){try{node.disconnect();}catch{}owned.delete(node);nodes.delete(node);}
          const controlled=stemGains.find(s=>s.node===gain);if(controlled)stemGains.splice(stemGains.indexOf(controlled),1);
        };
        source.onended=release;voices.set(source,{end:finish,release,clip});
      }
      function append(entry) {
        if(failedClips.has(entry.clip.id))return;
        const previous=new Set(owned),previousFx=passFx.length;
        try{appendVoice(entry);}catch(error){
          if(!isolatedPlayback||options.priming)throw error;
          // Retire a graph that failed during construction before scheduling
          // another clip. Existing deck/master nodes remain owned by the pass.
          const added=new Set([...owned].filter(node=>!previous.has(node)));
          window.AxiomDawFx?.clearReduction?.(audioContext,added);
          for(const node of added){try{node.stop?.();}catch{}try{node.disconnect();}catch{}owned.delete(node);nodes.delete(node);}
          for(const [id,node] of buses)if(added.has(node))buses.delete(id);
          for(let i=channels.length-1;i>=0;i--)if(added.has(channels[i].input))channels.splice(i,1);
          for(let i=stemGains.length-1;i>=0;i--)if(added.has(stemGains[i].node))stemGains.splice(i,1);
          for(const apply of passFx.splice(previousFx)){const i=fxUpdates.indexOf(apply);if(i>=0)fxUpdates.splice(i,1);}
          skipClip(entry.clip);isolateClip(entry.clip,error);
        }
      }
      function appendVoice(entry) {
        if(bufferedOffline&&base+entry.when<audioContext.currentTime-1/48000)throw new Error('Offline audio was not scheduled before its render boundary.');
        if((rolling||repeat)&&running&&base+entry.when<audioContext.currentTime+.01)throw new Error('Upcoming audio was not ready in time. Playback paused; press Play to retry from this position.');
        let sourceBuffer=entry.buffer,sourceOffset=entry.offset;
        if(entry.reversed){
          sourceBuffer=reversedBuffer(audioContext,entry.buffer);
          sourceOffset=entry.buffer.duration-entry.offset-sourceSpan(entry);
        }
        // Beat positions are continuous; decoded PCM is rounded to whole frames.
        // Only absorb a one-frame boundary discrepancy, never a missing range.
        const frame=1/sourceBuffer.sampleRate;
        if(sourceOffset<0&&sourceOffset>=-frame)sourceOffset=0;
        if(!Number.isFinite(sourceOffset)||sourceOffset<0 || sourceOffset>=sourceBuffer.duration)throw new Error(`Clip source range is unavailable: ${entry.clip.title||entry.clip.label||entry.clip.id}.`);
        const sourceTiming={when:base+entry.when,offset:sourceOffset,duration:entry.duration,drainFrames:Math.round(latency*audioContext.sampleRate)};
        const worklet=Boolean(audioContext.audioWorklet&&window.AxiomPcmSource?.enabled&&entry.rate===1&&entry.rateEnd===1&&window.AxiomPcmSource.canPlay(audioContext,sourceBuffer,sourceTiming));
        const source=own(worklet?window.AxiomPcmSource.create(audioContext,sourceBuffer,sourceTiming):context.createBufferSource());
        if(worklet){
          stats.workletSourceEntries++;
          source.onprocessorerror=()=>{if(token!==generation)return;if(isolatedPlayback)isolateClip(entry.clip,new Error('Audio source processing failed.'));else{stop(false,'pcm-source-failed');window.showToast?.('Audio source processing failed. Playback stopped; retry from this position.',true);}};
        }else{stats.nativeSourceEntries++;source.buffer=sourceBuffer;source.playbackRate.value=entry.rate;}
        if(!worklet&&Math.abs(entry.rateEnd-entry.rate)>1e-10) {
          source.playbackRate.setValueAtTime(entry.rate,base+entry.when);
          source.playbackRate.exponentialRampToValueAtTime(entry.rateEnd,base+entry.when+entry.duration);
        }
        if(!clipBuses.has(entry.clip)){
          const clipNodes=new Set(),clipOwn=node=>{clipNodes.add(node);return own(node);};
          const clipFx=[],clipUpdates={push(apply){clipFx.push(apply);updateFx.push(apply);}};
          let output=bus(entry.clip.sectionId);
          let tailEndBeat=0;
          if(window.AxiomDawFx&&(p.fxRegions||[]).some(fx=>fx.target===entry.clip.sectionId&&fx.clipId===entry.clip.id)){
            const input=clipOwn(context.createGain());
            input.channelCount=2;input.channelCountMode='explicit';
            tailEndBeat=window.AxiomDawFx.connect(context,input,output,entry.clip,p,origin,clipOwn,fxCapture,clipUpdates,clipRouting(entry.clip))||0;
            if(tailEndBeat>entry.clip.timelineStartBeat+entry.clip.timelineDurationBeats){
              // Native delay nodes can fold stored stereo to mono when their
              // finite source ends. Keep silent stereo input through the tail.
              const silence=clipOwn(context.createConstantSource());silence.offset.value=0;
              silence.connect(input);silence.start();silence.stop(origin+clock.beatToSeconds(tailEndBeat));
            }
            output=input;
          }
          const edges=editEdges(p,continuous,entry.clip);
          if(entry.clip.frozenClip?.version===1){if(Math.abs(entry.clip.sourceStartBeat)<1e-9)edges.in=false;if(Math.abs(entry.clip.sourceStartBeat+entry.clip.sourceDurationBeats-entry.clip.frozenClip.durationBeats)<1e-9)edges.out=false;}
          if(edges.in||edges.out){
            const edge=clipOwn(context.createGain());edge.connect(output);output=edge;
            const points=edgeEnvelope(entry.clip,clock,from,edges);edge.gain.setValueAtTime(points[0].value,origin+points[0].time);
            for(const point of points.slice(1))edge.gain.linearRampToValueAtTime(point.value,origin+point.time);
          }
          if(entry.clip.fadeInBeats>0||entry.clip.fadeOutBeats>0){
            const fade=clipOwn(context.createGain());fade.connect(output);output=fade;
            const points=fadeEnvelope(entry.clip,clock,from);fade.gain.setValueAtTime(points[0].value,origin+points[0].time);
            for(const point of points.slice(1))fade.gain.linearRampToValueAtTime(point.value,origin+point.time);
          }
          const strip=channel(context,output,()=>clipSettings(entry.clip),v=>clipLevel(entry.clip,v)*(exportStem||exportSection||audible(p,entry.clip)?1:0),clipOwn,automation('clip',entry.clip.id));strip.clip=entry.clip;strip.nodes=clipNodes;strip.fxUpdates=clipFx;
          strip.endBeat=Math.max(entry.clip.timelineStartBeat+entry.clip.timelineDurationBeats,tailEndBeat);clipBuses.set(entry.clip,strip);
        }
        const gain=own(context.createGain());gain.gain.value=entry.gain;
        if(entry.stem){
          // Each streamed voice only needs automation during its audible block.
          const stemTiming={...timing,liveStartBeat:entry.clip.timelineStartBeat,startBeat:clock.secondsToBeat(from+entry.when),endBeat:clock.secondsToBeat(from+entry.when+entry.duration)};
          const controlled={node:gain,clip:entry.clip,stem:entry.stem,timing:stemTiming};stemGains.push(controlled);applyStemGain(controlled);
        }
        source.connect(gain);let join;
        if(entry.joinIn||entry.joinOut){
          join=own(context.createGain());const begin=from+entry.when,finish=begin+entry.duration;
          const level=t=>Math.min(entry.joinIn?Math.max(0,Math.min(1,(t-entry.joinIn[0])/(entry.joinIn[1]-entry.joinIn[0]))):1,
            entry.joinOut?Math.max(0,Math.min(1,(entry.joinOut[1]-t)/(entry.joinOut[1]-entry.joinOut[0]))):1);
          join.gain.setValueAtTime(level(begin),base+entry.when);
          const points=[...(entry.joinIn||[]),...(entry.joinOut||[]),finish].filter(t=>t>begin&&t<=finish).sort((a,b)=>a-b);
          for(const t of points)join.gain.linearRampToValueAtTime(level(t),origin+t);
          gain.connect(join);join.connect(clipBuses.get(entry.clip).input);
        }else gain.connect(clipBuses.get(entry.clip).input);
        if(!worklet){source.start(base+entry.when,sourceOffset);source.stop(base+entry.when+entry.duration);}
        trackVoice(source,gain,base+entry.when+entry.duration+(worklet?latency:0),join?[join]:[],entry.clip);
        if(repeat){
          loopCacheEnds.set(entry.cacheKey,Math.max(loopCacheEnds.get(entry.cacheKey)||0,base+entry.when+entry.duration));
          loopClipEnds.set(entry.clip.id,Math.max(loopClipEnds.get(entry.clip.id)||0,origin+Math.min(limit,clock.beatToSeconds(entry.clip.timelineStartBeat+entry.clip.timelineDurationBeats))));
        }
        end=Math.max(end,from+entry.when+entry.duration);
      }
      for(const entry of pass)append(entry);
      let patternBus=null,patternThrough=rollingPatterns?patternWindowEnd(from,limit):initialPatternEnd;
      function patternSource(buffer,when,offset,duration){
        const timing={when,offset,duration,drainFrames:Math.round(latency*audioContext.sampleRate)};
        const protectedVoice=Boolean(audioContext.audioWorklet&&window.AxiomPcmSource?.enabled&&window.AxiomPcmSource.canPlayVoice(audioContext,buffer,timing));
        const source=own(protectedVoice?window.AxiomPcmSource.createVoice(audioContext,buffer,timing):context.createBufferSource());
        if(protectedVoice){
          stats.workletSourceEntries++;
          source.onprocessorerror=()=>{if(token===generation){stop(false,'pcm-source-failed');window.showToast?.('Pattern audio processing failed. Playback stopped; retry from this position.',true);}};
        }else{stats.nativeSourceEntries++;source.buffer=buffer;source.start(when,offset);source.stop(when+duration);}
        return source;
      }
      const trackPatternVoice=(source,gain,finish)=>trackVoice(source,gain,finish+latency);
      function appendPatterns(start,finish){
        window.AxiomBeatPreview?.scheduleArrangement(context,patternBus,p,origin,start,finish,own,trackPatternVoice,patternSource);
        window.AxiomInstruments?.schedule(context,patternBus,p,origin,start,finish,own,trackPatternVoice,{complete:rollingPatterns,continuations:start===from,end:repeat?limit:Infinity,source:patternSource});
      }
      if(!clipIds&&(!exportSection||exportSection==='instruments')&&(hasPatternAudio(p)||recording?.recorder?.output)){
        const drums=channel(context,bus('instruments'),()=>({}),()=>exportSection||!anySolo(p)||p.rowMixer?.instruments?.solo?1:0,own);patternBus=drums.input;
        appendPatterns(from,options.priming?limit:rollingPatterns?patternThrough:end);if(!options.priming)recording?.recorder?.output?.connect(drums.input);
      }
      const patternLimit=Math.min(seconds(patternEnd,p),repeat?limit:Infinity);
      const needsPatterns=until=>Boolean(rollingPatterns&&patternBus&&patternThrough<patternLimit&&patternThrough+4<=until+1e-8);
      async function preparePatterns(until){
        while(needsPatterns(until)){
          const next=Math.min(patternThrough+4,patternLimit);
          await window.AxiomInstruments?.prepare(p,patternThrough,next,()=>token!==generation);
          if(token!==generation)throw new Error('Instrument preparation cancelled');
          if(origin+patternThrough<audioContext.currentTime+(bufferedOffline?-1/48000:.01))throw new Error('Upcoming instruments were not ready in time. Press Play to resume.');
          appendPatterns(patternThrough,next);patternThrough=next;
        }
      }
      const tail=Math.max(0,...(p.fxRegions||[]).map(fx=>seconds(fx.startBeat+fx.durationBeats+fx.tailBeats,p)));
      end=repeat?limit:Math.max(end,tail);
      function releaseStrip(clip,strip){
        window.AxiomDawFx?.clearReduction?.(audioContext,strip.nodes);
        for(const node of strip.nodes){try{node.stop?.();}catch{}try{node.disconnect();}catch{}owned.delete(node);nodes.delete(node);}
        for(const apply of strip.fxUpdates){const i=fxUpdates.indexOf(apply);if(i>=0)fxUpdates.splice(i,1);const j=passFx.indexOf(apply);if(j>=0)passFx.splice(j,1);}
        const i=channels.indexOf(strip);if(i>=0)channels.splice(i,1);clipBuses.delete(clip);
      }
      function skipClip(clip){
        for(const [source,voice] of voices)if(voice.clip?.id===clip.id){try{source.stop();}catch{}voice.release();}
        for(const [c,strip] of clipBuses)if(c.id===clip.id)releaseStrip(c,strip);
      }
      return {end,append,preparePatterns,needsPatterns,patternOrigin:origin,base,audioQueue,skipClip,releaseClips(){
        for(const voice of voices.values())if(voice.end<=audioContext.currentTime)voice.release();
        for(const [clip,strip] of clipBuses)if(origin+clock.beatToSeconds(strip.endBeat)+latency+(bufferedOffline?1:0)<=audioContext.currentTime){
          releaseStrip(clip,strip);
        }
      },next:base+end-from,finish:base+end-from+latency,dispose(){
        window.AxiomDawFx?.clearReduction?.(audioContext,owned);
        for(const node of owned){try{node.stop?.();}catch{}try{node.disconnect();}catch{}nodes.delete(node);}
        for(const apply of passFx){const i=fxUpdates.indexOf(apply);if(i>=0)fxUpdates.splice(i,1);}
        for(let i=channels.length-1;i>=0;i--)if(owned.has(channels[i].input))channels.splice(i,1);
        for(let i=stemGains.length-1;i>=0;i--)if(owned.has(stemGains[i].node))stemGains.splice(i,1);
      }};
      }
      for(const range of tapeRanges){
        preparationStatus('Preparing effects at the chosen playback position…');
        const ready=[];
        for(const entry of chunkEntries(cropEntries(historyEntries,plannedFrom,range.start,range.destination))){
          const loaded=await loadReady(entry);if(loaded)ready.push(loaded);
        }
        if(token!==generation)throw new Error('Effect preparation cancelled.');
        const primeFrames=Math.round((graphWarmup+range.destination-range.start)*audioContext.sampleRate);
        const prime=new OfflineAudioContext(2,Math.max(1,primeFrames),audioContext.sampleRate);
        if(prime.audioWorklet&&window.AxiomPcmSource?.enabled)await window.AxiomPcmSource.prepare(prime);
        await window.AxiomDawFx?.prepare?.(prime,p);await window.AxiomDawDjFx?.prepare?.(prime,p);
        if(!clipIds)await window.AxiomInstruments?.prepare?.(p,range.start,range.destination,()=>token!==generation);
        if(token!==generation)throw new Error('Effect preparation cancelled.');
        const capture={frame:primeFrames,states:new Map(),waiting:new Set(),error:null,fail(error){this.error=error;}};
        let pass;
        try{
          pass=schedulePass(range.start,range.destination,graphWarmup,ready,null,prime,{priming:true,tapeCapture:capture});
          await prime.startRendering();
          const deadline=Date.now()+5000;
          while(capture.waiting.size&&!capture.error&&token===generation&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
          if(token!==generation)throw new Error('Effect preparation cancelled.');
          if(capture.error||capture.waiting.size)throw capture.error||new Error('Effect history could not be verified. Retry Play.');
          tapeSeeds.set(range.destination,capture.states);
        }finally{pass?.dispose();}
      }
      if(recording){
        recording.recorder=await recording.prepare(context);
        if(token!==generation||recording.cancelled){recording.recorder.abort();return false;}
      }
      const lead=Math.max(.08,graphWarmup);
      const base=offline&&!streamExport?graphWarmup:streamExport?Math.ceil((context.currentTime+lead)*48000/128)*128/48000:context.currentTime+lead;origin=base-initialFrom+latency;loopClock=repeat;
      capture?.arm(base+exportLatency);
      const passes=[schedulePass(initialFrom,repeat?.end,base,prepared,firstLoopQueue)];
      activePasses=passes;
      if(failedClips.size&&!p.arrangementClips.some(c=>!c.muted&&!failedClips.has(c.id)&&c.timelineDurationBeats>0)&&!hasPatternAudio(p))throw new Error(`No playable clips remain. ${[...failedClips.values()][0]} Retry Play after fixing the affected clip.`);
      if(rolling||repeat)prepared.length=0;
      if(recording){
        if(passes[0].end<=initialFrom)throw new Error('Place the cursor before the project end to record with playback.');
        recording.recorder.arm(base+latency,passes[0].finish);recording.armed=true;
      }
      if(offline&&!streamExport){
        phase('rendering');
        const rendering=context;let audio;
        if(bufferedOffline){
          let nextBoundary=base+4,suspension=null,rejectCancellation;
          const cancelled=new Promise((resolve,reject)=>{rejectCancellation=reject;});cancelled.catch(()=>{});
          const job={stop:reason=>rejectCancellation(new Error('Export cancelled: '+reason))};exportJob=job;
          const suspendNext=()=>{
            const frame=Math.ceil(nextBoundary*48000/128)*128;nextBoundary+=4;
            return frame<rendering.length?rendering.suspend(frame/48000):null;
          };
          suspension=suspendNext();
          const completed=rendering.startRendering();completed.catch(()=>{});
          try{
            while(suspension){
              await Promise.race([suspension,cancelled,completed.then(()=>{throw new Error('Offline rendering ended before its scheduled boundary.');})]);
              if(token!==generation)throw new Error('Export cancelled');
              releaseFinishedAudio();
              phase('preparation');
              await prepareUntil(rendering.currentTime+lookAhead-base,passes[0].append);
              await passes[0].preparePatterns(from+rendering.currentTime+lookAhead-base);
              phase('rendering');
              if(token!==generation)throw new Error('Export cancelled');
              offline.onProgress?.(Math.min(exportDuration,Math.max(0,rendering.currentTime-base)),exportDuration);
              if(token!==generation)throw new Error('Export cancelled');
              suspension=suspendNext();
              await rendering.resume();
            }
            audio=await Promise.race([completed,cancelled]);
          }catch(error){
            if(token===generation)stop(false,'offline-render-failed');
            // Offline contexts cannot be closed. Drain the disconnected graph,
            // including a suspension already queued before cancellation.
            suspension?.then(()=>rendering.resume()).catch(()=>{});
            await rendering.resume().catch(()=>{});await completed.catch(()=>{});
            throw error;
          }finally{if(exportJob===job)exportJob=null;}
        }else audio=await rendering.startRendering();
        if(context===rendering)context=null;
        if(token!==generation)throw new Error('Export cancelled');
        const start=tailRegion?seconds(tailRegion.startBeat+tailRegion.durationBeats,p):0;
        const result={audio,warmupFrames:Math.round(graphWarmup*48000),trimFrames:Math.round((graphWarmup+start+exportLatency)*48000),frames:Math.round((exportDuration+exportLatency)*48000)-Math.round((start+exportLatency)*48000),renderStartSeconds:initialFrom,renderEndSeconds:Number.isFinite(renderEndSeconds)?renderEndSeconds:initialFrom+exportDuration,...(bufferedOffline?{streamingStats:{...stats}}:{})};
        stop(true,'export-complete');return result;
      }
      const end=passes[0].end;let next=passes[0].next;
      if(!offline)patternMonitor=window.AxiomPatternMonitor?.start(context,p,{
        segments:()=>passes.map(pass=>({base:pass.base+latency,from:pass.base-pass.patternOrigin,to:pass.end,clock})),
        valid:()=>token===generation&&!document.getElementById('studio-daw-shell')?.classList.contains('hidden')
      });
      let pumping=false;
      function queueAudio(){
        if(!rolling)return;
        const nextEntry=deferred[queued],until=audioContext.currentTime+lookAhead-base;
        if(nextEntry&&base+nextEntry.when<audioContext.currentTime+.01)throw new Error('Audio scheduling fell behind. Press Play to resume from the paused position.');
        if(pumping)return;
        const warm=deferred.slice(queued).find(e=>e.pcm&&!e.rawStem&&!e.rawFrozen&&!failedClips.has(e.clip.id)&&base+e.when<audioContext.currentTime+90&&!preparedURLs.has(e.preparationKey||preparationKey(e.clip,e.stem)));
        if((!nextEntry||nextEntry.when>=until)&&!warm&&!passes[0].needsPatterns(from+until))return;
        pumping=true;
        (async()=>{
          await prepareUntil(audioContext.currentTime+lookAhead-base,passes[0].append);
          await passes[0].preparePatterns(from+audioContext.currentTime+lookAhead-base);
          // Expensive DSP can run ahead on disk without retaining its decoded
          // waveform. Never start more than one native preparation at a time.
          if(warm&&token===generation)try{await warm.resolve();}catch(error){isolateClip(warm.clip,error);}
        })().catch(error=>{
          if(token!==generation)return;
          stop(false,'audio-preparation-failed');window.showToast?.(error.message,true);
        }).finally(()=>{pumping=false;});
      }
      function releaseFinishedAudio(){
        if(!rolling)return;
        const now=audioContext.currentTime-base;
        for(const [key,url] of preparedURLs){
          const [clipId,,startBeat,durationBeats]=JSON.parse(key);
          const windowEnd=clock.beatToSeconds(startBeat+durationBeats)-from;
          if(clipEnds.get(clipId)>now&&windowEnd>now)continue;
          preparedURLs.delete(key);
          if(![...preparedURLs.values()].includes(url)){leases?.forget(url);browserPreparation?.forget(url);ratePreparation?.release(url);pcmInfo.delete(url);}
        }
        // Sources keep their buffers while sounding. Drop the cache only after
        // every scheduled use has ended and no near-future use needs it.
        const needed=new Set(deferred.filter(e=>e.when+e.duration>now&&e.when<now+lookAhead).map(e=>e.clip));
        const urls=new Set();
        for(const c of needed){
          if(p.playbackMode==='preserve-pitch'||sourcePCMClips.has(c)){for(const [key,url] of preparedURLs)if(JSON.parse(key)[0]===c.id)urls.add(url);}
          else if(c.stemState==='ready'&&c.stemJob&&c.stemPlaybackMode!=='original'||forceStems)for(const stem of ['vocals','other','bass','drums'])urls.add(`/api/studio-daw/stems/${encodeURIComponent(c.stemJob)}/${stem}`);
          else urls.add(`/api/library/stream?path=${encodeURIComponent(c.path)}`);
        }
        for(const [url,decoded] of cache)if(cacheEnds.has(url)?cacheEnds.get(url)<=now:!urls.has(url)){
          bytes-=decoded.length*decoded.numberOfChannels*4;cache.delete(url);cacheEnds.delete(url);
        }
        stats.decodedBytes=bytes;passes[0].releaseClips();
      }
      function queueLoops(){
        if(!repeat)return;
        if(context.currentTime>next){stop(false,'loop-scheduler-late');window.showToast?.('Loop paused because audio scheduling fell behind. Press Play to resume.',true);return;}
        for(const pass of passes)pass.releaseClips();
        if(!pumping){
          for(const [key,finish] of loopCacheEnds)if(finish<=audioContext.currentTime){
            const decoded=cache.get(key);if(decoded){bytes-=decoded.length*decoded.numberOfChannels*4;cache.delete(key);}
            cacheEnds.delete(key);loopCacheEnds.delete(key);
          }
          for(const [key,url] of preparedURLs)if((loopClipEnds.get(JSON.parse(key)[0])??Infinity)<=audioContext.currentTime){
            preparedURLs.delete(key);
            if(![...preparedURLs.values()].includes(url)){leases?.forget(url);browserPreparation?.forget(url);ratePreparation?.release(url);pcmInfo.delete(url);}
          }
          stats.decodedBytes=bytes;
        }
        const loopLead=Math.min(lookAhead,Math.max(1,(repeat.end-repeat.start)/2));
        if(!pumping&&(next<context.currentTime+loopLead||passes.some(pass=>pass.audioQueue?.needs(context.currentTime+lookAhead-pass.base)||pass.needsPatterns(context.currentTime+lookAhead-pass.patternOrigin)))){
          pumping=true;
          (async()=>{
            for(const pass of [...passes]){
              await pass.audioQueue?.fill(audioContext.currentTime+lookAhead-pass.base,pass.append);
              await pass.preparePatterns(audioContext.currentTime+lookAhead-pass.patternOrigin);
            }
            while(token===generation&&next<audioContext.currentTime+loopLead){
              const queue=loopQueue(repeat.start),ready=[];
              await queue.fill(lookAhead,entry=>ready.push(entry));
              await window.AxiomInstruments?.prepare(p,repeat.start,patternWindowEnd(repeat.start,repeat.end),()=>token!==generation);
              if(token!==generation)return;
              if(next<audioContext.currentTime+.01)throw new Error('Loop audio was not ready in time. Press Play to resume.');
              const pass=schedulePass(repeat.start,repeat.end,next,ready,queue);passes.push(pass);next=pass.next;
            }
          })().catch(error=>{if(token===generation){stop(false,'loop-preparation-failed');window.showToast?.(error.message,true);}}).finally(()=>{pumping=false;});
        }
        while(passes.length>1&&passes[0].finish<context.currentTime)passes.shift().dispose();
      }
      running=true;loading=false;preparationStatus('');queueLoops();update();
      if(streamExport)phase('rendering');
      Object.assign(timingDiagnostics,{ticks:0,frames:0,maxTickGapMs:0,lastTickAt:Date.now()});
      if(!streamExport&&typeof window.requestAnimationFrame==='function'){
        const drawFrame=()=>{
          if(token!==generation||!running)return;
          try{drawPlayhead();timingDiagnostics.frames++;}
          catch(error){timingDiagnostics.lastRenderError=String(error.message||error);}
          playheadFrame=window.requestAnimationFrame(drawFrame);
        };
        playheadFrame=window.requestAnimationFrame(drawFrame);
      }
      const player=document.getElementById('audio-player');if(player){player.dataset.transportState='playing';player.dataset.transportEnd=String(end);}
      let lastAudioTime=context.currentTime,lastAudioProgress=Date.now();
      const resyncVisibleClock=()=>{if(token!==generation||!running||!context)return;lastAudioTime=context.currentTime;lastAudioProgress=Date.now();update();};
      window.addEventListener?.('focus',resyncVisibleClock);
      window.addEventListener?.('pageshow',resyncVisibleClock);
      document.addEventListener?.('visibilitychange',resyncVisibleClock);
      clockResyncCleanup=()=>{
        window.removeEventListener?.('focus',resyncVisibleClock);
        window.removeEventListener?.('pageshow',resyncVisibleClock);
        document.removeEventListener?.('visibilitychange',resyncVisibleClock);
      };
      timer=setInterval(()=>{
        try{
          const tickAt=Date.now();
          timingDiagnostics.maxTickGapMs=Math.max(timingDiagnostics.maxTickGapMs,tickAt-timingDiagnostics.lastTickAt);
          timingDiagnostics.lastTickAt=tickAt;timingDiagnostics.ticks++;
          if(!repeat&&position()>=end)stop(true,'end');
          else if(!streamExport && ((window.axiomVisibleTab && window.axiomVisibleTab!=='studio') || document.getElementById('studio-daw-shell')?.classList.contains('hidden') || document.getElementById('studio-daw-shell')?.closest?.('.hidden, [aria-hidden="true"]')))stop(false,'hidden');
          else {
            // WebKit can leave an engine marked running with a frozen audio clock.
            // Retire it so Play can recover without reopening or losing the project.
            if(context.currentTime!==lastAudioTime){lastAudioTime=context.currentTime;lastAudioProgress=Date.now();}
            else if(Date.now()-lastAudioProgress>1500){
              const stalled=context;
              stop(false,'audio-clock-stalled');context=null;
              try{Promise.resolve(stalled.close?.()).catch(()=>{});}catch{}
              const message='Audio output stalled. Press Play to reconnect at this position.';
              const title=document.getElementById('ap-title');if(title)title.textContent=message;
              window.showToast?.(message,true);return;
            }
            releaseFinishedAudio();queueAudio();queueLoops();update();
          }
        }catch(error){stop(false,repeat?'loop-error':'audio-scheduler-error');window.showToast?.('Playback stopped: '+error.message,true);}
      },60);
      if(!streamExport){
        if(p.playbackMode==='preserve-pitch'&&deferred.length) window.showToast?.('Playing prepared pitch-preserving audio. Tempo or grid edits require a new preparation pass.');
        else if(deferred.some(entry=>Math.abs(entry.rate-1)>.001)) window.showToast?.('Resample mode changes pitch with speed. Choose Preserve Pitch to prepare key-locked audio.');
        else if(entries.some(entry=>!entry.clip.beatgrid)) window.showToast?.('Snap is not ready for every song yet. Check its status before editing drifting audio.');
      }
      if(capture){
        try{return await capture.result;}
        finally{if(exportJob===capture)stop(true,'export-complete');}
      }
      return true;
    } catch(error) {if(token===generation){
      if(recording)recording.cancelled=true;
      stop(false);
      const title=document.getElementById('ap-title');if(title)title.textContent=`Playback stopped: ${error.message}`;
      window.showToast?.(error.message,true);
    }if(offline||recording)throw error;}
  }
  function record(p,from,prepare){
    const job={prepare,recorder:null,armed:false,cancelled:false};
    return {ready:play(p,from,null,false,job),stop(){if(recordingJob===job)stop(false,'recording-stop');},cancel(){job.cancelled=true;if(recordingJob===job)stop(false,'recording-cancelled');else job.recorder?.abort();}};
  }
  function toggle() {if(running||loading) stop(false,'pause-toggle');else play(window.AxiomStudioDaw.activeProject,cursor);}
  function seekBeat(p,beat) {
    if(!p || !Number.isFinite(beat) || beat<0) return;
    const nextClock=window.AxiomStudioDaw.compileTempoMap(p),position=nextClock.beatToSeconds(beat);
    if(running||loading) play(p,position,project===p?auditionClipIds:null,false,null,project===p&&stemPreview);
    else {project=p;clock=nextClock;cursor=position;update();}
  }
  function tempoChanged(p) {
    if(project!==p || !clock) return;
    const beat=clock.secondsToBeat(Math.max(0,running?position():cursor));
    const next=window.AxiomStudioDaw.compileTempoMap(p);
    const nextPosition=next.beatToSeconds(beat);
    if(running || loading) play(p,nextPosition,auditionClipIds,false,null,stemPreview);
    else {cursor=nextPosition;clock=next;update();}
  }
  document.getElementById('ap-volume')?.addEventListener('input',()=>{if(master)mixerChanged(project);});
  window.addEventListener('pagehide',()=>stop());
  window.AxiomArrangement={play,warmKeySync,auditionSource:(p,c,at)=>play(p,0,[c.id],false,null,false,at),audition:(p,c,ratio=0)=>play(p,seconds(c.timelineStartBeat+c.timelineDurationBeats*ratio,p),[c.id]),toggle,stop,seekBeat,tempoChanged,mixerChanged,rowLevel,clipLevel,audible,channel,pause:()=>stop(false),plan,stretchRequest,get playing(){return running;},get loading(){return loading;}};
  window.AxiomArrangement.fadeEnvelope=fadeEnvelope;
  window.AxiomArrangement.transportDiagnostics=()=>({...timingDiagnostics,
    playing:running,audioState:context?.state||'unavailable',audioTime:Number(context?.currentTime)||0,
    positionSeconds:running?position():cursor,documentVisible:document.visibilityState||'unknown'});
  window.AxiomArrangement.isPlayingProject=p=>p===project&&(running||loading);
  window.AxiomArrangement.warmTiming=(p,c)=>warmKeySync(p,c,'AXIOM Snap');
  Object.assign(window.AxiomArrangement,{timingWindow,playbackWindows,continuousSources,editEdges,edgeEnvelope});
  Object.defineProperty(window.AxiomArrangement,'waitingForSnap',{get:()=>waitingForSnap});
  window.AxiomArrangement.auditionStems=(p,c,ratio=0)=>play(p,seconds(c.timelineStartBeat+c.timelineDurationBeats*ratio,p),[c.id],false,null,true);
  window.AxiomArrangement.stopStemPreview=()=>{if(stemPreview)stop(false,'stem-preview-stop');};
  Object.defineProperty(window.AxiomArrangement,'stemPreviewPlaying',{get:()=>stemPreview&&running});
  Object.defineProperty(window.AxiomArrangement,'rendering',{get:()=>renderingProject});
  window.AxiomArrangement.automationPosition=timeStamp=>{
    const audioTime=context?(Number.isFinite(timeStamp)?window.AxiomMidiInput?.eventTime(context,timeStamp)??context.currentTime:context.currentTime):0;
    const raw=audioTime-origin,wrapped=loopClock&&raw>=loopClock.end?loopClock.start+(raw-loopClock.end)%(loopClock.end-loopClock.start):Math.max(cursor,raw);
    return {project,eligible:running&&!renderingProject&&!auditionClipIds&&!stemPreview&&raw>=cursor,
      beat:clock?clock.secondsToBeat(running?wrapped:cursor):0,
      cycle:loopClock&&raw>=loopClock.end?1+Math.floor((raw-loopClock.end)/(loopClock.end-loopClock.start)):0,
      loopEndBeat:loop?.project===project?loop.endBeat:null};
  };
  function renderStart(p,options={}){return renderBounds(p,options).startSeconds;}
  window.AxiomArrangement.render=(p,options={})=>play(p,renderStart(p,options),options.stem?[options.clipId]:null,{sectionId:options.sectionId,stem:options.stem,masterProcessing:options.masterProcessing,fxTailId:options.fxTailId,endSeconds:renderBounds(p,options).endSeconds});
  window.AxiomArrangement.renderStream=(p,options={})=>play(p,renderStart(p,options),options.stem?[options.clipId]:null,{...options,streaming:true,endSeconds:renderBounds(p,options).endSeconds});
  window.AxiomArrangement.renderAuto=(p,options={})=>play(p,renderStart(p,options),options.stem?[options.clipId]:null,{...options,auto:true,endSeconds:renderBounds(p,options).endSeconds});
  window.AxiomArrangement.renderPolicy=renderPolicy;
  window.AxiomArrangement.enhancementReduction=(p,id)=>running&&!renderingProject&&p===project?window.AxiomDawFx?.readReduction?.(context,p,id)||null:null;
  window.AxiomArrangement.enhancementMatchSource=(p,id)=>running&&!renderingProject&&p===project?window.AxiomDawFx?.matchSource?.(context,p,id)||null:null;
  window.AxiomArrangement.renderLength=(p,options={})=>{const bounds=renderBounds(p,options);return renderLength(p,true,bounds.startSeconds,bounds.endSeconds);};
  Object.assign(window.AxiomArrangement,{record,setLoop,clearLoop,cropEntries,pcmEntries,audibleClockTime,getLoop:p=>loop?.project===p?{startBeat:loop.startBeat,endBeat:loop.endBeat}:null});
  Object.defineProperty(window.AxiomArrangement,'streamingState',{get:()=>streamingState?{...streamingState,graphNodes:nodes.size,mixerChannels:channels.length}:null});
})();
