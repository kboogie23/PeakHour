import Rubberband from '../../vendor/rubberband-wasm-0.2.0/rubberband.mjs';
import {stretch,validate,encodeWav} from './stretch-engine.mjs';
let running=false;
self.onmessage=async event=>{
  if(running){self.postMessage({error:'Stretch worker is already processing audio.'});return;}
  running=true;
  try{
    const {channels,plan}=event.data;validate(channels,plan);
    const module=await Rubberband();
    const result=stretch(module,channels,plan,progress=>self.postMessage({progress}));
    const buffer=encodeWav(result.channels);
    self.postMessage({buffer,frames:result.frames,sampleRate:result.sampleRate,engine:result.engine},[buffer]);
  }catch(error){self.postMessage({error:error.message||'Pitch-preserving processing failed.'});}
  finally{self.close();}
};
