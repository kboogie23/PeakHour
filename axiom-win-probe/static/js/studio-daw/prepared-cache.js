(function(){
  'use strict';
  const routes={stretch:'/api/studio-daw/stretch/cache-lease',native:'/api/studio-daw/plugins/cache-lease',stems:'/api/studio-daw/stems/cache-lease'};
  function address(url){
    const stem=/^\/api\/studio-daw\/stems\/([a-f0-9]{64})\/(?:vocals|other|bass|drums)$/.exec(url);
    if(stem)return {kind:'stems',key:stem[1]};
    const match=/^\/api\/studio-daw\/(stretch|plugins\/render)\/([a-f0-9]{64})\/audio$/.exec(url);
    return match?{kind:match[1]==='stretch'?'stretch':'native',key:match[2]}:null;
  }
  function create(onFailure){
    const groups=new Map();let closed=false,queue=Promise.resolve();
    async function releaseToken(kind,token){
      try{await fetch(routes[kind],{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),keepalive:true});}catch{}
    }
    async function update(force=false){
      if(closed)return;
      for(const [kind,group] of groups){
        if(closed)return;
        if(!group.keys.size){if(group.token){const token=group.token;group.token=null;await releaseToken(kind,token);}group.held.clear();continue;}
        if(!force&&group.token&&Date.now()-group.renewedAt<60000&&group.held.size===group.keys.size&&[...group.keys].every(key=>group.held.has(key)))continue;
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
        try{
          const keys=[...group.keys];
          const response=await fetch(routes[kind],{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({keys,...(group.token?{token:group.token}:{})})});
          if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Restart the local AXIOM engine to enable managed audio caching.');
          const data=await response.json();
          if(!response.ok||! /^[a-f0-9]{64}$/.test(data.token)||data.ttlSeconds!==120)throw new Error(data.error||'Audio cache protection is unavailable. Restart playback.');
          if(closed){await releaseToken(kind,data.token);return;}
          group.token=data.token;
          group.held=new Set(keys);group.renewedAt=Date.now();
        }catch(error){group.held.clear();group.renewedAt=0;throw error;
        }finally{clearTimeout(timeout);}
      }
    }
    function sync(force=false){const next=queue.then(()=>update(force));queue=next.catch(()=>{});return next;}
    const timer=setInterval(()=>sync(true).catch(error=>{if(!closed)onFailure(error);}),30000);
    return {
      async hold(url){
        if(closed)throw new Error('Playback cancelled');
        const item=address(url);if(!item)return;
        if(!groups.has(item.kind))groups.set(item.kind,{keys:new Set(),held:new Set(),renewedAt:0,token:null});
        const group=groups.get(item.kind);group.keys.add(item.key);
        // Repeated clips and stem voices often use the same prepared file.
        // Await any pending reconciliation before trusting its verified lease;
        // renew well before the unchanged 120-second server TTL expires.
        await queue;
        if(closed)throw new Error('Playback cancelled');
        if(!group.token||!group.held.has(item.key)||Date.now()-group.renewedAt>=60000)await sync();
        if(closed)throw new Error('Playback cancelled');
      },
      forget(url){const item=address(url);if(item)groups.get(item.kind)?.keys.delete(item.key);},
      release(){closed=true;clearInterval(timer);for(const [kind,group] of groups)if(group.token){releaseToken(kind,group.token);group.token=null;}},
      renew:()=>sync(true)
    };
  }
  window.AxiomPreparedCache={create};
})();
