import { randomUUID } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';
import { LIVEKIT_MAX_BATCH_SAMPLES, LIVEKIT_SAMPLE_RATE, type LiveKitTurnEvent } from './livekit-turns.ts';
import { loadLiveKitVoiceRuntime } from './livekit-runtime.ts';

export class VoiceDetectorError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface Detector {
  owner: number;
  touched: number;
  processing: boolean;
  samples: number;
  processed: number;
  sequence: number;
  events: LiveKitTurnEvent[];
  notify?: () => void;
  failure?: Error;
  close(): void;
  push(pcm: Int16Array): void;
}
const globals = globalThis as typeof globalThis & { breadboardLiveKitDetectors?: Map<string, Detector> };
const sessions = globals.breadboardLiveKitDetectors ??= new Map<string, Detector>();
const IDLE_MS = 20_000;

function expire() {
  for (const [id, detector] of sessions) {
    if (Date.now() - detector.touched > IDLE_MS) {
      sessions.delete(id);
      detector.close();
    }
  }
}

/** LiveKit's small, bundled Silero model runs on this machine; no room or cloud account is needed. */
export async function createVoiceDetector(owner: number): Promise<string> {
  expire();
  if ([...sessions.values()].filter(s => s.owner === owner).length >= 2 || sessions.size >= 16) {
    throw new VoiceDetectorError(429, 'Close another voice conversation and try again.');
  }
  // Reserve before loading native code so parallel requests cannot bypass admission.
  const id = randomUUID();
  let closeStream = () => {};
  const detector: Detector = {
    owner, touched: Date.now(), processing: false, samples: 0, processed: 0, sequence: 0, events: [],
    close() { closeStream(); detector.failure = new Error('Voice detection closed.'); detector.notify?.(); },
    push() { throw new Error('Voice detection is still starting.'); },
  };
  sessions.set(id, detector);
  try {
    // Verify the native binding explicitly: LiveKit otherwise allows a silent no-op VAD.
    const { VAD, initializeLogger, log, VADEventType, AudioFrame } = loadLiveKitVoiceRuntime();
    try { log(); } catch { initializeLogger({ pretty: false, level: 'error' }); }
    const vad = new VAD({
      minSpeechDuration: 224, minSilenceDuration: 650,
      prefixPaddingDuration: 400, maxBufferedSpeech: 45_000,
      activationThreshold: 0.6,
    });
    const stream = vad.stream();
    let input: ReadableStreamDefaultController<InstanceType<typeof AudioFrame>>;
    stream.updateInputStream(new ReadableStream({ start(controller) { input = controller; } }));
    let closed = false;
    closeStream = () => {
      if (closed) return;
      closed = true;
      input.close();
      stream.close();
      void vad.close();
    };
    detector.push = pcm => input.enqueue(new AudioFrame(pcm, LIVEKIT_SAMPLE_RATE, 1, pcm.length));
    void (async () => {
      try {
        for await (const event of stream) {
          if (event.type === VADEventType.INFERENCE_DONE) detector.processed = event.samplesIndex;
          if (event.type === VADEventType.START_OF_SPEECH || event.type === VADEventType.END_OF_SPEECH) {
            detector.events.push({ type: event.type === VADEventType.START_OF_SPEECH ? 'speech-start' : 'speech-end', sample: event.samplesIndex });
          }
          detector.notify?.();
        }
      } catch {
        detector.failure = new Error('Voice detection stopped. Reopen voice to retry.');
        detector.notify?.();
      }
    })();
    const timer = setInterval(() => {
      expire();
      if (!sessions.has(id)) clearInterval(timer);
    }, IDLE_MS);
    timer.unref();
    return id;
  } catch (error) {
    sessions.delete(id);
    detector.close();
    console.error('[speech] LiveKit initialization failed:', error);
    throw new VoiceDetectorError(503, 'LiveKit speech detection could not start. Reopen voice to retry.');
  }
}

function owned(owner: number, id: string): Detector {
  expire();
  const session = sessions.get(id);
  if (!session || session.owner !== owner) throw new VoiceDetectorError(404, 'Voice detection session expired. Reopen voice to retry.');
  return session;
}

export async function detectVoiceFrame(owner: number, id: string, sequence: number, pcm: Int16Array) {
  const detector = owned(owner, id);
  if (detector.processing || sequence !== detector.sequence) throw new VoiceDetectorError(409, 'Voice audio arrived out of order.');
  if (!pcm.length || pcm.length % 512 || pcm.length > LIVEKIT_MAX_BATCH_SAMPLES) throw new VoiceDetectorError(400, 'Invalid voice audio frame.');
  detector.processing = true;
  detector.touched = Date.now();
  detector.samples += pcm.length;
  try {
    detector.push(pcm);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Voice detection timed out.')), 2_000);
      const check = () => {
        if (detector.failure) { clearTimeout(timer); reject(detector.failure); }
        else if (detector.processed >= detector.samples) { clearTimeout(timer); resolve(); }
      };
      detector.notify = check;
      check();
    });
    // INFERENCE_DONE precedes the boundary event for that same frame.
    await new Promise<void>(resolve => setImmediate(resolve));
    detector.sequence++;
    return { events: detector.events.splice(0) };
  } catch {
    sessions.delete(id);
    detector.close();
    throw new VoiceDetectorError(503, 'Voice detection lost its connection. Reopen voice to retry.');
  } finally {
    detector.processing = false;
    detector.notify = undefined;
  }
}

export function closeVoiceDetector(owner: number, id: string) {
  const detector = owned(owner, id);
  sessions.delete(id);
  detector.close();
}
