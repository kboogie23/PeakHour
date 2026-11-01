(function(){
  'use strict';
  if(!window.indexedDB)return;
  const prefix='axiom.daw.draft.v1.';
  let opening;
  function database(){
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=window.indexedDB.open('axiom-daw-projects',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
      request.onerror=()=>reject(request.error||new Error('Project storage could not open.'));
      request.onblocked=()=>reject(new Error('Close other AXIOM windows, then try saving again.'));
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
    }).then(async db=>{
      // Copy first, commit, read back, then remove only unchanged legacy values.
      // Corrupt legacy records are retained byte-for-byte for recovery too.
      const legacy=[];
      for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))legacy.push([key,localStorage.getItem(key)]);}
      if(legacy.length){
        const destinations=new Map();
        await transaction(db,'readwrite',store=>{for(const [key,value] of legacy){const read=store.get(key);read.onsuccess=()=>{
          const target=read.result===undefined||read.result===value?key:`${key}.legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          destinations.set(key,target);
          if(read.result!==value)store.put(value,target);
        };}});
        const copied=await transaction(db,'readonly',store=>store.getAllKeys());
        for(const [key,value] of legacy){
          const target=destinations.get(key);
          if(!copied.includes(target))throw new Error('Existing project migration could not be verified.');
          const saved=await transaction(db,'readonly',store=>store.get(target));
          if(saved===value&&localStorage.getItem(key)===value)localStorage.removeItem(key);
        }
      }
      return db;
    }).catch(error=>{opening=null;throw error;});
    return opening;
  }
  function transaction(db,mode,work){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode);let result;
      tx.oncomplete=()=>resolve(result?.result);
      tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Project storage write failed. Your previous save was kept.'));
      try{result=work(tx.objectStore('drafts'));}catch(error){tx.abort();reject(error);}
    });
  }
  window.AxiomDraftStorage={
    get:key=>database().then(db=>transaction(db,'readonly',store=>store.get(key))),
    set:(key,value)=>database().then(async db=>{
      await transaction(db,'readwrite',store=>store.put(value,key));
      if(await transaction(db,'readonly',store=>store.get(key))!==value)throw new Error('Saved project verification failed.');
    }),
    list:()=>database().then(db=>transaction(db,'readonly',store=>store.getAll())),
    ready:database
  };
})();
