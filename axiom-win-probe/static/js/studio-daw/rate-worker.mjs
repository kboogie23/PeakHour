import './pcm.js';
import {createRateRenderer} from './rate-renderer.mjs?v=2';

const streams=new Map();let chain=Promise.resolve();
self.onmessage=({data})=>{
  chain=chain.then(async()=>{
    try{
      if(data.type==='release'){streams.get(data.key)?.close();streams.delete(data.key);return;}
      if(data.type!=='read'||typeof data.key!=='string'||data.key.length>2048)throw new Error('Invalid streaming request.');
      let renderer=streams.get(data.key);
      if(!renderer){
        if(data.offset!==0||streams.size>=64)throw new Error('Streaming voice capacity exceeded or position is unavailable.');
        const info=await AxiomPcm.describe(data.url);
        renderer=await createRateRenderer(info,data.entry,async(start,frames)=>{
          const query=new URLSearchParams({pcm:'block',identity:info.identity,start,frames});
          return AxiomPcm.readInterleaved(info,{key:data.url+'?'+query,start,frames});
        });
        streams.set(data.key,renderer);
      }
      const result=await renderer.pull(data.offset,data.frames);
      result.memoryBytes=renderer.heapBytes+[...streams.values()].reduce((sum,stream)=>sum+stream.retainedBytes,0);
      self.postMessage({id:data.id,...result},[result.samples.buffer]);
      if(data.final){renderer.close();streams.delete(data.key);}
    }catch(error){streams.get(data.key)?.close();streams.delete(data.key);self.postMessage({id:data.id,error:error.message});}
  });
};
