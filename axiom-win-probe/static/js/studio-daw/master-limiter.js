(function(){
  'use strict';
  const defaults={enabled:false,amount:0,ceilingDb:-1,releaseMs:100};
  const graphs=new WeakMap();
  let dialog=null,dialogProject=null;
  function validate(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean')throw new Error('Invalid master limiter settings.');
    for(const [key,min,max] of [['amount',0,100],['ceilingDb',-12,0],['releaseMs',10,1000]])if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)throw new Error('Invalid master limiter '+key+'.');
    return value;
  }
  const settings=p=>p.masterMixer?.limiter||defaults;
  // Amount is input drive, not a wet/dry mix: the ceiling remains protected.
  const driveDb=value=>value.amount*.12;
  function display(meters=null){
    if(!dialog?.open)return;
    const playing=window.AxiomArrangement?.playing&&!window.AxiomArrangement?.rendering;
    const value=playing&&settings(dialogProject).enabled?meters:null;
    for(const [key,label] of [['inputPeak','Input'],['reductionDb','Reduction'],['outputPeak','Output']]){
      const db=value?(key==='reductionDb'?value[key]:20*Math.log10(Math.max(1e-9,value[key]))):key==='reductionDb'?0:-Infinity;
      const node=dialog.querySelector(`[data-meter="${key}"]`);node.value=key==='reductionDb'?Math.min(24,db):Math.max(-60,db);
      node.nextElementSibling.textContent=Number.isFinite(db)?db.toFixed(1)+' dB':'—';
      node.title=label+': '+node.nextElementSibling.textContent;
    }
  }
  function clear(ctx){graphs.delete(ctx);display();}
  function connect(ctx,input,own,p,updates,preview,onerror){
    validate(settings(p));
    const node=own(new AudioWorkletNode(ctx,'axiom-dj-dynamics',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{mode:'limiter',meter:preview}}));
    let active=true;
    const stop=node.stop?.bind(node);node.stop=()=>{active=false;node.port.onmessage=null;node.port.close();stop?.();};
    graphs.set(ctx,node);
    node.onprocessorerror=onerror;
    node.port.onmessage=event=>{if(active&&graphs.get(ctx)===node&&dialogProject===p)display(event.data);};
    const apply=(initial=false)=>{
      const s=validate(settings(p));
      for(const [name,value] of [['driveDb',driveDb(s)],['ceilingDb',s.ceilingDb],['limiterReleaseMs',s.releaseMs],['limiterEnabled',s.enabled?1:0]]){
        const param=node.parameters.get(name);param.cancelScheduledValues(ctx.currentTime);
        if(initial||name==='limiterEnabled')param.setValueAtTime(value,ctx.currentTime);
        else param.setTargetAtTime(value,ctx.currentTime,.01);
      }
    };
    apply(true);updates.push(()=>apply());input.connect(node);return node;
  }
  function refresh(){
    const p=window.AxiomStudioDaw?.activeProject,button=document.getElementById('daw-master-limiter');
    if(button){button.dataset.enabled=String(Boolean(p&&settings(p).enabled));button.textContent=p&&settings(p).enabled?'Master Limiter · On':'Master Limiter';}
    if(!dialog?.open)return;
    if(p!==dialogProject){dialog.close();return;}
    const s=settings(p);dialog.querySelector('[name="enabled"]').checked=s.enabled;
    for(const key of ['amount','ceilingDb','releaseMs']){const field=dialog.querySelector(`[name="${key}"]`);if(document.activeElement!==field)field.value=s[key];}
    dialog.querySelector('[data-amount-value]').textContent=Math.round(s.amount)+'%';
    dialog.querySelector('[data-drive-value]').textContent='+'+driveDb(s).toFixed(1)+' dB gain';
    dialog.querySelector('[name="amount"]').style.setProperty('--amount-angle',(-135+s.amount*2.7)+'deg');
    dialog.querySelector('[name="amount"]').setAttribute('aria-valuenow',String(s.amount));
    display();
  }
  function change(key,value){
    const p=dialogProject;if(!p||p!==window.AxiomStudioDaw?.activeProject||window.AxiomArrangement?.rendering)return false;
    const next=validate({...settings(p),[key]:value});p.masterMixer||={volume:1,muted:false};
    window.AxiomMixerHistory.write(p,[{scope:'mix',id:'master'}],'limiter',next);
    window.AxiomArrangement?.mixerChanged(p);window.AxiomDawDrafts?.checkpoint();refresh();return true;
  }
  function open(){
    const p=window.AxiomStudioDaw?.activeProject;if(!p)return;
    if(window.AxiomArrangement?.rendering){window.showToast?.('Wait for export to finish before changing the master limiter.');return;}
    if(dialog?.open){dialog.focus();return;}
    dialogProject=p;dialog=document.createElement('dialog');dialog.id='daw-master-limiter-dialog';dialog.className='daw-fx-dialog';dialog.setAttribute('aria-labelledby','daw-master-limiter-title');
    dialog.innerHTML=`<h2 id="daw-master-limiter-title">Master Limiter</h2><p class="daw-limiter-help">Turn up Amount for a fuller, louder mix. Peaks stay under the ceiling.</p>
      <label class="daw-limiter-enable">Limiter on <input name="enabled" type="checkbox" aria-label="Enable master limiter"></label>
      <div class="daw-limiter-amount"><button name="amount" type="button" role="slider" aria-label="Limiter Amount" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></button><div><strong>Amount</strong><output data-amount-value>0%</output><small data-drive-value>+0.0 dB gain</small></div></div>
      <div class="daw-limiter-meters">${[['inputPeak','Input',-60,0],['reductionDb','Reduction',0,24],['outputPeak','Output',-60,0]].map(([key,label,min,max])=>`<div><span>${label}</span><meter data-meter="${key}" aria-label="Limiter ${label}" min="${min}" max="${max}" value="${min}"></meter><output>—</output></div>`).join('')}</div>
      <details><summary>Advanced</summary><label>Output ceiling (dB)<input name="ceilingDb" aria-label="Limiter output ceiling" type="number" min="-12" max="0" step="0.1"></label><label>Release (ms)<input name="releaseMs" aria-label="Limiter release" type="number" min="10" max="1000" step="1"></label><p class="daw-limiter-help">Applies to the entire mix, after master gain and EQ, in playback and export. Sample-peak limiting.</p></details><footer><button data-preview type="button">Play / Pause</button><button data-close type="button">Done</button></footer>`;
    const amount=dialog.querySelector('[name="amount"]');
    const setAmount=value=>{value=Math.max(0,Math.min(100,Math.round(value)));if(change('amount',value))amount.setAttribute('aria-valuenow',String(value));};
    amount.onkeydown=e=>{let value=settings(p).amount;if(e.key==='Home')value=0;else if(e.key==='End')value=100;else if(['ArrowUp','ArrowRight'].includes(e.key))value+=e.shiftKey?10:1;else if(['ArrowDown','ArrowLeft'].includes(e.key))value-=e.shiftKey?10:1;else return;e.preventDefault();e.stopPropagation();setAmount(value);};
    amount.onpointerdown=e=>{
      if(e.button!==0)return;e.preventDefault();amount.focus();const y=e.clientY,start=settings(p).amount;amount.setPointerCapture(e.pointerId);window.AxiomMixerHistory.begin(p);
      amount.onpointermove=event=>setAmount(start+(y-event.clientY)*.5);
      const finish=event=>{amount.onpointermove=null;amount.onpointerup=null;amount.onpointercancel=null;window.AxiomMixerHistory.finish(event.type==='pointercancel');window.AxiomArrangement?.mixerChanged(p);window.AxiomDawDrafts?.checkpoint();refresh();};
      amount.onpointerup=finish;amount.onpointercancel=finish;
    };
    dialog.querySelector('[name="enabled"]').onchange=e=>change('enabled',e.target.checked);
    for(const key of ['ceilingDb','releaseMs'])dialog.querySelector(`[name="${key}"]`).onchange=e=>{if(!e.target.checkValidity()){e.target.reportValidity();e.target.value=settings(p)[key];return;}change(key,Number(e.target.value));};
    dialog.querySelector('[data-preview]').onclick=()=>window.AxiomArrangement?.toggle(p);
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    const instance=dialog;instance.onclose=()=>{window.AxiomMixerHistory.finish();instance.remove();if(dialog===instance){dialog=null;dialogProject=null;}};
    document.body.append(dialog);dialog.showModal();refresh();amount.setAttribute('aria-valuenow',String(settings(p).amount));
  }
  function mount(controls){
    if(controls&&!document.getElementById('daw-master-limiter')){const button=document.createElement('button');button.id='daw-master-limiter';button.type='button';button.onclick=open;button.title='Master loudness and peak control';controls.append(button);}refresh();
  }
  window.AxiomMasterLimiter={validate,settings,driveDb,connect,clear,mount,refresh,open};
})();
