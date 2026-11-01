(function(){
  'use strict';
  if(!window.AXIOM_BROWSER_AUDIO_ENABLED)return;
  const rate=48000;
  function create(){
    let closed=false,workerCancel=null,queue=Promise.resolve(),bytes=0,pending=0;
    const urls=new Map(),requests=new Set();
    const check=()=>{if(closed)throw new Error('Pitch-preserving preparation cancelled.');};
    async function source(payload){
      let path=payload.path,start=payload.start;
      if(payload.stem){
        const job=await window.AxiomBrowserAudio.readStemJob(payload.stemJob);
        if(!job||job.source!==path||!Object.hasOwn(job.audio,payload.stem))throw new Error('Stored stems do not belong to this source.');
        path=job.audio[payload.stem];start-=job.start;
        if(start<-.00005||start+payload.duration>job.duration+.1)throw new Error('The selected clip exceeds its separated stem range.');
        start=Math.max(0,start);
      }
      check();
      const stored=await window.AxiomBrowserAudio.read(path);check();
      if(stored)return {buffer:await stored.blob.arrayBuffer(),start};
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);requests.add(controller);
      try{
        let response=await fetch('/api/library/stream?path='+encodeURIComponent(path),{signal:controller.signal});
        if(!response.ok)throw new Error('Reconnect the source audio before preserving pitch.');
        if(response.headers.get('Content-Type')?.includes('application/json')){
          const data=await response.json();
          if(data.success!==true||data.needs_browser_folder||typeof data.resolved_path!=='string'||!data.resolved_path)throw new Error('Reconnect the browser music folder before preserving pitch.');
          const address=new URL(data.resolved_path,location.href);
          if(address.origin!==location.origin||!['blob:','http:','https:'].includes(address.protocol)||address.pathname==='/api/library/stream')throw new Error('The browser source address is unavailable.');
          response=await fetch(address.href,{signal:controller.signal});
        }
        if(!response.ok)throw new Error('The source audio could not be read.');
        const size=Number(response.headers.get('Content-Length'));if(size>256*1024*1024)throw new Error('The encoded source exceeds 256 MiB.');
        const buffer=await response.arrayBuffer();check();if(buffer.byteLength>256*1024*1024)throw new Error('The encoded source exceeds 256 MiB.');
        return {buffer,start};
      }finally{clearTimeout(timer);requests.delete(controller);}
    }
    async function prepareNow(payload){
      check();
      if(!payload||typeof payload.path!=='string'||!Number.isFinite(payload.start)||payload.start<0||!Number.isFinite(payload.duration)||payload.duration<.02||payload.duration>600||!Number.isFinite(payload.pitch)||Math.abs(payload.pitch)>24||!Array.isArray(payload.anchors)||payload.anchors.length<2||payload.anchors.length>32768)throw new Error('Invalid pitch-preserving source range.');
      const points=payload.anchors.map(p=>[Math.round(p.source*rate),Math.round(p.target*rate)]);
      points.forEach((p,i)=>{if(p.some(n=>!Number.isSafeInteger(n)||n<0)||i&&(p[0]<=points[i-1][0]||p[1]<=points[i-1][1]||(p[1]-points[i-1][1])/(p[0]-points[i-1][0])<.125||(p[1]-points[i-1][1])/(p[0]-points[i-1][0])>8))throw new Error('Invalid pitch-preserving timing map.');});
      if(points[0][0]!==0||points[0][1]!==0||points.at(-1)[0]!==Math.round(payload.duration*rate)||(points.at(-1)[0]+points.at(-1)[1])*8>256*1024*1024)throw new Error('Pitch-preserving timing map exceeds its source or sample budget.');
      const input=await source(payload);check();
      const context=new OfflineAudioContext(2,1,rate),decoded=await context.decodeAudioData(input.buffer);check();
      if(decoded.numberOfChannels>2||decoded.duration>600)throw new Error('Browser stretching supports mono or stereo sources up to ten minutes.');
      const start=Math.round(input.start*rate);let frames=Math.round(payload.duration*rate);
      if(start+frames>decoded.length){
        const available=decoded.length-start,previous=points.at(-2),last=points.at(-1);
        if(frames-available>rate*.1||available<=previous[0])throw new Error('The clip extends beyond its source audio. Correct its end before preparing.');
        points[points.length-1]=[available,previous[1]+Math.round((available-previous[0])*(last[1]-previous[1])/(last[0]-previous[0]))];frames=available;
      }
      if(start<0||frames<960||start+frames>decoded.length)throw new Error('Selected source audio is unavailable.');
      const channels=[0,1].map(c=>decoded.getChannelData(Math.min(c,decoded.numberOfChannels-1)).slice(start,start+frames));
      const result=await new Promise((resolve,reject)=>{
        const worker=new Worker('/static/js/studio-daw/stretch-worker.mjs',{type:'module'});
        const finish=(error,value)=>{clearTimeout(timer);worker.terminate();workerCancel=null;error?reject(error):resolve(value);};
        const timer=setTimeout(()=>finish(new Error('Browser stretching exceeded its 15-minute limit.')),15*60*1000);
        workerCancel=()=>finish(new Error('Pitch-preserving preparation cancelled.'));
        worker.onerror=e=>finish(new Error(e.message||'Stretch worker failed.'));
        worker.onmessage=e=>{if(e.data.error)finish(new Error(e.data.error));else if(e.data.buffer)finish(null,e.data);};
        worker.postMessage({channels,plan:{pitch:payload.pitch,frames:points}},channels.map(c=>c.buffer));
      });check();
      if(!(result.buffer instanceof ArrayBuffer)||result.sampleRate!==rate||result.frames!==points.at(-1)[1]||result.buffer.byteLength!==58+result.frames*8)throw new Error('Prepared audio did not match the requested duration.');
      if(bytes+result.buffer.byteLength>512*1024*1024)throw new Error('Browser prepared audio exceeds 512 MiB. Use shorter clips or fewer simultaneous stems.');
      const url=URL.createObjectURL(new Blob([result.buffer],{type:'audio/wav'}));urls.set(url,result.buffer.byteLength);bytes+=result.buffer.byteLength;return url;
    }
    return {
      prepare(payload){if(pending>=16)return Promise.reject(new Error('Browser preparation is busy.'));pending++;const result=queue.then(()=>prepareNow(payload)).finally(()=>pending--);queue=result.catch(()=>{});return result;},
      forget(url){if(urls.has(url)){bytes-=urls.get(url);urls.delete(url);URL.revokeObjectURL(url);}},
      release(){closed=true;workerCancel?.();for(const request of requests)request.abort();for(const url of urls.keys())URL.revokeObjectURL(url);urls.clear();bytes=0;},
      get bytes(){return bytes;}
    };
  }
  window.AxiomBrowserStretch={create};
})();
