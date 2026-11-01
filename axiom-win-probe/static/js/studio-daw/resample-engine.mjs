import createModule from '../../vendor/libsamplerate-0.1.0/dist/wasm/libsamplerate.js';

let runtime;
const capacity=32768;
export async function createResampler(channels=2){
  if(![1,2].includes(channels))throw new Error('Resampling supports mono or stereo audio.');
  runtime ||= createModule().catch(error=>{runtime=null;throw error;});
  return new Resampler(await runtime,channels);
}

class Resampler {
  constructor(module,channels){
    this.module=module;this.channels=channels;this.destroyed=false;this.finalInput=false;
    this.pointers=[];this.state=0;
    const allocate=bytes=>{const ptr=module._malloc(bytes);if(!ptr)throw new Error('Resampler allocation failed.');this.pointers.push(ptr);return ptr;};
    try{
      this.counts=allocate(8);this.input=allocate(capacity*channels*4);this.output=allocate(capacity*channels*4);
      this.state=module._resampler_new(0,channels,this.counts);
      if(!this.state)throw new Error('Resampler initialization failed.');
    }catch(error){this.destroy();throw error;}
  }
  process(input,outputFrames,ratio,end=false){
    if(this.destroyed)throw new Error('Resampler is closed.');
    if(!(input instanceof Float32Array)||input.length%this.channels||input.length>capacity*this.channels||
       !Number.isSafeInteger(outputFrames)||outputFrames<1||outputFrames>capacity||!Number.isFinite(ratio)||ratio<.125||ratio>8)
      throw new Error('Invalid bounded resampling request.');
    if(this.finalInput&&input.length)throw new Error('Resampler input already ended.');
    for(const sample of input)if(!Number.isFinite(sample))throw new Error('Resampler input contains invalid samples.');
    const m=this.module;
    m.HEAPF32.set(input,this.input>>2);
    const error=m._resampler_process(this.state,this.input,input.length/this.channels,this.output,outputFrames,ratio,end?1:0,this.counts,this.counts+4);
    if(error)throw new Error('Resampling failed: '+m.UTF8ToString(m._resampler_strerror(error)));
    const used=m.HEAP32[this.counts>>2],frames=m.HEAP32[(this.counts+4)>>2];
    if(used<0||used>input.length/this.channels||frames<0||frames>outputFrames)throw new Error('Invalid resampler receipt.');
    if(end&&used===input.length/this.channels)this.finalInput=true;
    const samples=m.HEAPF32.slice(this.output>>2,(this.output>>2)+frames*this.channels);
    for(const sample of samples)if(!Number.isFinite(sample))throw new Error('Resampler output contains invalid samples.');
    return {samples,used,frames};
  }
  reset(){
    if(this.destroyed)throw new Error('Resampler is closed.');
    if(this.module._resampler_reset(this.state))throw new Error('Resampler reset failed.');
    this.finalInput=false;
  }
  destroy(){
    if(this.destroyed)return;this.destroyed=true;
    if(this.state)this.module._resampler_delete(this.state);
    for(const ptr of this.pointers)this.module._free(ptr);
    this.state=0;this.pointers=[];
  }
}
