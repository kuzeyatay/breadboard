import { playSpeechBlob, playSubscriptionText, stopSpeechPlayback } from './playback';
import { speechRequest } from './request-client';
import { speakableText } from './voice-conversation';

export async function speakNotification(text: string, signal: AbortSignal): Promise<void> {
  text = speakableText(text).slice(0, 4000);
  if (!text || signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { signal.removeEventListener('abort', stop); if (error) reject(error); else resolve(); };
    const stop = () => { stopSpeechPlayback(); finish(); };
    signal.addEventListener('abort', stop, { once: true });
    void (async () => {
      if (await playSubscriptionText(text, finish, signal)) return;
      const response = await speechRequest('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || 'The selected voice could not read this notification.'); }
      const blob = await response.blob(); signal.throwIfAborted();
      await playSpeechBlob(blob, finish);
    })().catch(error => finish(signal.aborted ? undefined : error));
  });
}
