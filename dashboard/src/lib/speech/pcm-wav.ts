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
