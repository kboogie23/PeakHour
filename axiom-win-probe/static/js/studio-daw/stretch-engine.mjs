const rate=48000,blockSize=4096;
export function validate(channels,plan){
  if(!Array.isArray(channels)||![1,2].includes(channels.length)||channels.some(c=>!(c instanceof Float32Array)||c.length!==channels[0].length))throw new Error('Stretch input must be matching mono or stereo float audio.');
  const frames=channels[0].length;
  if(frames<960||frames>600*rate||!plan||!Number.isFinite(plan.pitch)||Math.abs(plan.pitch)>24||!Array.isArray(plan.frames)||plan.frames.length<2||plan.frames.length>32768)throw new Error('Invalid stretch duration, pitch or timing map.');
  const points=plan.frames;
  points.forEach((p,i)=>{
    if(!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Timing anchors require nonnegative integer frames.');
    if(i){const ds=p[0]-points[i-1][0],dt=p[1]-points[i-1][1];if(ds<=0||dt<=0||dt/ds<.125||dt/ds>8)throw new Error('Timing anchors must increase with ratios between 1/8 and 8.');}
  });
  const target=points.at(-1)[1];
  if(points[0][0]!==0||points[0][1]!==0||points.at(-1)[0]!==frames||target<1||target>1200*rate)throw new Error('Timing map must cover the complete input and output.');
  if((frames+target)*channels.length*4>256*1024*1024)throw new Error('Stretch audio exceeds the 256 MiB input/output sample budget. Split this clip.');
  for(const channel of channels)for(const value of channel)if(!Number.isFinite(value))throw new Error('Source audio contains invalid samples.');
  return {frames,target};
}

export function stretch(module,channels,plan,progress=()=>{}){
  const {frames,target}=validate(channels,plan),allocated=[];let state;
  const alloc=bytes=>{const pointer=module._malloc(bytes);if(!pointer)throw new Error('Stretch worker ran out of memory.');allocated.push(pointer);return pointer;};
  try{
    // R3 offline processing keeps stereo together and uses the same mapped two-pass workflow as desktop.
    state=module._rubberband_new(rate,channels.length,0x30010000,target/frames,Math.pow(2,plan.pitch/12));
    if(!state||module._rubberband_get_engine_version(state)!==3)throw new Error('Rubber Band R3 is unavailable.');
    module._rubberband_set_max_process_size(state,blockSize);
    module._rubberband_set_expected_input_duration(state,frames);
    const pointers=alloc(channels.length*4),buffers=channels.map(()=>alloc(blockSize*4));
    buffers.forEach((pointer,c)=>{module.HEAPU32[pointers/4+c]=pointer;});
    const inner=plan.frames.slice(1,-1);
    if(inner.length){
      const from=alloc(inner.length*4),to=alloc(inner.length*4);
      inner.forEach((p,i)=>{module.HEAPU32[from/4+i]=p[0];module.HEAPU32[to/4+i]=p[1];});
      module._rubberband_set_key_frame_map(state,inner.length,from,to);
    }
    const result=channels.map(()=>new Float32Array(target));let written=0,retrieved=0;
    function drain(){
      let available=module._rubberband_available(state);
      while(available>0){
        const count=module._rubberband_retrieve(state,pointers,Math.min(available,blockSize));
        retrieved+=count;
        if(count<=0||retrieved>target+2)throw new Error('Stretch output duration did not match the timing map.');
        const keep=Math.min(count,target-written);
        for(let c=0;c<channels.length;c++){
          const samples=module.HEAPF32.subarray(buffers[c]/4,buffers[c]/4+keep);
          for(const value of samples)if(!Number.isFinite(value))throw new Error('Stretch output contains invalid samples.');
          result[c].set(samples,written);
        }
        written+=keep;available=module._rubberband_available(state);
      }
      return available;
    }
    for(let pass=0;pass<2;pass++){
      for(let offset=0;offset<frames;offset+=blockSize){
        const count=Math.min(blockSize,frames-offset),last=offset+count===frames?1:0;
        channels.forEach((channel,c)=>module.HEAPF32.set(channel.subarray(offset,offset+count),buffers[c]/4));
        if(pass===0)module._rubberband_study(state,pointers,count,last);
        else{module._rubberband_process(state,pointers,count,last);drain();}
        if(offset%(blockSize*32)===0||last)progress((pass+(offset+count)/frames)/2);
      }
    }
    if(drain()!==-1||written!==target)throw new Error(`Stretch returned ${written} frames; expected ${target}. No padding was applied.`);
    return {channels:result,frames:written,sampleRate:rate,engine:'rubberband-r3-wasm-0.2.0'};
  }finally{
    if(state)module._rubberband_delete(state);
    for(const pointer of allocated.reverse())module._free(pointer);
  }
}

export function encodeWav(channels){
  if(channels.length!==2)throw new Error('Prepared playback requires stereo output.');
  const frames=channels[0].length,buffer=new ArrayBuffer(58+frames*8),v=new DataView(buffer);
  const tag=(at,text)=>{for(let i=0;i<text.length;i++)v.setUint8(at+i,text.charCodeAt(i));};
  tag(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,18,true);
  v.setUint16(20,3,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*8,true);v.setUint16(32,8,true);v.setUint16(34,32,true);v.setUint16(36,0,true);
  tag(38,'fact');v.setUint32(42,4,true);v.setUint32(46,frames,true);tag(50,'data');v.setUint32(54,frames*8,true);
  for(let i=0;i<frames;i++)for(let c=0;c<2;c++)v.setFloat32(58+(i*2+c)*4,channels[c][i],true);
  return buffer;
}
