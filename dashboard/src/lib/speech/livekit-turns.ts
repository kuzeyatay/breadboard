/** Wire format for the local LiveKit detector. No provider keys or text cross it. */
export const LIVEKIT_SAMPLE_RATE = 16_000;
export const LIVEKIT_FRAME_SAMPLES = 1_024;
export const LIVEKIT_MAX_BATCH_SAMPLES = 8_192;
export type LiveKitTurnEvent = { type: 'speech-start' | 'speech-end'; sample: number };

/** Continuous resampling: retain the fractional position across capture callbacks. */
export function createVoicePcmEncoder(sampleRate: number) {
  const ratio = sampleRate / LIVEKIT_SAMPLE_RATE;
  let offset = 0;
  let pending: number[] = [];
  return (input: Float32Array): Int16Array[] => {
    for (; offset < input.length; offset += ratio) {
      const value = Math.max(-1, Math.min(1, input[Math.floor(offset)]));
      pending.push(Math.round(value * (value < 0 ? 32768 : 32767)));
    }
    offset -= input.length;
    const frames: Int16Array[] = [];
    while (pending.length >= LIVEKIT_FRAME_SAMPLES) {
      frames.push(Int16Array.from(pending.slice(0, LIVEKIT_FRAME_SAMPLES)));
      pending = pending.slice(LIVEKIT_FRAME_SAMPLES);
    }
    return frames;
  };
}
