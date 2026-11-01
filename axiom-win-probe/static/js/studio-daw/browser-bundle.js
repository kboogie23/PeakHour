(function(){
  'use strict';
  if(!window.AXIOM_BROWSER_AUDIO_ENABLED)return;
  const maxAudio=256*1024*1024,maxManifest=10*1024*1024;
  const stemNames=['vocals','other','bass','drums'];
  const references=p=>[p.sourceTrack,...(p.sourceTracks||[]),...(p.arrangementClips||[]),...Object.values(p.drumSamples||{}),...(p.fxRegions||[]).map(f=>f.sweepSource)].filter(t=>t?.path);
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  function validate(p){
    window.AxiomDawDrafts.validate(p);
    if(references(p).some(t=>t.stemState==='processing'))throw new Error('Wait for stem processing before bundling. No audio was omitted.');
  }
  function worker(data,transfer){
    return new Promise((resolve,reject)=>{
      const w=new Worker('/static/js/studio-daw/bundle-worker.js?v=1');
      const finish=(error,result)=>{clearTimeout(timer);w.terminate();error?reject(error):resolve(result);};
      const timer=setTimeout(()=>finish(new Error('Portable archive worker timed out.')),120000);
      w.onerror=e=>finish(new Error(e.message||'Portable archive worker failed.'));
      w.onmessage=e=>finish(e.data.error?new Error(e.data.error):null,e.data);
      w.postMessage(data,transfer);
    });
  }
  async function exportProject(project){
    const p=JSON.parse(JSON.stringify(project));validate(p);
    p.assetIdentities={...p.assetIdentities};
    const tracks=references(p);
    const manifest={format:'axiom-daw-bundle',version:1,project:p,assets:Object.create(null),sources:Object.create(null),stems:{}},entries=[];
    let total=0;
    async function addAudio(path){
      const record=await window.AxiomBrowserAudio.readSource(path);
      if(!record)throw new Error('Reconnect the exact music folder or restore the missing source before portable export. No source was omitted.');
      const expected=[p.assetIdentities[path],...tracks.filter(t=>t.path===path).map(t=>t.assetIdentity)].filter(Boolean);
      if(expected.some(identity=>identity.sha256!==record.sha256||identity.size!==record.size))throw new Error('Audio differs from its saved fingerprint.');
      const name='audio/'+record.sha256+'.'+(record.extension||path.split('.').at(-1));
      if(!Object.hasOwn(manifest.assets,name)){
        total+=record.size;if(total>maxAudio||entries.length>=2000)throw new Error('Browser portable project exceeds 256 MiB or 2000 audio assets.');
        manifest.assets[name]={sha256:record.sha256,size:record.size};entries.push({name,buffer:await record.blob.arrayBuffer()});
      }
      return name;
    }
    for(const track of tracks){
      if(!Object.hasOwn(manifest.sources,track.path))manifest.sources[track.path]=await addAudio(track.path);
      p.assetIdentities[track.path]=manifest.assets[manifest.sources[track.path]];
      if(track.stemJob){
        if(Object.hasOwn(manifest.stems,track.stemJob)){
          if(manifest.stems[track.stemJob].source!==track.path)throw new Error('Stem job does not belong to this source.');
          continue;
        }
        const job=await window.AxiomBrowserAudio.readStemJob(track.stemJob);
        if(!job||job.source!==track.path)throw new Error('Stored stems do not match this source. Restore its portable backup.');
        const audio={};for(const name of stemNames)audio[name]=await addAudio(job.audio[name]);
        manifest.stems[track.stemJob]={source:track.path,start:job.start,duration:job.duration,audio};
      }
    }
    const json=new TextEncoder().encode(JSON.stringify(manifest));if(json.length>maxManifest)throw new Error('Project manifest exceeds 10 MiB.');
    entries.push({name:'project.json',buffer:json.buffer});
    const result=await worker({type:'export',entries},entries.map(e=>e.buffer));
    return new Blob([result.buffer],{type:'application/zip'});
  }
  async function importProject(file){
    if(!(file instanceof Blob)||file.size>maxAudio+maxManifest+1024*1024)throw new Error('Browser portable project is too large.');
    const buffer=await file.arrayBuffer(),result=await worker({type:'import',buffer},[buffer]),entries=new Map(result.entries.map(e=>[e.name,e.buffer]));
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get('project.json')));
    if(!object(manifest)||manifest.format!=='axiom-daw-bundle'||manifest.version!==1||!object(manifest.assets)||!object(manifest.sources)||!object(manifest.stems))throw new Error('Unsupported portable project.');
    const p=manifest.project;validate(p);
    const assets=Object.entries(manifest.assets),prepared=[];
    if(entries.size!==assets.length+1||assets.some(([name])=>!entries.has(name)))throw new Error('Archive does not match its manifest.');
    for(const [name,expected] of assets){
      const match=/^audio\/([a-f0-9]{64})\.(mp3|mp4|m4a|wav|aiff|flac|aac)$/.exec(name);
      if(!match||!object(expected)||expected.sha256!==match[1]||!Number.isSafeInteger(expected.size)||expected.size!==entries.get(name).byteLength)throw new Error('Invalid bundled audio identity.');
      prepared.push({buffer:entries.get(name),sha256:expected.sha256,size:expected.size,extension:match[2]});
    }
    const sourceName=path=>{
      if(!Object.hasOwn(manifest.sources,path)||!Object.hasOwn(manifest.assets,manifest.sources[path]))throw new Error('Portable project is missing a source.');
      const expected=p.assetIdentities?.[path],actual=manifest.assets[manifest.sources[path]];
      if(expected&&(expected.size!==actual.size||expected.sha256!==actual.sha256))throw new Error('Source differs from the project fingerprint.');
      return manifest.sources[path];
    };
    for(const track of references(p))sourceName(track.path);if(p.anchorPath)sourceName(p.anchorPath);
    const stemEntries=Object.entries(manifest.stems),assetIndices=new Map(assets.map(([name],i)=>[name,i]));
    const stemRequests=stemEntries.map(([,entry])=>{
      if(!object(entry)||!object(entry.audio)||Object.keys(entry.audio).length!==4||stemNames.some(name=>!assetIndices.has(entry.audio[name])||!entry.audio[name].endsWith('.wav')))throw new Error('Portable project must include all four WAV stems.');
      return {source:assetIndices.get(sourceName(entry.source)),start:entry.start,duration:entry.duration,audio:Object.fromEntries(stemNames.map(name=>[name,assetIndices.get(entry.audio[name])]))};
    });
    for(const track of references(p))if(track.stemJob&&(!Object.hasOwn(manifest.stems,track.stemJob)||manifest.stems[track.stemJob].source!==track.path))throw new Error('Bundled stem does not belong to its clip.');
    const restored=await window.AxiomBrowserAudio.restoreBundle(prepared,stemRequests),paths=restored.paths,byJob=new Map(stemEntries.map(([id],i)=>[id,restored.jobs[i]])),byName=new Map(assets.map(([name],i)=>[name,paths[i]])),identities={};
    for(const track of references(p)){
      const name=sourceName(track.path);track.path=byName.get(name);identities[track.path]=manifest.assets[name];
      if(track.beatgrid)track.beatgrid.trackPath=track.path;
      if(track.stemJob){track.stemJob=byJob.get(track.stemJob);track.stemState='ready';}
    }
    if(p.anchorPath)p.anchorPath=byName.get(sourceName(p.anchorPath));
    p.assetIdentities=identities;delete p.localDraftId;
    return {format:'axiom-daw-project',version:1,project:p};
  }
  window.AxiomBrowserBundle={exportProject,importProject};
})();
