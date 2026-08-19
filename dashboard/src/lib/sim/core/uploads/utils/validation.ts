// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/uploads/utils/validation.ts
// (the size cap and image content sniffing the executor's file-tool processor uses);
// adapted for Breadboard. The extension allowlists and knowledge-base validators
// alongside them were not vendored.

export const MAX_FILE_SIZE = 100 * 1024 * 1024;

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isValidPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES);
}

/**
 * A stored contentType is client-declared, so anything rendering a file inline derives the
 * served type from the bytes. SVG is deliberately excluded: it can carry script.
 */
export function sniffImageContentType(buffer: Buffer): string | null {
  if (isValidPng(buffer)) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const header = buffer.toString("latin1", 0, 6);
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
