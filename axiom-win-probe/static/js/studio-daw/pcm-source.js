(function(){
  'use strict';
  // This workaround targets the native WebKit source-rendering failure. Chromium
  // keeps its existing path until live/offline worklet boundary parity is proven.
  const agent=typeof navigator==='undefined'?'':navigator.userAgent;
  const enabled=/AppleWebKit/.test(agent)&&!/(Chrome|Chromium|Edg|OPR)/.test(agent);
  const modules=new WeakMap();
  function prepare(ctx){
    if(!modules.has(ctx)){
      const pending=ctx.audioWorklet.addModule('/static/js/studio-daw/pcm-source-worklet.js?v=2').catch(error=>{modules.delete(ctx);throw error;});
      modules.set(ctx,pending);
    }
    return modules.get(ctx);
  }
  function coordinates(ctx,buffer,{when,offset=0,duration,drainFrames=0},windowSeconds=12){
    if(buffer.sampleRate!==ctx.sampleRate||![1,2].includes(buffer.numberOfChannels)||![when,offset,duration].every(Number.isFinite)||when<0||offset<0||duration<=0||!Number.isSafeInteger(drainFrames)||drainFrames<0)throw new Error('PCM source requires prepared audio at the output sample rate.');
    // Stabilize float round-off before converting the native schedule to sample frames.
    const frame=value=>Math.round(value*ctx.sampleRate*1024)/1024;
    const startFrame=Math.ceil(frame(when)),stopFrame=Math.ceil(frame(when+duration));
    // Preserve the source/output phase together. Rounding the source offset
    // independently makes a newly split piece jump by up to one sample.
    const position=Math.max(0,frame(offset)+startFrame-frame(when));
    const sourceOffset=Math.floor(position),phase=position-sourceOffset;
    if(![startFrame,stopFrame,sourceOffset].every(Number.isSafeInteger)||sourceOffset<0||sourceOffset>=buffer.length||stopFrame<=startFrame)throw new Error('Invalid PCM source range.');
    if(Math.min(buffer.length-sourceOffset,stopFrame-startFrame)>windowSeconds*ctx.sampleRate)throw new Error('PCM source range exceeds its preparation window.');
    return {startFrame,stopFrame,offset:sourceOffset,drainFrames,phase};
  }
  function canPlay(ctx,buffer,timing){try{coordinates(ctx,buffer,timing);return true;}catch{return false;}}
  function create(ctx,buffer,timing,windowSeconds=12){
    const schedule=coordinates(ctx,buffer,timing,windowSeconds);
    const first=Math.max(0,schedule.offset-(schedule.phase>0?1:0));
    const frames=Math.min(buffer.length-first,schedule.stopFrame-schedule.startFrame+(schedule.phase>0?1:0)+schedule.offset-first);
    // Copy only the scheduled range; transferring a view would clone its entire backing song.
    const channels=Array.from({length:buffer.numberOfChannels},(_,c)=>buffer.getChannelData(c).slice(first,first+frames));
    const node=new AudioWorkletNode(ctx,'axiom-pcm-source',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[channels.length],processorOptions:{channels,...schedule,offset:schedule.offset-first}});
    node.onended=null;
    node.port.onmessage=({data})=>{if(data?.type==='ended'){node.onended?.();node.port.close();}};
    node.stop=(when=ctx.currentTime)=>{
      if(!Number.isFinite(when)||when<0||!Number.isSafeInteger(Math.round(when*ctx.sampleRate)))throw new Error('Invalid PCM stop time.');
      node.port.postMessage({type:'stop',frame:Math.ceil(Math.round(when*ctx.sampleRate*1024)/1024)});
    };
    return node;
  }
  // Rendered notes have a bounded bank, 60-second holds and up to 5-second releases.
  // Keep one phase-continuous voice through its release, including across refills.
  const canPlayVoice=(ctx,buffer,timing)=>{try{coordinates(ctx,buffer,timing,66);return true;}catch{return false;}};
  const createVoice=(ctx,buffer,timing)=>create(ctx,buffer,timing,66);
  window.AxiomPcmSource={enabled,prepare,canPlay,create:(ctx,buffer,timing)=>create(ctx,buffer,timing),canPlayVoice,createVoice};
})();
