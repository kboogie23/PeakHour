// Only writes newly named export files in this origin's private storage.
let handle,root,name,frames=0,total=0,peak=0,peaks,bands,opened=false,closed=false,recording=false;
const low=[0,0],upper=[0,0],lowAlpha=1-Math.exp(-2*Math.PI*200/48000),midAlpha=1-Math.exp(-2*Math.PI*2000/48000);
const maxFrames=Math.floor((0xffffffff-50)/8);
const littleEndian=new DataView(new Float32Array([1]).buffer).getFloat32(0,true)===1;
function header(count){
  const bytes=new Uint8Array(58),v=new DataView(bytes.buffer);
  const text=(at,value)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');v.setUint32(4,50+count*8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,18,true);
  v.setUint16(20,3,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint32(28,384000,true);v.setUint16(32,8,true);v.setUint16(34,32,true);
  text(38,'fact');v.setUint32(42,4,true);v.setUint32(46,count,true);text(50,'data');v.setUint32(54,count*8,true);return bytes;
}
function write(bytes,at){if(handle.write(bytes,{at})!==bytes.byteLength)throw new Error('Export storage could not write a complete block.');}
async function discard(){try{handle?.close();}finally{handle=null;if(root&&name)await root.removeEntry(name).catch(()=>{});}}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  if(closed)return;
  if(data?.type==='clear'&&!opened){
    opened=true;let removed=0,busy=0;
    const storage=await navigator.storage.getDirectory();
    try{root=await storage.getDirectoryHandle('axiom-mix-exports-v1');}catch(error){if(error.name!=='NotFoundError')throw error;}
    if(root)for await(const [entry,file] of root.entries()){
      if(file.kind!=='file'||!/^export-[a-f0-9-]{36}\.wav$/.test(entry))continue;
      let lock;
      try{lock=await file.createSyncAccessHandle();}catch(error){if(error.name==='NoModificationAllowedError'||error.name==='InvalidStateError'){busy++;continue;}throw error;}
      lock.close();await root.removeEntry(entry);removed++;
    }
    closed=true;self.postMessage({type:'cleared',removed,busy});return;
  }
  if(data?.type==='abort'){closed=true;await discard();self.postMessage({type:'aborted'});return;}
  if(data?.type==='open'){
    if(opened||!Number.isSafeInteger(data.frames)||data.frames<1||data.frames>maxFrames||!/^export-[a-f0-9-]{36}\.wav$/.test(data.name))throw new Error('Invalid streaming export range.');
    recording=data.recording===true;
    if(recording&&data.frames>48000*7200)throw new Error('Recording exceeds the two-hour take limit.');
    opened=true;total=data.frames;name=data.name;peaks=new Float32Array(Math.min(65536,total));bands=Array.from({length:3},()=>new Float32Array(peaks.length));
    const storage=await navigator.storage.getDirectory();root=await storage.getDirectoryHandle('axiom-mix-exports-v1',{create:true});
    // The randomly named destination must not already exist.
    try{await root.getFileHandle(name);name=null;throw new Error('Export destination already exists.');}catch(error){if(error.name!=='NotFoundError')throw error;}
    const file=await root.getFileHandle(name,{create:true});self.postMessage({type:'created'});
    if(!file.createSyncAccessHandle)throw new Error('This browser cannot stream exports to private storage.');
    handle=await file.createSyncAccessHandle();write(header(total),0);
    self.postMessage({type:'ready'});return;
  }
  if(!handle)throw new Error('Export writer is unavailable.');
  if(data?.type==='samples'){
    const samples=data.samples;
    if(!(samples instanceof Float32Array)||samples.length<2||samples.length>131072||samples.length%2||data.offset!==frames||frames+samples.length/2>total)throw new Error('Export audio blocks are missing or out of order.');
    if(typeof SharedArrayBuffer==='function'&&samples.buffer instanceof SharedArrayBuffer)throw new Error('Export requires exclusively owned audio blocks.');
    // Transferred float PCM is already WAV byte order on little-endian hosts.
    // Validate the entire view before writing; never include its backing-buffer padding.
    const bytes=littleEndian?new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength):new Uint8Array(samples.length*4);
    const v=littleEndian?null:new DataView(bytes.buffer);
    // A waveform bin covers consecutive frames. Resolve its boundary once,
    // preserving the original floating-point bin rule at exact boundaries.
    const blockEnd=frames+samples.length/2;
    for(let i=0;i<samples.length;){
      const bin=Math.min(peaks.length-1,Math.floor((frames+i/2)/total*peaks.length));
      let end=Math.min(blockEnd,Math.ceil((bin+1)*total/peaks.length));
      while(end<blockEnd&&Math.floor(end/total*peaks.length)===bin)end++;
      const stop=(end-frames)*2;let magnitude=peaks[bin];
      for(;i<stop;i+=2){
        const left=samples[i],right=samples[i+1];
        if(!Number.isFinite(left)||!Number.isFinite(right))throw new Error('Export contains invalid audio samples.');
        if(v){v.setFloat32(i*4,left,true);v.setFloat32((i+1)*4,right,true);}
        magnitude=Math.max(magnitude,Math.abs(left),Math.abs(right));
        for(let ch=0;ch<2;ch++){
          const value=ch?right:left;low[ch]+=lowAlpha*(value-low[ch]);upper[ch]+=midAlpha*(value-upper[ch]);
          bands[0][bin]+=low[ch]**2;bands[1][bin]+=(upper[ch]-low[ch])**2;bands[2][bin]+=(value-upper[ch])**2;
        }
      }
      peak=Math.max(peak,magnitude);peaks[bin]=magnitude;
    }
    write(bytes,58+frames*8);frames+=samples.length/2;self.postMessage({type:'ack',frames});return;
  }
  if(data?.type==='complete'){
    if(data.frames!==frames||frames<1||(!recording&&frames!==total))throw new Error('Export ended before the complete mix was written.');
    if(recording)write(header(frames),0);
    handle.truncate(58+frames*8);handle.flush();handle.close();handle=null;closed=true;
    self.postMessage({type:'complete',frames,peak,peaks,bands},[peaks.buffer,...bands.map(b=>b.buffer)]);return;
  }
  throw new Error('Invalid export writer message.');
}).catch(async error=>{closed=true;await discard();self.postMessage({type:'error',message:error.message});});};
