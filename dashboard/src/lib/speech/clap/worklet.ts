import { GestureDetector, type GestureDetectorOptions } from './gesture-detector.ts';
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { port: MessagePort; }
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;

class ClapProcessor extends AudioWorkletProcessor {
  private detector: GestureDetector;
  private expected = -1; private sequence = 0; private lastMeter = 0;
  private readonly session: string;
  constructor(options: { processorOptions?: GestureDetectorOptions & { session?: string } } = {}) {
    super();
    const p = options.processorOptions ?? {};
    this.session = p.session ?? 'clap';
    this.detector = new GestureDetector(sampleRate, p);
    this.port.onmessage = () => { this.detector.reset(); this.expected = -1; };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    for (const bus of outputs) for (const channel of bus) channel.fill(0);
    if (!input) { this.detector.reset(); this.expected = -1; return true; }
    if (this.expected !== -1 && currentFrame !== this.expected) this.detector.reset();
    this.expected = currentFrame + input.length;
    for (let i = 0; i < input.length; i++) {
      const result = this.detector.pushSample(input[i]);
      if (result >= 2) {
        const control = result === 3 ? 'snap' : 'clap', detector = this.detector[control];
        this.port.postMessage({ type: 'gesture', control, id: `${this.session}:${++this.sequence}`,
          pattern: detector.pattern.pattern, audioTime: (currentFrame + i) * 1000 / sampleRate, score: detector.score, impulseRms: detector.lastImpulseRms });
      }
      if (result && currentFrame + i - this.lastMeter >= sampleRate / 10) {
        this.lastMeter = currentFrame + i;
        for (const control of ['clap', 'snap'] as const) {
          const detector = this.detector[control];
          this.port.postMessage({ type: 'meter', control, rms: detector.rms, noise: detector.noise, threshold: detector.threshold,
            diagnostic: detector.diagnostic, accepted: detector.accepted, audioTime: (currentFrame + i) * 1000 / sampleRate });
        }
      }
    }
    return true;
  }
}
registerProcessor('breadboard-clap-controls', ClapProcessor);
