import { createVoicePcmEncoder, LIVEKIT_FRAME_SAMPLES, LIVEKIT_MAX_BATCH_SAMPLES, LIVEKIT_SAMPLE_RATE, type LiveKitTurnEvent } from './livekit-turns.ts';

export interface LiveKitTurnDetector {
  /** False while recovering; the microphone can use its acoustic fallback. */
  readonly ready?: boolean;
  push(samples: Float32Array): void;
  close(): void;
}

const MAX_REALTIME_INFERENCE_LAG_MS = 200;

/** Bounded same-origin PCM batches reuse Breadboard authentication and desktop routing. */
export async function connectLiveKitTurnDetector(options: {
  sampleRate: number;
  signal: AbortSignal;
  onEvent(event: LiveKitTurnEvent): void;
  onError(error: Error): void;
  onReady?(): void;
}): Promise<LiveKitTurnDetector> {
  let encode = createVoicePcmEncoder(options.sampleRate);
  let frames: Int16Array[] = [], closed = false, retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let current: { endpoint: string; controller: AbortController; sequence: number; pending: boolean; pendingSince: number; pendingSamples: number } | null = null;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, options.signal]);
  const retire = () => {
    const previous = current;
    current = null;
    frames = [];
    encode = createVoicePcmEncoder(options.sampleRate);
    if (!previous) return;
    previous.controller.abort();
    void fetch(previous.endpoint, { method: 'DELETE', keepalive: true }).catch(() => {});
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(retryTimer);
    lifetime.abort();
    retire();
    options.signal.removeEventListener('abort', close);
  };
  const fail = (error: unknown) => {
    if (closed || signal.aborted) return;
    retire();
    options.onError(error instanceof Error ? error : new Error('Voice detection lost its connection.'));
    // Forget stale inference queues. Capture continues with acoustic detection.
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, Math.min(500 * 2 ** Math.min(retry++, 4), 8_000));
  };
  async function connect() {
    try {
      const response = await fetch('/api/speech/livekit', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.id !== 'string') throw new Error(body?.error || 'LiveKit speech detection could not start.');
      const endpoint = `/api/speech/livekit?id=${encodeURIComponent(body.id)}`;
      if (closed || signal.aborted) {
        void fetch(endpoint, { method: 'DELETE', keepalive: true }).catch(() => {});
        return;
      }
      current = { endpoint, controller: new AbortController(), sequence: 0, pending: false, pendingSince: 0, pendingSamples: 0 };
      options.onReady?.();
    } catch (error) { fail(error); }
  }
  async function drain() {
    const connection = current;
    if (!connection || connection.pending || closed || !frames.length) return;
    connection.pending = true;
    connection.pendingSince = Date.now();
    const batch = frames.splice(0, LIVEKIT_MAX_BATCH_SAMPLES / LIVEKIT_FRAME_SAMPLES);
    const pcm = new Int16Array(batch.reduce((size, frame) => size + frame.length, 0));
    connection.pendingSamples = pcm.length;
    let offset = 0;
    for (const frame of batch) { pcm.set(frame, offset); offset += frame.length; }
    try {
      const response = await fetch(`${connection.endpoint}&sequence=${connection.sequence++}`, {
        method: 'PUT', body: pcm.buffer, headers: { 'Content-Type': 'application/octet-stream' },
        signal: AbortSignal.any([signal, connection.controller.signal, AbortSignal.timeout(2_000)]),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.events)) throw new Error(body?.error || 'Voice detection lost its connection.');
      if (current !== connection || closed || signal.aborted) return;
      retry = 0;
      for (const event of body.events) {
        if ((event.type === 'speech-start' || event.type === 'speech-end') && Number.isSafeInteger(event.sample)) options.onEvent(event);
      }
    } catch (error) { if (current === connection) fail(error); }
    finally { connection.pending = false; connection.pendingSamples = 0; if (current === connection) void drain(); }
  }
  options.signal.addEventListener('abort', close, { once: true });
  if (options.signal.aborted) { close(); options.signal.throwIfAborted(); }
  await connect();
  return {
    get ready() {
      // A connected detector can still be behind the live microphone. Let the
      // local acoustic guard stop playback while inference catches up. A new
      // HTTP batch must not reset readiness while older microphone audio is
      // still queued or being processed. Preserve every ordered PCM frame.
      return current !== null && !closed &&
        (!current.pending || Date.now() - current.pendingSince < MAX_REALTIME_INFERENCE_LAG_MS) &&
        (frames.length * LIVEKIT_FRAME_SAMPLES + current.pendingSamples) / LIVEKIT_SAMPLE_RATE * 1000 < MAX_REALTIME_INFERENCE_LAG_MS;
    },
    close,
    push(samples) {
      if (closed || !current) return;
      frames.push(...encode(samples));
      if (frames.length * LIVEKIT_FRAME_SAMPLES > LIVEKIT_SAMPLE_RATE * 1.5) {
        fail(new Error('Voice detection is recovering.'));
        return;
      }
      void drain();
    },
  };
}
