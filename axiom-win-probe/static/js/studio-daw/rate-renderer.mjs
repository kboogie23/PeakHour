import {createResampler} from './resample-engine.mjs';

export async function createRateRenderer(info,entry,read){
  if(info.sampleRate!==48000||![1,2].includes(info.channels)||!Number.isSafeInteger(info.frames)||info.frames<1||
    ![entry.offset,entry.duration,entry.rate,entry.rateEnd].every(Number.isFinite)||entry.offset<0||entry.duration<=0||
    Math.min(entry.rate,entry.rateEnd)<.125||Math.max(entry.rate,entry.rateEnd)>8)throw new Error('Invalid streaming rate plan.');
  const sourceStart=Math.round(entry.offset*48000),total=Math.round(entry.duration*48000);
  if(sourceStart>=info.frames||!Number.isSafeInteger(total)||total<1||total>4800*48000)throw new Error('Streaming source range is unavailable.');
  const engine=await createResampler(info.channels),empty=new Float32Array(0);
  let loaded=sourceStart,input=empty,consumed=0,rendered=0,closed=false;
  const slope=Math.log(entry.rateEnd/entry.rate)/entry.duration;
  const quantum=entry.rate===entry.rateEnd?4096:128;
  return {
    get retainedBytes(){return input.byteLength;},
    get heapBytes(){return engine.module.HEAPU8.byteLength;},
    async pull(offset,frames){
      if(closed||offset!==rendered||!Number.isSafeInteger(frames)||frames<1||frames>192000||offset+frames>total)throw new Error('Streaming output is out of sequence.');
      const output=new Float32Array(frames*info.channels);let written=0;
      while(written<frames){
        if(consumed===input.length&&loaded<info.frames){
          const count=Math.min(32768,info.frames-loaded);input=await read(loaded,count);
          if(closed)throw new Error('Streaming rate preparation cancelled.');
          if(!(input instanceof Float32Array)||input.length!==count*info.channels)throw new Error('Streaming source block is incomplete.');
          loaded+=count;consumed=0;
        }
        // Ramps retain their fine ratio updates; constant rates can batch the same sinc processing.
        const count=Math.min(quantum,frames-written),time=(rendered+count)/48000;
        const ratio=1/(entry.rate*Math.exp(slope*time));
        const last=Math.min(input.length,consumed+4096*info.channels);
        const result=engine.process(input.subarray(consumed,last),count,ratio,loaded===info.frames&&last===input.length);
        consumed+=result.used*info.channels;
        if(!result.used&&!result.frames){
          if(loaded===info.frames&&last===input.length){
            const missing=total-rendered;
            if(missing<=Math.round(.25*48000)){
              const remaining=frames-written;
              rendered+=remaining;
              written=frames;
              break;
            }
          }
          throw new Error(`Streaming source ended ${total-rendered} frames before the clip (${entry.rate} to ${entry.rateEnd}).`);
        }
        output.set(result.samples,written*info.channels);written+=result.frames;rendered+=result.frames;
      }
      return {samples:output,frames,channels:info.channels,memoryBytes:engine.module.HEAPU8.byteLength+input.byteLength};
    },
    close(){if(closed)return;closed=true;input=empty;engine.destroy();}
  };
}
