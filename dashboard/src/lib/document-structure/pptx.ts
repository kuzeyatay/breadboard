// Reading a deck as slides rather than as one long paragraph.
//
// Two things the old reader lost. **Slide boundaries**: a deck flattened into
// continuous text has no way to say which claim sat next to which chart, and
// "slide 12" is how people refer to decks. And **speaker notes**, which is
// where the argument usually is — the slide says "Revenue up 40%" and the note
// says why, what it excludes, and which quarter it is annualised from.
//
// Pictures are lifted the same way as in a Word document, because a deck is
// mostly pictures and a deck with its pictures removed is not a deck.

import AdmZip from "adm-zip";
import {
  attribute,
  childNamed,
  childrenNamed,
  descendants,
  parseXml,
  textContent,
  type XmlNode,
} from "./xml.ts";
import {
  emptyStructure,
  figureFilename,
  type DocumentStructure,
  type ExtractedFigure,
} from "./types.ts";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "emf", "wmf", "svg"]);
const MAX_FIGURES = 80;
const MAX_FIGURE_BYTES = 12 * 1024 * 1024;

function readPart(zip: AdmZip, name: string): XmlNode | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  try {
    return parseXml(entry.getData().toString("utf8"));
  } catch {
    return null;
  }
}

function readRelationships(zip: AdmZip, part: string): Map<string, string> {
  const map = new Map<string, string>();
  const root = readPart(zip, part);
  if (!root) return map;
  for (const relationship of childrenNamed(root, "Relationship")) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Slide parts in presentation order, which is not alphabetical order. */
function slideEntryNames(zip: AdmZip): string[] {
  const presentation = readPart(zip, "ppt/presentation.xml");
  const relationships = readRelationships(zip, "ppt/_rels/presentation.xml.rels");
  const ordered: string[] = [];
  if (presentation) {
    const list = childNamed(presentation, "sldIdLst");
    for (const slide of list ? childrenNamed(list, "sldId") : []) {
      const id = attribute(slide, "id2") ?? attribute(slide, "id");
      const relationshipId = attribute(slide, "id") ?? "";
      const target =
        relationships.get(relationshipId) ??
        relationships.get(attribute(slide, "rId") ?? "") ??
        (id ? relationships.get(id) : undefined);
      if (target) ordered.push(`ppt/${target.replace(/^\/?ppt\//, "").replace(/^\.\.\//, "")}`);
    }
  }
  if (ordered.length) return ordered;
  // Fall back to a numeric sort of whatever slides are in the package: slide10
  // must not come before slide2.
  return zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      (left, right) =>
        Number(left.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(right.match(/(\d+)\.xml$/)?.[1] ?? 0),
    );
}

/** Every text frame on a slide, one line per paragraph. */
function slideText(slide: XmlNode): { title: string; body: string[] } {
  const lines: string[] = [];
  for (const shape of descendants(slide, "sp")) {
    const frame = childNamed(shape, "txBody");
    if (!frame) continue;
    for (const paragraph of childrenNamed(frame, "p")) {
      const text = descendants(paragraph, "t")
        .map((node) => textContent(node))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push(text);
    }
  }
  // A slide's title is its first line often enough, and PowerPoint's own title
  // placeholder is not reliably marked in every template.
  const [title, ...body] = lines;
  return { title: title ?? "", body };
}

function slideNotes(zip: AdmZip, slideEntry: string): string {
  const name = slideEntry.replace("ppt/slides/", "").replace(".xml", "");
  const notes = readPart(zip, `ppt/notesSlides/notesSlide${name.replace("slide", "")}.xml`);
  if (!notes) return "";
  return descendants(notes, "t")
    .map((node) => textContent(node))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read a .pptx into per-slide markdown with speaker notes and figures.
 *
 * Never throws: a deck with one unreadable slide is still worth reading.
 */
export function readPptx(buffer: Buffer): DocumentStructure {
  const structure = emptyStructure();
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    structure.warnings.push("That presentation could not be opened.");
    return structure;
  }

  const slides = slideEntryNames(zip);
  if (!slides.length) {
    structure.warnings.push("That presentation has no readable slides.");
    return structure;
  }

  const figures: ExtractedFigure[] = [];
  const blocks: string[] = [];

  slides.forEach((entryName, index) => {
    const slide = readPart(zip, entryName);
    if (!slide) {
      structure.warnings.push(`Slide ${index + 1} could not be read.`);
      return;
    }
    const number = index + 1;
    const { title, body } = slideText(slide);
    const lines: string[] = [`## Slide ${number}${title ? `: ${title}` : ""}`];
    for (const line of body) lines.push(`- ${line}`);

    const relationships = readRelationships(
      zip,
      entryName.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels",
    );
    for (const blip of descendants(slide, "blip")) {
      if (figures.length >= MAX_FIGURES) break;
      const id = attribute(blip, "embed") ?? attribute(blip, "link");
      const target = id ? relationships.get(id) : null;
      if (!target) continue;
      const media = `ppt/${target.replace(/^\/?ppt\//, "").replace(/^\.\.\//, "")}`;
      const entry = zip.getEntry(media);
      const extension = extensionOf(target);
      if (!entry || !IMAGE_EXTENSIONS.has(extension)) continue;
      let bytes: Buffer;
      try {
        bytes = entry.getData();
      } catch {
        continue;
      }
      if (!bytes.length || bytes.length > MAX_FIGURE_BYTES) continue;
      const figure: ExtractedFigure = {
        index: figures.length + 1,
        extension,
        bytes,
        caption: title,
        altText: "",
        location: `Slide ${number}`,
      };
      figures.push(figure);
      lines.push(`![Slide ${number} image](${figureFilename(figure)})`);
    }

    const notes = slideNotes(zip, entryName);
    // The notes are where the reasoning is, so they are labelled rather than
    // folded into the bullets as if they had been on the slide.
    if (notes) lines.push("", `**Speaker notes:** ${notes}`);
    blocks.push(lines.join("\n"));
  });

  structure.markdown = blocks.join("\n\n").trim();
  structure.figures = figures;
  structure.summary = { ...structure.summary, slideCount: slides.length, figureCount: figures.length };
  return structure;
}
