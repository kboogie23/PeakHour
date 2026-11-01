(function(){
  'use strict';
  const verified=new WeakMap(),playbackCache=new Map(),cacheLimit=32*1024*1024;
  let cacheBytes=0;
  function clearPlaybackCache(){playbackCache.clear();cacheBytes=0;}
  function supports(url){return /^\/api\/studio-daw\/(?:stretch\/[a-f0-9]{64}\/audio|stems\/[a-f0-9]{64}\/(?:vocals|other|bass|drums)|plugins\/render\/[a-f0-9]{64}\/audio)$/.test(url);}
  async function describe(url,signal){
    if(!supports(url))throw new Error('PCM playback requires a prepared audio file.');
    const response=await fetch(url+'?pcm=info',{signal});
    if(!response.headers.get('Content-Type')?.includes('application/json')){await response.body?.cancel();throw new Error('PCM playback is unavailable. Restart the local AXIOM engine.');}
    const info=await response.json();
    if(!response.ok)throw new Error(info.error||'Prepared audio information is unavailable.');
    if(info.version!==1||!/^[a-f0-9]{64}$/.test(info.identity)||!Number.isSafeInteger(info.frames)||info.frames<=0||!Number.isInteger(info.sampleRate)||info.sampleRate<8000||info.sampleRate>96000||![1,2].includes(info.channels)||info.maxBlockFrames!==info.sampleRate*8)throw new Error('PCM playback is unavailable. Restart the local AXIOM engine.');
    verified.set(info,{url,signature:JSON.stringify(info)});
    for(const [key,item] of playbackCache)if(item.url===url&&item.identity!==info.identity){playbackCache.delete(key);cacheBytes-=item.bytes;}
    return info;
  }
  function sourceEnd(entry){
    const k=Math.log(entry.rateEnd/entry.rate)/entry.duration;
    return entry.offset+(Math.abs(k)<1e-12?entry.rate*entry.duration:entry.rate*Math.expm1(k*entry.duration)/k);
  }
  function range(url,info,entry,outputRate=info.sampleRate){
    const end=sourceEnd(entry);let start=Math.max(0,Math.floor(entry.offset*info.sampleRate)-128);
    if(outputRate!==info.sampleRate){
      // Align the converter's origin to the output sample grid, so adjacent
      // raw-stem blocks retain the same phase after native rate conversion.
      let a=info.sampleRate,b=outputRate;while(b){const next=a%b;a=b;b=next;}
      const quantum=info.sampleRate/a;start=Math.floor(start/quantum)*quantum;
    }
    const finish=Math.min(info.frames,Math.ceil(end*info.sampleRate)+128);
    if(!Number.isFinite(end)||entry.offset<0||end*info.sampleRate>info.frames+Math.round(.25*info.sampleRate)||finish<=start||finish-start>info.maxBlockFrames)throw new Error('Clip PCM range is unavailable.');
    const query=new URLSearchParams({pcm:'block',identity:info.identity,start,frames:finish-start});
    return {key:url+'?'+query,start,frames:finish-start,startSeconds:start/info.sampleRate};
  }
  function floatWave(samples,info,frames){
    // A bounded in-memory WAV uses the same float format as existing stems.
    // No file is created and source music remains read-only.
    const raw=new ArrayBuffer(56+samples.length*4),view=new DataView(raw);
    const label=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
    label(0,'RIFF');view.setUint32(4,raw.byteLength-8,true);label(8,'WAVE');label(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,3,true);view.setUint16(22,info.channels,true);view.setUint32(24,info.sampleRate,true);
    view.setUint32(28,info.sampleRate*info.channels*4,true);view.setUint16(32,info.channels*4,true);view.setUint16(34,32,true);
    label(36,'fact');view.setUint32(40,4,true);view.setUint32(44,frames,true);label(48,'data');view.setUint32(52,samples.length*4,true);
    for(let i=0;i<samples.length;i++)view.setFloat32(56+i*4,samples[i],true);
    return raw;
  }
  async function readInterleaved(info,range,signal){
    const response=await fetch(range.key,{signal});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Prepared audio block is unavailable.');}
    if(response.headers.get('X-AXIOM-PCM-Identity')!==info.identity||Number(response.headers.get('X-AXIOM-PCM-Start'))!==range.start||Number(response.headers.get('X-AXIOM-PCM-Frames'))!==range.frames||!response.headers.get('Content-Type')?.includes('application/x-axiom-f32le')||(response.headers.get('Content-Length')&&Number(response.headers.get('Content-Length'))!==range.frames*info.channels*4)){await response.body?.cancel();throw new Error('Prepared audio block identity is invalid.');}
    const raw=await response.arrayBuffer();
    if(signal?.aborted)throw new Error('PCM load cancelled.');
    if(raw.byteLength!==range.frames*info.channels*4)throw new Error('Prepared audio block is incomplete.');
    const samples=new Float32Array(range.frames*info.channels),view=new DataView(raw);
    for(let i=0;i<samples.length;i++){const value=view.getFloat32(i*4,true);if(!Number.isFinite(value))throw new Error('Prepared audio block contains invalid samples.');samples[i]=value;}
    return samples;
  }
  async function read(ctx,info,range,signal,options=null){
    if(signal?.aborted)throw new Error('PCM load cancelled.');
    // Only metadata checked against the local file can authorize reuse.
    // Transport obtains it again on every playback start, including seeks.
    const receipt=verified.get(info);
    const reusable=options?.reuse&&receipt&&receipt.signature===JSON.stringify(info)&&range.key.startsWith(receipt.url+'?');
    const outputRate=Number.isInteger(ctx.sampleRate)?ctx.sampleRate:info.sampleRate;
    const key=JSON.stringify([range.key,info.identity,range.start,range.frames,info.channels,info.sampleRate,outputRate]);
    const cached=reusable&&playbackCache.get(key);
    if(cached){playbackCache.delete(key);playbackCache.set(key,cached);return cached.audio;}
    const samples=await readInterleaved(info,range,signal);let audio;
    if(outputRate!==info.sampleRate){
      audio=await ctx.decodeAudioData(floatWave(samples,info,range.frames));
      if(signal?.aborted)throw new Error('PCM load cancelled.');
      if(audio.sampleRate!==outputRate||audio.numberOfChannels!==info.channels||Math.abs(audio.length-range.frames*outputRate/info.sampleRate)>2)throw new Error('Stem sample-rate conversion did not verify.');
    }else{
      audio=ctx.createBuffer(info.channels,range.frames,info.sampleRate);
      for(let c=0;c<info.channels;c++){
        const values=audio.getChannelData(c);
        for(let i=0;i<range.frames;i++)values[i]=samples[i*info.channels+c];
      }
    }
    if(reusable){
      const bytes=(Number.isSafeInteger(audio.length)?audio.length:range.frames)*info.channels*4;
      if(bytes<=cacheLimit){
        const previous=playbackCache.get(key);if(previous){playbackCache.delete(key);cacheBytes-=previous.bytes;}
        while(cacheBytes+bytes>cacheLimit){const [old,item]=playbackCache.entries().next().value;playbackCache.delete(old);cacheBytes-=item.bytes;}
        playbackCache.set(key,{audio,bytes,url:receipt.url,identity:info.identity});cacheBytes+=bytes;
      }
    }
    return audio;
  }
  (typeof window==='object'?window:globalThis).AxiomPcm={supports,describe,sourceEnd,range,read,readInterleaved,clearPlaybackCache,get playbackCacheBytes(){return cacheBytes;}};
})();
