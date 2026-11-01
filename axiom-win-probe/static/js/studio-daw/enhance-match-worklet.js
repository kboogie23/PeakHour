class AxiomEnhanceMatch extends AudioWorkletProcessor {
  constructor(){
    super();this.frames=0;this.inputPower=0;this.outputPower=0;this.peak=0;this.done=false;
  }
  process(inputs,outputs){
    for(const output of outputs)for(const channel of output)channel.fill(0);
    if(this.done)return false;
    const a=inputs[0],b=inputs[1];
    if(!a?.[0]||!b?.[0])return true;
    const count=Math.min(a[0].length,b[0].length,Math.round(sampleRate*2)-this.frames);
    for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){
      const dry=(a[ch]||a[0])[i],wet=(b[ch]||b[0])[i];
      if(!Number.isFinite(dry)||!Number.isFinite(wet)){this.done=true;this.port.postMessage({error:'Invalid audio during level matching.'});return false;}
      this.inputPower+=dry*dry;this.outputPower+=wet*wet;this.peak=Math.max(this.peak,Math.abs(wet));
    }
    this.frames+=count;
    if(this.frames===Math.round(sampleRate*2)){
      this.done=true;this.port.postMessage({frames:this.frames,inputPower:this.inputPower,outputPower:this.outputPower,peak:this.peak});return false;
    }
    return true;
  }
}
registerProcessor('axiom-enhance-match',AxiomEnhanceMatch);
