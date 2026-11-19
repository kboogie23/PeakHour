(function(){
  'use strict';
  let pending=null;
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  function validate(value){
    if(value===null||value===undefined)return;
    if(!object(value)||value.format!=='AU'||!/^61756678-[0-9a-f]{8}-[0-9a-f]{8}$/.test(value.id)||
       typeof value.name!=='string'||!value.name||value.name.length>256||typeof value.enabled!=='boolean'||
       !Number.isInteger(value.version)||value.version<0||value.version>4294967295||
       typeof value.state!=='string'||value.state.length>8*1024*1024||value.state.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.state))throw new Error('Invalid saved Audio Unit effect.');
    if(!object(value.parameters)||Object.keys(value.parameters).length>4096||Object.entries(value.parameters).some(([key,v])=>!/^\d{1,20}$/.test(key)||BigInt(key)>18446744073709551615n||!Number.isFinite(v)))throw new Error('Invalid saved Audio Unit parameters.');
  }
  async function request(path,data,signal){
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(abort,35000);
    try{
      const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});
      if(response.status===404)throw new Error('Restart the local AXIOM engine to enable native effects.');
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Native effect request failed.');
      return {data:result,status:response.status};
    }catch(error){if(error.name==='AbortError')throw new Error('Native effect request cancelled or timed out.');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function cancelJob(entry){
    entry.cancelled=true;
    if(entry.id&&entry.created&&!entry.sent){entry.sent=true;fetch('/api/studio-daw/plugins/render/'+entry.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});}
  }
  function cancel(){if(pending){cancelJob(pending);pending=null;}}
  function tempoContext(clip,project){
    if(!project)return undefined;
    const map=window.AxiomStudioDaw.compileTempoMap(project);
    return {startBeat:clip.timelineStartBeat,points:map.segments.map(s=>({beat:s.beat,bpm:s.value,linear:s.slope!==0}))};
  }
  async function prepare(clip,url,cancelled=()=>false,project){
    validate(clip.nativeEffect);const effect=clip.nativeEffect;if(!effect?.enabled)return url;
    const match=/^\/api\/studio-daw\/stretch\/([a-f0-9]{64})\/audio$/.exec(url);
    if(!match)throw new Error('Prepare the clip before applying its Audio Unit.');
    const entry={cancelled:false};pending=entry;
    const check=()=>{if(entry.cancelled||cancelled()){cancelJob(entry);throw new Error('Native effect preparation cancelled.');}};
    try{
      check();
      const response=await request('/api/studio-daw/plugins/render',{id:effect.id,version:effect.version,state:effect.state,parameters:effect.parameters,preparedId:match[1],tailSeconds:0,tempo:tempoContext(clip,project)});
      let job=response.data;
      if(!/^[a-f0-9]{64}$/.test(job.id))throw new Error('Invalid native effect job.');
      entry.id=job.id;entry.created=response.status===202;check();
      const deadline=Date.now()+660000;
      while(job.state!=='ready'){
        if(!['queued','processing'].includes(job.state))throw new Error(job.error||'Native effect processing failed.');
        if(Date.now()>deadline)throw new Error('Native effect processing timed out.');
        await new Promise(resolve=>setTimeout(resolve,250));check();
        job=(await request('/api/studio-daw/plugins/render/'+entry.id)).data;check();
      }
      return '/api/studio-daw/plugins/render/'+entry.id+'/audio';
    }catch(error){cancelJob(entry);throw new Error(`${effect.name}: ${error.message} Retry playback or bypass the Audio Unit in its clip menu.`);}
    finally{if(pending===entry)pending=null;}
  }
  function open(id){
    const p=window.AxiomStudioDaw.activeProject,c=p?.arrangementClips.find(c=>c.id===id);if(!c)return;
    document.getElementById('daw-native-effect-dialog')?.close();
    const before=JSON.stringify(c),controller=new AbortController();let revision=0,loaded=null,catalog=[];
    const current=()=>dialog.isConnected&&p===window.AxiomStudioDaw.activeProject&&p.arrangementClips.find(clip=>clip.id===id)===c&&JSON.stringify(c)===before;
    const dialog=document.createElement('dialog');dialog.id='daw-native-effect-dialog';dialog.className='daw-fx-dialog daw-native-effect-dialog';dialog.setAttribute('aria-label','Audio Unit Effect');
    dialog.innerHTML='<h2>Plugins</h2><p data-clip></p><label>Installed effect<select aria-label="Audio Unit effect"></select></label><label>Bypass<input type="checkbox" aria-label="Bypass Audio Unit" title="Hear the clip without this plugin while keeping its settings."></label><p>Attach one VST3 effect to this clip. AXIOM prepares the processed sound before playback and export. Applying uses Preserve Pitch and the original clip mix.</p><div data-parameters></div><output role="status"></output><footer><button type="button" data-retry>Scan again</button><button type="button" data-remove>Remove</button><button type="button" data-close>Cancel</button><button type="button" data-apply>Attach plugin</button></footer>';
    dialog.querySelector('[data-clip]').textContent=c.title||c.label||'Clip';
    const select=dialog.querySelector('select'),bypass=dialog.querySelector('input'),rows=dialog.querySelector('[data-parameters]'),status=dialog.querySelector('output'),apply=dialog.querySelector('[data-apply]');
    const option=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);};
    option('','Choose effect');if(c.nativeEffect)option(c.nativeEffect.id,c.nativeEffect.name);
    select.value=c.nativeEffect?.id||'';bypass.checked=c.nativeEffect?.enabled===false;
    const update=()=>{apply.disabled=!(loaded||bypass.checked&&c.nativeEffect&&select.value===c.nativeEffect.id);};
    bypass.onchange=update;update();dialog.querySelector('[data-remove]').disabled=!c.nativeEffect;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{revision++;controller.abort();dialog.remove();});
    dialog.addEventListener('keydown',event=>event.stopPropagation());
    dialog.querySelector('[data-remove]').onclick=()=>{if(current()){window.AxiomStudioDaw.setNativeEffect(id,null);dialog.close();}else status.textContent='The clip changed. Close and reopen its controls.';};
    async function load(){
      const token=++revision,chosen=select.value;loaded=null;rows.replaceChildren();update();if(!chosen)return;
      status.textContent='Loading effect...';
      try{
        const entry=catalog.find(p=>p.id===chosen);if(!entry)throw new Error('This Audio Unit is unavailable. Reinstall it, bypass it or remove it.');
        const saved=c.nativeEffect?.id===chosen?c.nativeEffect:null;
        const result=(await request('/api/studio-daw/plugins/inspect',{id:chosen,version:entry.version,...(saved?{state:saved.state,parameters:saved.parameters}:{})},controller.signal)).data;
        if(token!==revision||!current())return;
        loaded={...entry,...result};
        for(const parameter of result.parameters){
          const row=document.createElement('label');row.className='daw-native-parameter';
          const name=document.createElement('span');name.textContent=parameter.name;row.append(name);
          const indexed=parameter.unitCode===1&&parameter.valueStrings?.length===parameter.max-parameter.min+1;
          const input=document.createElement(indexed?'select':'input');
          if(indexed){parameter.valueStrings.forEach((label,i)=>{const option=document.createElement('option');option.value=parameter.min+i;option.textContent=label;input.append(option);});input.value=parameter.value;}
          else if(parameter.unitCode===2){input.type='checkbox';input.checked=parameter.value!==0;}
          else {input.type='number';input.step='any';input.min=parameter.min;input.max=parameter.max;input.value=Number(Number(parameter.value).toPrecision(7));}
          input.disabled=!parameter.writable;input.dataset.address=parameter.address;input.dataset.original=parameter.value;input.setAttribute('aria-label',parameter.name);row.append(input);
          const value=document.createElement('small');value.textContent=parameter.displayValue||String(parameter.value);row.append(value);rows.append(row);
          input.oninput=()=>{input.dataset.changed='true';value.textContent='';};
          input.onchange=input.oninput;
        }
        status.textContent='Ready. Changes are saved with the project; source audio stays unchanged.';update();
      }catch(error){if(token===revision&&dialog.isConnected){status.textContent=error.message;update();}}
    }
    async function scan(){
      const token=++revision;select.disabled=true;status.textContent='Finding installed effects...';
      try{
        const result=(await request('/api/studio-daw/plugins/scan',{},controller.signal)).data;
        if(token!==revision||!current())return;
        catalog=result.plugins.slice().sort((a,b)=>(a.manufacturer+' '+a.name).localeCompare(b.manufacturer+' '+b.name));const chosen=select.value;select.replaceChildren();option('','Choose effect');
        catalog.forEach(p=>option(p.id,`${p.manufacturer}: ${p.name}`));
        if(chosen&&!catalog.some(p=>p.id===chosen))option(chosen,c.nativeEffect?.name||'Unavailable effect');
        if(!catalog.length)select.firstElementChild.textContent='No VST3 plug-ins found';
        select.value=chosen;select.disabled=false;status.textContent=catalog.length?'Choose an effect':'No VST3 plug-ins found in C:\\Program Files\\Common Files\\VST3. Install a VST3 effect plug-in there (or in %LOCALAPPDATA%\\Programs\\Common\\VST3), then press Scan again.';if(chosen)await load();
      }catch(error){if(token===revision&&dialog.isConnected)status.textContent=error.message;}
      finally{if(token===revision)select.disabled=false;}
    }
    select.onchange=load;dialog.querySelector('[data-retry]').onclick=scan;
    apply.onclick=async()=>{
      if(!current()){status.textContent='The clip changed. Close and reopen its controls.';return;}
      if(bypass.checked&&!loaded&&c.nativeEffect&&select.value===c.nativeEffect.id){window.AxiomStudioDaw.setNativeEffect(id,{...c.nativeEffect,enabled:false});dialog.close();return;}
      if(!loaded)return;
      const selected=loaded,token=++revision;apply.disabled=true;status.textContent='Saving effect settings...';
      try{
        const parameters={};for(const input of rows.querySelectorAll('[data-address]:not(:disabled)')){
          if(!input.checkValidity()||input.type==='number'&&!input.value.trim())throw new Error('Enter parameter values within the displayed ranges.');
          parameters[input.dataset.address]=input.dataset.changed==='true'?(input.type==='checkbox'?Number(input.checked):Number(input.value)):Number(input.dataset.original);
        }
        const result=(await request('/api/studio-daw/plugins/inspect',{id:selected.id,version:selected.version,state:selected.state,parameters},controller.signal)).data;
        if(token!==revision||!current())return;
        const effect={format:'AU',id:selected.id,version:selected.version,name:selected.name,enabled:!bypass.checked,state:result.state,parameters};validate(effect);
        if(window.AxiomStudioDaw.setNativeEffect(id,effect))dialog.close();
      }catch(error){if(token===revision&&dialog.isConnected){status.textContent=error.message;update();}}
    };
    document.body.append(dialog);dialog.showModal();scan();
  }
  function openSelected(){
    const clips=window.AxiomStudioDaw.selectedMixerClips||[];
    if(clips.length!==1){window.showToast?.('Select one audio clip on the timeline, then open Plugins.',true);return false;}
    open(clips[0].id);return true;
  }
  window.AxiomNativeEffects={validate,open,openSelected,prepare,cancel,tempoContext};
})();
