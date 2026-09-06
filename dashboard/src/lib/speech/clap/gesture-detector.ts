import { ClapDetector } from './detector.ts';
import type { ClapPattern } from './pattern.ts';

export interface GestureDetectorOptions {
  sensitivity?: number; pattern?: ClapPattern; clapEnabled?: boolean;
  snapEnabled?: boolean; snapSensitivity?: number; snapPattern?: ClapPattern;
}

/** Both signatures share PCM and one action cooldown. No stream or model per gesture. */
export class GestureDetector {
  readonly clap: ClapDetector;
  readonly snap: ClapDetector;
  private samples = 0; private cooldownUntil = 0;
  private rate: number; private options: GestureDetectorOptions;
  constructor(rate: number, options: GestureDetectorOptions = {}) {
    this.rate = rate; this.options = options;
    this.clap = new ClapDetector(rate, options.sensitivity, options.pattern);
    this.snap = new ClapDetector(rate, options.snapSensitivity ?? .65, options.snapPattern ?? 'single', 'snap');
  }
  reset() { this.clap.reset(); this.snap.reset(); this.samples = this.cooldownUntil = 0; }
  /** 0: sample, 1: meter frame, 2: clap gesture, 3: snap gesture. */
  pushSample(input: number): number {
    if (!Number.isFinite(input)) { this.reset(); return 0; }
    this.samples++;
    const clap = this.clap.pushSample(input), snap = this.snap.pushSample(input);
    const time = this.samples * 1000 / this.rate;
    if (time >= this.cooldownUntil) {
      if (this.options.snapEnabled && snap === 2) {
        this.cooldownUntil = time + 1500; this.clap.pattern.reset(); return 3;
      }
      if (this.options.clapEnabled !== false && clap === 2) {
        this.cooldownUntil = time + 1500; this.snap.pattern.reset(); return 2;
      }
    }
    return clap || snap ? 1 : 0;
  }
}
