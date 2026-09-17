import { pcmWav } from "./pcm-wav";
export { pcmWav } from "./pcm-wav";
import { connectSubscriptionVoice } from "./subscription-live";

/** Buffered downloads/uploads; live microphone and playback use the persistent connection directly. */
export async function subscriptionSpeech(input: { text: string } | { file: Blob }, signal?: AbortSignal | null): Promise<Blob | string> {
  let voice = await connectSubscriptionVoice({ signal: signal || undefined, capture: "text" in input, mode: "text" in input ? "speak" : "transcribe" });
  try {
    if ("file" in input) return await voice.transcribeFile(input.file);
    if (!input.text.trim()) throw new Error("There is no text to speak.");
    for (let attempt = 0; ; attempt++) {
      try { await voice.speak(input.text, false); break; }
      catch (error) {
        if (attempt > 0 || signal?.aborted || !error || typeof error !== 'object' ||
          !('safeToRetry' in error) || error.safeToRetry !== true) throw error;
        await voice.close();
        signal?.throwIfAborted();
        voice = await connectSubscriptionVoice({ signal: signal || undefined, capture: true, mode: 'speak' });
      }
    }
    const blob = await voice.capture();
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      const samples = audio.getChannelData(0);
      if (!samples.some(value => Math.abs(value) > 0.005)) throw new Error("ChatGPT returned no audible speech.");
      return pcmWav([samples], audio.sampleRate);
    } finally { await context.close(); }
  } finally { await voice.close(); }
}
