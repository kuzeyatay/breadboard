/**
 * TypeScript adaptation of Tzur Soffer's clapDetection, MIT (2023).
 * Pinned source + license: ./upstream. Bandpass/adaptive threshold/debounce
 * derive from that design. Float32 thresholds, streaming filters, impulse
 * decay/crest checks and the pattern machine are Breadboard adaptations.
 */
import { ClapPatternDetector, type ClapPattern } from './pattern.ts';
import type { GestureControl } from './preferences.ts';

class Biquad {
  private z1 = 0; private z2 = 0;
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  constructor(rate: number, hz: number, high: boolean) {
    const w = 2 * Math.PI * hz / rate, c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha;
    this.b0 = (high ? 1 + c : 1 - c) / 2 / a0;
    this.b1 = (high ? -(1 + c) : 1 - c) / a0; this.b2 = this.b0;
    this.a1 = -2 * c / a0; this.a2 = (1 - alpha) / a0;
  }
  sample(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = this.z2 = 0; }
}

export type ClapDiagnostic = 'warming' | 'quiet' | 'candidate' | 'accepted' | 'slow-onset' | 'low-frequency' | 'sustained' | 'echo' | 'other-gesture';
/** No buffers or per-frame allocations. pushSample returns 1 at a frame, 2 at a gesture. */
export class ClapDetector {
  readonly pattern: ClapPatternDetector;
  readonly frameSize: number;
  readonly high: Biquad; readonly low: Biquad;
  private readonly bright: Biquad;
  private brightEnergy = 0; private burstEnergy = 0; private burstBright = 0; private burstSamplePeak = 0;
  impulseCompactness = 0; impulseBrightness = 0; impulseDuration = 0;
  readonly control: GestureControl;
  samples = 0; rms = 0; noise = 0.0001; threshold = 0; score = 0;
  diagnostic: ClapDiagnostic = 'warming';
  accepted = 0;
  lastImpulseRms = 0;
  private count = 0; private energy = 0; private rawEnergy = 0; private peak = 0;
  private previous = 0; private onsetAt = -Infinity; private burstPeak = 0;
  private refractory = 0; private candidate = false; private loudSince = 0; private quiet = 0;
  readonly sampleRate: number; readonly sensitivity: number;
  constructor(sampleRate: number, sensitivity = 0.55, pattern: ClapPattern = 'double', control: GestureControl = 'clap') {
    this.sampleRate = sampleRate; this.sensitivity = sensitivity;
    this.control = control;
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported sample rate');
    this.frameSize = Math.round(sampleRate * 0.01);
    this.high = new Biquad(sampleRate, 250, true); this.low = new Biquad(sampleRate, Math.min(4200, sampleRate * 0.4), false);
    this.bright = new Biquad(sampleRate, 2000, true);
    this.pattern = new ClapPatternDetector(pattern);
  }
  reset() {
    this.high.reset(); this.low.reset(); this.bright.reset(); this.pattern.reset(); this.samples = this.count = 0;
    this.energy = this.rawEnergy = this.peak = this.previous = this.rms = this.quiet = this.loudSince = 0;
    this.noise = 0.0001; this.refractory = 0; this.candidate = false; this.onsetAt = -Infinity; this.diagnostic = 'warming';
    this.accepted = this.lastImpulseRms = this.burstPeak = this.threshold = this.score = 0;
    this.brightEnergy = this.burstEnergy = this.burstBright = this.burstSamplePeak = 0;
    this.impulseCompactness = this.impulseBrightness = this.impulseDuration = 0;
  }
  get milliseconds() { return this.samples * 1000 / this.sampleRate; }
  pushSample(input: number): number {
    if (!Number.isFinite(input)) { this.reset(); return 0; }
    const x = Math.max(-1, Math.min(1, input));
    const y = this.low.sample(this.high.sample(x));
    const bright = this.bright.sample(y); this.brightEnergy += bright * bright;
    this.energy += y * y; this.rawEnergy += x * x; this.peak = Math.max(this.peak, Math.abs(y));
    this.samples++; this.count++;
    if (this.count < this.frameSize) return 0;
    this.rms = Math.sqrt(this.energy / this.count);
    const crest = this.peak / Math.max(this.rms, 1e-8);
    const bandShare = this.energy / Math.max(this.rawEnergy, 1e-12);
    const frameEnergy = this.energy, frameBright = this.brightEnergy, framePeak = this.peak;
    this.brightEnergy = 0;
    this.energy = this.rawEnergy = this.peak = this.count = 0;
    const ms = this.milliseconds;
    this.pattern.tick(ms);
    const s = Math.max(0, Math.min(1, this.sensitivity));
    this.threshold = Math.max(0.002 + (1 - s) * 0.016, this.noise * (8 - s * 5));
    const loud = this.rms > this.threshold;
    const rise = this.rms / Math.max(this.previous, this.noise, 0.0001);
    this.previous = this.rms;
    if (ms < 600) {
      // Reject warm-up impulses from the ambient estimate as well.
      if (this.rms < Math.max(this.noise * 5, 0.012)) this.noise += (this.rms - this.noise) * 0.08;
      this.diagnostic = 'warming'; return 1;
    }
    if (!this.candidate && !loud) this.noise += (this.rms - this.noise) * 0.025;
    if (loud && !this.candidate && this.quiet >= 30) {
      this.diagnostic = ms < this.refractory ? 'echo' : bandShare < 0.12 ? 'low-frequency' : rise < 1.7 || crest < 1.8 ? 'slow-onset' : 'candidate';
      if (this.diagnostic === 'candidate') {
        this.candidate = true; this.onsetAt = ms; this.burstPeak = this.rms;
        this.burstEnergy = this.burstBright = this.burstSamplePeak = 0;
        this.score = Math.min(10, rise) * Math.min(4, crest) / 40;
      }
    }
    if (loud) { this.quiet = 0; this.loudSince += 10; }
    else { this.quiet += 10; this.loudSince = 0; }
    if (this.candidate) {
      this.burstPeak = Math.max(this.burstPeak, this.rms);
      this.burstEnergy += frameEnergy; this.burstBright += frameBright; this.burstSamplePeak = Math.max(this.burstSamplePeak, framePeak);
      if (ms - this.onsetAt > 90) { this.candidate = false; this.diagnostic = 'sustained'; this.refractory = ms + 120; }
      else if (this.rms < Math.max(this.threshold * 0.65, this.burstPeak * 0.25) && ms > this.onsetAt) {
        this.candidate = false; this.refractory = ms + 100;
        // Snaps usually concentrate their energy into a shorter, brighter burst.
        // These are heuristics, not a claim that a hand made the sound.
        this.impulseDuration = ms - this.onsetAt;
        this.impulseCompactness = this.burstEnergy / Math.max(this.burstSamplePeak ** 2, 1e-12) / this.sampleRate;
        this.impulseBrightness = this.burstBright / Math.max(this.burstEnergy, 1e-12);
        const snapLike = this.impulseDuration <= 20 && this.impulseCompactness <= .0012 && this.impulseBrightness >= .42 &&
          (this.impulseDuration <= 10 || this.impulseBrightness >= .68);
        if (snapLike !== (this.control === 'snap')) { this.diagnostic = 'other-gesture'; return 1; }
        this.accepted++; this.diagnostic = 'accepted';
        this.lastImpulseRms = this.burstPeak;
        return this.pattern.onset(ms) ? 2 : 1;
      }
    } else if (!loud && this.diagnostic !== 'accepted') this.diagnostic = 'quiet';
    if (this.loudSince > 120) this.diagnostic = 'sustained';
    return 1;
  }
}
