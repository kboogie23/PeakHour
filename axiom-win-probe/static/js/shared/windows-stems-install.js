// "Install stem engine" (Windows): Studio's Stems need a one-time engine download (PyTorch, Demucs, the separation model),
// which is not part of the PEAK HOUR installer. When a stems request answers stem_runtime_missing / stem_model_missing,
// studio-daw/stems.js calls AxiomStemInstall.ensure(answer): this shows what will be downloaded, installs it with a real
// progress bar (Cancel, and Retry after an error; a retry continues where it stopped) and resolves true once the engine
// is ready so the stems action the user asked for runs again by itself.
(function(){
 'use strict';
 const API='/api/windows/stem-engine/';
 const toast=(text,bad)=>window.showToast?.(text,bad);
 function el(tag,text,props){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(props)Object.assign(e,props);return e;}
 async function call(path,method,body){
  const response=await fetch(API+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.success===false)throw new Error(data.error||'The stem engine installer is not available.');
  return data;
 }
 const sources=list=>(list&&list.length?list:['download.pytorch.org','pypi.org','files.pythonhosted.org','dl.fbaipublicfiles.com']).join(', ');
 let pending=null;
 function ensure(){
  if(pending)return pending;
  pending=run().finally(()=>{pending=null;});
  return pending;
 }
 async function run(){
  let status;
  try{status=await call('status','GET');}catch(error){toast(error.message,true);return false;}
  if(status.ready)return true;
  document.getElementById('axiom-stem-install')?.remove();
  return new Promise(resolve=>{
   const box=el('dialog',undefined,{id:'axiom-stem-install',className:'axiom-vdj-inspect axiom-stem-install'});
   box.setAttribute('aria-labelledby','axiom-stem-install-title');
   const title=el('h2','Install stem engine',{id:'axiom-stem-install-title'});
   const intro=el('p','Stems split a song into vocals, melody, bass and drums. PEAK HOUR needs a one-time engine for that. '+
    'It is not part of the PEAK HOUR installer, so it is downloaded once and kept on this PC.');
   const what=el('ul',undefined,{className:'axiom-stem-install-list'});
   const facts=el('p',undefined,{className:'axiom-stem-install-facts'});
   const bar=el('div',undefined,{className:'axiom-stem-bar'});
   bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');
   const fill=el('i');bar.append(fill);
   const phase=el('div',undefined,{className:'axiom-stem-phase'});
   phase.setAttribute('role','status');phase.setAttribute('aria-live','polite');
   const problem=el('div',undefined,{className:'axiom-stem-error'});problem.setAttribute('role','alert');
   const closeButton=el('button','Not now',{type:'button'});
   const installButton=el('button','Install',{type:'button',id:'axiom-stem-install-go'});
   const cancelButton=el('button','Cancel install',{type:'button',id:'axiom-stem-install-cancel'});
   const actions=el('div',undefined,{className:'axiom-vdj-actions'});
   actions.append(closeButton,cancelButton,installButton);
   box.append(title,intro,what,facts,bar,phase,problem,actions);
   document.body.append(box);
   let timer=null,finished=false,view='idle',gpuChecking=false;
   const finish=ok=>{if(finished)return;finished=true;clearInterval(timer);if(box.open)box.close();box.remove();resolve(ok);};
   function describe(s){
    what.replaceChildren();
    const gpu=s.flavour==='cuda';
    if(!s.runtime_ready&&s.gpu_checking){
     what.append(el('li','Checking this PC for an NVIDIA graphics card (a few seconds).'));  // never guess the build before it is known
    }else if(!s.runtime_ready){
     what.append(el('li',gpu?`PyTorch with NVIDIA GPU support (CUDA 12.4)${s.gpu?' for your '+s.gpu:''}: stems separate in seconds.`
      :'PyTorch for the CPU (no NVIDIA GPU was found): stems separate more slowly, about a minute for a short clip.'));
     what.append(el('li','Demucs 4.0.1 and the small audio libraries it needs.'));
    }
    if(!s.model_ready)what.append(el('li','The separation model (htdemucs, 84 MB), checked against its official checksum.'));
    facts.textContent=`Download: about ${s.download_text}. Disk space needed while installing: about ${s.disk_text}. `+
     `From: ${sources(s.sources)}. Nothing from your music leaves this PC.`;
   }
   function show(s){
    describe(s);
    const running=s.state==='running'||s.state==='cancelling';
    const percent=Math.max(0,Math.min(100,Number(s.percent)||0));
    bar.hidden=!running;fill.style.width=percent+'%';bar.setAttribute('aria-valuenow',String(percent));
    phase.textContent=running?`${s.detail||'Working...'} (${percent}%)${s.notice?' '+s.notice:''}`:s.state==='cancelled'?s.detail:s.notice||'';
    problem.textContent=s.state==='failed'?s.error||'The install failed.':'';
    installButton.hidden=running||s.state==='done';
    gpuChecking=Boolean(s.gpu_checking&&!s.runtime_ready&&!running);installButton.disabled=gpuChecking;if(gpuChecking)watch();
    installButton.textContent=s.state==='failed'?'Retry':s.state==='cancelled'||s.resumable?'Continue install':'Install';
    cancelButton.hidden=!running;cancelButton.disabled=s.state==='cancelling';
    closeButton.hidden=running;closeButton.textContent=s.state==='failed'||s.state==='cancelled'?'Close':'Not now';
    view=s.state;
    if(s.state==='done'&&s.ready){toast('Stem engine installed. Starting your stems.');finish(true);}
   }
   async function poll(){
    try{
     const s=await call('status','GET');show(s);
     if(s.running||s.state==='running'||s.state==='cancelling'||(s.gpu_checking&&!s.runtime_ready))return;
     clearInterval(timer);timer=null;
    }catch(error){problem.textContent=error.message;}
   }
   const watch=()=>{if(!timer)timer=setInterval(poll,700);};
   installButton.onclick=async()=>{
    installButton.disabled=true;problem.textContent='';
    try{show(await call('install','POST',{}));watch();}catch(error){problem.textContent=error.message;}
    installButton.disabled=gpuChecking;
   };
   cancelButton.onclick=async()=>{cancelButton.disabled=true;try{show(await call('cancel','POST',{}));watch();}catch(error){problem.textContent=error.message;}};
   closeButton.onclick=()=>finish(false);
   box.addEventListener('cancel',event=>{if(view==='running'||view==='cancelling')event.preventDefault();else finish(false);});
   show(status);
   box.showModal();
   if(status.state==='running'||status.state==='cancelling')watch();
   else installButton.focus();
  });
 }
 window.AxiomStemInstall=Object.freeze({ensure,open:ensure});
})();
