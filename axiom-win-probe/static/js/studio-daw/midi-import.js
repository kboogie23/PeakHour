(function(){
  'use strict';
  function open(){
    if(document.getElementById('daw-midi-import'))return;
    const p=window.AxiomStudioDaw.activeProject;if(!p)return;
    const dialog=document.createElement('dialog');dialog.id='daw-midi-import';dialog.setAttribute('aria-label','Import MIDI notes');dialog.style.cssText='background:#191c19;color:#eee;border:1px solid #525852;padding:18px;width:380px;max-width:90vw';
    dialog.innerHTML='<form><h3>Import MIDI Notes</h3><label>MIDI file <input type="file" accept=".mid,.midi" required></label><label>Track <select data-track disabled></select></label><label>Start bar <input data-start type="number" min="1" step="0.0625" required></label><label>Sound <select data-sound></select></label><output role="status"></output><button data-import type="submit" disabled>Import</button><button data-cancel type="button">Cancel</button></form>';
    for(const label of dialog.querySelectorAll('label'))label.style.cssText='display:block;margin:12px 0';
    for(const control of dialog.querySelectorAll('input,select,button'))control.style.cssText='max-width:100%;background:#252925;color:#eee;margin:4px;padding:5px';
    const file=dialog.querySelector('[type=file]'),track=dialog.querySelector('[data-track]'),start=dialog.querySelector('[data-start]'),sound=dialog.querySelector('[data-sound]'),status=dialog.querySelector('output'),submit=dialog.querySelector('[data-import]');
    const bendLabel=document.createElement('label');bendLabel.textContent='Pitch bend range (semitones) ';bendLabel.style.cssText='display:block;margin:12px 0';
    const bend=document.createElement('input');bend.type='number';bend.min='1';bend.max='24';bend.step='1';bend.value='2';bend.required=true;bend.style.cssText='max-width:100%;background:#252925;color:#eee;margin:4px;padding:5px';bendLabel.append(bend);status.before(bendLabel);
    start.value=String(Math.max(0,p.editCursorBeat||0)/4+1);status.style.display='block';
    for(const [key,s] of Object.entries(window.AxiomInstruments.sounds))sound.add(new Option(s.name,key));
    let worker=null,timer=null,parsed=null,generation=0,filename='';
    const stop=()=>{worker?.terminate();worker=null;clearTimeout(timer);timer=null;};
    const close=()=>{generation++;stop();dialog.remove();};
    dialog.querySelector('[data-cancel]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
    track.onchange=()=>{
      const t=parsed?.tracks[Number(track.value)];submit.disabled=!t||!!t.reason;if(!t)return;sound.value=t.sound;
      status.textContent=t.reason||`${t.notes.length} notes / ${t.lengthBeats/4} bars / ${t.midiControls.length} controls / ${t.sustained} sustained. Project tempo. ${t.controllers} controller events and ${t.pitchBends} pitch bends excluded.`;
    };
    file.onchange=async()=>{
      const version=++generation;stop();parsed=null;submit.disabled=true;track.disabled=true;track.replaceChildren();const selected=file.files[0];if(!selected)return;
      if(!/\.midi?$/i.test(selected.name)||selected.size>2*1024*1024){status.textContent='Choose a MIDI file no larger than 2 MB.';return;}
      filename=selected.name;status.textContent='Reading MIDI notes...';
      try{
        const buffer=await selected.arrayBuffer();if(version!==generation||!dialog.isConnected)return;
        worker=new Worker('/static/js/studio-daw/midi-worker.js?v=1');
        timer=setTimeout(()=>{stop();status.textContent='MIDI parsing timed out. Choose a smaller file.';},10000);
        worker.onerror=()=>{stop();status.textContent='Could not read MIDI file.';};
        worker.onmessage=e=>{
          stop();if(version!==generation||!dialog.isConnected)return;
          if(e.data.error){status.textContent=e.data.error;return;}parsed=e.data;
          parsed.tracks.forEach((t,i)=>track.add(new Option(t.name+(t.reason?' (unavailable)':''),String(i))));
          track.disabled=false;track.value=String(Math.max(0,parsed.tracks.findIndex(t=>!t.reason)));track.onchange();
        };
        worker.postMessage(buffer,[buffer]);
      }catch(error){stop();if(version===generation)status.textContent=error.message;}
    };
    dialog.querySelector('form').onsubmit=e=>{
      e.preventDefault();const t=parsed?.tracks[Number(track.value)],beat=(Number(start.value)-1)*4;
      if(p!==window.AxiomStudioDaw.activeProject){status.textContent='The project changed. Reopen MIDI import.';return;}
      if(!t||t.reason||!Number.isFinite(beat)||beat<0||start.value==='')return;
      if(!bend.value.trim()||!Number.isInteger(Number(bend.value))||Number(bend.value)<1||Number(bend.value)>24){status.textContent='Pitch bend range must be an integer from 1 to 24 semitones.';return;}
      const clip={id:crypto.randomUUID(),kind:'midi',name:t.name,startBeat:beat,durationBeats:t.lengthBeats,lengthBeats:t.lengthBeats,steps:{},sound:sound.value,notes:t.notes,midiControls:t.midiControls.map(point=>({...point,value:point.kind==='pitch'?point.value*Number(bend.value)/2:point.value})),midiImport:{filename,ppq:parsed.ppq,program:t.program,tempo:'project',pitchBendRange:Number(bend.value),excludedControllers:t.controllers,excludedPitchBends:t.pitchBends}};
      clip.midiImport.sustainedNotes=t.sustained;
      if(window.AxiomStudioDaw.importPattern(clip)){close();}else status.textContent='MIDI notes could not be added.';
    };
    document.body.append(dialog);dialog.showModal();
  }
  window.AxiomMidiImport={open};
})();
