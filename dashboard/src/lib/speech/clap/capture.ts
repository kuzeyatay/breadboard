import type { ClapPreferences, GestureControl } from './preferences';
import type { GestureDetectorOptions } from './gesture-detector';
import type { ClapDiagnostic } from './detector';
export interface ClapGesture { type: 'gesture'; control?: GestureControl; id: string; pattern: 'single' | 'double'; audioTime: number; score?: number; impulseRms?: number }
export interface ClapMeter { type: 'meter'; control?: GestureControl; rms: number; noise: number; threshold: number; diagnostic: ClapDiagnostic; accepted: number; audioTime: number }
export type CaptureStatus = 'requesting' | 'calibrating' | 'listening' | 'suspended';

/** Resolves only after owned capture is fully closed, including late permission grants. */
export async function captureClaps(signal: AbortSignal, preferences: ClapPreferences, callbacks: {
  status: (status: CaptureStatus) => void; gesture: (event: ClapGesture) => void; meter: (event: ClapMeter) => void;
}, options: GestureDetectorOptions = {}): Promise<void> {
  let stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });
  let failure: Error | undefined;
  const stop = () => {
    stream?.getTracks().forEach(t => t.stop());
    if (node) { node.port.onmessage = null; node.port.close(); node.disconnect(); }
    source?.disconnect(); resolveStopped();
  };
  const resume = () => { if (!signal.aborted && context?.state === 'suspended') void context.resume().catch(() => {}); };
  const deviceLost = () => { failure = new Error('The selected microphone disconnected. Choose it again in Clap controls.'); stop(); };
  const stateChanged = () => {
    node?.port.postMessage('reset');
    callbacks.status(context?.state === 'running' ? 'calibrating' : 'suspended');
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted(); callbacks.status('requesting');
    // exact prevents Chromium silently choosing another physical device.
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(preferences.deviceId ? { deviceId: { exact: preferences.deviceId } } : {}),
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
    } });
    signal.throwIfAborted();
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', deviceLost);
    context = new AudioContext();
    await context.audioWorklet.addModule('/audio/clap-controls.js'); signal.throwIfAborted();
    node = new AudioWorkletNode(context, 'breadboard-clap-controls', {
      processorOptions: { sensitivity: preferences.sensitivity, pattern: preferences.pattern, ...options, session: crypto.randomUUID() },
    });
    let lastId = ''; let lastTime = -1;
    node.port.onmessage = (message: MessageEvent<ClapGesture | ClapMeter>) => {
      if (signal.aborted) return;
      const e = message.data;
      if (e.type === 'gesture' && e.id !== lastId && Number.isFinite(e.audioTime) && e.audioTime > lastTime) {
        lastId = e.id; lastTime = e.audioTime; callbacks.gesture(e);
      } else if (e.type === 'meter') {
        callbacks.status(e.diagnostic === 'warming' ? 'calibrating' : 'listening'); callbacks.meter(e);
      }
    };
    node.onprocessorerror = () => { failure = new Error('Clap audio processing stopped. Retry in Clap controls.'); stop(); };
    source = context.createMediaStreamSource(stream); source.connect(node).connect(context.destination);
    context.addEventListener('statechange', stateChanged);
    window.addEventListener('pointerdown', resume); window.addEventListener('keydown', resume);
    stateChanged(); resume(); await stopped;
    if (failure && !signal.aborted) throw failure;
  } finally {
    signal.removeEventListener('abort', stop);
    window.removeEventListener('pointerdown', resume); window.removeEventListener('keydown', resume);
    context?.removeEventListener('statechange', stateChanged);
    stream?.getTracks().forEach(t => t.removeEventListener('ended', deviceLost));
    stop();
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}
