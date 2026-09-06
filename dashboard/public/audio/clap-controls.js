/* Clap controls — adapted from Tzur Soffer, revision 4464865ba69dbe96462ccc678fb3c75b5515f647.
The MIT License (MIT)
Copyright © 2023 Tzur Soffer

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
"use strict";
(() => {
  // src/lib/speech/clap/pattern.ts
  var ClapPatternDetector = class {
    constructor(pattern = "double") {
      this.state = "idle";
      this.first = -Infinity;
      this.until = 0;
      this.last = -Infinity;
      this.pattern = pattern;
    }
    reset() {
      this.state = "idle";
      this.first = this.last = -Infinity;
      this.until = 0;
    }
    tick(ms) {
      if (ms < this.last) this.reset();
      this.last = ms;
      if (this.state === "matched") this.state = "cooldown";
      if (this.state === "cooldown" && ms >= this.until) this.state = "idle";
      if (this.state === "first-onset") this.state = "waiting-for-second";
      if (this.state === "waiting-for-second" && ms - this.first > 650) this.state = "idle";
    }
    onset(ms) {
      this.tick(ms);
      if (this.state === "cooldown") return false;
      if (this.pattern === "single" || this.state === "waiting-for-second" && ms - this.first >= 150 && ms - this.first <= 650) {
        this.state = "matched";
        this.until = ms + 1500;
        this.first = -Infinity;
        return true;
      }
      if (this.state === "idle") {
        this.first = ms;
        this.state = "first-onset";
      }
      return false;
    }
  };

  // src/lib/speech/clap/detector.ts
  var Biquad = class {
    constructor(rate, hz, high) {
      this.z1 = 0;
      this.z2 = 0;
      const w = 2 * Math.PI * hz / rate, c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha;
      this.b0 = (high ? 1 + c : 1 - c) / 2 / a0;
      this.b1 = (high ? -(1 + c) : 1 - c) / a0;
      this.b2 = this.b0;
      this.a1 = -2 * c / a0;
      this.a2 = (1 - alpha) / a0;
    }
    sample(x) {
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
    reset() {
      this.z1 = this.z2 = 0;
    }
  };
  var ClapDetector = class {
    constructor(sampleRate2, sensitivity = 0.55, pattern = "double", control = "clap") {
      this.brightEnergy = 0;
      this.burstEnergy = 0;
      this.burstBright = 0;
      this.burstSamplePeak = 0;
      this.impulseCompactness = 0;
      this.impulseBrightness = 0;
      this.impulseDuration = 0;
      this.samples = 0;
      this.rms = 0;
      this.noise = 1e-4;
      this.threshold = 0;
      this.score = 0;
      this.diagnostic = "warming";
      this.accepted = 0;
      this.lastImpulseRms = 0;
      this.count = 0;
      this.energy = 0;
      this.rawEnergy = 0;
      this.peak = 0;
      this.previous = 0;
      this.onsetAt = -Infinity;
      this.burstPeak = 0;
      this.refractory = 0;
      this.candidate = false;
      this.loudSince = 0;
      this.quiet = 0;
      this.sampleRate = sampleRate2;
      this.sensitivity = sensitivity;
      this.control = control;
      if (!Number.isFinite(sampleRate2) || sampleRate2 < 8e3 || sampleRate2 > 192e3) throw new Error("Unsupported sample rate");
      this.frameSize = Math.round(sampleRate2 * 0.01);
      this.high = new Biquad(sampleRate2, 250, true);
      this.low = new Biquad(sampleRate2, Math.min(4200, sampleRate2 * 0.4), false);
      this.bright = new Biquad(sampleRate2, 2e3, true);
      this.pattern = new ClapPatternDetector(pattern);
    }
    reset() {
      this.high.reset();
      this.low.reset();
      this.bright.reset();
      this.pattern.reset();
      this.samples = this.count = 0;
      this.energy = this.rawEnergy = this.peak = this.previous = this.rms = this.quiet = this.loudSince = 0;
      this.noise = 1e-4;
      this.refractory = 0;
      this.candidate = false;
      this.onsetAt = -Infinity;
      this.diagnostic = "warming";
      this.accepted = this.lastImpulseRms = this.burstPeak = this.threshold = this.score = 0;
      this.brightEnergy = this.burstEnergy = this.burstBright = this.burstSamplePeak = 0;
      this.impulseCompactness = this.impulseBrightness = this.impulseDuration = 0;
    }
    get milliseconds() {
      return this.samples * 1e3 / this.sampleRate;
    }
    pushSample(input) {
      if (!Number.isFinite(input)) {
        this.reset();
        return 0;
      }
      const x = Math.max(-1, Math.min(1, input));
      const y = this.low.sample(this.high.sample(x));
      const bright = this.bright.sample(y);
      this.brightEnergy += bright * bright;
      this.energy += y * y;
      this.rawEnergy += x * x;
      this.peak = Math.max(this.peak, Math.abs(y));
      this.samples++;
      this.count++;
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
      this.threshold = Math.max(2e-3 + (1 - s) * 0.016, this.noise * (8 - s * 5));
      const loud = this.rms > this.threshold;
      const rise = this.rms / Math.max(this.previous, this.noise, 1e-4);
      this.previous = this.rms;
      if (ms < 600) {
        if (this.rms < Math.max(this.noise * 5, 0.012)) this.noise += (this.rms - this.noise) * 0.08;
        this.diagnostic = "warming";
        return 1;
      }
      if (!this.candidate && !loud) this.noise += (this.rms - this.noise) * 0.025;
      if (loud && !this.candidate && this.quiet >= 30) {
        this.diagnostic = ms < this.refractory ? "echo" : bandShare < 0.12 ? "low-frequency" : rise < 1.7 || crest < 1.8 ? "slow-onset" : "candidate";
        if (this.diagnostic === "candidate") {
          this.candidate = true;
          this.onsetAt = ms;
          this.burstPeak = this.rms;
          this.burstEnergy = this.burstBright = this.burstSamplePeak = 0;
          this.score = Math.min(10, rise) * Math.min(4, crest) / 40;
        }
      }
      if (loud) {
        this.quiet = 0;
        this.loudSince += 10;
      } else {
        this.quiet += 10;
        this.loudSince = 0;
      }
      if (this.candidate) {
        this.burstPeak = Math.max(this.burstPeak, this.rms);
        this.burstEnergy += frameEnergy;
        this.burstBright += frameBright;
        this.burstSamplePeak = Math.max(this.burstSamplePeak, framePeak);
        if (ms - this.onsetAt > 90) {
          this.candidate = false;
          this.diagnostic = "sustained";
          this.refractory = ms + 120;
        } else if (this.rms < Math.max(this.threshold * 0.65, this.burstPeak * 0.25) && ms > this.onsetAt) {
          this.candidate = false;
          this.refractory = ms + 100;
          this.impulseDuration = ms - this.onsetAt;
          this.impulseCompactness = this.burstEnergy / Math.max(this.burstSamplePeak ** 2, 1e-12) / this.sampleRate;
          this.impulseBrightness = this.burstBright / Math.max(this.burstEnergy, 1e-12);
          const snapLike = this.impulseDuration <= 20 && this.impulseCompactness <= 12e-4 && this.impulseBrightness >= 0.42 && (this.impulseDuration <= 10 || this.impulseBrightness >= 0.68);
          if (snapLike !== (this.control === "snap")) {
            this.diagnostic = "other-gesture";
            return 1;
          }
          this.accepted++;
          this.diagnostic = "accepted";
          this.lastImpulseRms = this.burstPeak;
          return this.pattern.onset(ms) ? 2 : 1;
        }
      } else if (!loud && this.diagnostic !== "accepted") this.diagnostic = "quiet";
      if (this.loudSince > 120) this.diagnostic = "sustained";
      return 1;
    }
  };

  // src/lib/speech/clap/gesture-detector.ts
  var GestureDetector = class {
    constructor(rate, options = {}) {
      this.samples = 0;
      this.cooldownUntil = 0;
      this.rate = rate;
      this.options = options;
      this.clap = new ClapDetector(rate, options.sensitivity, options.pattern);
      this.snap = new ClapDetector(rate, options.snapSensitivity ?? 0.65, options.snapPattern ?? "single", "snap");
    }
    reset() {
      this.clap.reset();
      this.snap.reset();
      this.samples = this.cooldownUntil = 0;
    }
    /** 0: sample, 1: meter frame, 2: clap gesture, 3: snap gesture. */
    pushSample(input) {
      if (!Number.isFinite(input)) {
        this.reset();
        return 0;
      }
      this.samples++;
      const clap = this.clap.pushSample(input), snap = this.snap.pushSample(input);
      const time = this.samples * 1e3 / this.rate;
      if (time >= this.cooldownUntil) {
        if (this.options.snapEnabled && snap === 2) {
          this.cooldownUntil = time + 1500;
          this.clap.pattern.reset();
          return 3;
        }
        if (this.options.clapEnabled !== false && clap === 2) {
          this.cooldownUntil = time + 1500;
          this.snap.pattern.reset();
          return 2;
        }
      }
      return clap || snap ? 1 : 0;
    }
  };

  // src/lib/speech/clap/worklet.ts
  var ClapProcessor = class extends AudioWorkletProcessor {
    constructor(options = {}) {
      super();
      this.expected = -1;
      this.sequence = 0;
      this.lastMeter = 0;
      const p = options.processorOptions ?? {};
      this.session = p.session ?? "clap";
      this.detector = new GestureDetector(sampleRate, p);
      this.port.onmessage = () => {
        this.detector.reset();
        this.expected = -1;
      };
    }
    process(inputs, outputs) {
      const input = inputs[0]?.[0];
      for (const bus of outputs) for (const channel of bus) channel.fill(0);
      if (!input) {
        this.detector.reset();
        this.expected = -1;
        return true;
      }
      if (this.expected !== -1 && currentFrame !== this.expected) this.detector.reset();
      this.expected = currentFrame + input.length;
      for (let i = 0; i < input.length; i++) {
        const result = this.detector.pushSample(input[i]);
        if (result >= 2) {
          const control = result === 3 ? "snap" : "clap", detector = this.detector[control];
          this.port.postMessage({
            type: "gesture",
            control,
            id: `${this.session}:${++this.sequence}`,
            pattern: detector.pattern.pattern,
            audioTime: (currentFrame + i) * 1e3 / sampleRate,
            score: detector.score,
            impulseRms: detector.lastImpulseRms
          });
        }
        if (result && currentFrame + i - this.lastMeter >= sampleRate / 10) {
          this.lastMeter = currentFrame + i;
          for (const control of ["clap", "snap"]) {
            const detector = this.detector[control];
            this.port.postMessage({
              type: "meter",
              control,
              rms: detector.rms,
              noise: detector.noise,
              threshold: detector.threshold,
              diagnostic: detector.diagnostic,
              accepted: detector.accepted,
              audioTime: (currentFrame + i) * 1e3 / sampleRate
            });
          }
        }
      }
      return true;
    }
  };
  registerProcessor("breadboard-clap-controls", ClapProcessor);
})();
