import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { findDocumentBlob } from "./document-blob-store.ts";

type Owner = { userId: number; blobId: string; root?: string };
const MAX_READING_BYTES = 8 * 1024 * 1024;

export function readStoredDocumentText(owner: Owner): string | null {
  const blob = findDocumentBlob(owner);
  if (!blob) return null;
  const file = `${blob.path}.reading.json`;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_READING_BYTES) return null;
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record.version === 1 && record.byteSize === blob.byteSize && typeof record.text === "string" && record.text.trim()
      ? record.text : null;
  } catch { return null; }
}

export function storeDocumentText(owner: Owner, text: string): void {
  const blob = findDocumentBlob(owner);
  if (!blob || !text.trim()) return;
  const bytes = JSON.stringify({ version: 1, byteSize: blob.byteSize, text });
  if (Buffer.byteLength(bytes) > MAX_READING_BYTES) throw new Error("The document reading exceeds its storage limit.");
  const file = `${blob.path}.reading.json`;
  const temporary = `${file}.${randomUUID()}.part`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
