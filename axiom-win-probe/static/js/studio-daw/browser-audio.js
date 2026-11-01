(function(){
  'use strict';
  const prefix='/axiom-browser-audio/',validPath=/^\/axiom-browser-audio\/[a-f0-9-]{36}\.(mp3|mp4|m4a|wav|aiff|flac|aac)$/;
  const maximum=256*1024*1024;
  const stemNames=['vocals','other','bass','drums'],stemPrefix='/axiom-browser-stems/',stemId=/^browser-[a-f0-9-]{36}$/;
  const mime={mp3:'audio/mpeg',mp4:'audio/mp4',m4a:'audio/mp4',wav:'audio/wav',aiff:'audio/aiff',flac:'audio/flac',aac:'audio/aac'};
  const extension=name=>String(name||'').toLowerCase().split('.').at(-1);
  function inspectWav(buffer){
    if(buffer.byteLength<66||buffer.byteLength>maximum)throw new Error('Generated WAV must contain audio and be smaller than 256 MiB.');
    const v=new DataView(buffer),tag=at=>String.fromCharCode(...new Uint8Array(buffer,at,4));
    if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(12)!=='fmt '||tag(38)!=='fact'||tag(50)!=='data'||v.getUint32(4,true)!==buffer.byteLength-8||v.getUint32(16,true)!==18||v.getUint16(20,true)!==3||v.getUint16(22,true)!==2||v.getUint32(24,true)!==48000||v.getUint32(28,true)!==384000||v.getUint16(32,true)!==8||v.getUint16(34,true)!==32||v.getUint16(36,true)!==0||v.getUint32(42,true)!==4||v.getUint32(54,true)!==buffer.byteLength-58||(buffer.byteLength-58)%8)throw new Error('Expected an AXIOM-generated stereo 48 kHz float WAV.');
    const frames=(buffer.byteLength-58)/8;
    if(v.getUint32(46,true)!==frames)throw new Error('Generated WAV frame count does not match its audio.');
    for(let i=58;i<buffer.byteLength;i+=4)if(!Number.isFinite(v.getFloat32(i,true)))throw new Error('Generated WAV contains invalid samples.');
    return {frames,duration:frames/48000};
  }
  window.AxiomBrowserAudio={inspectWav};
  if(!window.AXIOM_BROWSER_AUDIO_ENABLED)return;
  const originalFetch=window.fetch.bind(window);
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  let opening,queue=Promise.resolve(),pending=0;
  function bounded(operation){
    if(pending>=32)return Promise.reject(new Error('Browser audio storage is busy. Try again after the current operation.'));
    pending++;const result=queue.then(operation).finally(()=>pending--);queue=result.catch(()=>{});return result;
  }
  function database(){
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('axiom-daw-audio-v1',1);let blocked=false;
      request.onupgradeneeded=()=>request.result.createObjectStore('audio',{keyPath:'path'});
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>{blocked=true;reject(new Error('Close other AXIOM tabs to open recording storage.'));};
      request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
    }).catch(error=>{opening=null;throw error;});return opening;
  }
  async function transaction(mode,operation){
    const db=await database();return new Promise((resolve,reject)=>{
      const tx=db.transaction('audio',mode),request=operation(tx.objectStore('audio'));let result;
      request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('Recording storage transaction was interrupted.'));
      tx.onerror=()=>{};
    });
  }
  const digest=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
  async function inspectEncoded(buffer,ext){
    if(!Object.hasOwn(mime,ext)||buffer.byteLength>96*1024*1024||!buffer.byteLength)throw new Error('Choose supported audio up to 96 MiB.');
    const blob=new Blob([buffer],{type:mime[ext]}),url=URL.createObjectURL(blob),media=new Audio();
    try{
      const duration=await new Promise((resolve,reject)=>{
        const done=(error,value)=>{clearTimeout(timer);media.onloadedmetadata=media.onerror=null;error?reject(error):resolve(value);};
        const timer=setTimeout(()=>done(new Error('Audio metadata timed out.')),15000);
        media.onloadedmetadata=()=>done(null,media.duration);media.onerror=()=>done(new Error('This browser cannot read this audio format or codec.'));
        media.preload='metadata';media.src=url;
      });
      if(!Number.isFinite(duration)||duration<=0||duration>600)throw new Error('Browser music imports currently support audio up to ten minutes.');
      const ctx=new OfflineAudioContext(2,1,48000),audio=await ctx.decodeAudioData(buffer.slice(0));
      if(audio.numberOfChannels>2||audio.duration>600||audio.length<1)throw new Error('Browser import requires mono or stereo audio up to ten minutes.');
      return {frames:audio.length,duration:audio.duration,channels:audio.numberOfChannels};
    }finally{media.removeAttribute('src');media.load();URL.revokeObjectURL(url);}
  }
  async function read(path){
    if(!validPath.test(path))return null;
    const record=await transaction('readonly',s=>s.get(path));if(!record)return null;
    if(!(record.blob instanceof Blob)||record.blob.size!==record.size||record.size>maximum)throw new Error('Stored audio did not verify.');
    const buffer=await record.blob.arrayBuffer();if(record.generated!==false)inspectWav(buffer);
    if(await digest(buffer)!==record.sha256)throw new Error('Stored audio fingerprint changed. Restore this take from a backup.');
    return record;
  }
  async function readSource(path){
    if(typeof path!=='string'||!path)return null;
    if(path.startsWith(prefix))return read(path);
    const file=window.AXIOM_BROWSER_SOURCE_FILE?.(path);
    if(!file)return null;
    const ext=extension(file.name);
    if(!(file instanceof Blob)||!Object.hasOwn(mime,ext)||file.size<1||file.size>96*1024*1024)throw new Error('Connected browser audio must be a supported file up to 96 MiB.');
    const buffer=await file.arrayBuffer();
    if(buffer.byteLength!==file.size)throw new Error('Connected source changed while reading. Reconnect the music folder.');
    return {path,blob:new Blob([buffer],{type:mime[ext]}),size:buffer.byteLength,sha256:await digest(buffer),extension:ext,generated:false};
  }
  async function save(file,generated=true,expected=null,recover=false){
    if(!(file instanceof Blob)||file.size>((generated||recover)?maximum:96*1024*1024))throw new Error('Audio exceeds the browser import size limit.');
    const ext=generated?'wav':extension(file.name);
    const buffer=await file.arrayBuffer(),sha256=await digest(buffer);
    if(expected&&(sha256!==expected.sha256||buffer.byteLength!==expected.size))throw new Error('That file does not match the saved original. No clips were changed.');
    let info;
    // Exact generated recordings may exceed the encoded-music limit.
    if(recover&&ext==='wav'){try{info=inspectWav(buffer);generated=true;}catch{}}
    info ||= generated?inspectWav(buffer):await inspectEncoded(buffer,ext);
    const path=prefix+crypto.randomUUID()+'.'+ext;
    const meta=generated?{}:await window.AXIOM_READ_BROWSER_AUDIO_METADATA?.(file,file.name)||{};
    const bpm=Number(meta.bpm),key=/^(?:[1-9]|1[0-2])[AB]$/.test(meta.camelot||'')?meta.camelot:'';
    const track={path,title:String(meta.title||String(file.name||'Recorded take').replace(/\.[^.]+$/i,'')).slice(0,200),artist:String(meta.artist||'Unknown Artist'),duration_sec:info.duration,duration:info.duration,bpm:Number.isFinite(bpm)&&bpm>0?bpm:0,camelot:key,browser_file:true,assetIdentity:{sha256,size:file.size}};
    const record={path,blob:new Blob([buffer],{type:mime[ext]}),track,sha256,size:file.size,generated};
    await transaction('readwrite',s=>s.add(record));
    return track;
  }
  async function withVerifiedSource(file,expected,apply){
    if(!expected||!/^[a-f0-9]{64}$/.test(expected.sha256)||!Number.isSafeInteger(expected.size)||expected.size<1||typeof apply!=='function')throw new Error('A saved audio fingerprint is required for recovery.');
    const track=await bounded(()=>save(file,false,expected,true));
    try{return await apply(track.path);}
    catch(error){
      const p=window.AxiomStudioDaw?.activeProject;
      const referenced=[p?.sourceTrack,...(p?.sourceTracks||[]),...(p?.arrangementClips||[]),...Object.values(p?.drumSamples||{})].some(t=>t?.path===track.path);
      if(!referenced)await bounded(()=>transaction('readwrite',s=>s.delete(track.path)));
      throw error;
    }
  }
  async function readStemJob(id){
    if(!stemId.test(id))return null;
    const record=await transaction('readonly',s=>s.get(stemPrefix+id));if(!record)return null;
    const job=record.job;
    if(!job||!validPath.test(job.source)||!Number.isFinite(job.start)||job.start<0||!Number.isFinite(job.duration)||job.duration<=0||job.duration>600||!job.audio||Object.keys(job.audio).length!==4||stemNames.some(name=>!validPath.test(job.audio[name])||!job.audio[name].endsWith('.wav')))throw new Error('Stored stem reference did not verify. Restore the portable backup.');
    return job;
  }
  async function relinkStems(payload){
    if(!payload||typeof payload.oldPath!=='string'||!payload.oldPath||!validPath.test(payload.path)||!Array.isArray(payload.jobs)||payload.jobs.length>32||payload.jobs.some(id=>typeof id!=='string'||!stemId.test(id)))throw new Error('Supply source paths and up to 32 browser stem references.');
    const source=await read(payload.path);if(!source)throw new Error('Replacement source is missing.');
    const results=[],records=[];
    for(const oldId of new Set(payload.jobs)){
      try{
        const job=await readStemJob(oldId);if(!job||job.source!==payload.oldPath)throw new Error('Stem reference does not belong to the missing source.');
        const expected=job.sourceIdentity||await read(job.source);
        if(!expected||expected.sha256!==source.sha256||expected.size!==source.size)throw new Error('Replacement audio does not match the stored stem original.');
        for(const name of stemNames)if(!await read(job.audio[name]))throw new Error('A separated stem is missing.');
        const id='browser-'+crypto.randomUUID();
        records.push({path:stemPrefix+id,id,job:{...job,source:payload.path,sourceIdentity:{sha256:source.sha256,size:source.size}}});
        results.push({previousId:oldId,id,state:'ready'});
      }catch(error){results.push({previousId:oldId,state:'failed',error:error.message});}
    }
    if(records.length){
      const db=await database();await new Promise((resolve,reject)=>{
        const tx=db.transaction('audio','readwrite');for(const record of records)tx.objectStore('audio').add(record);
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Stem recovery could not be saved.'));tx.onerror=()=>{};
      });
    }
    return {jobs:results,source_audio_untouched:true};
  }
  async function restoreBundle(entries,stemEntries=[]){
    return bounded(async()=>{
      if(!Array.isArray(entries)||entries.length>2000||!Array.isArray(stemEntries)||stemEntries.length>2000)throw new Error('Browser restore exceeds 2000 audio assets or stem sets.');
      const records=[];let total=0;
      for(const entry of entries){
        total+=entry.buffer.byteLength;if(total>maximum)throw new Error('Browser restore exceeds 256 MiB of audio.');
        const sha256=await digest(entry.buffer);
        if(sha256!==entry.sha256||entry.buffer.byteLength!==entry.size)throw new Error('Bundled audio failed fingerprint verification.');
        const ext=entry.extension||'wav';let generated=ext==='wav',info;
        if(generated){try{info=inspectWav(entry.buffer);}catch{generated=false;}}
        if(!generated)info=await inspectEncoded(entry.buffer,ext);
        const path=prefix+crypto.randomUUID()+'.'+ext;
        records.push({path,blob:new Blob([entry.buffer],{type:mime[ext]}),sha256,size:entry.size,generated,track:{path,title:'Restored audio',artist:'Unknown Artist',duration_sec:info.duration}});
      }
      const asset=index=>{if(!Number.isSafeInteger(index)||index<0||index>=records.length)throw new Error('Invalid bundled stem asset.');return records[index];};
      const jobs=stemEntries.map(entry=>{
        const source=asset(entry.source),audio={},start=entry.start,duration=entry.duration;
        if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0||duration>600||start+duration>source.track.duration_sec+.05||!entry.audio||Object.keys(entry.audio).length!==4)throw new Error('Invalid bundled stem range.');
        for(const name of stemNames){const stem=asset(entry.audio[name]);if(!stem.path.endsWith('.wav')||Math.abs(stem.track.duration_sec-duration)>.05)throw new Error('Bundled stem duration does not match its source range.');audio[name]=stem.path;}
        const id='browser-'+crypto.randomUUID();return {path:stemPrefix+id,id,job:{source:source.path,sourceIdentity:{sha256:source.sha256,size:source.size},start,duration,audio}};
      });
      const db=await database();await new Promise((resolve,reject)=>{
        const tx=db.transaction('audio','readwrite');
        for(const record of records)tx.objectStore('audio').add(record);
        for(const job of jobs)tx.objectStore('audio').add(job);
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Portable audio restore failed.'));tx.onerror=()=>{};
      });return {paths:records.map(r=>r.path),jobs:jobs.map(r=>r.id)};
    });
  }
  Object.assign(window.AxiomBrowserAudio,{read:path=>bounded(()=>read(path)),readSource:path=>bounded(()=>readSource(path)),readStemJob:id=>bounded(()=>readStemJob(id)),restore:entries=>restoreBundle(entries).then(result=>result.paths),restoreBundle,withVerifiedSource});
  window.fetch=async function(input,init){
    const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);
    if(url.origin!==location.origin)return originalFetch(input,init);
    const method=(init?.method||input.method||'GET').toUpperCase(),path=url.searchParams.get('path')||'';
    const stemRoute=/^\/api\/studio-daw\/stems\/(browser-[a-f0-9-]{36})(?:\/([^/]+))?$/.exec(url.pathname);
    const importing=url.pathname==='/api/studio-daw/import',streaming=url.pathname==='/api/library/stream'&&path.startsWith(prefix),checking=url.pathname==='/api/studio-daw/assets/check',relinking=url.pathname==='/api/studio-daw/stems/relink';
    if(!importing&&!streaming&&!checking&&!stemRoute&&!relinking)return originalFetch(input,init);
    try{
      if(relinking){
        if(method!=='POST')return json({error:'Use POST to reconnect verified stems.'},405);
        const payload=init?.body?JSON.parse(init.body):input instanceof Request?await input.clone().json():null;
        return json(await bounded(()=>relinkStems(payload)));
      }
      if(stemRoute){
        if(!['GET','HEAD'].includes(method))return json({error:'Stored stems are read-only. Stem analysis requires the desktop engine.'},405);
        if(url.searchParams.has('pcm'))return json({error:'Browser stems currently use whole-file decoding.'},422);
        if(stemRoute[2]&&!stemNames.includes(stemRoute[2]))return json({error:'Stem analysis requires the desktop engine.'},422);
        return await bounded(async()=>{
          const job=await readStemJob(stemRoute[1]);if(!job)return json({error:'Stored stems are missing. Restore the portable backup.'},404);
          if(!stemRoute[2]){
            for(const audioPath of [job.source,...Object.values(job.audio)])if(!await read(audioPath))return json({error:'A stored stem or source is missing. Restore the portable backup.'},404);
            return json({id:stemRoute[1],state:'ready',sourcePath:job.source,sourceStart:job.start,sourceDuration:job.duration});
          }
          const record=await read(job.audio[stemRoute[2]]);if(!record)return json({error:'Stored stem audio is missing. Restore the portable backup.'},404);
          return new Response(method==='HEAD'?null:record.blob,{headers:{'Content-Type':'audio/wav','Content-Length':String(record.size)}});
        });
      }
      if(importing){
        if(method!=='POST')return json({error:'Use POST to save generated audio.'},405);
        const form=init?.body instanceof FormData?init.body:input instanceof Request?await input.clone().formData():null;
        return json({success:true,track:await bounded(()=>save(form?.get('file'),form?.get('axiom_generated')==='1')),storage:'browser',source_audio_untouched:true});
      }
      if(streaming){
        if(!['GET','HEAD'].includes(method))return json({error:'Stored audio is read-only.'},405);
        const record=await bounded(()=>read(path));if(!record)return json({error:'This browser take is missing. Restore its audio backup; clearing site data removes browser recordings.'},404);
        return new Response(method==='HEAD'?null:record.blob,{headers:{'Content-Type':mime[extension(path)],'Content-Length':String(record.size)}});
      }
      if(method!=='POST')return json({error:'Use POST to check audio.'},405);
      const payload=init?.body?JSON.parse(init.body):input instanceof Request?await input.clone().json():null;
      if(!Array.isArray(payload?.paths)||payload.paths.length>32||payload.paths.some(p=>typeof p!=='string'))return json({error:'Supply at most 32 audio paths.'},422);
      const assets=[];
      for(const item of payload.paths){
        try{
          const record=await bounded(()=>readSource(item));assets.push(record?{path:item,status:'ready',size:record.size,sha256:record.sha256}:{path:item,status:'missing',error:'Restore the portable backup or reconnect the exact music folder.'});
        }catch(error){assets.push({path:item,status:'unavailable',error:error.message});}
      }
      return json({assets});
    }catch(error){return json({error:error.name==='QuotaExceededError'?'Browser storage is full. The take was not saved.':error.message||'Browser audio storage failed.'},422);}
  };
})();
