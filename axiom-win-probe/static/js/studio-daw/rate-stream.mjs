export function create(ctx){
  const worker=new Worker('/static/js/studio-daw/rate-worker.mjs?v=2',{type:'module'}),pending=new Map(),last=new Map();
  let sequence=0,closed=false;
  function destroy(error=new Error('Streaming rate preparation cancelled.')){
    if(closed)return;closed=true;worker.terminate();last.clear();
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();
  }
  worker.onerror=()=>destroy(new Error('Streaming audio worker failed. Press Play to retry.'));
  worker.onmessage=({data})=>{
    const item=pending.get(data.id);if(!item)return;
    pending.delete(data.id);clearTimeout(item.timer);
    if(data.error){item.reject(new Error(data.error));return;}
    try{
      if(!(data.samples instanceof Float32Array)||data.frames!==item.frames||![1,2].includes(data.channels)||data.samples.length!==data.frames*data.channels||!Number.isFinite(data.memoryBytes))throw new Error('Invalid streaming audio receipt.');
      const audio=ctx.createBuffer(data.channels,data.frames,48000);
      for(let c=0;c<data.channels;c++){
        const samples=audio.getChannelData(c);
        for(let i=0;i<data.frames;i++){const v=data.samples[i*data.channels+c];if(!Number.isFinite(v))throw new Error('Invalid streaming audio sample.');samples[i]=v;}
      }
      item.resolve({buffer:audio,memoryBytes:data.memoryBytes});
      if(item.final)last.delete(item.key);
    }catch(error){item.reject(error);}
  };
  return {destroy,read(url,entry){
    if(closed)return Promise.reject(new Error('Streaming audio worker is closed.'));
    const key=entry.rateVoiceId?JSON.stringify([url,entry.rateStream,entry.rateVoiceId]):JSON.stringify([url,entry.rateStream]);
    const prior=last.get(key);if(prior?.offset===entry.rateOffset)return prior.promise;
    const promise=new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>destroy(new Error('Streaming audio preparation timed out.')),35000);
      pending.set(id,{resolve,reject,timer,frames:entry.rateFrames,key,final:entry.rateFinal});
      worker.postMessage({type:'read',id,key,url,entry:entry.rateStream,offset:entry.rateOffset,frames:entry.rateFrames,final:entry.rateFinal});
    });
    last.set(key,{offset:entry.rateOffset,promise});return promise;
  },release(url){
    for(const key of last.keys())if(JSON.parse(key)[0]===url){last.delete(key);worker.postMessage({type:'release',key});}
  }};
}
