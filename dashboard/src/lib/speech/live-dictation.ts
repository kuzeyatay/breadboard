/** Helpers shared by the live dictation recorder and its browser-free tests. */

export const DICTATION_WAV_SAMPLE_RATE = 16_000;

type WavRange = {
  startSample?: number;
  endSample?: number;
  targetSampleRate?: number;
};

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function selectedPcm(
  chunks: readonly Float32Array[],
  startSample: number,
  endSample: number,
): Float32Array {
  const length = Math.max(0, endSample - startSample);
  const selected = new Float32Array(length);
  let sourceOffset = 0;
  let destinationOffset = 0;

  for (const chunk of chunks) {
    const chunkStart = sourceOffset;
    const chunkEnd = chunkStart + chunk.length;
    sourceOffset = chunkEnd;
    if (chunkEnd <= startSample) continue;
    if (chunkStart >= endSample) break;

    const from = Math.max(0, startSample - chunkStart);
    const to = Math.min(chunk.length, endSample - chunkStart);
    selected.set(chunk.subarray(from, to), destinationOffset);
    destinationOffset += to - from;
  }

  return destinationOffset === length ? selected : selected.slice(0, destinationOffset);
}

function resampleMono(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (!input.length || sourceSampleRate === targetSampleRate) return input;
  const ratio = sourceSampleRate / targetSampleRate;
  const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));

  // Averaging each source window is intentionally simple: speech is uploaded
  // to Whisper at 16 kHz, and averaging avoids the harsh aliasing introduced by
  // selecting only one out of every three 48 kHz microphone samples.
  for (let index = 0; index < output.length; index += 1) {
    const from = Math.floor(index * ratio);
    const to = Math.min(input.length, Math.max(from + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let source = from; source < to; source += 1) sum += input[source];
    output[index] = sum / (to - from);
  }
  return output;
}

/** Encode captured browser PCM as the 16-bit mono WAV Voicebox accepts natively. */
export function encodePcm16Wav(
  chunks: readonly Float32Array[],
  sourceSampleRate: number,
  options: WavRange = {},
): Blob {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const startSample = Math.max(0, Math.min(totalSamples, options.startSample ?? 0));
  const endSample = Math.max(
    startSample,
    Math.min(totalSamples, options.endSample ?? totalSamples),
  );
  const targetSampleRate = options.targetSampleRate ?? DICTATION_WAV_SAMPLE_RATE;
  const pcm = resampleMono(
    selectedPcm(chunks, startSample, endSample),
    sourceSampleRate,
    targetSampleRate,
  );
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);

  for (let index = 0; index < pcm.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/** Decode a browser recording container and normalize it to Voicebox-safe WAV. */
export async function decodedRecordingAsWav(
  recording: Blob,
  targetSampleRate = DICTATION_WAV_SAMPLE_RATE,
): Promise<Blob | null> {
  const AudioContextClass = audioContextConstructor();
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const samples = decoded.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        mono[index] += samples[index] / decoded.numberOfChannels;
      }
    }
    return encodePcm16Wav([mono], decoded.sampleRate, {
      targetSampleRate: Math.min(decoded.sampleRate, targetSampleRate),
    });
  } catch {
    return null;
  } finally {
    void context.close();
  }
}

export function appendRecognizedSegment(current: string, segment: string): string {
  const next = segment.trim();
  if (!next) return current.trim();
  const existing = current.trim();
  return existing ? `${existing} ${next}` : next;
}

/** Replace only dictation's draft text, preserving text typed around it. */
export function replaceDictationPreview(
  currentValue: string,
  previousPreview: string,
  nextPreview: string,
): string {
  if (previousPreview) {
    const position = currentValue.lastIndexOf(previousPreview);
    if (position >= 0) {
      return `${currentValue.slice(0, position)}${nextPreview}${currentValue.slice(position + previousPreview.length)}`;
    }
  }
  if (!nextPreview) return currentValue;
  const separator = currentValue.length > 0 && !/\s$/.test(currentValue) ? " " : "";
  return `${currentValue}${separator}${nextPreview}`;
}
