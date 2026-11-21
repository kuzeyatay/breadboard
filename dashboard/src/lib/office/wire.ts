/**
 * JSON for IPC values. Electron IPC is structured clone; between the browser
 * and the dashboard, binary data and the other non-JSON clone types travel
 * tagged and are rebuilt on the other side.
 */
const TAG = "__genofficeWire";

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function fromBase64(text: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"));
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeWire(value: unknown): unknown {
  if (value === undefined) return { [TAG]: "undefined" };
  if (value === null || typeof value !== "object") return typeof value === "number" && !Number.isFinite(value) ? { [TAG]: "number", value: String(value) } : value;
  if (value instanceof ArrayBuffer) return { [TAG]: "ab", b64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    const kind = value.constructor.name;
    return { [TAG]: "view", kind, b64: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  }
  if (value instanceof Date) return { [TAG]: "date", value: value.toISOString() };
  if (value instanceof Map) return { [TAG]: "map", value: [...value].map(([key, item]) => [encodeWire(key), encodeWire(item)]) };
  if (value instanceof Set) return { [TAG]: "set", value: [...value].map(encodeWire) };
  if (value instanceof Error) return { [TAG]: "error", message: value.message, name: value.name };
  if (Array.isArray(value)) return value.map(encodeWire);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item !== "function") out[key] = encodeWire(item);
  return out;
}

const VIEWS: Record<string, new (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView> = {
  Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
  BigInt64Array: BigInt64Array as never, BigUint64Array: BigUint64Array as never,
};

export function decodeWire(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeWire);
  const record = value as Record<string, unknown>;
  switch (record[TAG]) {
    case undefined: break;
    case "undefined": return undefined;
    case "number": return Number(record.value);
    case "ab": { const bytes = fromBase64(record.b64 as string); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
    case "view": {
      const bytes = fromBase64(record.b64 as string), kind = record.kind as string;
      // Buffers cross as Uint8Array, as they do over Electron IPC.
      if (kind === "DataView") return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const View = VIEWS[kind];
      if (!View) return bytes;
      const copy = bytes.slice().buffer;
      return new View(copy, 0, copy.byteLength / ((View as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT));
    }
    case "date": return new Date(record.value as string);
    case "map": return new Map((record.value as [unknown, unknown][]).map(([key, item]) => [decodeWire(key), decodeWire(item)]));
    case "set": return new Set((record.value as unknown[]).map(decodeWire));
    case "error": return Object.assign(new Error(record.message as string), { name: record.name });
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = decodeWire(item);
  return out;
}
