// Studio DAW's native save bridge on Windows.
// The Mac app receives mixExport* messages through WKWebView
// (window.webkit.messageHandlers.axiomNative) and answers through
// window.__AXIOM_MIX_EXPORT_RESULT. Studio's export.js also looks for this
// object, which forwards only those messages to the local AXIOM engine
// (windows_mix_export.py): Save As dialog, WAV/MP3 file, verified receipt.
(function(){
  'use strict';
  const actions=new Set(['mixExportSupport','mixExportChoose','mixExportStart','mixExportBegin','mixExportChunk','mixExportFinish','mixExportCancel']);
  function reply(requestId,payload){setTimeout(()=>window.__AXIOM_MIX_EXPORT_RESULT?.(requestId,payload),0);}
  window.AxiomWindowsMixExport={
    postMessage(message){
      const {action,requestId,...data}=message||{};
      if(!actions.has(action)){reply(requestId,{success:false,error:'This save action is not available on Windows.'});return;}
      fetch('/api/windows/mix-export/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(response=>response.json())
        .then(payload=>reply(requestId,payload),error=>reply(requestId,{success:false,error:'The local AXIOM engine did not answer: '+error.message}));
    }
  };
})();
