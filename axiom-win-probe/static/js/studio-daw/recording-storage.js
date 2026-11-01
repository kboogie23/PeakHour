(function(){
  'use strict';
  const maxFrames=48000*7200;
  async function create(){
    if(!navigator.storage?.getDirectory||!window.Worker)throw new Error('Recording needs temporary audio storage. Update AXIOM and retry.');
    const estimate=await navigator.storage.estimate?.()||{};
    const available=Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)?estimate.quota-estimate.usage-128*1024**2:Infinity;
    const limit=Math.min(maxFrames,Math.floor(available/8));
    if(limit<48000*60)throw new Error('Not enough temporary storage for recording. Free some disk space first.');
    const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('axiom-mix-exports-v1',{create:true});
    const name='export-'+crypto.randomUUID()+'.wav',worker=new Worker('/static/js/studio-daw/export-writer.js?v=5');
    let pending=null,owned=false,closed=false,failure=null;
    const remove=()=>folder.removeEntry(name).catch(()=>{});
    const fail=error=>{if(closed||failure)return;failure=error;pending?.reject(error);worker.terminate();if(owned)remove();};
    const send=(data,type,transfer=[])=>new Promise((resolve,reject)=>{
      if(failure){reject(failure);return;}
      if(closed||pending){reject(new Error('Recording storage is unavailable.'));return;}
      const timeout=setTimeout(()=>fail(new Error('Recording storage stopped responding.')),10000);
      pending={type,resolve:value=>{clearTimeout(timeout);pending=null;resolve(value);},reject:error=>{clearTimeout(timeout);pending=null;reject(error);}};
      try{worker.postMessage(data,transfer);}catch(error){fail(error);}
    });
    worker.onerror=()=>fail(new Error('Recording storage failed. The incomplete take was discarded.'));
    worker.onmessage=({data})=>{
      if(closed||failure)return;
      if(data?.type==='created'){owned=true;return;}
      if(data?.type==='error'){fail(new Error(data.message));return;}
      if(!pending||data?.type!==pending.type){fail(new Error('Unexpected recording storage response.'));return;}
      pending.resolve(data);
    };
    const abort=()=>{if(closed)return;fail(new Error('Recording cancelled.'));closed=true;};
    try{await send({type:'open',name,frames:limit,recording:true},'ready');}
    catch(error){abort();throw error;}
    return {maxFrames:limit,abort,
      async append(data){
        const samples=new Float32Array(data.left.length*2);
        for(let i=0;i<data.left.length;i++){samples[i*2]=data.left[i];samples[i*2+1]=data.right[i];}
        const receipt=await send({type:'samples',offset:data.offset,samples},'ack',[samples.buffer]);
        if(receipt.frames!==data.offset+data.left.length)throw new Error('Recording storage lost an audio block.');
      },
      async finish(frames){
        try{
          const receipt=await send({type:'complete',frames},'complete');
          if(receipt.frames!==frames)throw new Error('Recording length did not verify.');
          const file=await (await folder.getFileHandle(name)).getFile();
          if(file.size!==58+frames*8)throw new Error('The recording file is incomplete.');
          if(closed)throw new Error('Recording cancelled.');
          closed=true;worker.terminate();return {file,release:remove};
        }catch(error){abort();throw error;}
      }
    };
  }
  window.AxiomDawRecordingStorage={create,maxFrames};
})();
