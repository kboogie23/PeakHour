class AxiomDjDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'fxAmount',defaultValue:50,minValue:0,maxValue:100},
    {name:'driveDb',defaultValue:0,minValue:0,maxValue:12},
    {name:'ceilingDb',defaultValue:-1,minValue:-12,maxValue:0},
    {name:'limiterReleaseMs',defaultValue:100,minValue:10,maxValue:1000},
    {name:'limiterEnabled',defaultValue:1,minValue:0,maxValue:1}
  ];}
  constructor(options){super();this.mode=options.processorOptions.mode;if(!['limiter','sidechainHard','sidechainSoft'].includes(this.mode))throw new Error('Unknown dynamics effect');this.envelope=0;this.gain=1;this.meter=Boolean(options.processorOptions.meter);this.frames=0;this.inputPeak=0;this.outputPeak=0;this.reduction=1;}
  process(inputs,outputs,parameters){
    const output=outputs[0],source=inputs[0]||[],trigger=inputs[1]||[],hard=this.mode==='sidechainHard',limiter=this.mode==='limiter';
    const parameter=(name,i)=>{const values=parameters[name];return values[values.length===1?0:i];};
    const attack=Math.exp(-1/(sampleRate*(hard?.002:.012))),release=Math.exp(-1/(sampleRate*(hard?.12:.25)));
    for(let i=0;i<output[0].length;i++){
      const left=source[0]?.[i]??0,right=source[1]?.[i]??left;
      if(!Number.isFinite(left)||!Number.isFinite(right))throw new Error('Invalid effect input');
      let gain;
      if(limiter&&parameter('limiterEnabled',i)<.5){this.gain=1;gain=1;}
      else if(limiter){
        const drive=Math.pow(10,parameter('driveDb',i)/20),ceiling=Math.pow(10,parameter('ceilingDb',i)/20),peak=Math.max(Math.abs(left),Math.abs(right))*drive;
        const target=peak>ceiling?ceiling/peak:1,decay=Math.exp(-1/(sampleRate*parameter('limiterReleaseMs',i)/1000));
        this.gain=target<this.gain?target:target+(this.gain-target)*decay;gain=this.gain*drive;
      }else{
        let peak=0;for(const channel of trigger){if(!Number.isFinite(channel[i]))throw new Error('Invalid sidechain input');peak=Math.max(peak,Math.abs(channel[i]));}
        const coefficient=peak>this.envelope?attack:release;this.envelope=peak+(this.envelope-peak)*coefficient;
        const over=Math.max(0,20*Math.log10(Math.max(1e-9,this.envelope))+(hard?24:18));
        gain=Math.pow(10,-over*(1-1/(hard?12:3))*parameter('fxAmount',i)/2000);
      }
      output[0][i]=left*gain;if(output[1])output[1][i]=right*gain;
      if(this.meter){this.inputPeak=Math.max(this.inputPeak,Math.abs(left),Math.abs(right));this.outputPeak=Math.max(this.outputPeak,Math.abs(left*gain),Math.abs(right*gain));this.reduction=Math.min(this.reduction,this.gain);}
    }
    if(this.meter&&(this.frames+=output[0].length)>=sampleRate/10){this.port.postMessage({inputPeak:this.inputPeak,outputPeak:this.outputPeak,reductionDb:-20*Math.log10(Math.max(1e-9,this.reduction))});this.frames=0;this.inputPeak=0;this.outputPeak=0;this.reduction=1;}
    return true;
  }
}
registerProcessor('axiom-dj-dynamics',AxiomDjDynamics);
