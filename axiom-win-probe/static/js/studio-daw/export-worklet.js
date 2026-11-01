class AxiomExportCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.start=null;this.end=null;this.frames=0;this.used=0;this.pending=0;this.done=false;this.block=new Float32Array(16384);
    this.port.onmessage=({data})=>{
      if(data?.type==='ack'){if(this.pending>0)this.pending--;}
      if(data?.type==='arm'&&this.start===null){
        if(!Number.isSafeInteger(data.start)||!Number.isSafeInteger(data.end)||data.start<currentFrame||data.end<=data.start){this.fail('Export missed its scheduled start.');return;}
        this.start=data.start;this.end=data.end;
      }
    };
  }
  fail(message){if(this.done)return;this.done=true;this.port.postMessage({type:'error',message});}
  flush(){
    if(!this.used)return;
    if(this.pending>=32){this.fail('Export storage fell behind. The incomplete file was discarded.');return;}
    const samples=this.block.slice(0,this.used*2);this.pending++;
    this.port.postMessage({type:'samples',offset:this.frames-this.used,samples},[samples.buffer]);this.used=0;
  }
  process(inputs,outputs){
    for(const channel of outputs[0]||[])channel.fill(0);
    if(this.done)return false;
    const input=inputs[0]||[],size=outputs[0]?.[0]?.length||128;
    if(this.start===null||currentFrame+size<=this.start)return true;
    if(!this.frames&&currentFrame>this.start){this.fail('Export missed its scheduled start.');return false;}
    const first=Math.max(0,this.start-currentFrame),last=Math.min(size,this.end-currentFrame);
    for(let i=first;i<last;i++){
      const l=input[0]?.[i]??0,r=input[1]?.[i]??l;
      if(!Number.isFinite(l)||!Number.isFinite(r)){this.fail('Export contains invalid audio samples.');return false;}
      this.block[this.used*2]=l;this.block[this.used*2+1]=r;this.used++;this.frames++;
      if(this.used===8192){this.flush();if(this.done)return false;}
    }
    if(currentFrame+size>=this.end){this.flush();if(!this.done){this.done=true;this.port.postMessage({type:'complete',frames:this.frames});}return false;}
    return true;
  }
}
registerProcessor('axiom-export-capture',AxiomExportCapture);
