// Dependency-free PNG cropping for source-visual extraction.
//
// The page snapshots Breadboard stores are produced by canvas.toDataURL(), which
// always emits 8-bit, non-interlaced PNGs (RGBA or RGB). That narrow, known
// input lets us crop with zlib alone instead of pulling in sharp/node-canvas.
// Anything outside that envelope (16-bit, palette, interlaced) returns null and
// callers fall back to using the uncropped page image.

import zlib from "zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHANNELS_BY_COLOR_TYPE: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // RGB
  4: 2, // grayscale + alpha
  6: 4, // RGBA
};

interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  colorType: number;
  /** Unfiltered raw pixel rows: height * width * channels bytes. */
  pixels: Buffer;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Buffer): DecodedPng | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (dataStart + length + 4 > buffer.length) return null;
    const data = buffer.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) return null;

  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idatParts));
  } catch {
    return null;
  }

  const bytesPerPixel = channels;
  const rowLength = width * bytesPerPixel;
  if (raw.length < height * (rowLength + 1)) return null;

  const pixels = Buffer.alloc(height * rowLength);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowLength + 1)];
    const rowStart = y * (rowLength + 1) + 1;
    const outStart = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const value = raw[rowStart + x];
      const left = x >= bytesPerPixel ? pixels[outStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[outStart - rowLength + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[outStart - rowLength + x - bytesPerPixel] : 0;
      let decoded: number;
      switch (filter) {
        case 0: decoded = value; break;
        case 1: decoded = value + left; break;
        case 2: decoded = value + up; break;
        case 3: decoded = value + Math.floor((left + up) / 2); break;
        case 4: decoded = value + paethPredictor(left, up, upLeft); break;
        default: return null;
      }
      pixels[outStart + x] = decoded & 0xff;
    }
  }

  return { width, height, channels, colorType, pixels };
}

export function encodePng(decoded: DecodedPng): Buffer {
  const { width, height, channels, colorType, pixels } = decoded;
  const rowLength = width * channels;
  const raw = Buffer.alloc(height * (rowLength + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowLength + 1)] = 0; // filter: None
    pixels.copy(raw, y * (rowLength + 1) + 1, y * rowLength, (y + 1) * rowLength);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface CropBox {
  /** Fractions of image width/height in [0, 1]. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crops a PNG buffer to the given fractional bounding box (with a small pixel
 * margin). Returns null when the PNG cannot be safely decoded or the crop is
 * degenerate, so callers can fall back to the full page image.
 */
export function cropPng(buffer: Buffer, box: CropBox, marginPx = 6): Buffer | null {
  const decoded = decodePng(buffer);
  if (!decoded) return null;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const x0 = clamp(Math.round(box.x * decoded.width) - marginPx, 0, decoded.width - 1);
  const y0 = clamp(Math.round(box.y * decoded.height) - marginPx, 0, decoded.height - 1);
  const x1 = clamp(Math.round((box.x + box.width) * decoded.width) + marginPx, x0 + 1, decoded.width);
  const y1 = clamp(Math.round((box.y + box.height) * decoded.height) + marginPx, y0 + 1, decoded.height);

  const cropWidth = x1 - x0;
  const cropHeight = y1 - y0;
  // Reject crops too small to show anything, or that are basically the full page.
  if (cropWidth < 24 || cropHeight < 24) return null;

  const rowLength = decoded.width * decoded.channels;
  const cropRowLength = cropWidth * decoded.channels;
  const pixels = Buffer.alloc(cropHeight * cropRowLength);
  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = (y0 + y) * rowLength + x0 * decoded.channels;
    decoded.pixels.copy(pixels, y * cropRowLength, sourceStart, sourceStart + cropRowLength);
  }

  return encodePng({
    width: cropWidth,
    height: cropHeight,
    channels: decoded.channels,
    colorType: decoded.colorType,
    pixels,
  });
}
