import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { GardenFileError, type GardenFileScope, type GardenFileStore } from "./store.ts";
import { gardenFileExtension, GARDEN_FILE_OFFICE_LIMIT, GARDEN_FILE_TEXT_LIMIT } from "./types.ts";
import { inspectGardenArchive } from "./archive.ts";

export function decodeGardenText(bytes: Buffer): string {
  if (bytes.includes(0)) throw new GardenFileError(422, "file_not_text", "This file contains binary data. Download it to open it in another app.");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new GardenFileError(422, "file_text_encoding", "This file uses a text encoding this editor cannot preserve. Download it to open it in another app."); }
}

export async function gardenFilePreview(store: GardenFileStore, scope: GardenFileScope, id: string) {
  const file = store.content(scope, id), ext = gardenFileExtension(file.entry.name), viewer = file.entry.capabilities.viewer;
  if (viewer === "model" && ["3mf", "usdz", "kmz"].includes(ext)) inspectGardenArchive(await fs.promises.readFile(file.path));
  if (["text", "markdown", "table", "json", "html"].includes(viewer) || ext === "svg") {
    const limit = Math.min(file.version.size, GARDEN_FILE_TEXT_LIMIT);
    const handle = await fs.promises.open(file.path, "r");
    try {
      const bytes = Buffer.alloc(limit), read = await handle.read(bytes, 0, limit, 0);
      const truncated = file.version.size > limit;
      // A preview can end halfway through UTF-8; the editor never edits a prefix.
      const text = truncated ? new TextDecoder().decode(bytes.subarray(0, read.bytesRead)) : decodeGardenText(bytes.subarray(0, read.bytesRead));
      return { kind: "text", text, truncated };
    } finally { await handle.close(); }
  }
  if (["document", "spreadsheet", "presentation", "archive"].includes(viewer)) {
    if (file.version.size > GARDEN_FILE_OFFICE_LIMIT) throw new GardenFileError(413, "file_preview_large", "This file is too large for an in-app preview. The original is available to download.");
    const bytes = await fs.promises.readFile(file.path);
    const inspected = inspectGardenArchive(bytes);
    if (viewer === "archive") return { kind: "archive", entries: inspected.entries };
    if (["odt", "ods", "odp"].includes(ext)) {
      const { readOpenDocument } = await import("../document-structure/opendocument.ts");
      const structure = await readOpenDocument(bytes);
      return { kind: "document", markdown: structure.markdown, warnings: structure.warnings };
    }
    if (ext === "pptx") {
      const { renderPptxPreviewHtml } = await import("../genoffice/pptx-preview.ts");
      return { kind: "html", html: await renderPptxPreviewHtml(bytes) };
    }
    const { readDocument } = await import("../document-structure/index.ts");
    const structure = readDocument(ext as "docx" | "xlsx" | "pptx", bytes);
    const figures = new Map(structure.figures.map(figure => [`figure-${figure.index}.${figure.extension}`, figure]));
    const markdown = structure.markdown.replace(/\]\((figure-\d+\.[a-z0-9]+)\)/gi, (match, name: string) => {
      const figure = figures.get(name);
      const mime = figure && ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<string, string>)[figure.extension];
      return figure && mime ? `](data:${mime};base64,${figure.bytes.toString("base64")})` : match;
    });
    return { kind: "document", markdown, warnings: structure.warnings };
  }
  return { kind: viewer };
}
