export type ClapPattern = 'single' | 'double';
export type PatternState = 'idle' | 'first-onset' | 'waiting-for-second' | 'matched' | 'cooldown';

/** Sample-clock timing. The first accepted pair wins; a third clap is unknown. */
export class ClapPatternDetector {
  state: PatternState = 'idle';
  private first = -Infinity;
  private until = 0;
  private last = -Infinity;
  readonly pattern: ClapPattern;
  constructor(pattern: ClapPattern = 'double') { this.pattern = pattern; }
  reset() { this.state = 'idle'; this.first = this.last = -Infinity; this.until = 0; }
  tick(ms: number) {
    if (ms < this.last) this.reset();
    this.last = ms;
    if (this.state === 'matched') this.state = 'cooldown';
    if (this.state === 'cooldown' && ms >= this.until) this.state = 'idle';
    if (this.state === 'first-onset') this.state = 'waiting-for-second';
    if (this.state === 'waiting-for-second' && ms - this.first > 650) this.state = 'idle';
  }
  onset(ms: number): boolean {
    this.tick(ms);
    if (this.state === 'cooldown') return false;
    if (this.pattern === 'single' || (this.state === 'waiting-for-second' && ms - this.first >= 150 && ms - this.first <= 650)) {
      this.state = 'matched'; this.until = ms + 1500; this.first = -Infinity;
      return true;
    }
    if (this.state === 'idle') { this.first = ms; this.state = 'first-onset'; }
    return false;
  }
}
