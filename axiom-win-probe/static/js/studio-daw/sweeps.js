(function(){
  'use strict';
  const noiseBuffers=new WeakMap();
  const sourceBuffers=new WeakMap();
  const variants={
    brightRise:{label:'Bright Rise',filter:'bandpass',q:.65,start:300,ratio:30,base:.025,lift:.3,curve:1.25},
    warmLift:{label:'Warm Lift',filter:'lowpass',q:.3,start:160,ratio:70,base:.02,lift:.24,curve:1.05},
    airCut:{label:'Air Cut',filter:'highpass',q:.55,start:90,ratio:95,base:.018,lift:.28,curve:1.45},
    tightBuild:{label:'Tight Build',filter:'bandpass',q:1.35,start:520,ratio:24,base:.015,lift:.34,curve:1.8},
  };
  function stages(pattern,speed='auto'){
    // The voice reference repeats two short bursts followed by a three-step hold.
    const phrase=[1,0,1,0,1,2,2,0];
    const build=pattern==='voiceBuild'?[[0,.5,.5,phrase],[.5,.25,.25,phrase],[.75,.25,.125,phrase]]:
      [[0,.5,1,[1,2,0,0,1,2,0,0]],[.5,.25,.5,[1,0,1,0,1,0,1,0]],[.75,.25,.25,[1,0,1,0,1,0,1,0]]];
    return speed==='auto'?build:[[0,1,...build[{steady:0,double:1,fast:2}[speed]].slice(2)]];
  }
  function validateSource(value){return value===undefined||value===null||value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.path==='string'&&value.path.length>0&&value.path.length<4096&&typeof value.title==='string'&&value.title.length<=256;}
  async function prepare(ctx,p){
    let cache=sourceBuffers.get(ctx);if(!cache){cache=new Map();sourceBuffers.set(ctx,cache);}
    const used=new Set((p.fxRegions||[]).filter(f=>f.type==='gatedSweep').map(f=>f.sweepSource?.path));
    for(const path of cache.keys())if(!used.has(path))cache.delete(path);
    for(const fx of p.fxRegions||[]){
      if(fx.type!=='gatedSweep'||!fx.sweepSource)continue;
      if(!validateSource(fx.sweepSource))throw new Error('Invalid sweep audio. Choose the file again.');
      const path=fx.sweepSource.path;if(cache.has(path))continue;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);let data;
      try{const response=await fetch('/api/library/stream?path='+encodeURIComponent(path),{signal:controller.signal});if(!response.ok)throw new Error('Sweep audio is unavailable. Choose the file again in its FX settings.');
        if(Number(response.headers?.get('content-length'))>96*1024*1024)throw new Error('Choose a sweep file under 96 MB.');
        data=await response.arrayBuffer();if(data.byteLength>96*1024*1024)throw new Error('Choose a sweep file under 96 MB.');
      }finally{clearTimeout(timeout);}
      const buffer=await ctx.decodeAudioData(data);if(buffer.duration>60||buffer.duration<=0)throw new Error('Choose a sweep sample up to 60 seconds long.');
      const bytes=buffer.length*buffer.numberOfChannels*4;
      if([...cache.values()].reduce((n,b)=>n+b.length*b.numberOfChannels*4,bytes)>256*1024*1024)throw new Error('This project has too much sweep audio loaded. Use fewer or shorter sweep samples.');
      cache.set(path,buffer);
    }
  }
  function noise(ctx){
    if(noiseBuffers.has(ctx))return noiseBuffers.get(ctx);
    const buffer=ctx.createBuffer(2,Math.round(ctx.sampleRate*4),ctx.sampleRate);
    for(let c=0;c<2;c++){let seed=104729+c*7919;const data=buffer.getChannelData(c);for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}}
    noiseBuffers.set(ctx,buffer);return buffer;
  }
  function connect(ctx,input,own,fx,timing,controlled,routing,clock){
    const start=timing.origin+clock.beatToSeconds(fx.startBeat),end=timing.origin+clock.beatToSeconds(fx.startBeat+fx.durationBeats),now=Math.max(ctx.currentTime,start);
    const [rangeStart,rangeEnd]=fx.sweepWindow||[0,1],fullBeats=fx.durationBeats/(rangeEnd-rangeStart),fullBeat=fx.startBeat-rangeStart*fullBeats;
    const virtualClock={...clock,beatToSeconds:beat=>beat<0?beat*60/clock.bpmAtBeat(0):clock.beatToSeconds(beat)};
    const fullStart=timing.origin+virtualClock.beatToSeconds(fullBeat),fullEnd=timing.origin+virtualClock.beatToSeconds(fullBeat+fullBeats);
    const sum=own(ctx.createGain());input.connect(sum);if(now>=end)return sum;
    const variant=variants[fx.sweepVariant]||variants.brightRise;
    const source=own(ctx.createBufferSource()),filter=own(ctx.createBiquadFilter()),envelope=own(ctx.createGain());
    source.buffer=fx.sweepSource?sourceBuffers.get(ctx)?.get(fx.sweepSource.path):noise(ctx);
    if(!source.buffer)throw new Error('Prepare the chosen sweep audio before playback.');
    source.loop=!fx.sweepSource;const rate=fx.sweepSource?source.buffer.duration/(fullEnd-fullStart):1;source.playbackRate.value=rate;filter.type=variant.filter;filter.Q.value=variant.q;
    const fraction=t=>Math.max(0,Math.min(1,(clock.secondsToBeat(Math.max(0,t-timing.origin))-fullBeat)/fullBeats));
    const frequency=t=>variant.start*Math.pow(variant.ratio,fraction(t)),level=t=>variant.base+variant.lift*Math.pow(fraction(t),variant.curve);
    filter.frequency.setValueAtTime(frequency(now),now);envelope.gain.setValueAtTime(now===start?0:level(now),now);
    const fadeIn=Math.min(end,now+(rangeStart? .003:.04)),fadeOut=Math.max(fadeIn,end-Math.min(rangeEnd<1?.003:.15,(end-start)*.05));
    envelope.gain.linearRampToValueAtTime(level(fadeIn),fadeIn);
    for(let i=1;i<=128;i++){const beat=fx.startBeat+fx.durationBeats*i/128,t=timing.origin+clock.beatToSeconds(beat);if(t<=now)continue;filter.frequency.exponentialRampToValueAtTime(frequency(t),t);if(t>fadeIn&&t<fadeOut)envelope.gain.linearRampToValueAtTime(level(t),t);}
    envelope.gain.linearRampToValueAtTime(level(fadeOut),fadeOut);envelope.gain.linearRampToValueAtTime(0,end);
    source.connect(filter).connect(envelope);
    for(const [offset,length,step,pattern] of stages(fx.sweepPattern,fx.sweepSpeed)){
      const gate={...fx,type:'tranceGate',startBeat:fullBeat+fullBeats*offset,durationBeats:fullBeats*length,gateDepth:100,gateStepBeats:step,gateSteps:pattern,gateAttackMs:3,gateDecayMs:0,gateSustain:100,gateReleaseMs:8,gateSwing:0};
      // Internal depth is fixed; only the region's sweep loudness is automated.
      const depth=(region,param,key,ignored,fallback,transform=v=>v)=>{param.value=transform(region[key]??fallback);};
      window.AxiomDawDjFx.connect(ctx,envelope,own,gate,{...timing,startBeat:gate.startBeat,endBeat:gate.startBeat+gate.durationBeats},depth,routing,virtualClock).connect(sum);
    }
    source.start(now,fx.sweepSource?(now-fullStart)*rate:(now-fullStart)%source.buffer.duration);source.stop(end);return sum;
  }
  function editor(form,fields,fx){
    let selected=fx.sweepSource?{...fx.sweepSource}:null,busy=false;
    const row=document.createElement('div');row.className='daw-sweep-source';
    const characterRow=document.createElement('label'),character=document.createElement('select');characterRow.textContent='Sweep character';character.name='sweepVariant';
    for(const [value,{label:text}] of Object.entries(variants)){const option=document.createElement('option');option.value=value;option.textContent=text;character.append(option);}
    character.value=fx.sweepVariant&&variants[fx.sweepVariant]?fx.sweepVariant:'brightRise';characterRow.append(character);row.append(characterRow);
    const rhythmRow=document.createElement('label'),rhythm=document.createElement('select');rhythmRow.textContent='Build rhythm';rhythm.name='sweepPattern';
    for(const [value,text] of [['voiceBuild','Short - short - long'],['halfBars','Original half-bar pulses']]){const option=document.createElement('option');option.value=value;option.textContent=text;rhythm.append(option);}
    rhythm.value=fx.sweepPattern||(fx.type==='gatedSweep'&&fx.id?'halfBars':'voiceBuild');rhythmRow.append(rhythm);row.append(rhythmRow);
    const speedRow=document.createElement('label'),speed=document.createElement('select');speedRow.textContent='Chop speed';speed.name='sweepSpeed';
    for(const [value,text] of [['auto','Build automatically'],['steady','Opening pulses'],['double','Faster chops'],['fast','Fastest chops']]){const option=document.createElement('option');option.value=value;option.textContent=text;speed.append(option);}
    speed.value=fx.sweepSpeed||'auto';speedRow.append(speed);row.append(speedRow);
    const label=document.createElement('p'),choose=document.createElement('button'),reset=document.createElement('button'),help=document.createElement('small');
    choose.type=reset.type='button';choose.textContent='Use my sweep';reset.textContent='Use AXIOM noise';
    help.textContent='Choose a sweep sample up to 60 seconds / 96 MB. Its playback speed fits the selected bars, which also changes pitch. Your original file stays unchanged.';
    row.append(label,choose,reset,help);form.querySelector('footer').before(row);
    const update=()=>{row.hidden=fields.type.value!=='gatedSweep';character.disabled=rhythm.disabled=speed.disabled=row.hidden;label.textContent='Sweep source: '+(selected?.title||'AXIOM noise');choose.disabled=busy;reset.disabled=busy||!selected;};
    choose.onclick=()=>{const picker=document.createElement('input');picker.type='file';picker.accept='.wav,.aif,.aiff,.mp3,.m4a,.flac,.aac,.mp4';picker.onchange=async()=>{
      const file=picker.files?.[0];if(!file)return;if(file.size>96*1024*1024){window.showToast?.('Choose a sweep under 96 MB.',true);return;}
      busy=true;update();label.textContent='Importing sweep...';
      try{const body=new FormData();body.append('file',file);const response=await fetch('/api/studio-daw/import',{method:'POST',body}),data=await response.json();if(!response.ok)throw new Error(data.error||'Sweep import failed.');
        const source={path:data.track?.path,title:file.name.slice(0,256)};if(!validateSource(source))throw new Error('Invalid imported sweep.');
        if(Number(data.track?.durationSec??data.track?.duration_sec)>60)throw new Error('Choose a sweep sample up to 60 seconds long.');
        if(row.isConnected)selected=source;
      }catch(error){window.showToast?.(error.message,true);}finally{busy=false;if(row.isConnected)update();}
    };picker.click();};
    reset.onclick=()=>{selected=null;update();};fields.type.addEventListener('change',update);update();
    return {update,read(region){if(region.type==='gatedSweep'){if(busy)throw new Error('Wait for the sweep upload to finish.');region.sweepVariant=character.value;region.sweepPattern=rhythm.value;region.sweepSpeed=speed.value;if(fx.sweepWindow)region.sweepWindow=[...fx.sweepWindow];if(selected)region.sweepSource={...selected};}}};
  }
  function open(){
    const p=window.AxiomStudioDaw.activeProject;if(!p){window.showToast?.('Open a DAW project first.',true);return;}
    const range=window.AxiomStudioDaw.selectedRange;
    window.AxiomDawFx.edit(null,{type:'gatedSweep',sweepVariant:'brightRise',sweepPattern:'voiceBuild',target:'master',startBeat:range?.start??p.editCursorBeat??0,durationBeats:range?range.end-range.start:64,tailBeats:0,wet:.5});
  }
  window.AxiomDawSweeps={connect,open,prepare,editor,validateSource,stages,variants};
})();
