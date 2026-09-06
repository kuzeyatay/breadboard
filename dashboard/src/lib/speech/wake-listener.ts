import { heardHeyBread } from './assistant-preferences';
import { prepareLocalSpeech } from './prepare-client';
import { speechRequest } from './request-client';
import { connectSubscriptionVoice, subscriptionSelected, type SubscriptionVoice } from './subscription-live';
import { encodePcm16Wav } from './live-dictation';
import { advanceVoiceTurn, frameLevel, initialVoiceTurn } from './voice-conversation';

/** Ambient audio is discarded after each short utterance; no chat is sent until wake. */
export async function listenForHeyBread(signal: AbortSignal, wake: () => void, status: (text: string) => void): Promise<void> {
  let stream: MediaStream | null = null, context: AudioContext | null = null, voice: SubscriptionVoice | null = null;
  let processor: ScriptProcessorNode | null = null;
  let fired = false;
  const transcript = (text: string) => { if (!signal.aborted && !fired && heardHeyBread(text)) { fired = true; wake(); } };
  const stop = () => { stream?.getTracks().forEach(track => track.stop()); void voice?.close(); if (processor) processor.onaudioprocess = null; void context?.close().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    status('Preparing “Hey Bread”…');
    await prepareLocalSpeech(signal); signal.throwIfAborted();
    const cloud = await subscriptionSelected(signal);
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    signal.throwIfAborted();
    if (cloud) {
      voice = await connectSubscriptionVoice({ microphone: stream, mode: 'transcribe', signal, onTranscript: transcript });
    } else {
      context = new AudioContext(); await context.resume();
      const source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      const sink = context.createGain(); sink.gain.value = 0;
      source.connect(processor); processor.connect(sink); sink.connect(context.destination);
      let turn = initialVoiceTurn(), chunks: Float32Array[] = [], transcribing = false;
      let queued: Float32Array[] | null = null;
      const sampleRate = context.sampleRate;
      const drain = async () => {
        if (transcribing) return;
        transcribing = true;
        try {
          while (queued && !signal.aborted && !fired) {
            const audio = queued; queued = null;
            const form = new FormData(); form.set('file', encodePcm16Wav(audio, sampleRate), 'wake.wav');
            const response = await speechRequest('/api/speech/transcribe', { method: 'POST', body: form, signal });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Wake transcription failed.');
            transcript(typeof body.text === 'string' ? body.text : '');
          }
        } catch (error) { if (!signal.aborted) status(error instanceof Error ? error.message : 'Wake transcription failed.'); }
        finally { transcribing = false; }
      };
      processor.onaudioprocess = event => {
        if (signal.aborted || fired) return;
        const input = event.inputBuffer.getChannelData(0);
        turn = advanceVoiceTurn(turn, frameLevel(input), input.length / sampleRate * 1000);
        chunks.push(new Float32Array(input));
        // A little lead-in preserves the 'h' without retaining minutes of room noise.
        if (!turn.heardSpeech && chunks.length > 4) chunks.shift();
        if (!turn.heardSpeech || (turn.silenceMs < 650 && turn.elapsedMs < 4500)) {
          if (!turn.heardSpeech) turn = { ...turn, elapsedMs: 0 };
          return;
        }
        const audio = chunks; const speechMs = turn.speechMs;
        chunks = []; turn = initialVoiceTurn();
        if (speechMs < 200) return;
        // Keep capturing during inference, retaining at most the latest utterance.
        queued = audio; void drain();
      };
    }
    signal.throwIfAborted(); status('Listening for “Hey Bread”');
    await new Promise<void>((resolve, reject) => {
      const ended = () => { cleanup(); reject(new Error('The microphone disconnected. Reconnect it to resume “Hey Bread”.')); };
      const aborted = () => { cleanup(); resolve(); };
      const cleanup = () => { signal.removeEventListener('abort', aborted); stream?.getTracks().forEach(track => track.removeEventListener('ended', ended)); };
      stream?.getTracks().forEach(track => track.addEventListener('ended', ended));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
  } finally { signal.removeEventListener('abort', stop); stop(); }
}
