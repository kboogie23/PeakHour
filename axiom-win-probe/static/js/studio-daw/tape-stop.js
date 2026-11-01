(function(){
  'use strict';
  const modules=new WeakMap(),modes={classic:'Classic — vinyl slowdown',modern:'Modern — keep slices on the beat',loop:'Loop — repeat and slow down'},shapes={linear:1,quick:2.5,gentle:.45};
  function validate(fx){return fx?.type==='tapeStop'&&fx.tailBeats===0&&fx.durationBeats<=32&&Object.hasOwn(modes,fx.tapeMode||'classic')&&Object.hasOwn(shapes,fx.tapeCurve||'linear')&&(fx.tapeEndSpeed===undefined||Number.isFinite(fx.tapeEndSpeed)&&fx.tapeEndSpeed>=0&&fx.tapeEndSpeed<=100)&&(fx.tapeSliceBeats===undefined||[.125,.25,.5,1,2].includes(fx.tapeSliceBeats))&&(fx.tapeLoopSync===undefined||typeof fx.tapeLoopSync==='boolean');}
  function timing(p,fx,rate=48000){
    if(window.AxiomCreativeFx?.historyTypes.includes(fx.type))return window.AxiomCreativeFx.timing(p,fx,rate);
    if(!validate(fx))throw new Error('Invalid Tape Stop settings. Reopen the effect.');
    const map=window.AxiomStudioDaw.compileTempoMap(p),start=map.beatToSeconds(fx.startBeat),end=map.beatToSeconds(fx.startBeat+fx.durationBeats);
    if(end-start>32||!Number.isFinite(end-start)||end<=start)throw new Error('Tape Stop supports up to 8 bars and 32 seconds per effect. Shorten this effect.');
    const step=fx.tapeSliceBeats??.5,boundaries=[];
    for(let beat=fx.startBeat;beat<fx.startBeat+fx.durationBeats;beat+=step)boundaries.push(Math.round(map.beatToSeconds(beat)*rate));
    return {start,end,step,boundaries,size:Math.ceil((end-start+.01)*rate)+4,loopFrames:Math.max(1,Math.round((map.beatToSeconds(Math.min(fx.startBeat+step,fx.startBeat+fx.durationBeats))-start)*rate))};
  }
  function regions(p,options={}){return (p.fxRegions||[]).filter(f=>(f.type==='tapeStop'||window.AxiomCreativeFx?.historyTypes.includes(f.type))&&(!options.sectionId||f.target===options.sectionId||f.target==='master')&&(!options.clipIds||!f.clipId||options.clipIds.includes(f.clipId)));}
  async function prepare(ctx,p){
    await window.AxiomCreativeFx?.prepare(ctx,p);
    const list=regions(p);if(!list.length)return;
    const bytes=list.reduce((sum,f)=>sum+timing(p,f,ctx.sampleRate).size*8,0);
    if(bytes>32*1024*1024)throw new Error('Tape Stop audio history exceeds 32 MB. Shorten or remove some Tape Stop effects.');
    if(!ctx.audioWorklet||typeof AudioWorkletNode!=='function')throw new Error('Tape Stop needs native audio-worklet support.');
    if(!modules.has(ctx))modules.set(ctx,ctx.audioWorklet.addModule('/static/js/studio-daw/tape-stop-worklet.js?v=20261014-tape-stop-v1').catch(e=>{modules.delete(ctx);throw e;}));
    await modules.get(ctx);
  }
  function rewind(p,from,options={}){
    let start=from;
    // Include serial effects that overlap earlier Tape Stop history as well.
    for(let changed=true;changed;){changed=false;for(const f of regions(p,options)){const t=timing(p,f),first=f.type==='bitcrush'?Math.max(t.start,from-64/48000):t.start;if(first<start&&t.end>start){start=first;changed=true;}}}
    if(from-start>32)throw new Error('Overlapping Tape Stop history exceeds 32 seconds. Separate these effects before seeking inside them.');
    return start;
  }
  function connect(ctx,input,own,fx,p,timingRef,controlled,routing,clock){
    const t=timing(p,fx,ctx.sampleRate),origin=timingRef.origin;
    const node=own(new AudioWorkletNode(ctx,'axiom-tape-stop',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{
      mode:fx.tapeMode||'classic',shape:shapes[fx.tapeCurve||'linear'],startFrame:Math.round((origin+t.start)*ctx.sampleRate),endFrame:Math.round((origin+t.end)*ctx.sampleRate),size:t.size,
      boundaries:t.boundaries.map(frame=>frame+Math.round(origin*ctx.sampleRate)),loopFrames:t.loopFrames,loopSync:fx.tapeLoopSync!==false,
      seed:routing?.tapeSeeds?.get(fx.id),captureFrame:routing?.tapeCapture?.frame,
      resumeFrame:Math.round((origin+(routing?.tapeResume??0))*ctx.sampleRate),
    }}));
    // Native AudioParam events can round a fractional seek origin to the next
    // sample. Snap the schedule so stepped speed changes retain their phase.
    const sampleParameter=param=>{
      const snap=time=>Math.max(0,Math.round(time*ctx.sampleRate)/ctx.sampleRate);
      return {get value(){return param.value;},set value(v){param.value=v;},
        cancelScheduledValues:t=>param.cancelScheduledValues(snap(t)),
        setValueAtTime:(v,t)=>param.setValueAtTime(v,snap(t)),
        linearRampToValueAtTime:(v,t)=>param.linearRampToValueAtTime(v,snap(t)),
        setTargetAtTime:(v,t,constant)=>param.setTargetAtTime(v,snap(t),constant)};
    };
    const speed=sampleParameter(node.parameters.get('speed')),wet=sampleParameter(node.parameters.get('wet'));
    const preset=()=>{
      const start=origin+t.start,end=origin+t.end,at=Math.max(ctx.currentTime,start),target=(fx.tapeEndSpeed??0)/100;
      speed.cancelScheduledValues(at);
      speed.setValueAtTime(1+(target-1)*Math.max(0,Math.min(1,(at-start)/(end-start))),at);
      if(at<end)speed.linearRampToValueAtTime(target,end);
    };
    controlled(fx,speed,'tapeSpeed',timingRef,100,v=>v/100,preset);
    controlled(fx,wet,'wet',timingRef,1);
    node.onprocessorerror=()=>{routing?.tapeCapture?.fail(new Error('Tape Stop history processing failed.'));routing?.onerror?.();};
    if(routing?.tapeCapture){
      const capture=routing.tapeCapture;capture.waiting.add(fx.id);
      node.port.onmessage=({data})=>{if(data?.type==='history'){capture.states.set(fx.id,data.state);capture.waiting.delete(fx.id);}};
    }
    node.stop=()=>{node.port.postMessage({type:'stop'});node.port.close();};input.connect(node);return node;
  }
  function editor(form,fx,fields){
    const rows=[],inputs={};
    const select=(name,label,values,value)=>{const row=document.createElement('label');row.textContent=label;const input=document.createElement('select');input.name=name;input.setAttribute('aria-label',label);for(const [v,text] of Array.isArray(values)?values:Object.entries(values)){const o=document.createElement('option');o.value=v;o.textContent=text;input.append(o);}input.value=String(value);row.append(input);form.querySelector('footer').before(row);rows.push(row);inputs[name]=input;};
    select('tapeMode','Tape Stop mode',modes,fx.tapeMode||'classic');select('tapeCurve','Slowdown curve',{linear:'Even slowdown',quick:'Stop sooner',gentle:'Hold speed longer'},fx.tapeCurve||'linear');
    select('tapeSliceBeats','Slice / repeat length',[[.125,'1/32 note'],[.25,'1/16 note'],[.5,'1/8 note'],[1,'1/4 note'],[2,'1/2 note']],fx.tapeSliceBeats??.5);
    const row=document.createElement('label');row.textContent='Speed at end (%)';const speed=document.createElement('input');Object.assign(speed,{name:'tapeEndSpeed',type:'number',min:0,max:100,step:1,value:fx.tapeEndSpeed??0});row.append(speed);form.querySelector('footer').before(row);rows.push(row);inputs.tapeEndSpeed=speed;
    const syncRow=document.createElement('label');syncRow.textContent='Keep repeats on the beat';const sync=document.createElement('input');sync.type='checkbox';sync.checked=fx.tapeLoopSync!==false;syncRow.append(sync);form.querySelector('footer').before(syncRow);rows.push(syncRow);
    const help=document.createElement('p');help.className='daw-tape-stop-help';form.querySelector('footer').before(help);
    const update=()=>{const on=fields.type.value==='tapeStop',mode=inputs.tapeMode.value;for(const r of rows){r.hidden=!on;for(const input of r.querySelectorAll('input,select'))input.disabled=!on;}inputs.tapeSliceBeats.parentElement.hidden=!on||mode==='classic';syncRow.hidden=!on||mode!=='loop';help.hidden=!on;help.textContent=({classic:'Slow down like stopping vinyl.',modern:'Drop pitch in slices that restart on the beat.',loop:'Repeat the opening slice as its pitch drops.'})[mode]+' 0% ends in silence. Draw Tape speed automation for custom stops.';if(on){fields.tail.value=0;fields.tail.disabled=true;fields.tail.parentElement.hidden=true;}fields.length.max=on?8:256;};inputs.tapeMode.onchange=update;
    return {update,read(region){if(region.type!=='tapeStop')return;for(const key of ['tapeMode','tapeCurve'])region[key]=inputs[key].value;region.tapeEndSpeed=Number(speed.value);region.tapeSliceBeats=Number(inputs.tapeSliceBeats.value);region.tapeLoopSync=sync.checked;region.tailBeats=0;}};
  }
  window.AxiomTapeStop={validate,prepare,rewind,connect,editor,timing,regions};
})();
