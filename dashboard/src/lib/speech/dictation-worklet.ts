/** Capture and queue on the audio rendering thread during provider setup. */
export const DICTATION_WORKLET_SOURCE = `
class DictationAudioQueue {
  constructor() { this.chunks=[]; this.head=0; this.offset=0; this.length=0; }
  push(samples) { if(samples.length) { this.chunks.push(samples.slice()); this.length+=samples.length; } }
  read(output) {
    output.fill(0); let written=0;
    while(written<output.length && this.length) {
      const chunk=this.chunks[this.head], count=Math.min(chunk.length-this.offset,output.length-written);
      output.set(chunk.subarray(this.offset,this.offset+count),written);
      written+=count; this.offset+=count; this.length-=count;
      if(this.offset===chunk.length) { this.head++; this.offset=0; }
    }
    if(this.head>64 || !this.length) { this.chunks=this.chunks.slice(this.head); this.head=0; }
    return written;
  }
  clear() { this.chunks=[]; this.head=this.offset=this.length=0; }
  trimTo(length) {
    let discard=Math.max(0,this.length-length);
    while(discard) {
      const count=Math.min(discard,this.chunks[this.head].length-this.offset);
      this.offset+=count; this.length-=count; discard-=count;
      if(this.offset===this.chunks[this.head].length) { this.head++; this.offset=0; }
    }
    if(this.head>64 || !this.length) { this.chunks=this.chunks.slice(this.head); this.head=0; }
  }
}
class BreadboardDictationBuffer extends AudioWorkletProcessor {
  constructor() {
    super(); this.queue=new DictationAudioQueue(); this.started=false; this.capturing=true; this.draining=false; this.heardInput=false;
    this.port.onmessage=event=>{
      if(event.data==='start') this.started=true;
      if(event.data==='stop') this.capturing=false;
      if(event.data==='finish' && !this.draining) {
        this.capturing=false; this.draining=true;
        // Flush the final render/RTP frames. finishTranscript then mutes its
        // input, which supplies the recognizer's endpoint silence itself; a
        // second 600ms silence queue only delays every completed hold.
        this.queue.push(new Float32Array(Math.ceil(sampleRate*0.08)));
      }
    };
  }
  process(inputs,outputs) {
    const input=inputs[0]?.[0], output=outputs[0]?.[0];
    if(this.capturing && input) {
      this.queue.push(input);
      // Do not replay the entire silent connection wait ahead of live speech.
      // Keep 200ms of pre-roll and preserve every sample once input exceeds a
      // single PCM16 quantization step, including quiet words and later pauses.
      if(!this.started && !this.heardInput) {
        this.heardInput=input.some(sample=>Math.abs(sample)>1/32768);
        if(!this.heardInput) this.queue.trimTo(Math.ceil(sampleRate*0.2));
      }
    }
    if(output) { if(this.started)this.queue.read(output);else output.fill(0); }
    if(this.started && this.draining && !this.queue.length) { this.draining=false; this.port.postMessage('drained'); }
    return true;
  }
}
registerProcessor('breadboard-dictation-buffer',BreadboardDictationBuffer);
`;
