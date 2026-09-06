import fs from "node:fs";
import { MAX_AUDIO_BYTES } from "../acestep/client.ts";
export interface WavInfo {
  duration: number;
  sampleRate: number;
  channels: number;
  bits: number;
  encoding: number;
  frames: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
  peak: number;
  peakDbfs: number | null;
  rmsDbfs: number | null;
  clippedSamples: number;
}
/** Bounded PCM/IEEE-float decoder. Compressed/RF64 files fail closed; no subprocess is needed. */
export function inspectWav(filename: string): WavInfo {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 44 || stat.size > MAX_AUDIO_BYTES)
    throw new Error("invalid_audio_file");
  const fd = fs.openSync(filename, "r");
  const read = (offset: number, length: number) => {
    const out = Buffer.alloc(length);
    if (fs.readSync(fd, out, 0, length, offset) !== length)
      throw new Error("truncated_wav");
    return out;
  };
  try {
    const header = read(0, 12);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) + 8 !== stat.size)
      throw new Error("invalid_wav_header");
    let encoding = 0, channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, dataOffset = 0, dataBytes = 0;
    let chunks = 0;
    for (let offset = 12; offset + 8 <= stat.size;) {
      if (++chunks > 128)
        throw new Error("too_many_wav_chunks");
      const chunk = read(offset, 8), id = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4);
      if (offset + 8 + size > stat.size)
        throw new Error("truncated_wav_chunk");
      if (id === "fmt ") {
        if (encoding || size < 16 || size > 4096)
          throw new Error("invalid_wav_format");
        const fmt = read(offset + 8, size);
        encoding = fmt.readUInt16LE(0);
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
        blockAlign = fmt.readUInt16LE(12);
        bits = fmt.readUInt16LE(14);
        if (encoding === 65534 && size >= 40 && fmt.readUInt16LE(16) >= 22) {
          if (fmt.toString("hex", 28, 40) !== "00001000800000aa00389b71")
            throw new Error("unsupported_wav_subformat");
          encoding = fmt.readUInt32LE(24);
        }
        if (![1, 3].includes(encoding) || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 192000 || ![16, 24, 32].includes(bits) || (encoding === 3 && bits !== 32) || blockAlign !== channels * bits / 8 || fmt.readUInt32LE(8) !== sampleRate * blockAlign)
          throw new Error("unsupported_wav_format");
      }
      else if (id === "data") {
        if (dataOffset)
          throw new Error("duplicate_wav_data");
        dataOffset = offset + 8;
        dataBytes = size;
      }
      offset += 8 + size + (size % 2);
    }
    if (!encoding || !dataOffset || !dataBytes || dataBytes % blockAlign)
      throw new Error("empty_or_invalid_wav");
    const frames = dataBytes / blockAlign, duration = frames / sampleRate;
    if (duration < 0.05 || duration > 601)
      throw new Error("audio_duration_out_of_bounds");
    let peak = 0, sum = 0, clippedSamples = 0, samples = 0;
    const stride = bits / 8, chunkSize = Math.floor(65536 / blockAlign) * blockAlign;
    for (let position = 0; position < dataBytes; position += chunkSize) {
      const bytes = read(dataOffset + position, Math.min(chunkSize, dataBytes - position));
      for (let index = 0; index < bytes.length; index += stride) {
        const value = encoding === 3 ? bytes.readFloatLE(index) : bytes.readIntLE(index, stride) / 2 ** (bits - 1);
        if (!Number.isFinite(value) || Math.abs(value) > 16)
          throw new Error("invalid_audio_samples");
        peak = Math.max(peak, Math.abs(value));
        sum += value * value;
        samples++;
        if (Math.abs(value) >= 1 - 1 / 2 ** (bits - 1))
          clippedSamples++;
      }
    }
    return {
      duration, sampleRate, channels, bits, encoding, frames, blockAlign, dataOffset, dataBytes, peak,
      peakDbfs: peak ? 20 * Math.log10(peak) : null, rmsDbfs: sum ? 10 * Math.log10(sum / samples) : null, clippedSamples
    };
  }
  finally {
    fs.closeSync(fd);
  }
}
/** Copies only the requested frame interval into the original container. Outside PCM stays byte-identical. */
export function spliceWav(source: string, generated: string, output: string, interval: {
  start: number;
  end: number;
}): WavInfo {
  const a = inspectWav(source), b = inspectWav(generated);
  if (["sampleRate", "channels", "bits", "encoding", "frames"].some(key => a[key as keyof WavInfo] !== b[key as keyof WavInfo]))
    throw new Error("precise_edit_requires_matching_pcm_and_duration");
  const start = Math.round(interval.start * a.sampleRate) * a.blockAlign;
  const end = Math.round(interval.end * a.sampleRate) * a.blockAlign;
  if (start < 0 || end <= start || end > a.dataBytes)
    throw new Error("invalid_splice_interval");
  fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL);
  const input = fs.openSync(generated, "r"), target = fs.openSync(output, "r+");
  try {
    const bytes = Buffer.alloc(65536);
    for (let at = start; at < end;) {
      const size = Math.min(bytes.length, end - at);
      if (fs.readSync(input, bytes, 0, size, b.dataOffset + at) !== size)
        throw new Error("truncated_splice_source");
      if (fs.writeSync(target, bytes, 0, size, a.dataOffset + at) !== size)
        throw new Error("incomplete_splice_write");
      at += size;
    }
    fs.fsyncSync(target);
  }
  finally {
    fs.closeSync(input);
    fs.closeSync(target);
  }
  return inspectWav(output);
}
