import { createHash } from "node:crypto";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { BUILD_PLATES, color, fail, type SlicedPlate, type BuildPlate } from "./types.ts";

export const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_ENTRY = 64 * 1024 * 1024;
const unzip = promisify(inflateRaw);
const hash = (bytes: Buffer, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
type Entry = { name: string; size: number; compressed: number; offset: number; method: number; crc: number };

/** No extraction and no XML/HTML rendering. ZIP64, encryption and ambiguous names fail closed. */
export async function inspectSlicedFile(bytes: Buffer, filename: string): Promise<{ plates: SlicedPlate[]; thumbnails: Map<number, Buffer> }> {
  if (!/\.gcode\.3mf$/i.test(filename)) fail("Export a sliced .gcode.3mf from Bambu Studio. STL and unsliced projects need slicing first.", "sliced_file_required", 400);
  if (bytes.length < 22 || bytes.length > MAX_FILE_BYTES) fail("The sliced archive must be between 22 bytes and 128 MiB.", "archive_size", 400);
  const deadline = Date.now() + 10_000;
  const checkTime = () => { if (Date.now() > deadline) fail("Inspection exceeded 10 seconds. Export a smaller plate.", "inspection_timeout", 400); };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail("This is not a complete ZIP/3MF archive.", "corrupt_archive", 400);
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== count || !count || count > 4096 || start + centralSize !== end) fail("Split, ZIP64 or oversized archives are unsupported.", "archive_limits", 400);
  const entries = new Map<string, Entry>();
  const names = new Set<string>();
  let pos = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    checkTime();
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) fail("The archive directory is corrupt.", "corrupt_archive", 400);
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10), compressed = bytes.readUInt32LE(pos + 20), size = bytes.readUInt32LE(pos + 24);
    const nameLength = bytes.readUInt16LE(pos + 28), extraLength = bytes.readUInt16LE(pos + 30), commentLength = bytes.readUInt16LE(pos + 32), offset = bytes.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength) fail("The archive directory is corrupt.", "corrupt_archive", 400);
    const name = bytes.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    const normalized = name.toLowerCase();
    if (name.length > 240 || /[\\:\x00-\x1f\ufffd]/.test(name) || name.startsWith("/") || name.split("/").some(part => part === ".." || part === ".") || names.has(normalized)) fail("The archive contains unsafe or duplicate paths.", "unsafe_archive_path", 400);
    const unixMode = bytes.readUInt32LE(pos + 38) >>> 16;
    if ((unixMode & 0xf000) === 0xa000 || (flags & 1) || ![0, 8].includes(method) || size > MAX_ENTRY || compressed > MAX_FILE_BYTES || offset >= start) fail("The archive contains an unsupported or oversized entry.", "archive_limits", 400);
    expanded += size;
    if (expanded > MAX_EXPANDED) fail("Expanded archive exceeds 256 MiB.", "archive_limits", 400);
    names.add(normalized);
    entries.set(name, { name, size, compressed, offset, method, crc: bytes.readUInt32LE(pos + 16) });
    pos = next;
  }
  if (pos !== end) fail("The archive directory is inconsistent.", "corrupt_archive", 400);
  async function read(entry: Entry, limit = MAX_ENTRY): Promise<Buffer> {
    checkTime();
    if (entry.size > limit || entry.offset + 30 > start || bytes.readUInt32LE(entry.offset) !== 0x04034b50) fail("An archive entry is invalid or too large.", "archive_limits", 400);
    const n = bytes.readUInt16LE(entry.offset + 26), e = bytes.readUInt16LE(entry.offset + 28), begin = entry.offset + 30 + n + e;
    if (begin + entry.compressed > start || bytes.subarray(entry.offset + 30, entry.offset + 30 + n).toString("utf8") !== entry.name || bytes.readUInt16LE(entry.offset + 8) !== entry.method || (bytes.readUInt16LE(entry.offset + 6) & 1)) fail("Local and central archive entries disagree.", "corrupt_archive", 400);
    let data: Buffer;
    try { data = entry.method === 0 ? bytes.subarray(begin, begin + entry.compressed) : await unzip(bytes.subarray(begin, begin + entry.compressed), { maxOutputLength: Math.min(limit, entry.size + 1) }); }
    catch { fail("An archive entry cannot be decompressed within its limit.", "corrupt_archive", 400); }
    if (data.length !== entry.size || crc32(data) !== entry.crc) fail("Archive size or CRC validation failed.", "corrupt_archive", 400);
    checkTime(); return data;
  }
  async function json(name: string): Promise<Record<string, unknown>> {
    const entry = entries.get(name); if (!entry) return {};
    try { const parsed = JSON.parse((await read(entry, 2 * 1024 * 1024)).toString("utf8")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
    catch { fail(`Invalid sliced metadata in ${name}.`, "invalid_metadata", 400); }
  }
  const settings = await json("Metadata/project_settings.config");
  const plates: SlicedPlate[] = [], thumbnails = new Map<number, Buffer>();
  for (const entry of entries.values()) {
    const match = /^Metadata\/plate_([1-9][0-9]{0,2})\.gcode$/.exec(entry.name);
    if (!match) continue;
    if (plates.length >= 32) fail("Export at most 32 plates per archive.", "plate_limit", 400);
    const id = Number(match[1]), code = await read(entry), source = code.toString("utf8");
    if (source.includes("\0") || !/^;.*(?:BambuStudio|OrcaSlicer)/im.test(source.slice(0, 8192)) || !/^(?:G0?1)\s+[^;\r\n]*[XYZE][-\d.]/m.test(source)) fail(`Plate ${id} does not contain supported Bambu/Orca sliced machine instructions.`, "unsupported_gcode", 400);
    const header = source.slice(0, 512 * 1024) + "\n" + source.slice(-2 * 1024 * 1024), meta = await json(`Metadata/plate_${id}.json`);
    const field = (key: string) => new RegExp(`^;\\s*${key}\\s*=\\s*([^\\r\\n]+)`, "m").exec(header)?.[1]?.trim();
    const list = (key: string): string[] => {
      const value = field(key); if (value) return value.split(";").map(item => item.trim().replace(/^"|"$/g, ""));
      return Array.isArray(settings[key]) ? (settings[key] as unknown[]).map(String) : [];
    };
    const models = String(field("printer_model") ?? settings.printer_model ?? "").trim().replace(/^"|"$/g, "");
    const nozzleValues = list("nozzle_diameter");
    const nozzle = nozzleValues.length === 1 && [0.2, 0.4, 0.6, 0.8].includes(Number(nozzleValues[0])) ? Number(nozzleValues[0]) : null;
    const types = list("filament_type"), colors = list("filament_colour");
    const positions = meta.filament_ids;
    const blockers: string[] = [];
    if (!models) blockers.push("Printer profile is missing; re-export with an explicit printer profile.");
    if (!nozzle) blockers.push("A single supported nozzle diameter must be declared by the slice.");
    if (!Array.isArray(positions) || !positions.length || positions.length > 16 || positions.some(p => !Number.isInteger(p) || Number(p) < 0 || Number(p) >= types.length) || new Set(positions).size !== positions.length) blockers.push("The plate must declare explicit project filament indices and their materials.");
    const rawPlate = String(field("curr_bed_type") ?? settings.curr_bed_type ?? "").trim().replace(/^"|"$/g, "");
    const plateNames: Record<string, BuildPlate> = { "Textured PEI Plate": "textured_plate", "Smooth PEI Plate": "hot_plate", "High Temp Plate": "hot_plate", "Cool Plate": "cool_plate", "Engineering Plate": "engineering_plate", "SuperTack Plate": "supertack_plate", "Cool Plate SuperTack": "supertack_plate" };
    const buildPlate = (BUILD_PLATES as readonly string[]).includes(rawPlate) ? rawPlate as BuildPlate : plateNames[rawPlate] ?? null;
    if (!buildPlate) blockers.push("Build plate metadata is unknown; select a supported plate in the slicer and re-export.");
    const thumbnail = entries.get(`Metadata/plate_${id}.png`);
    if (thumbnail) { const png = await read(thumbnail, 2 * 1024 * 1024); if (validPng(png)) thumbnails.set(id, png); }
    const durationMatch = /estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)/i.exec(header)?.[1];
    const duration = durationMatch ? [...durationMatch.matchAll(/(\d+)\s*([dhms])/g)].reduce((s, m) => s + Number(m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2]] ?? 0), 0) : null;
    const grams = /total filament weight \[g\]\s*[:=]\s*([\d.]+)/i.exec(header)?.[1];
    plates.push({ id, path: entry.name, model: models || null, nozzle, buildPlate, filaments: blockers.some(b => b.includes("indices")) ? [] : (positions as number[]).map(index => ({ index, material: types[index], color: color(colors[index]) })), projectFilamentCount: types.length, durationSeconds: duration || null, grams: grams && Number.isFinite(Number(grams)) ? Number(grams) : null, gcodeSha256: hash(code), gcodeMd5: hash(code, "md5"), thumbnail: thumbnails.has(id), blockers });
  }
  if (!plates.length) fail("This 3MF has no printable sliced plates. Slice it in Bambu Studio and use Export plate sliced file.", "unsliced_project", 400);
  return { plates: plates.sort((a, b) => a.id - b.id), thumbnails };
}
export function validPng(bytes: Buffer): boolean {
  return bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 1024 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 1024;
}
