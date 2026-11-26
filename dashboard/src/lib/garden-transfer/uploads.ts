import { Readable } from "node:stream";
import { createInflateRaw, crc32 } from "node:zlib";
import type AdmZip from "adm-zip";
import { gardenFiles } from "../garden-files/repository.ts";
import { gardenFilePath, type GardenFileScope, type StagedGardenFile } from "../garden-files/store.ts";
import { addJsonEntry, readJsonEntry, type PackBudget } from "./archive.ts";
import { TransferError, type GardenContentSummary } from "./format.ts";
import type { StreamingArchive } from "./stream-archive.ts";

interface Upload {
  path: string;
  kind: "folder" | "file";
  visibility: "private" | "garden";
}
export interface StagedUpload extends Upload { stage?: StagedGardenFile }

async function* uploadBytes(entry: AdmZip.IZipEntry) {
  const { method, size, crc } = entry.header;
  if (method !== 0 && method !== 8) throw new TransferError("Unsupported compression in an uploaded file.");
  const compressed = Readable.from([entry.getCompressedData()]);
  const bytes = method === 8 ? compressed.pipe(createInflateRaw()) : compressed;
  let count = 0;
  let checksum = 0;
  for await (const chunk of bytes) {
    count += chunk.length;
    if (count > size) throw new TransferError("An uploaded file exceeds its declared size.");
    checksum = crc32(chunk, checksum);
    yield chunk;
  }
  if (count !== size || checksum !== crc) throw new TransferError("An uploaded file failed its integrity check.");
}

// The inventory lives beside the Quartz tree. Archive entries use ordinal
// names, so uploaded names never become host paths during extraction.
export function packUploads(
  zip: StreamingArchive, prefix: string, scope: GardenFileScope,
  sharedOnly: boolean, content: GardenContentSummary, budget: PackBudget,
) {
  const store = gardenFiles();
  const entries = store.list(scope).filter(entry => !sharedOnly || (entry.kind === "file" && entry.visibility === "garden"));
  if (!entries.length) return;
  const inventory: Upload[] = [];
  for (const [index, entry] of entries.entries()) {
    inventory.push({ path: entry.path, kind: entry.kind, visibility: entry.visibility });
    if (entry.kind === "folder") continue;
    const file = store.content(scope, entry.id, entry.version);
    zip.addSourceFile(prefix + "uploads/" + index, file.path, file.version.size);
    content.files++;
    content.bytes += file.version.size;
    budget.bytes += file.version.size;
  }
  addJsonEntry(zip, prefix + "uploads.json", inventory);
}

export async function stageUploads(zip: AdmZip, prefix: string, result: StagedUpload[]) {
  if (!zip.getEntry(prefix + "uploads.json")) return;
  const entries = readJsonEntry(zip, prefix + "uploads.json");
  if (!Array.isArray(entries)) throw new TransferError("Invalid uploaded file inventory.");
  const store = gardenFiles();
  const paths = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (!entry || !["file", "folder"].includes(entry.kind) || !["private", "garden"].includes(entry.visibility)) throw new TransferError("Invalid upload entry.");
    const path = gardenFilePath(entry.path);
    if (paths.has(path.toLowerCase())) throw new TransferError("Duplicate upload path.");
    paths.add(path.toLowerCase());
    const item: StagedUpload = { path, kind: entry.kind, visibility: entry.visibility };
    if (item.kind === "file") {
      const source = zip.getEntry(prefix + "uploads/" + index);
      if (!source || source.isDirectory || source.header.size > store.maxBytes) throw new TransferError("An uploaded file is missing or exceeds the upload limit.");
      item.stage = await store.stage(Readable.from(uploadBytes(source)));
    }
    result.push(item);
  }
}

export function restoreUploads(scope: GardenFileScope, uploads: StagedUpload[]) {
  const store = gardenFiles();
  for (const item of uploads) {
    const entry = item.stage ? store.import(scope, item.path, item.stage) : store.createFolder(scope, item.path);
    if (entry.path !== item.path) throw new TransferError("An uploaded file conflicts with another entry in this Garden.");
    if (item.kind === "file" && item.visibility === "garden") store.share(scope, entry.id, entry.revision, "garden");
  }
}
