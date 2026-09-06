import { connectSubscriptionVoice } from "./subscription-live";

/** Buffered downloads/uploads; live microphone and playback use the persistent connection directly. */
export async function subscriptionSpeech(input: { text: string } | { file: Blob }, signal?: AbortSignal | null): Promise<Blob | string> {
  const voice = await connectSubscriptionVoice({ signal: signal || undefined, capture: "text" in input, mode: "text" in input ? "speak" : "transcribe" });
  try {
    if ("file" in input) return await voice.transcribeFile(input.file);
    if (!input.text.trim()) throw new Error("There is no text to speak.");
    await voice.speak(input.text, false);
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

export function pcmWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((count, chunk) => count + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const label = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); label(8, "WAVE"); label(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 32767, true); offset += 2; }
  return new Blob([bytes], { type: "audio/wav" });
}
