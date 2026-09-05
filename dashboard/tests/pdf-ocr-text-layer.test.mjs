import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { PDFParse } from "pdf-parse";

import {
  createOcrTextCompanionPdf,
  embedOcrTextLayer,
  hasUsableTextLayer,
  ocrTextLayerLines,
  packLines,
} from "../src/lib/pdf-text-layer.ts";

async function blankScan(pageCount) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([595, 842]);
  }
  return doc.save();
}

async function extractPages(bytes) {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.pages.map((page) => page.text);
  } finally {
    await parser.destroy();
  }
}

describe("OCR text layer", () => {
  test("strips Markdown scaffolding down to searchable lines", () => {
    const lines = ocrTextLayerLines(
      [
        "## Başlık",
        "",
        "![figure](/cluster/assets/fig-1.png)",
        "- **bold** item with `code`",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "Formula $E = mc^2$ here",
        "<br>tail\tend",
      ].join("\n"),
    );
    assert.deepEqual(lines, [
      "Başlık",
      "bold item with code",
      "a b",
      "1 2",
      "Formula E = mc^2 here",
      "tail end",
    ]);
  });

  test("packs overflowing lines without losing words", () => {
    const lines = Array.from({ length: 10 }, (_, index) => `w${index}`);
    const packed = packLines(lines, 4);
    assert.ok(packed.length <= 4);
    assert.equal(packed.join(" "), lines.join(" "));
    assert.deepEqual(packLines(lines, 20), lines);
  });

  test("treats blank and placeholder extraction as no text layer", () => {
    assert.equal(hasUsableTextLayer(undefined), false);
    assert.equal(hasUsableTextLayer("   "), false);
    assert.equal(
      hasUsableTextLayer("[PDF text extraction failed for Page 1: broken xref]"),
      false,
    );
    assert.equal(hasUsableTextLayer("one two"), false);
    assert.equal(hasUsableTextLayer("a real paragraph of page text"), true);
  });

  test("embeds Unicode OCR text that extractors read back, page by page", async () => {
    const original = await blankScan(3);
    const result = await embedOcrTextLayer({
      pdf: original,
      pages: [
        { pageNumber: 1, text: "# Elektrik devreleri\n\nŞişli ağaç öğrenci ışık" },
        { pageNumber: 2, text: "   \n\n" },
        { pageNumber: 3, text: "Üçüncü sayfa" },
        { pageNumber: 9, text: "beyond the last page" },
      ],
    });
    assert.equal(result.pagesWritten, 2);
    assert.deepEqual(result.skippedPages, [2, 9]);
    assert.notEqual(result.bytes, original);

    const pages = await extractPages(result.bytes);
    assert.equal(pages.length, 3);
    assert.match(pages[0], /Elektrik devreleri/);
    assert.match(pages[0], /Şişli ağaç öğrenci ışık/);
    assert.doesNotMatch(pages[0], /#/);
    assert.equal(pages[1].trim(), "");
    assert.match(pages[2], /Üçüncü sayfa/);
  });

  test("keeps the page pixels unchanged", async () => {
    const original = await blankScan(1);
    // Put something visible on the page so the comparison is not blank-vs-blank.
    const doc = await PDFDocument.load(original);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(0).drawText("visible ink", { x: 40, y: 700, size: 24, font });
    const inked = await doc.save();

    const layered = await embedOcrTextLayer({
      pdf: inked,
      pages: [{ pageNumber: 1, text: "hidden ocr words" }],
    });
    assert.equal(layered.pagesWritten, 1);

    const render = async (bytes) => {
      const parser = new PDFParse({ data: bytes });
      try {
        const shot = await parser.getScreenshot({
          first: 1,
          last: 1,
          desiredWidth: 300,
          imageBuffer: true,
          imageDataUrl: false,
        });
        return Buffer.from(shot.pages[0].data);
      } finally {
        await parser.destroy();
      }
    };
    const before = await render(inked);
    const after = await render(layered.bytes);
    assert.ok(before.length > 0);
    assert.ok(before.equals(after), "invisible text must not change the rendering");
  });

  test("returns the input untouched when nothing can be written", async () => {
    const original = await blankScan(1);
    const result = await embedOcrTextLayer({
      pdf: original,
      pages: [{ pageNumber: 1, text: "![only](/an/image.png)" }],
    });
    assert.equal(result.pagesWritten, 0);
    assert.equal(result.bytes, original);
  });

  test("creates a visible text-only companion in source-page order", async () => {
    const result = await createOcrTextCompanionPdf({
      pages: [
        { pageNumber: 3, text: "Third page equations" },
        { pageNumber: 1, text: "# First page electrostatics" },
        { pageNumber: 2, text: "![scan](/scan.png)" },
      ],
    });
    assert.equal(result.pagesWritten, 2);
    assert.deepEqual(result.skippedPages, [2]);

    const pages = await extractPages(result.bytes);
    assert.equal(pages.length, 2);
    assert.match(pages[0], /Page 1/);
    assert.match(pages[0], /First page electrostatics/);
    assert.match(pages[1], /Page 3/);
    assert.match(pages[1], /Third page equations/);
  });
});

describe("ingest wiring", () => {
  const executor = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "runtime-v2", "ingest-executor.ts"),
    "utf8",
  );

  test("both PDF OCR paths preserve the authoritative uploaded bytes", () => {
    const calls = executor.match(/await preserveOriginalSourcePdf\(/g) ?? [];
    assert.equal(calls.length, 2, "VLM parse and handwriting OCR both preserve the source");
    assert.match(executor, /Keep the uploaded PDF byte-for-byte authoritative/);
    assert.match(executor, /OCR text is retained in the notes/);
    assert.doesNotMatch(executor, /await embedOcrTextLayer\(/);
  });

  test("image-only VLM PDFs get an anydoc text-companion fallback", () => {
    assert.match(executor, /Retrying anydoc with the VLM OCR text companion/);
    assert.match(executor, /await createOcrTextCompanionPdf\(/);
    assert.match(executor, /applyAnydocCrossCheck\(conversion\)/);
  });
});
