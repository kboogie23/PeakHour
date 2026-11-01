(function(){
  'use strict';
  const key='axiom.daw.metronome.v1',sessions=new Set();
  let enabled=false;
  try{enabled=localStorage.getItem(key)==='true';}catch{}
  // Segments use the transport's audio clock, including its output latency.
  function clicks(segments,start,end){
    const result=[];
    for(const s of segments){
      const a=Math.max(s.from,start-s.base+s.from),b=Math.min(s.to,end-s.base+s.from);
      if(b<=a)continue;
      for(let beat=Math.ceil(s.clock.secondsToBeat(a)-1e-8);s.clock.beatToSeconds(beat)<b-1e-8;beat++){
        const when=s.base+s.clock.beatToSeconds(beat)-s.from;
        if(when>=start-1e-8)result.push({when,beat:beat||0});
        if(result.length>1024)throw new Error('Metronome scheduling range is too large.');
      }
    }
    return result;
  }
  function position(segments,time){
    const s=segments.find(s=>time>=s.base&&time<s.base+s.to-s.from);
    return s?s.clock.secondsToBeat(s.from+time-s.base):null;
  }
  function patternPosition(c,beat,preview=false){
    if(!c||c.kind==='midi'||beat===null)return null;
    if(!preview&&(beat<c.startBeat||beat>=c.startBeat+c.durationBeats))return null;
    const source=preview?beat:beat-c.startBeat+(c.offsetBeats||0);
    return (source%c.lengthBeats+c.lengthBeats)%c.lengthBeats;
  }
  function setEnabled(value){
    enabled=Boolean(value);
    try{localStorage.setItem(key,String(enabled));}catch{}
    document.querySelectorAll('[data-daw-metronome]').forEach(input=>{input.checked=enabled;});
    for(const session of sessions)session.resetClicks();
  }
  function mount(host){
    if(!host||host.querySelector('[data-daw-metronome]'))return;
    const label=document.createElement('label');label.className='daw-metronome-toggle';
    label.title='Metronome: monitoring only, never included in exported audio';
    const input=document.createElement('input');input.type='checkbox';input.dataset.dawMetronome='';input.checked=enabled;
    input.onchange=()=>setEnabled(input.checked);label.append(input,document.createTextNode('Metronome'));
    const transport=host.querySelector('.daw-pattern-transport');
    if(transport)transport.after(label);else host.append(label);
  }
  function start(ctx,p,{segments,previewPatternId=null,valid=()=>true}={}){
    if(!ctx||ctx.startRendering)return null;
    const voices=new Set();let through=ctx.currentTime,interval,frame,stopped=false,lastPage=null,lastId=null;
    function clearClicks(){for(const voice of [...voices])voice.dispose();}
    function click(when,beat){
      const oscillator=ctx.createOscillator(),gain=ctx.createGain();
      oscillator.type='sine';oscillator.frequency.value=beat%4===0?1200:800;
      const level=.12*Math.max(0,Math.min(1,Number(document.getElementById('ap-volume')?.value??1)));
      gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(level,when+.002);gain.gain.exponentialRampToValueAtTime(.0001,when+.035);
      // Bypass all project buses and capture taps: this is a monitor, not a clip.
      oscillator.connect(gain).connect(ctx.destination);
      const voice={dispose(){try{oscillator.stop();}catch{}oscillator.disconnect();gain.disconnect();voices.delete(voice);}};
      voices.add(voice);oscillator.onended=()=>voice.dispose();oscillator.start(when);oscillator.stop(when+.04);
    }
    function pump(){
      if(stopped)return;
      if(!valid()||ctx.state==='closed'||ctx.state==='suspended'){stop();return;}
      const spans=segments(),now=ctx.currentTime;
      const until=Math.min(now+.12,Math.max(now,...spans.map(s=>s.base+s.to-s.from)));
      if(enabled)for(const event of clicks(spans,Math.max(now,through),until))click(event.when,event.beat);
      through=until;
    }
    function paint(){
      if(stopped)return;
      const grid=document.querySelector('#studio-daw-step-editor.daw-drum-editor .studio-daw-step-grid');
      if(grid){
        const c=window.AxiomPatterns?.active(p),beat=position(segments(),ctx.currentTime);
        const local=previewPatternId&&c?.id!==previewPatternId?null:patternPosition(c,beat,Boolean(previewPatternId));
        if(local!==null){
          const pageBeats=64*c.lengthBeats/window.AxiomPatterns.stepCount(c),page=Math.floor(local/pageBeats);
          if((lastId!==c.id||lastPage!==page)&&!window.AxiomDrumDraw?.active){lastId=c.id;lastPage=page;window.AxiomStudioDaw.showPatternPage?.(page);}
          const visiblePage=window.AxiomPatterns.page(p,c),fraction=(local-visiblePage*pageBeats)/pageBeats;
          const target=document.querySelector('#studio-daw-step-editor.daw-drum-editor .studio-daw-step-grid');
          if(target){
            let line=target.querySelector('.daw-step-playhead');
            if(!line){line=document.createElement('div');line.className='daw-step-playhead';line.setAttribute('aria-hidden','true');target.append(line);}
            const cells=target.querySelectorAll('.studio-daw-step-cell');
            if(cells.length>=64){
              const bounds=target.getBoundingClientRect(),first=cells[0].getBoundingClientRect(),last=cells[63].getBoundingClientRect();
              line.hidden=fraction<0||fraction>=1;
              line.style.left=`${first.left-bounds.left+target.scrollLeft+fraction*(last.right-first.left)}px`;
              line.dataset.beat=String(local);
            }
          }
        }else grid.querySelector('.daw-step-playhead')?.remove();
      }
      frame=requestAnimationFrame(paint);
    }
    function stop(){
      if(stopped)return;stopped=true;clearInterval(interval);cancelAnimationFrame(frame);clearClicks();sessions.delete(api);
      if(!sessions.size)document.querySelectorAll('.daw-step-playhead').forEach(line=>line.remove());
    }
    const api={pump,stop,resetClicks(){clearClicks();through=ctx.currentTime;pump();},get voiceCount(){return voices.size;}};
    sessions.add(api);interval=setInterval(pump,25);pump();frame=requestAnimationFrame(paint);return api;
  }
  window.AxiomPatternMonitor=Object.freeze({mount,start,clicks,position,patternPosition,setEnabled,get enabled(){return enabled;},stats:()=>({sessions:sessions.size,voices:[...sessions].reduce((n,s)=>n+s.voiceCount,0)})});
  window.addEventListener('pagehide',()=>{for(const session of [...sessions])session.stop();});
})();
