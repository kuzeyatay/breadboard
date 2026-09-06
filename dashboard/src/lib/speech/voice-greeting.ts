import { speechRequest } from './request-client';
import { playSpeechBlob, stopSpeechPlayback } from './playback';
import type { SubscriptionVoice } from './subscription-live';

export const VOICE_GREETING = "Hi! I'm here. What would you like to work on?";

/** Use the selected provider: the existing OpenAI call, or Voicebox synthesis. */
export async function speakVoiceGreeting(signal: AbortSignal, voice?: Pick<SubscriptionVoice, 'speak' | 'stopSpeaking'>): Promise<void> {
  if (signal.aborted) return;
  if (voice) {
    const stop = () => voice.stopSpeaking();
    signal.addEventListener('abort', stop, { once: true });
    try { await voice.speak(VOICE_GREETING); }
    finally { signal.removeEventListener('abort', stop); }
    return;
  }
  const response = await speechRequest('/api/speech/synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: VOICE_GREETING }), signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'The selected voice could not speak the greeting.');
  }
  const blob = await response.blob();
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { signal.removeEventListener('abort', stop); if (error) reject(error); else resolve(); };
    const stop = () => { stopSpeechPlayback(); finish(); };
    signal.addEventListener('abort', stop, { once: true });
    void playSpeechBlob(blob, finish).catch(error => { signal.removeEventListener('abort', stop); reject(error); });
  });
}
