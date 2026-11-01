(function(){
  'use strict';
  const modules=new WeakMap();let pending=null;
  function result(receipt,rate){
    const {frames,inputPower,outputPower,peak}=receipt||{};
    if(!Number.isFinite(rate)||rate<=0||frames!==Math.round(rate*2)||![inputPower,outputPower,peak].every(v=>Number.isFinite(v)&&v>=0))throw new Error('Invalid level-match measurement.');
    const inputRms=Math.sqrt(inputPower/(frames*2)),outputRms=Math.sqrt(outputPower/(frames*2));
    if(inputRms<.0001||outputRms<.0001)throw new Error('Not enough signal to match. Play a louder passage.');
    const db=20*Math.log10(inputRms/outputRms);
    if(Math.abs(db)>12)throw new Error('The required match exceeds 12 dB. Adjust the effect first.');
    if(peak*Math.pow(10,db/20)>.98)throw new Error('Not enough peak headroom to match this passage.');
    return {db,inputRms,outputRms,peak,frames,duration:frames/rate};
  }
  function cancel(){pending?.(new Error('Level matching cancelled.'));}
  async function measure(source,current){
    if(!source||!source.ctx.audioWorklet||!window.AudioWorkletNode)throw new Error('Play the saved enhancement region before matching.');
    const {ctx,dry,wet}=source;
    if(ctx.state!=='running'||source.end-ctx.currentTime<2.2)throw new Error('Play at least two seconds before the region ends.');
    cancel();
    return new Promise((resolve,reject)=>{
      let node,finished=false,watch,timer;
      const finish=(error,value)=>{
        if(finished)return;finished=true;clearInterval(watch);clearTimeout(timer);if(pending===finish)pending=null;
        if(node){try{dry.disconnect(node);}catch{}try{wet.disconnect(node);}catch{}node.port.onmessage=null;node.port.close();node.disconnect();}
        error?reject(error):resolve(value);
      };
      pending=finish;
      watch=setInterval(()=>{if(ctx.state!=='running'||current()!==source)finish(new Error('Playback changed during level matching.'));},50);
      timer=setTimeout(()=>finish(new Error('Level matching timed out.')),10000);
      (async()=>{
        try{
          if(!modules.has(ctx))modules.set(ctx,ctx.audioWorklet.addModule('/static/js/studio-daw/enhance-match-worklet.js?v=1').catch(error=>{modules.delete(ctx);throw error;}));
          await modules.get(ctx);if(finished)return;
          if(current()!==source||source.end-ctx.currentTime<2.1)throw new Error('Playback changed during level matching.');
          node=new AudioWorkletNode(ctx,'axiom-enhance-match',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:'explicit'});
          node.onprocessorerror=()=>finish(new Error('Level measurement failed.'));
          node.port.onmessage=({data})=>{
            try{if(current()!==source)throw new Error('Playback changed during level matching.');if(data.error)throw new Error(data.error);finish(null,result(data,ctx.sampleRate));}catch(error){finish(error);}
          };
          dry.connect(node,0,0);wet.connect(node,0,1);node.connect(ctx.destination);
        }catch(error){finish(error);}
      })();
    });
  }
  window.AxiomEnhanceMatch={measure,cancel,result};
})();
