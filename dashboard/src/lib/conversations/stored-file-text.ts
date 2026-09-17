// What a stored chat file says to the model, re-derived from its bytes.
//
// A transcript keeps a pointer to an uploaded file, never its words. When a
// turn is regenerated, `reusableChatAttachments` hands back that pointer with
// an empty `text`, and the server has to produce the same reading the upload
// produced the first time. Textual formats are read as UTF-8; an archive is
// walked for its text entries; a file Breadboard could not classify — stored
// as `bin` under its original name — is decoded the way the extraction route
// decoded it when it was first attached.
//
// Node-only: `adm-zip` never reaches the composer bundle.

import AdmZip from "adm-zip";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { mlxText } from "../document-structure/mlx.ts";
import {
  storedBinaryFilePromptText,
  storedFileIsText,
  type StoredFileAttachmentFormat,
} from "../stored-file-attachments.ts";

/** Matches the request parser's per-attachment text cap. */
export const MAX_STORED_FILE_TEXT_LENGTH = 2 * 1024 * 1024;

const ARCHIVE_TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json", ".xml", ".html", ".js", ".ts",
  ".py", ".java", ".c", ".cpp", ".h", ".css", ".yaml", ".yml",
  ".toml", ".ini", ".sql", ".sh", ".bat",
]);

/** The readable entries of a ZIP archive, each under its own heading. */
export function extractZipText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (ARCHIVE_TEXT_EXTENSIONS.has(path.extname(entry.entryName).toLowerCase())) {
      parts.push(`=== ${entry.entryName} ===\n${entry.getData().toString("utf8")}`);
    }
  }
  return parts.join("\n\n") || "(No readable text files found in archive)";
}

/**
 * The text a stored file contributes to a turn, from its bytes.
 *
 * `bin` covers two different uploads: a file the person picked as a real
 * binary, whose name ends in `.bin`, and a file of a kind Breadboard has no
 * registry entry for, kept whole so a retry can find it again. The first is
 * described rather than decoded. The second is decoded as text because that is
 * exactly what the upload did — see the extraction route's fallback — and a
 * regenerated turn must not read differently from the original one.
 */
export function storedFileText(input: {
  name: string;
  format: StoredFileAttachmentFormat;
  bytes: Buffer;
}): string {
  if (storedFileIsText(input.format)) {
    return input.bytes.toString("utf8");
  }
  if (input.format === "zip") {
    return extractZipText(input.bytes);
  }
  const name = input.name.toLowerCase();
  if (name.endsWith(".bin")) {
    return storedBinaryFilePromptText(input.name);
  }
  if (input.format === "mlx" || name.endsWith(".mlx")) {
    return mlxText(input.bytes);
  }
  return input.bytes.toString("utf8").slice(0, MAX_STORED_FILE_TEXT_LENGTH);
}
