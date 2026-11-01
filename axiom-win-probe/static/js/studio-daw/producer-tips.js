(function(){
  'use strict';
  const key='axiom.producer-tips.v1',states=new WeakMap();
  let enabled=true,lastShown=-Infinity,hotSince=null,meterProject=null,visibleProject=null;
  try{enabled=localStorage.getItem(key)!=='off';}catch(_){}
  const project=()=>window.AxiomStudioDaw?.activeProject;
  function state(p){if(!states.has(p))states.set(p,{baseline:null,shown:new Set()});return states.get(p);}
  function dismiss(){document.getElementById('daw-producer-tip')?.remove();}
  function setEnabled(value){
    enabled=Boolean(value);hotSince=null;
    try{localStorage.setItem(key,enabled?'on':'off');}catch(_){}
    document.querySelectorAll('[data-producer-tips-toggle]').forEach(input=>{input.checked=enabled;});
    if(!enabled)dismiss();
  }
  function overlap(a,b){return a.startBeat<b.startBeat+b.durationBeats&&b.startBeat<a.startBeat+a.durationBeats;}
  function rules(p){
    const rows=p.rowMixer||{},clips=p.arrangementClips||[],solo=Object.values(rows).some(r=>r.solo)||clips.some(c=>c.mixSolo);
    const audible=c=>!c.muted&&!c.mixMuted&&(c.mixVolume??1)>0&&!rows[c.sectionId]?.muted&&(rows[c.sectionId]?.volume??1)>0&&(!solo||rows[c.sectionId]?.solo||c.mixSolo);
    const events=clips.filter(c=>audible(c)&&c.timelineDurationBeats>0).flatMap(c=>[[c.timelineStartBeat,1],[c.timelineStartBeat+c.timelineDurationBeats,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let count=0,maximum=0;for(const [,delta] of events){count+=delta;maximum=Math.max(maximum,count);}
    const result=[];
    if(maximum>=3)result.push('layers');
    if(audible({sectionId:'instruments'})&&p.drumSamples?.Kick?.path){
      const patterns=(p.patternClips||[]).filter(c=>!c.muted&&(c.velocity??1)>0&&(c.probability??1)>0);
      const kicks=patterns.filter(c=>c.kind!=='midi'&&c.steps?.Kick?.length).sort((a,b)=>a.startBeat-b.startBeat);
      const bass=patterns.filter(c=>c.kind==='midi'&&c.sound==='bass'&&c.notes?.some(n=>n.velocity>0)).sort((a,b)=>a.startBeat-b.startBeat);
      let i=0,j=0;
      while(i<kicks.length&&j<bass.length){
        if(overlap(kicks[i],bass[j])){result.push('kick-bass');break;}
        if(kicks[i].startBeat+kicks[i].durationBeats<=bass[j].startBeat)i++;else j++;
      }
    }
    return result;
  }
  const copy={
    clipping:{title:'Master reached 0 dBFS',body:'The measured output is reaching digital full scale. Lower overlapping clip levels first, then review the master limiter.',action:'Review limiter'},
    layers:{title:'Check your headroom',body:'Three or more audio clips overlap. Listen to their combined level before adding gain; overlap alone does not mean the mix is clipping.',action:'Review limiter'},
    'kick-bass':{title:'Give kick and bass some room',body:'Kick and bass patterns overlap on Drums / Instruments. Try reducing bass velocity. To sidechain bass separately, it needs its own audio lane.'}
  };
  function show(p,id,now=performance.now()){
    const s=state(p);
    if(!enabled||p!==project()||s.shown.has(id)||window.AxiomDawTimelineRecording?.active||!document.body.classList.contains('studio-daw-mode-active')||document.querySelector('dialog[open]'))return false;
    if(id!=='clipping'&&(now-lastShown<45000||document.getElementById('daw-producer-tip')))return false;
    dismiss();visibleProject=p;
    const content=copy[id],panel=document.createElement('section');panel.id='daw-producer-tip';panel.setAttribute('aria-label','Producer tip');
    panel.innerHTML='<header><strong></strong><button aria-label="Dismiss producer tip" title="Dismiss"><img src="/static/icons/x.svg" alt=""></button></header><p role="status"></p><footer></footer>';
    panel.querySelector('strong').textContent=content.title;panel.querySelector('p').textContent=content.body;
    panel.querySelector('header button').onclick=dismiss;
    const footer=panel.querySelector('footer');
    if(content.action){const action=document.createElement('button');action.textContent=content.action;action.onclick=()=>{dismiss();if(p===project())window.AxiomMasterLimiter?.open();};footer.append(action);}
    footer.append(toggle());document.body.append(panel);s.shown.add(id);lastShown=now;return true;
  }
  function toggle(){
    const label=document.createElement('label');label.className='daw-producer-toggle';
    const input=document.createElement('input');input.type='checkbox';input.dataset.producerTipsToggle='';input.checked=enabled;input.onchange=()=>setEnabled(input.checked);
    label.append(input,document.createTextNode('Producer Tips'));return label;
  }
  function mount(head){
    if(head.querySelector('[data-producer-tips-toggle]'))return;
    const actions=document.createElement('div');actions.className='daw-production-controls';
    const fx=document.createElement('button');fx.type='button';fx.title='Drums / Instruments effects';fx.setAttribute('aria-label',fx.title);fx.innerHTML='<img src="/static/icons/sliders-horizontal.svg" alt="">';
    fx.onclick=()=>{const p=project();if(!p)return;const pattern=window.AxiomPatterns?.active(p);window.AxiomDawFx?.edit(null,{target:'instruments',startBeat:pattern?.startBeat??p.editCursorBeat??0,durationBeats:Math.min(1024,pattern?.durationBeats||4)});};
    actions.append(fx,toggle());head.append(actions);
  }
  function consider(p){
    if(!p)return;
    const s=state(p),next=rules(p),previous=s.baseline;s.baseline=next;
    if(visibleProject&&visibleProject!==p)dismiss();
    if(previous)for(const id of next)if(!previous.includes(id)&&show(p,id))break;
  }
  function observeMaster(p,peak,now=performance.now()){
    if(p!==meterProject){meterProject=p;hotSince=null;dismiss();}
    if(!enabled||!p||!Number.isFinite(peak)||peak<1){hotSince=null;return;}
    hotSince??=now;
    if(now-hotSince>=250)show(p,'clipping',now);
  }
  window.addEventListener('pagehide',dismiss);
  window.AxiomProducerTips={rules,consider,observeMaster,mount,setEnabled,dismiss,get enabled(){return enabled;}};
})();
