import { connectSubscriptionVoice, subscriptionSelected, type SubscriptionVoice } from './subscription-live';
import { prepareLocalSpeech } from './prepare-client';

// All dictation surfaces use the same microphone processing. Garden/terminal
// and system-wide holds use this connection; recordings use requestTranscript.
export const DICTATION_MICROPHONE: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
export const selectDictationProvider = subscriptionSelected;
/** Negotiate the input transport without requesting or attaching a microphone. */
export function prepareDictationProvider(signal: AbortSignal): Promise<SubscriptionVoice> {
  return connectSubscriptionVoice({ mode: 'conversation', inputOnly: true, listening: false, signal });
}
export async function openDictationProvider(microphone: MediaStream, selected: Promise<boolean>, signal: AbortSignal,
  onTranscript?: (text: string, final?: boolean) => void, onDisconnect?: (error: Error) => void, onInputReady?: () => void): Promise<SubscriptionVoice | null> {
  const subscription = await selected;
  signal.throwIfAborted();
  if (subscription) {
    return connectSubscriptionVoice({ microphone, signal, onTranscript, onDisconnect, onInputReady, inputOnly: true });
  }
  void prepareLocalSpeech(signal).catch(() => {});
  return null;
}
