import AdmZip from "adm-zip";
import { GardenFileError } from "./store.ts";

/** Inspect the central directory before allowing a document parser to inflate it. */
export function inspectGardenArchive(bytes: Buffer) {
  let archive: AdmZip;
  try { archive = new AdmZip(bytes); }
  catch { throw new GardenFileError(422, "file_archive_invalid", "This archive could not be opened. You can still download the original."); }
  const entries = archive.getEntries();
  let expanded = 0;
  if (entries.length > 5_000) throw new GardenFileError(413, "file_archive_large", "This archive has too many entries to preview.");
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, "/");
    if (/^(?:\/|[a-z]:)/i.test(name) || name.split("/").some(part => part === "..") || /[\u0000-\u001f]/.test(name)) throw new GardenFileError(422, "file_archive_path", "This archive contains an unsafe file path.");
    expanded += entry.header.size;
    if (expanded > 512 * 1024 * 1024 || entry.header.size > 128 * 1024 * 1024 || (entry.header.size > 1024 * 1024 && entry.header.size / Math.max(1, entry.header.compressedSize) > 1000)) throw new GardenFileError(413, "file_archive_large", "This archive expands beyond the preview limit.");
  }
  return { archive, entries: entries.map(entry => ({ path: entry.entryName, size: entry.header.size, folder: entry.isDirectory })) };
}
