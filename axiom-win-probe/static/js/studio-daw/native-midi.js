(function(){
  'use strict';
  function local(){return ['127.0.0.1','localhost'].includes(location.hostname)&&['http:','https:'].includes(location.protocol);}
  async function requestAccess(){
    if(!local())throw new Error('Native MIDI requires the local AXIOM app.');
    let token,closed=false,timer,selected=null,sequence=0,epoch=0,offset=0,best=Infinity,polling=null,opening=false,flushing=false;
    const access=new EventTarget();access.inputs=new Map();access.clock='native-callback-estimate';
    async function command(action,body={},keepalive=false){
      const sent=performance.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2000);
      try{
        const response=await fetch('/api/studio-daw/midi/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:controller.signal,keepalive});
        if(response.status===404)throw new Error('Restart the local AXIOM engine to enable native MIDI.');
        const data=await response.json(),received=performance.now();
        if(!response.ok)throw new Error(data.error||'Native MIDI connection failed.');
        if(action!=='close'&&(!Number.isFinite(data.serverTime)||data.serverTime<0))throw new Error('Invalid native MIDI clock.');
        if(Number.isFinite(data.serverTime)&&received-sent<best){best=received-sent;offset=(sent+received)/2-data.serverTime*1000;}
        return data;
      }catch(error){throw new Error(error.name==='AbortError'?'Native MIDI connection timed out. Reconnect before recording.':error.message);}
      finally{clearTimeout(timeout);}
    }
    function state(error){access.error=error||null;access.dispatchEvent(new Event('statechange'));}
    function update(inputs){
      if(!Array.isArray(inputs)||inputs.length>256)throw new Error('Invalid native MIDI device list.');
      const ids=new Set();let changed=false;
      for(const info of inputs){
        if(typeof info.id!=='string'||typeof info.name!=='string'||ids.has(info.id))throw new Error('Invalid native MIDI input.');
        ids.add(info.id);
        if(!access.inputs.has(info.id)){
          const port=new EventTarget();Object.assign(port,{id:info.id,name:info.name,state:'connected',connection:'closed'});
          port.open=async()=>{
            if(closed||port.state!=='connected')throw new Error('MIDI input disconnected.');
            if(selected||opening)throw new Error('A MIDI input is already open.');
            opening=true;flushing=false;clearTimeout(timer);
            try{
              // Drain an idle poll before opening so it cannot consume the new take's first notes.
              await polling;if(closed||port.state!=='connected')throw new Error('MIDI input disconnected.');
              const version=++epoch;selected=port;sequence=0;
              await command('open',{id:port.id});if(closed||epoch!==version){await command('stop').catch(()=>{});throw new Error('MIDI input opening cancelled.');}port.connection='open';return port;
            }catch(error){if(selected===port)selected=null;throw error;}
            finally{opening=false;if(!closed)timer=setTimeout(poll,0);}
          };
          port.close=async()=>{if(selected!==port)return port;epoch++;selected=null;port.connection='closed';if(!closed)await command('stop');return port;};
          access.inputs.set(port.id,port);changed=true;
        }
      }
      for(const [id,port] of access.inputs)if(!ids.has(id)){port.state='disconnected';port.connection='closed';access.inputs.delete(id);changed=true;}
      if(changed)state();
    }
    access.close=async()=>{if(closed)return;closed=true;epoch++;clearTimeout(timer);for(const port of access.inputs.values()){port.state='disconnected';port.connection='closed';}selected=null;await command('close',{},true).catch(()=>{});};
    function fail(error){
      if(closed)return;
      if(selected){selected.state='disconnected';selected.connection='closed';}
      state(error.message);access.close();
    }
    async function read(){
      if(closed)return;
      const version=epoch;
      try{
        const data=await command('poll');if(closed)return;
        if(!Array.isArray(data.events)||data.events.length>2048)throw new Error('Invalid native MIDI event batch.');
        if(version===epoch&&selected?.connection==='open'){
          for(const item of data.events){
            if(item.sequence!==sequence+1||!Number.isFinite(item.time)||!Array.isArray(item.data)||![2,3].includes(item.data.length)||item.data.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error('Native MIDI events were lost. Reconnect before recording.');
            sequence=item.sequence;
            const event=new Event('midimessage');Object.defineProperties(event,{data:{value:new Uint8Array(item.data)},timeStamp:{value:item.time*1000+offset}});selected.dispatchEvent(event);
            if(closed||version!==epoch)break;
          }
        }
        if(data.error)throw new Error(data.error);
        update(data.inputs);if(!closed&&!opening&&!flushing)timer=setTimeout(poll,selected?10:250);
      }catch(error){fail(error);}
    }
    function poll(){polling=read();polling.finally(()=>{polling=null;});}
    access.flush=async()=>{flushing=true;clearTimeout(timer);await polling;if(!closed)await read();if(access.error)throw new Error(access.error);};
    const data=await command('connect');token=data.token;
    if(typeof token!=='string'||token.length<32)throw new Error('Invalid native MIDI connection.');
    try{update(data.inputs);}catch(error){await access.close();throw error;}
    timer=setTimeout(poll,0);return access;
  }
  window.AxiomNativeMidi={requestAccess,available:local};
})();
