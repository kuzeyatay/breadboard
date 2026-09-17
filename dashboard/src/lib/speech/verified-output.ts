/** Punctuation and capitalization may differ; words, their order and repetitions may not. */
export function sameSpokenWords(script: string, transcript: string): boolean {
  const words = (text: string) => text.normalize('NFKC').toLowerCase()
    .replace(/['’]/gu, '').match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
  const expected = words(script);
  return Boolean(expected) && expected === words(transcript);
}

export class SpeechFidelityError extends Error {
  readonly safeToRetry: boolean;
  /** Live readings: script offset where a fresh reading can continue without repeating heard words. */
  readonly resumeAt?: number;
  constructor(safeToRetry: boolean, resumeAt?: number) {
    super(resumeAt === undefined
      ? 'The voice changed or skipped words. That passage was not played. Please retry the reading.'
      : 'The voice stopped reading the message. Please retry the reading.');
    this.safeToRetry = safeToRetry;
    this.resumeAt = resumeAt;
  }
}

/**
 * Buffered output (downloads, uploads) records the muted remote track; only a
 * complete, verified recording is kept. Live listening plays the track itself
 * under the script guard instead — see speakLive in subscription-live.ts.
 */
export function createVerifiedSpeechOutput(signal: AbortSignal) {
  let stream: MediaStream | undefined;
  let recording: { recorder: MediaRecorder; finished: Promise<Blob> } | undefined;
  let cancelPlayback: (() => void) | undefined;
  const verified: Blob[] = [];

  function stop() {
    if (recording?.recorder.state !== 'inactive') recording?.recorder.stop();
    recording = undefined;
    cancelPlayback?.();
  }
  signal.addEventListener('abort', stop, { once: true });

  return {
    attach(value: MediaStream) { stream = value; },
    ready() { return Boolean(stream); },
    stop,
    async begin() {
      signal.throwIfAborted();
      if (!stream) throw new Error('The voice audio stream is not ready. Please retry.');
      if (recording) throw new Error('A voice passage is already being recorded.');
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      let cancelStart = () => {};
      const started = new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        const timeout = setTimeout(() => reject(new Error('The voice recording did not start. Please retry.')), 5000);
        cancelStart = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); };
        signal.addEventListener('abort', abort, { once: true });
        recorder.onstart = () => resolve();
      });
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.onerror = () => reject(new Error('The voice passage could not be recorded. Please retry.'));
      });
      // Observe recording failures even if the request is cancelled before finish().
      void finished.catch(() => {});
      recording = { recorder, finished };
      try {
        recorder.start();
        // Recording must be active before the script can produce its first word.
        await Promise.race([started, finished.then(() => { throw new Error('The voice recording stopped before it started.'); })]);
      } finally { cancelStart(); }
      signal.throwIfAborted();
    },
    async finish(script: string, transcript: string, safeToRetry: boolean): Promise<Blob> {
      const current = recording;
      if (!current) throw new Error('The voice passage was cancelled.');
      recording = undefined;
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      const audio = await current.finished;
      signal.throwIfAborted();
      if (!sameSpokenWords(script, transcript)) throw new SpeechFidelityError(safeToRetry);
      if (!audio.size) throw new Error('The voice returned an empty recording. Please retry.');
      return audio;
    },
    keep(audio: Blob) { verified.push(audio); },
    async play(audio: Blob, onProgress?: (progress: number) => void) {
      signal.throwIfAborted();
      const url = URL.createObjectURL(audio);
      const player = new Audio(url);
      try {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            player.pause();
            player.onended = player.onerror = player.ontimeupdate = null;
            cancelPlayback = undefined;
            if (error) reject(error);
            else resolve();
          };
          cancelPlayback = () => finish();
          player.onended = () => { onProgress?.(1); finish(); };
          player.onerror = () => finish(new Error('The verified voice recording could not play.'));
          player.ontimeupdate = () => {
            if (Number.isFinite(player.duration) && player.duration > 0) onProgress?.(Math.min(1, player.currentTime / player.duration));
          };
          onProgress?.(0);
          void player.play().catch(error => finish(error));
        });
      } finally {
        player.pause();
        player.removeAttribute('src');
        player.load();
        URL.revokeObjectURL(url);
      }
    },
    async capture(context: AudioContext): Promise<Blob> {
      signal.throwIfAborted();
      const { pcmWav } = await import('./pcm-wav.ts');
      const chunks: Float32Array[] = [];
      for (const audio of verified) {
        const decoded = await context.decodeAudioData(await audio.arrayBuffer());
        signal.throwIfAborted();
        chunks.push(decoded.getChannelData(0));
      }
      if (!chunks.length) throw new Error('There is no verified speech to download.');
      return pcmWav(chunks, context.sampleRate);
    },
  };
}
