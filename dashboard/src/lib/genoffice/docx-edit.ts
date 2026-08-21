import {
  parseDocx,
  saveDocx as saveEngineDocx,
  type Block,
  type GeneratedBlock,
  type ParsedDocFull,
  type Run,
  type SaveBlock,
} from "../../vendor/genoffice/docx-engine/src/index.ts";

import { GenOfficeError } from "./types.ts";
import type {
  EditableOfficeBlock,
  EditableOfficeDocument,
  OfficeBlockPatch,
} from "./types.ts";

export interface EditableDocxDocument extends EditableOfficeDocument {
  readonly format: "docx";
}

interface DocxState {
  parsed: ParsedDocFull;
  byAnchor: Map<string, Block>;
  dirty: Map<number, GeneratedBlock>;
}

const states = new WeakMap<EditableDocxDocument, DocxState>();

function blockText(block: Block): string {
  return block.runs?.map((run) => run.text).join("") ?? block.previewText ?? block.label ?? "";
}

function blockAnchor(block: Block): string {
  const index = (block.docxIndex ?? -1) + 1;
  const tag = ["paragraph", "heading", "listItem"].includes(block.type)
    ? "p"
    : block.type === "table"
      ? "tbl"
      : "node";
  return `/body/${tag}[${index}]`;
}

function isEditable(block: Block): block is Block & {
  type: "paragraph" | "heading" | "listItem";
  docxIndex: number;
} {
  return (
    block.docxIndex !== null &&
    (block.type === "paragraph" || block.type === "heading" || block.type === "listItem")
  );
}

function publicBlock(block: Block): EditableOfficeBlock {
  return {
    anchor: blockAnchor(block),
    kind: block.type,
    text: blockText(block),
    editable: isEditable(block),
  };
}

function replacementRuns(runs: readonly Run[] | undefined, text: string): Run[] {
  const style = runs?.find((run) => !run.image && !run.math && !run.noteRef) ?? runs?.[0];
  return [{ ...(style ?? {}), text, image: undefined, math: undefined, noteRef: undefined }];
}

function generatedBlock(block: Block, text: string): GeneratedBlock {
  if (!isEditable(block)) {
    throw new GenOfficeError(400, "document_block_read_only", `${blockAnchor(block)} is not editable.`);
  }
  return {
    type: block.type,
    ...(block.level === undefined ? {} : { level: block.level }),
    ...(block.styleId === undefined ? {} : { styleId: block.styleId }),
    ...(block.list === undefined ? {} : { list: block.list }),
    ...(block.format === undefined ? {} : { format: block.format }),
    ...(block.rawPPr === undefined ? {} : { rawPPr: block.rawPPr }),
    ...(block.bookmarks === undefined ? {} : { bookmarks: block.bookmarks }),
    ...(block.hiddenBookmarks === undefined ? {} : { hiddenBookmarks: block.hiddenBookmarks }),
    ...(block.commentStarts === undefined ? {} : { commentStarts: block.commentStarts }),
    ...(block.commentEnds === undefined ? {} : { commentEnds: block.commentEnds }),
    ...(block.sdtShell === undefined ? {} : { sdtShell: block.sdtShell }),
    ...(block.blockRevision === undefined ? {} : { blockRevision: block.blockRevision }),
    runs: replacementRuns(block.runs, text),
  };
}

function stateFor(document: EditableDocxDocument): DocxState {
  const state = states.get(document);
  if (!state) {
    throw new GenOfficeError(400, "document_not_open", "The DOCX document was not opened by this library instance.");
  }
  return state;
}

export async function openDocx(buffer: Uint8Array): Promise<EditableDocxDocument> {
  const parsed = await parseDocx(buffer);
  const blocks = parsed.blocks.filter((block) => !block.hidden).map(publicBlock);
  const document: EditableDocxDocument = { format: "docx", blocks };
  states.set(document, {
    parsed,
    byAnchor: new Map(parsed.blocks.filter((block) => !block.hidden).map((block) => [blockAnchor(block), block])),
    dirty: new Map(),
  });
  return document;
}

export function patchBlocks(
  document: EditableDocxDocument,
  patches: readonly OfficeBlockPatch[],
): EditableDocxDocument {
  const state = stateFor(document);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!patch.anchor || typeof patch.text !== "string") {
      throw new GenOfficeError(400, "document_patch_invalid", "Each patch needs a block anchor and replacement text.");
    }
    if (seen.has(patch.anchor)) {
      throw new GenOfficeError(400, "document_patch_duplicate", `Duplicate patch anchor: ${patch.anchor}`);
    }
    seen.add(patch.anchor);
    const block = state.byAnchor.get(patch.anchor);
    if (!block) {
      throw new GenOfficeError(404, "document_block_not_found", `No DOCX block has anchor ${patch.anchor}.`);
    }
    if (!isEditable(block)) {
      throw new GenOfficeError(400, "document_block_read_only", `${patch.anchor} is not an editable paragraph.`);
    }
    if (blockText(block) === patch.text) {
      state.dirty.delete(block.docxIndex);
      continue;
    }
    state.dirty.set(block.docxIndex, generatedBlock(block, patch.text));
    const publicEntry = document.blocks.find((entry) => entry.anchor === patch.anchor);
    if (publicEntry) publicEntry.text = patch.text;
  }
  return document;
}

export async function saveDocx(document: EditableDocxDocument): Promise<Uint8Array> {
  const state = stateFor(document);
  return saveEngineDocx(
    state.parsed,
    state.parsed.blocks.flatMap<SaveBlock>((block) => {
      if (block.hidden || block.docxIndex === null) return [];
      const replacement = state.dirty.get(block.docxIndex);
      return replacement
        ? [{ kind: "generated" as const, block: replacement }]
        : [{ kind: "original" as const, docxIndex: block.docxIndex }];
    }),
  );
}
