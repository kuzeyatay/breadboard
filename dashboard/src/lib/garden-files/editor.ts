import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "./store.ts";
import { gardenFileExtension, GARDEN_FILE_OFFICE_LIMIT, GARDEN_FILE_TEXT_LIMIT } from "./types.ts";
import { decodeGardenText } from "./preview.ts";
import { inspectGardenArchive } from "./archive.ts";
import type { RuntimeV2OfficeControl } from "../office/runtime-v2.ts";

async function withOfficeFile<T>(store: GardenFileStore, scope: GardenFileScope, id: string, work: (source: string) => Promise<T>, version?: number): Promise<T> {
  const file = store.content(scope, id, version);
  if (file.version.size > GARDEN_FILE_OFFICE_LIMIT) throw new GardenFileError(413, "file_editor_large", "This file exceeds the editor's size limit.");
  inspectGardenArchive(await fs.promises.readFile(file.path));
  const directory = path.join(store.root, "work", randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  const source = path.join(directory, `source.${gardenFileExtension(file.entry.name)}`);
  try { await fs.promises.copyFile(file.path, source); return await work(source); }
  finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

const officeScope = (scope: GardenFileScope) => ({ userId: scope.ownerId, gardenId: scope.gardenId, conversationId: null });

export async function loadGardenFileEditor(store: GardenFileStore, scope: GardenFileScope, id: string, signal?: AbortSignal, control?: RuntimeV2OfficeControl) {
  const file = store.content(scope, id), mode = file.entry.capabilities.editor;
  if (!file.entry.canEdit) throw new GardenFileError(403, "file_read_only", "This file is read only.");
  if (!mode) throw new GardenFileError(422, "file_editor_unsupported", "This file does not have an in-app editor.");
  if (mode === "text") {
    if (file.entry.size > GARDEN_FILE_TEXT_LIMIT) throw new GardenFileError(413, "file_editor_large", "This file is too large to edit here.");
    return { file: file.entry, mode, content: decodeGardenText(await fs.promises.readFile(file.path)) };
  }
  if (mode === "docx") { inspectGardenArchive(await fs.promises.readFile(file.path)); return { file: file.entry, mode }; }
  if (mode === "pdf") return { file: file.entry, mode };
  const runtime = await import("../office/runtime-v2.ts");
  return withOfficeFile(store, scope, id, async source => {
    const options = { signal, control, idempotencySeed: `${id}:${file.entry.version}:library-inspect` };
    const data = mode === "cells"
      ? await runtime.inspectSpreadsheetViaRuntime(officeScope(scope), source, options)
      : await runtime.runDocumentEditViaRuntime(officeScope(scope), path.dirname(source), { file: path.basename(source) }, options);
    if ("cleanup" in data) { data.cleanup(); throw new GardenFileError(500, "file_editor_failed", "The document could not be opened for editing."); }
    return { file: file.entry, mode, blocks: data.blocks, truncated: data.truncated };
  });
}

export async function saveGardenFileEditor(store: GardenFileStore, scope: GardenFileScope, id: string, input: { revision: number; content?: unknown; patches?: unknown; copy?: boolean; baseVersion?: number }, signal?: AbortSignal, control?: RuntimeV2OfficeControl) {
  const file = store.get(scope, id), mode = file.capabilities.editor;
  if (!file.canEdit) throw new GardenFileError(403, "file_read_only", "This file is read only.");
  if (!input.copy && file.revision !== input.revision) throw new GardenFileError(409, "file_revision_conflict", "This file changed elsewhere. Your changes are still here; save a copy to keep both.");
  if (input.copy && (!Number.isSafeInteger(input.baseVersion) || input.baseVersion! < 1)) throw new GardenFileError(400, "file_version_invalid", "Choose the original version for this copy.");
  const publish = (stage: import("./store.ts").StagedGardenFile) => input.copy ? store.import(scope, file.path, stage) : store.save(scope, id, input.revision, stage);
  if (mode === "text") {
    if (typeof input.content !== "string" || Buffer.byteLength(input.content) > GARDEN_FILE_TEXT_LIMIT || input.content.includes("\0")) throw new GardenFileError(400, "file_text_invalid", "The edited text is invalid or too large.");
    const original = decodeGardenText(await fs.promises.readFile(store.content(scope, id, input.copy ? input.baseVersion : undefined).path));
    // Textareas normalize newlines. Keep the original file's newline and BOM conventions.
    const crlf = original.includes("\r\n") && !original.replaceAll("\r\n", "").includes("\n");
    let content = crlf ? input.content.replace(/\r?\n/g, "\r\n") : input.content;
    if (original.startsWith("\uFEFF") && !content.startsWith("\uFEFF")) content = `\uFEFF${content}`;
    return publish(await store.stage(Readable.from([Buffer.from(content)]), signal));
  }
  if (mode !== "cells" && mode !== "blocks") throw new GardenFileError(422, "file_editor_unsupported", "Use this file's native editor to save changes.");
  if (!Array.isArray(input.patches) || input.patches.length > 2000 || input.patches.some(item => !item || typeof item.anchor !== "string" || item.anchor.length > 4096 || typeof item.text !== "string" || item.text.length > 100_000)) throw new GardenFileError(400, "file_patches_invalid", "The document changes could not be read.");
  if (!input.patches.length) return file;
  const runtime = await import("../office/runtime-v2.ts");
  return withOfficeFile(store, scope, id, async source => {
    const options = { signal, control, idempotencySeed: `${id}:${file.version}:library-edit` };
    const output = mode === "cells"
      ? await runtime.editSpreadsheetViaRuntime(officeScope(scope), source, input.patches, options)
      : await runtime.runDocumentEditViaRuntime(officeScope(scope), path.dirname(source), { file: path.basename(source), output: "edited.pptx", patches: input.patches }, options);
    if (!("cleanup" in output)) throw new GardenFileError(422, "file_editor_failed", "No edited document was returned.");
    try { return publish(await store.stage(fs.createReadStream(output.filePath), signal)); }
    finally { output.cleanup(); }
  }, input.copy ? input.baseVersion : undefined);
}

export async function saveGardenNativeBytes(store: GardenFileStore, scope: GardenFileScope, id: string, revision: number, body: ReadableStream<Uint8Array>, signal?: AbortSignal, copy = false) {
  const file = store.get(scope, id);
  if (!file.canEdit || !["docx", "pdf"].includes(file.capabilities.editor ?? "")) throw new GardenFileError(403, "file_editor_unsupported", "This file cannot be saved by that editor.");
  if (!copy && file.revision !== revision) throw new GardenFileError(409, "file_revision_conflict", "This file changed elsewhere. Your changes are still here; save a copy to keep both.");
  const stage = await store.stage(body, signal);
  try {
    if (stage.size > GARDEN_FILE_OFFICE_LIMIT || stage.size === 0) throw new GardenFileError(413, "file_editor_large", "The edited file is empty or exceeds the editor's limit.");
    const bytes = await fs.promises.readFile(store.blobPath(stage.blob));
    if (file.capabilities.editor === "docx") {
      const { archive } = inspectGardenArchive(bytes);
      if (!archive.getEntry("word/document.xml") || !archive.getEntry("[Content_Types].xml")) throw new GardenFileError(422, "file_document_invalid", "The editor did not return a valid Word document.");
    } else if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new GardenFileError(422, "file_pdf_invalid", "The editor did not return a valid PDF.");
    return copy ? store.import(scope, file.path, stage) : store.save(scope, id, revision, stage);
  } finally { store.discard(stage); }
}
