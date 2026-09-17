export function recordedVoiceFixture(t, players = []) {
  const previous = Object.fromEntries(['Audio', 'MediaStream', 'MediaRecorder'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  globalThis.MediaStream = class {};
  globalThis.MediaRecorder = class {
    state = 'inactive'; mimeType = 'audio/webm';
    start() { this.state = 'recording'; queueMicrotask(() => this.onstart?.()); }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['recorded audio']) });
        this.onstop?.();
      });
    }
  };
  globalThis.Audio = class {
    volume = 0; duration = 1; currentTime = 0;
    constructor(url) { this.url = url; players.push(this); }
    async play() {
      this.played = true;
      if (this.url) queueMicrotask(() => {
        this.currentTime = 1;
        this.ontimeupdate?.();
        this.onended?.();
      });
    }
    pause() {} removeAttribute() {} load() {}
  };
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return players;
}
