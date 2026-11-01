(function(){
  'use strict';
  const maxFrames=Math.floor((0xffffffff-50)/8);
  const offlineBlockFrames=65536;
  function canEncodeOffline(){return Boolean(navigator.storage?.getDirectory&&window.Worker);}
  async function encodeOffline(result,cancelled=()=>false){
    const {audio,trimFrames,frames}=result;
    if(!canEncodeOffline())throw new Error('Temporary WAV storage is unavailable.');
    if(audio.numberOfChannels!==2||audio.sampleRate!==48000||!Number.isSafeInteger(frames)||frames<1||frames>maxFrames||!Number.isSafeInteger(trimFrames)||trimFrames<0||trimFrames+frames>audio.length)throw new Error('Invalid rendered audio range.');
    const estimate=await navigator.storage.estimate?.()||{};
    if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)&&estimate.quota-estimate.usage<frames*8+128*1024**2)throw new Error('Not enough temporary storage for this export.');
    if(cancelled())throw new Error('Export cancelled');
    const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('axiom-mix-exports-v1',{create:true});
    const name='export-'+crypto.randomUUID()+'.wav',worker=new Worker('/static/js/studio-daw/export-writer.js?v=4');
    let pending=null,failure=null,owned=false;
    const fail=error=>{failure=error;pending?.reject(error);};
    worker.onerror=()=>fail(new Error('Export storage worker failed.'));
    worker.onmessage=({data})=>{
      if(data?.type==='created'){owned=true;return;}
      if(data?.type==='error'){fail(new Error(data.message));return;}
      if(!pending||data?.type!==pending.type){fail(new Error('Unexpected WAV writer response.'));return;}
      pending.resolve(data);
    };
    const send=(data,type,transfer=[])=>new Promise((resolve,reject)=>{
      if(failure){reject(failure);return;}
      const finish=(error,value)=>{clearTimeout(timeout);clearInterval(cancelWatch);pending=null;error?reject(error):resolve(value);};
      const timeout=setTimeout(()=>finish(new Error('Temporary WAV write timed out.')),30000);
      const cancelWatch=setInterval(()=>{if(cancelled())finish(new Error('Export cancelled'));},50);
      pending={type,resolve:value=>finish(null,value),reject:error=>finish(error)};
      try{worker.postMessage(data,transfer);}catch(error){finish(error);}
    });
    const remove=()=>folder.removeEntry(name).catch(()=>{});
    try{
      await send({type:'open',name,frames},'ready');
      const left=audio.getChannelData(0),right=audio.getChannelData(1);
      // One acknowledged 512 KiB block bounds memory and reduces writer round trips.
      for(let offset=0;offset<frames;offset+=offlineBlockFrames){
        if(cancelled())throw new Error('Export cancelled');
        const count=Math.min(offlineBlockFrames,frames-offset),samples=new Float32Array(count*2);
        for(let i=0;i<count;i++){samples[i*2]=left[trimFrames+offset+i];samples[i*2+1]=right[trimFrames+offset+i];}
        const receipt=await send({type:'samples',offset,samples},'ack',[samples.buffer]);
        if(receipt.frames!==offset+count)throw new Error('Temporary WAV write length did not verify.');
      }
      if(cancelled())throw new Error('Export cancelled');
      const receipt=await send({type:'complete',frames},'complete');
      if(receipt.frames!==frames||!(receipt.peaks instanceof Float32Array)||receipt.peaks.length!==Math.min(65536,frames)||!Number.isFinite(receipt.peak))throw new Error('Invalid WAV completion receipt.');
      const file=await (await folder.getFileHandle(name)).getFile();
      if(cancelled())throw new Error('Export cancelled');
      if(file.size!==58+frames*8)throw new Error('The exported WAV size does not match the mix.');
      return {file,peak:receipt.peak,peaks:receipt.peaks,bands:receipt.bands,duration:frames/48000,release:remove};
    }catch(error){
      worker.terminate();
      if(owned)await remove();
      throw error;
    }finally{worker.terminate();}
  }
  function clear(){
    return new Promise((resolve,reject)=>{
      const worker=new Worker('/static/js/studio-daw/export-writer.js?v=4');
      const finish=(error,data)=>{clearTimeout(timeout);worker.terminate();error?reject(error):resolve(data);};
      const timeout=setTimeout(()=>finish(new Error('Temporary export cleanup timed out.')),10000);
      worker.onerror=()=>finish(new Error('Temporary export cleanup failed.'));
      worker.onmessage=({data})=>data?.type==='cleared'?finish(null,data):finish(new Error(data?.message||'Temporary export cleanup failed.'));
      worker.postMessage({type:'clear'});
    });
  }
  async function create(ctx,duration,onProgress=()=>{}){
    const frames=Math.round(duration*48000);
    if(ctx.sampleRate!==48000||!Number.isSafeInteger(frames)||frames<1||frames>maxFrames)throw new Error('Streaming WAV export requires 48 kHz and a mix smaller than 4 GiB.');
    if(!navigator.storage?.getDirectory||!window.Worker||!window.AudioWorkletNode||!ctx.audioWorklet)throw new Error('Streaming export is unavailable in this browser.');
    const estimate=await navigator.storage.estimate?.()||{};
    if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)&&estimate.quota-estimate.usage<frames*8+128*1024**2)throw new Error('Not enough browser storage for this export.');
    const name='export-'+crypto.randomUUID()+'.wav',worker=new Worker('/static/js/studio-daw/export-writer.js?v=4');
    let node,readyResolve,readyReject,resolve,reject,terminal=false,started=false,owned=false,watchdog,lastProgress=Date.now();
    const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;}),result=new Promise((a,b)=>{resolve=a;reject=b;});result.catch(()=>{});
    const remove=async()=>{const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('axiom-mix-exports-v1');await folder.removeEntry(name);};
    const dispose=()=>{clearInterval(watchdog);node?.disconnect();if(node){node.port.onmessage=null;node.port.close();}worker.terminate();};
    const fail=error=>{
      if(terminal)return;terminal=true;readyReject(error);reject(error);
      // Termination releases the worker's exclusive file handle before cleanup.
      dispose();if(owned)setTimeout(()=>remove().catch(()=>{}),100);
    };
    worker.onerror=()=>fail(new Error('Export storage worker failed. The incomplete file was discarded.'));
    worker.onmessage=async({data})=>{
      if(terminal)return;
      lastProgress=Date.now();
      if(data?.type==='created'){owned=true;return;}
      if(data?.type==='ready'){readyResolve();return;}
      if(data?.type==='error'){fail(new Error(data.message));return;}
      if(data?.type==='ack'){node?.port.postMessage({type:'ack'});try{onProgress(data.frames/48000,duration);}catch(error){fail(error);}return;}
      if(data?.type==='complete'){
        try{
          if(data.frames!==frames||!(data.peaks instanceof Float32Array)||!Number.isFinite(data.peak))throw new Error('Invalid export completion receipt.');
          const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('axiom-mix-exports-v1'),file=await (await folder.getFileHandle(name)).getFile();
          if(terminal)return;
          if(file.size!==58+frames*8)throw new Error('The exported WAV size does not match the mix.');
          terminal=true;dispose();resolve({file,peak:data.peak,peaks:data.peaks,bands:data.bands,duration:frames/48000,release:()=>remove().catch(()=>{})});
        }catch(error){fail(error);}
      }
    };
    watchdog=setInterval(()=>{if(Date.now()-lastProgress>15000)fail(new Error('Export stopped receiving audio or storage acknowledgements.'));},1000);
    worker.postMessage({type:'open',name,frames});
    try{
      await ready;await Promise.race([ctx.audioWorklet.addModule('/static/js/studio-daw/export-worklet.js?v=1'),result]);
      if(terminal)throw new Error('Export cancelled');
      node=new AudioWorkletNode(ctx,'axiom-export-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
      node.onprocessorerror=()=>fail(new Error('Export audio capture failed.'));
      node.port.onmessage=({data})=>{
        if(terminal)return;
        if(data?.type==='error'){fail(new Error(data.message));return;}
        if(data?.type==='samples')worker.postMessage(data,[data.samples.buffer]);
        else if(data?.type==='complete')worker.postMessage(data);
      };
      node.connect(ctx.destination);
      return {input:node,result,arm(start){if(started||terminal)throw new Error('Export is unavailable.');started=true;lastProgress=Date.now();const begin=Math.round(start*48000);node.port.postMessage({type:'arm',start:begin,end:begin+frames});},stop(reason){if(reason!=='end'&&reason!=='export-complete')fail(new Error('Export cancelled: '+reason));},abort(){fail(new Error('Export cancelled'));}};
    }catch(error){fail(error);throw error;}
  }
  window.AxiomStreamExport={create,clear,maxFrames,canEncodeOffline,encodeOffline};
})();
