// PEAK HOUR (Windows): plain reasons when the Studio DAW cannot open an audio input.
// Edge's own errors are terse or empty ("Permission denied"; an unplugged saved input gives an EMPTY message, which showed
// as a blank toast). Every getUserMedia({audio}) failure is re-thrown with a sentence that says what to do on Windows.
// Recording itself needs no change at 44.1 kHz devices: the Studio DAW opens its capture AudioContext at 48 kHz explicitly,
// and Edge resamples the input into it (checked in test_windows_studio_recording.py with a 44.1 kHz source).
(function(){
 'use strict';
 const media=navigator.mediaDevices;
 if(!media||typeof media.getUserMedia!=='function'||media.getUserMedia.phFriendly)return;
 const original=media.getUserMedia.bind(media);
 const SETTINGS='Open Windows Settings > Privacy & security > Microphone, turn on "Microphone access" and "Let desktop apps access your microphone", then try again.';
 function friendly(error){
  const name=error&&error.name||'';
  let message='';
  if(name==='NotAllowedError'||name==='SecurityError')message='PEAK HOUR is not allowed to use the microphone or audio input. '+SETTINGS;
  else if(name==='NotFoundError'||name==='DevicesNotFoundError')message='No microphone or audio input was found. Plug in your mixer, controller or microphone (and switch on its USB audio), check Windows Settings > System > Sound > Input, then choose Find audio inputs again.';
  else if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError')message='The chosen audio input is not connected any more, or Windows has renamed it. Choose it again from the list (Find audio inputs) or pick another input.';
  else if(name==='NotReadableError'||name==='TrackStartError'||name==='AbortError')message='The audio input could not be opened. Another program may be using it exclusively (a DJ program, a call or a recorder). Close it and try again.';
  else if(!(error&&error.message))message='The audio input could not be opened.';
  if(!message)return error;
  const friendlyError=new Error(message);
  friendlyError.name=name||'Error';
  friendlyError.cause=error;
  return friendlyError;
 }
 const wrapped=function(constraints){
  const result=original(constraints);
  return constraints&&constraints.audio?result.catch(error=>{throw friendly(error);}):result;
 };
 wrapped.phFriendly=true;
 media.getUserMedia=wrapped;
})();
