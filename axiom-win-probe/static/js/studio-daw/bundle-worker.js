importScripts('/static/vendor/fflate-0.8.3/fflate.js');
const maxAudio=256*1024*1024,maxManifest=10*1024*1024;
const nameAllowed=name=>name==='project.json'||/^audio\/[a-f0-9]{64}\.(mp3|mp4|m4a|wav|aiff|flac|aac)$/.test(name);
self.onmessage=e=>{
  try{
    if(e.data.type==='export'){
      const entries=Object.create(null);let size=0,count=0;
      for(const entry of e.data.entries){
        if(!nameAllowed(entry.name)||entries[entry.name]||++count>2001)throw new Error('Invalid portable archive entries.');
        const bytes=new Uint8Array(entry.buffer);size+=bytes.length;
        if(size>maxAudio+maxManifest||entry.name==='project.json'&&bytes.length>maxManifest)throw new Error('Browser portable project exceeds 256 MiB audio or 10 MiB manifest.');
        entries[entry.name]=bytes;
      }
      const output=fflate.zipSync(entries,{level:0});self.postMessage({buffer:output.buffer},[output.buffer]);
    }else if(e.data.type==='import'){
      const input=new Uint8Array(e.data.buffer);if(input.length>maxAudio+maxManifest+1024*1024)throw new Error('Browser portable project is too large.');
      const names=new Set();let size=0;
      const entries=fflate.unzipSync(input,{filter:file=>{
        if(!nameAllowed(file.name)||names.has(file.name)||names.size>=2001)throw new Error('Unexpected or duplicate archive entry.');
        names.add(file.name);size+=file.originalSize;
        if(!Number.isSafeInteger(file.originalSize)||file.originalSize<0||size>maxAudio+maxManifest||file.name==='project.json'&&file.originalSize>maxManifest)throw new Error('Archive exceeds browser restore limits.');
        if(file.compression!==0)throw new Error('Use an uncompressed AXIOM portable archive.');
        return true;
      }});
      if(!entries['project.json'])throw new Error('Project manifest is missing.');
      const result=Object.entries(entries).map(([name,bytes])=>({name,buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}));
      self.postMessage({entries:result},result.map(e=>e.buffer));
    }else throw new Error('Unknown portable archive operation.');
  }catch(error){self.postMessage({error:error.message||'Portable archive failed.'});}
};
