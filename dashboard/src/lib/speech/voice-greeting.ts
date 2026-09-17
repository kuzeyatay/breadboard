import { speechRequest } from './request-client';
import { playSpeechBlob, stopSpeechPlayback } from './playback';
import type { SubscriptionVoice } from './subscription-live';

const VOICE_GREETINGS = [
  "Hey! What's on your mind?",
  "I'm here. What can I help with?",
  "Hi there! What are we working on?",
  "Ready when you are. What's the plan?",
  "Hey! What would you like to do?",
  "I'm listening. Where should we start?",
  "Hello! What can we figure out together?",
  "You rang? What can I help with?",
  "Hey there! What's next?",
  "All ears. What have you got?",
];
const LAST_GREETING_KEY = 'breadboard:voice:last-greeting';
let lastGreeting: string | null = null;

/** Remember across voice windows, with an in-memory fallback if storage is blocked. */
export function nextVoiceGreeting(): string {
  try { lastGreeting = window.localStorage.getItem(LAST_GREETING_KEY) ?? lastGreeting; }
  catch { /* Keep the last greeting in memory when storage is unavailable. */ }
  const choices = VOICE_GREETINGS.filter(greeting => greeting !== lastGreeting);
  const greeting = choices[Math.floor(Math.random() * choices.length)];
  lastGreeting = greeting;
  try { window.localStorage.setItem(LAST_GREETING_KEY, greeting); }
  catch { /* Greeting playback does not depend on storage. */ }
  return greeting;
}

/** Use the selected provider: the existing OpenAI call, or Voicebox synthesis. */
export async function speakVoiceGreeting(text: string, signal: AbortSignal, voice?: Pick<SubscriptionVoice, 'speak' | 'stopSpeaking'>): Promise<void> {
  if (signal.aborted) return;
  const timeout = new AbortController();
  const greetingSignal = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error('The voice greeting timed out.')), 25_000);
  let aborted = () => {};
  try {
    // A stalled provider or media element must not keep the microphone waiting
    // on Hello. Abort retires pending playback before the caller starts input.
    await new Promise<void>((resolve, reject) => {
      aborted = () => reject(greetingSignal.reason);
      greetingSignal.addEventListener('abort', aborted, { once: true });
      void playVoiceGreeting(text, greetingSignal, voice).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    greetingSignal.removeEventListener('abort', aborted);
  }
}

async function playVoiceGreeting(text: string, signal: AbortSignal, voice?: Pick<SubscriptionVoice, 'speak' | 'stopSpeaking'>): Promise<void> {
  if (voice) {
    const stop = () => voice.stopSpeaking();
    signal.addEventListener('abort', stop, { once: true });
    try { await voice.speak(text); }
    finally { signal.removeEventListener('abort', stop); }
    return;
  }
  const response = await speechRequest('/api/speech/synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }), signal,
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
