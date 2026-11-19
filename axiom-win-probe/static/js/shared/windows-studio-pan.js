// PEAK HOUR (Windows): a PAN control in the Studio DAW's detailed mixer. Each deck / lane (Left Deck, Right Deck, Samples, FX,
// Recordings, Drums / Instruments) gets one slider, -100 (full left) ... 0 (centre) ... +100 (full right), read out as "L 35",
// "C" or "R 35". Master has none. The value lives next to the deck's volume and mute (project.rowMixer[id].pan), so it is
// saved with the draft and the project file, restored on reload, and undone and redone with the other mixer edits
// (AxiomMixerHistory). A deck without the field is centred, which is how every older project loads. The sound is made by
// transport.js, in live playback and in Export Mix alike; this file only draws and edits the number.
// Keys: Left / Right (or Down / Up) move 1, Shift or Page Up / Page Down move 10, Home and End go full left and full right,
// Delete, Backspace or 0 centre it. Double-click, or Alt-click, also centres it.
(function(){
 'use strict';
 if(!document.body||!document.body.hasAttribute('data-ph-region')&&!(window.__phPanForce&&location.port!=='8080')){
  // windows-regions.js marks <body data-ph-region> a moment after load; wait for it so the macOS edition never shows this.
  const wait=new MutationObserver(()=>{if(document.body?.hasAttribute('data-ph-region')){wait.disconnect();start();}});
  const arm=()=>wait.observe(document.body,{attributes:true,attributeFilter:['data-ph-region']});
  if(document.body)arm();else document.addEventListener('DOMContentLoaded',()=>{if(document.body.hasAttribute('data-ph-region'))start();else arm();});
  return;
 }
 start();

 function start(){
  if(window.AxiomWindowsPan)return;
  const clamp=v=>Math.max(-100,Math.min(100,Math.round(v)));
  const describe=v=>v===0?'C':(v<0?'L ':'R ')+Math.abs(v);
  const api=()=>window.AxiomStudioDaw;
  let row=null,input=null,output=null,label=null;

  function current(){
   const a=api(),p=a?.activeProject,id=a?.expandedSection;
   return p&&id&&id!=='master'?{p,id}:null;
  }
  function stored(p,id){const v=Number(p.rowMixer?.[id]?.pan);return Number.isFinite(v)?clamp(v):0;}

  function sync(){
   if(!row)return;
   const now=current();
   row.hidden=!now;input.disabled=!now;
   if(!now)return;
   const v=stored(now.p,now.id),text=describe(v);
   input.value=String(v);
   input.setAttribute('aria-valuenow',String(v));input.setAttribute('aria-valuetext',text);
   input.setAttribute('aria-label','Pan '+(document.querySelector('#daw-mixer-detail-panel .daw-mixer-target option:checked')?.textContent||now.id));
   output.textContent=text;
   row.style.setProperty('--ph-pan',String(v));
  }

  function set(value){
   const now=current();
   if(!now||!Number.isFinite(value))return false;
   const v=clamp(value);
   if(stored(now.p,now.id)===v){sync();return true;}
   now.p.rowMixer||={};now.p.rowMixer[now.id]||={volume:1,muted:false};
   window.AxiomMixerHistory?.write(now.p,[{scope:'mix',id:now.id}],'pan',v);
   window.AxiomArrangement?.mixerChanged(now.p);
   sync();
   return true;
  }
  function reset(){window.AxiomMixerHistory?.finish();set(0);}

  function build(panel){
   const section=panel.querySelector('[data-mixer-detail-scope="mix"]'),anchor=section?.querySelector('.daw-fader-control');
   if(!section||!anchor)return false;
   row=document.createElement('div');
   row.className='ph-pan';row.hidden=true;row.dataset.phPan='';
   row.innerHTML='<label class="ph-pan-label" for="ph-pan-slider">PAN</label>'
    +'<input id="ph-pan-slider" class="ph-pan-slider" type="range" role="slider" min="-100" max="100" step="1" value="0" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="C" aria-label="Pan" title="Pan: drag to adjust, double-click or Alt-click to centre">'
    +'<output class="ph-pan-readout" for="ph-pan-slider">C</output>';
   section.insertBefore(row,anchor);
   input=row.querySelector('input');output=row.querySelector('output');label=row.querySelector('label');
   input.addEventListener('input',()=>set(Number(input.value)));
   input.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(event.altKey){event.preventDefault();reset();return;}
    const now=current();if(now)window.AxiomMixerHistory?.begin(now.p);
   });
   input.addEventListener('change',()=>window.AxiomMixerHistory?.finish());
   input.addEventListener('blur',()=>window.AxiomMixerHistory?.finish());
   input.addEventListener('pointercancel',()=>{window.AxiomMixerHistory?.finish(true);const now=current();if(now)window.AxiomArrangement?.mixerChanged(now.p);sync();});
   input.addEventListener('dblclick',event=>{event.preventDefault();reset();});
   input.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const big=event.shiftKey?10:1,now=Number(input.value);
    const next={ArrowRight:now+big,ArrowUp:now+big,ArrowLeft:now-big,ArrowDown:now-big,PageUp:now+10,PageDown:now-10,Home:-100,End:100,Delete:0,Backspace:0,'0':0}[event.key];
    if(next===undefined)return;
    event.preventDefault();event.stopPropagation();set(next);
   });
   // composer.js rewrites the label under the mixer strip on every refresh (channel change, undo, project switch, edits)
   const strips=document.querySelector('.studio-daw-mixer-strips');
   if(strips)new MutationObserver(sync).observe(strips,{childList:true,subtree:true,characterData:true});
   panel.querySelector('.daw-mixer-target')?.addEventListener('change',()=>setTimeout(sync,0));
   sync();
   return true;
  }

  window.AxiomWindowsPan={set,get:()=>{const n=current();return n?stored(n.p,n.id):null;},sync,describe};

  // The DAW builds its mixer when it starts; wait for it if this file ran first.
  const tryBuild=()=>{const panel=document.getElementById('daw-mixer-detail-panel');return panel?build(panel):false;};
  if(!tryBuild()){
   const find=new MutationObserver(()=>{if(tryBuild())find.disconnect();});
   find.observe(document.documentElement,{childList:true,subtree:true});
  }
 }
})();
