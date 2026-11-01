class AxiomEcho extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'delayTime',defaultValue:.25,minValue:0,maxValue:180,automationRate:'a-rate'},
    {name:'feedback',defaultValue:.45,minValue:0,maxValue:.9,automationRate:'a-rate'},
  ];}
  constructor({processorOptions:{maxDelay,endFrame}}){
    super();
    if(!Number.isFinite(maxDelay)||maxDelay<=0||maxDelay>=180||!Number.isSafeInteger(endFrame))throw new Error('Invalid echo schedule.');
    this.size=Math.ceil(maxDelay*sampleRate)+2;this.buffers=[new Float32Array(this.size),new Float32Array(this.size)];this.at=0;this.endFrame=endFrame;
    this.port.onmessage=({data})=>{if(data?.type==='stop')this.endFrame=currentFrame;};
  }
  process(inputs,outputs,parameters){
    const output=outputs[0],input=inputs[0]||[];
    for(let i=0;i<output[0].length;i++){
      const delay=parameters.delayTime[parameters.delayTime.length===1?0:i]*sampleRate;
      const feedback=parameters.feedback[parameters.feedback.length===1?0:i];
      const read=(this.at-Math.max(1,Math.min(this.size-2,delay))+this.size)%this.size,first=Math.floor(read),fraction=read-first;
      for(let c=0;c<output.length;c++){
        const buffer=this.buffers[c],wet=buffer[first]*(1-fraction)+buffer[(first+1)%this.size]*fraction;
        output[c][i]=currentFrame+i<this.endFrame?wet:0;
        buffer[this.at]=(input[c]?.[i]??input[0]?.[i]??0)+wet*feedback;
      }
      this.at=(this.at+1)%this.size;
    }
    return currentFrame+output[0].length<this.endFrame;
  }
}
registerProcessor('axiom-echo',AxiomEcho);
