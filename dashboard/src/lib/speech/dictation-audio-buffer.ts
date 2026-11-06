import { DICTATION_WORKLET_SOURCE } from './dictation-worklet';

export type BufferedDictationAudio = {
  stream: MediaStream;
  ready?: Promise<void>;
  start(): void;
  stopCapture(): void;
  finish(): Promise<void>;
  close(): void;
};

/** Capture and queue on the audio thread so provider setup cannot drop speech. */
export function bufferDictationAudio(microphone: MediaStream): BufferedDictationAudio {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(microphone);
  const destination = context.createMediaStreamDestination();
  const sink = context.createGain(); sink.gain.value = 0;
  const createdAt = performance.now();
  let processor: AudioWorkletNode | undefined;
  let started = false, capturing = true, closed = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let drain: Promise<void> | undefined, resolveDrain: (() => void) | undefined, rejectDrain: ((error: Error) => void) | undefined;
  const url = URL.createObjectURL(new Blob([DICTATION_WORKLET_SOURCE], { type: 'text/javascript' }));
  const ready = (async () => {
    try {
      await Promise.all([context.resume(), context.audioWorklet.addModule(url)]);
      if (closed) throw new DOMException('Audio buffer closed', 'AbortError');
      processor = new AudioWorkletNode(context, 'breadboard-dictation-buffer', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      processor.port.onmessage = event => {
        if (event.data === 'drained') { clearTimeout(drainTimer); resolveDrain?.(); resolveDrain = rejectDrain = undefined; }
      };
      processor.onprocessorerror = () => rejectDrain?.(new Error('Dictation audio stopped processing'));
      processor.connect(destination); processor.connect(sink); sink.connect(context.destination);
      if (capturing) source.connect(processor); else processor.port.postMessage('stop');
      if (started) processor.port.postMessage('start');
    } finally { URL.revokeObjectURL(url); }
  })();
  void ready.catch(() => {});
  return {
    stream: destination.stream, ready,
    start() { if (!closed) { started = true; processor?.port.postMessage('start'); } },
    stopCapture() { capturing = false; processor?.port.postMessage('stop'); source.disconnect(); },
    finish() {
      if (closed) return Promise.reject(new DOMException('Audio buffer closed', 'AbortError'));
      capturing = false; source.disconnect();
      if (!drain) {
        drain = new Promise<void>((resolve, reject) => { resolveDrain = resolve; rejectDrain = reject; });
        void ready.then(() => { if (!closed) processor?.port.postMessage('finish'); }, error => rejectDrain?.(error));
        drainTimer = setTimeout(() => rejectDrain?.(new Error('Dictation audio stopped processing')), performance.now() - createdAt + 6000);
      }
      return drain;
    },
    close() {
      if (closed) return;
      closed = true; capturing = false; clearTimeout(drainTimer);
      rejectDrain?.(new DOMException('Audio buffer closed', 'AbortError'));
      source.disconnect(); processor?.disconnect(); processor?.port.close(); sink.disconnect();
      destination.stream.getTracks().forEach(track => track.stop());
      void context.close();
    },
  };
}