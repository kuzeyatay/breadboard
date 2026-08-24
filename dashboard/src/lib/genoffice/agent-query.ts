import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { openDocx, patchBlocks as patchDocxBlocks, saveDocx } from "./docx-edit.ts";
import { openPptx, patchBlocks as patchPptxBlocks, savePptx } from "./pptx-edit.ts";
import { resolveGenOfficeWorkspacePath } from "./paths.ts";
import { GenOfficeError, type EditableOfficeBlock, type OfficeBlockPatch } from "./types.ts";

const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_RETURNED_BLOCKS = 1_000;
const MAX_BLOCK_TEXT = 4_000;

export function readInputFile(workspace: string, file: unknown, extensions: readonly string[]): {
  absolute: string;
  relative: string;
  extension: string;
  bytes: Buffer;
} {
  const requested = typeof file === "string" ? file.trim() : "";
  const absolute = resolveGenOfficeWorkspacePath(workspace, requested, "The document path", {
    mustExist: true,
  });
  const stats = fs.statSync(absolute);
  const extension = path.extname(absolute).toLowerCase();
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_INPUT_BYTES) {
    throw new GenOfficeError(422, "document_file_invalid", "The document must be a non-empty file no larger than 128 MiB.");
  }
  if (!extensions.includes(extension)) {
    throw new GenOfficeError(
      400,
      "document_format_unsupported",
      `This operation accepts ${extensions.join(" or ")} files.`,
    );
  }
  return {
    absolute,
    relative: path.relative(workspace, absolute).replaceAll("\\", "/"),
    extension,
    bytes: fs.readFileSync(absolute),
  };
}
export function outputPath(workspace: string, raw: unknown, input: string, extension: string): {
  absolute: string;
  relative: string;
} {
  const parsed = path.parse(input);
  const fallback = `${parsed.name}-edited${extension}`;
  const requested = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  const absolute = resolveGenOfficeWorkspacePath(workspace, requested, "The output path");
  if (path.extname(absolute).toLowerCase() !== extension) {
    throw new GenOfficeError(400, "document_output_extension", `The output path must end in ${extension}.`);
  }
  return { absolute, relative: path.relative(workspace, absolute).replaceAll("\\", "/") };
}

export function atomicWrite(filePath: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function parsePatches(value: unknown): OfficeBlockPatch[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) {
    throw new GenOfficeError(400, "document_patches_invalid", "Patches must be an array of at most 200 block replacements.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new GenOfficeError(400, "document_patch_invalid", `Patch ${index + 1} is invalid.`);
    }
    const patch = entry as Record<string, unknown>;
    if (typeof patch.anchor !== "string" || typeof patch.text !== "string") {
      throw new GenOfficeError(400, "document_patch_invalid", `Patch ${index + 1} needs anchor and text strings.`);
    }
    return { anchor: patch.anchor, text: patch.text };
  });
}

function presentBlocks(blocks: readonly EditableOfficeBlock[]): Array<EditableOfficeBlock & { text: string }> {
  return blocks.slice(0, MAX_RETURNED_BLOCKS).map((block) => ({
    ...block,
    text: block.text.slice(0, MAX_BLOCK_TEXT),
  }));
}

export type DocumentEditResult =
  | {
      operation: "inspect";
      format: "docx" | "pptx";
      file: string;
      blocks: Array<EditableOfficeBlock & { text: string }>;
      truncated: boolean;
    }
  | {
      operation: "patch";
      format: "docx" | "pptx";
      file: string;
      outputPath: string;
      title: string;
      filename: string;
      kind: "document" | "presentation";
      patched: string[];
    };

export async function editDocument(
  workspace: string,
  args: Record<string, unknown>,
): Promise<DocumentEditResult> {
  const input = readInputFile(workspace, args.file, [".docx", ".pptx"]);
  const patches = parsePatches(args.patches);
  const document = input.extension === ".docx"
    ? await openDocx(input.bytes)
    : await openPptx(input.bytes);

  if (patches.length === 0) {
    return {
      operation: "inspect",
      format: document.format,
      file: input.relative,
      blocks: presentBlocks(document.blocks),
      truncated: document.blocks.length > MAX_RETURNED_BLOCKS,
    };
  }

  const output = outputPath(workspace, args.output, input.relative, input.extension);
  const bytes = document.format === "docx"
    ? await saveDocx(patchDocxBlocks(document, patches))
    : await savePptx(patchPptxBlocks(document, patches));
  atomicWrite(output.absolute, bytes);
  const filename = path.basename(output.absolute);
  const title = typeof args.title === "string" && args.title.trim()
    ? args.title.trim().slice(0, 240)
    : path.parse(filename).name;
  return {
    operation: "patch",
    format: document.format,
    file: input.relative,
    outputPath: output.absolute,
    title,
    filename,
    kind: document.format === "docx" ? "document" : "presentation",
    patched: patches.map((patch) => patch.anchor),
  };
}
