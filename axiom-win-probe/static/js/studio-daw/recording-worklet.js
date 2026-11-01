class AxiomInputCapture extends AudioWorkletProcessor {
  constructor(options){
    super();this.used=0;this.frames=0;this.gapFrames=0;this.done=false;this.started=false;this.maxFrames=Math.min(Math.floor(sampleRate*7200),options?.processorOptions?.maxFrames||Math.floor(sampleRate*240));this.allocate();
    this.channelOffset=options?.processorOptions?.channelOffset||0;this.bounded=Boolean(options?.processorOptions?.bounded);this.pending=0;
    this.scheduled=Boolean(options?.processorOptions?.scheduled);this.startFrame=this.scheduled?null:0;this.endFrame=Infinity;
    this.port.onmessage=e=>{
      if(e.data?.type==='ack')this.pending=Math.max(0,this.pending-1);
      if(e.data?.type==='stop')this.finish();
      if(e.data?.type==='arm'&&this.scheduled&&this.startFrame===null&&!this.done){
        const {startFrame,endFrame}=e.data;
        if(!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(endFrame)||startFrame<currentFrame||endFrame<=startFrame){this.done=true;this.port.postMessage({type:'error',message:'Recording missed its scheduled start. Start a new take.'});return;}
        this.startFrame=startFrame;this.endFrame=endFrame;
      }
    };
  }
  allocate(){this.left=new Float32Array(4096);this.right=new Float32Array(4096);}
  flush(){
    if(!this.used)return;
    if(this.bounded&&this.pending>=32){this.done=true;this.port.postMessage({type:'error',message:'Recording storage cannot keep up. The incomplete take was discarded.'});return;}
    const left=this.left.slice(0,this.used),right=this.right.slice(0,this.used);
    let peak=0;for(let i=0;i<left.length;i++)peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
    this.pending++;this.port.postMessage({type:'samples',offset:this.frames-this.used,left,right,peak},[left.buffer,right.buffer]);this.used=0;
  }
  finish(){if(this.done)return;this.done=true;this.flush();this.port.postMessage({type:'stopped',frames:this.frames,gapFrames:this.gapFrames,sampleRate,startFrame:this.actualStartFrame,scheduledEndFrame:this.scheduled?this.endFrame:null});}
  process(inputs,outputs){
    for(const channel of outputs[0]||[])channel.fill(0);
    if(this.done)return false;
    const input=inputs[0]||[],size=input[0]?.length||outputs[0]?.[0]?.length||128;
    if(input.length&&this.channelOffset>0&&input.length<this.channelOffset+2){this.done=true;this.port.postMessage({type:'error',message:'The selected USB channel pair is unavailable. Check the controller routing or choose another audio input.'});return false;}
    if(this.startFrame===null||currentFrame+size<=this.startFrame)return true;
    const first=this.started?0:Math.max(0,this.startFrame-currentFrame);
    if(!this.started){
      if(!this.scheduled&&!input.length)return true;
      if(this.scheduled&&currentFrame>this.startFrame){this.done=true;this.port.postMessage({type:'error',message:'Recording missed its scheduled start. Start a new take.'});return false;}
      this.started=true;this.actualStartFrame=currentFrame+first;this.port.postMessage({type:'started',frame:this.actualStartFrame,sampleRate});
    }
    for(let i=first;i<size&&!this.done&&this.frames<this.maxFrames&&currentFrame+i<this.endFrame;i++){
      if(!input.length)this.gapFrames++;
      this.left[this.used]=input[this.channelOffset]?.[i]??0;this.right[this.used]=input[this.channelOffset+1]?.[i]??input[this.channelOffset]?.[i]??0;this.used++;this.frames++;
      if(this.used===this.left.length)this.flush();
    }
    if(this.frames===this.maxFrames||currentFrame+size>=this.endFrame)this.finish();
    return !this.done;
  }
}
registerProcessor('axiom-input-capture',AxiomInputCapture);
