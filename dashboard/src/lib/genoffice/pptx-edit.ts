import {
  openPptx as openEnginePptx,
  savePptx as saveEnginePptx,
  type OpenedPptx,
  type Paragraph,
  type SlideElement,
  type TextElement,
  type TextRun,
} from "../../vendor/genoffice/pptx-engine/src/index.ts";

import { GenOfficeError } from "./types.ts";
import type {
  EditableOfficeBlock,
  EditableOfficeDocument,
  OfficeBlockPatch,
} from "./types.ts";

export interface EditablePptxDocument extends EditableOfficeDocument {
  readonly format: "pptx";
}

interface PptxTarget {
  element: SlideElement;
  slide: number;
}

interface PptxState {
  opened: OpenedPptx;
  byAnchor: Map<string, PptxTarget>;
}

const states = new WeakMap<EditablePptxDocument, PptxState>();

function isTextElement(element: SlideElement): element is TextElement {
  return (element.type === "text" || element.type === "shape") && Boolean(element.text);
}

function elementText(element: SlideElement): string {
  if (!isTextElement(element)) return "";
  return element.text!.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
}

function elementAnchor(slideIndex: number, element: SlideElement): string {
  return `/slides/slide[${slideIndex + 1}]/sp[${element.anchor.spIndex + 1}]`;
}

function publicBlock(slideIndex: number, element: SlideElement): EditableOfficeBlock {
  return {
    anchor: elementAnchor(slideIndex, element),
    kind: element.type,
    text: elementText(element),
    editable: isTextElement(element),
    slide: slideIndex + 1,
  };
}

function replacementRuns(runs: readonly TextRun[], text: string): TextRun[] {
  const style = runs[0];
  return [{ ...(style ?? {}), text }];
}

function replaceElementText(element: TextElement, text: string): void {
  const body = element.text!;
  const lines = text.split("\n");
  const template = body.paragraphs[0];
  const paragraphs: Paragraph[] = lines.map((line, index) => {
    const original = body.paragraphs[index] ?? template;
    return {
      ...(original ?? { runs: [] }),
      runs: replacementRuns(original?.runs ?? [], line),
    };
  });
  element.text = { ...body, paragraphs };
  element.dirty = true;
}

function stateFor(document: EditablePptxDocument): PptxState {
  const state = states.get(document);
  if (!state) {
    throw new GenOfficeError(400, "document_not_open", "The PPTX document was not opened by this library instance.");
  }
  return state;
}

export async function openPptx(buffer: Uint8Array): Promise<EditablePptxDocument> {
  const opened = await openEnginePptx(buffer);
  const targets: Array<[string, PptxTarget]> = [];
  const blocks: EditableOfficeBlock[] = [];
  opened.deck.slides.forEach((slide, slideIndex) => {
    slide.elements.forEach((element) => {
      const anchor = elementAnchor(slideIndex, element);
      targets.push([anchor, { element, slide: slideIndex + 1 }]);
      blocks.push(publicBlock(slideIndex, element));
    });
  });
  const document: EditablePptxDocument = { format: "pptx", blocks };
  states.set(document, { opened, byAnchor: new Map(targets) });
  return document;
}

export function patchBlocks(
  document: EditablePptxDocument,
  patches: readonly OfficeBlockPatch[],
): EditablePptxDocument {
  const state = stateFor(document);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!patch.anchor || typeof patch.text !== "string") {
      throw new GenOfficeError(400, "document_patch_invalid", "Each patch needs an element anchor and replacement text.");
    }
    if (seen.has(patch.anchor)) {
      throw new GenOfficeError(400, "document_patch_duplicate", `Duplicate patch anchor: ${patch.anchor}`);
    }
    seen.add(patch.anchor);
    const target = state.byAnchor.get(patch.anchor);
    if (!target) {
      throw new GenOfficeError(404, "document_block_not_found", `No PPTX element has anchor ${patch.anchor}.`);
    }
    if (!isTextElement(target.element)) {
      throw new GenOfficeError(400, "document_block_read_only", `${patch.anchor} is not an editable text element.`);
    }
    if (elementText(target.element) !== patch.text) replaceElementText(target.element, patch.text);
    const publicEntry = document.blocks.find((entry) => entry.anchor === patch.anchor);
    if (publicEntry) publicEntry.text = patch.text;
  }
  return document;
}

export async function savePptx(document: EditablePptxDocument): Promise<Uint8Array> {
  return saveEnginePptx(stateFor(document).opened);
}
