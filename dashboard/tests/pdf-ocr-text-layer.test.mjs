import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { degrees, PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
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

const require = createRequire(import.meta.url);
const pdfjsPromise = import(
  pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
);

/**
 * Where pdf.js sees each text run on page 1, as fractions of the page as a
 * viewer shows it (rotation applied, y down) — the same space as the boxes.
 */
async function textItemsInView(bytes) {
  const pdfjs = await pdfjsPromise;
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const t = pdfjs.Util.transform(view.transform, item.transform);
      const unit = Math.hypot(item.transform[0], item.transform[1]);
      const width = (item.width * Math.hypot(t[0], t[1])) / unit;
      items.push({
        str: item.str,
        x: t[4] / view.width,
        baseline: t[5] / view.height,
        width: width / view.width,
      });
    }
    return items;
  } finally {
    await doc.destroy();
  }
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

  test("places spotted lines over their boxes on every page rotation", async () => {
    const lines = [
      { box: [0.1, 0.1, 0.6, 0.13], text: "Hello positioned world" },
      { box: [0.5, 0.5, 0.9, 0.56], text: "second line lower right" },
    ];
    for (const rotation of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      doc.addPage([600, 800]).setRotation(degrees(rotation));
      const result = await embedOcrTextLayer({
        pdf: await doc.save(),
        pages: [{ pageNumber: 1, text: "", lines }],
      });
      assert.equal(result.pagesWritten, 1, `rotation ${rotation}`);
      assert.equal(result.positionedPages, 1, `rotation ${rotation}`);

      const items = await textItemsInView(result.bytes);
      const first = items.filter((item) =>
        /Hello|positioned|world/.test(item.str),
      );
      const second = items.find((item) => /second line/.test(item.str));
      assert.ok(first.length > 0 && second, `rotation ${rotation}`);
      // Line one: left edge at 10%, baseline inside 10–13%, run spanning to 60%.
      const left = Math.min(...first.map((item) => item.x));
      const right = Math.max(...first.map((item) => item.x + item.width));
      assert.ok(Math.abs(left - 0.1) < 0.01, `rotation ${rotation} left ${left}`);
      assert.ok(Math.abs(right - 0.6) < 0.02, `rotation ${rotation} right ${right}`);
      for (const item of first) {
        assert.ok(
          item.baseline > 0.1 && item.baseline < 0.13,
          `rotation ${rotation} baseline ${item.baseline}`,
        );
      }
      assert.ok(Math.abs(second.x - 0.5) < 0.01, `rotation ${rotation}`);
      assert.ok(Math.abs(second.width - 0.4) < 0.02, `rotation ${rotation}`);
      assert.ok(second.baseline > 0.5 && second.baseline < 0.56, `rotation ${rotation}`);
    }
  });

  test("falls back to the even spread when a page has no usable boxes", async () => {
    const result = await embedOcrTextLayer({
      pdf: await blankScan(1),
      pages: [
        {
          pageNumber: 1,
          text: "fallback words here",
          lines: [{ box: [0.5, 0.5, 0.5, 0.5], text: "collapsed" }],
        },
      ],
    });
    assert.equal(result.pagesWritten, 1);
    assert.equal(result.positionedPages, 0);
    const pages = await extractPages(result.bytes);
    assert.match(pages[0], /fallback words here/);
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

  test("both PDF OCR paths write a searchable twin and keep the upload intact", () => {
    const calls = executor.match(/await writeSearchablePdfAsset\(/g) ?? [];
    assert.equal(calls.length, 2, "VLM parse and handwriting OCR both write the twin");
    // The layer goes into a second asset, never over the uploaded bytes.
    assert.match(executor, /slugify\(`\$\{baseName\}-searchable`\)/);
    assert.match(executor, /searchable_pdf: searchablePdfPath/);
    assert.match(executor, /await embedOcrTextLayer\(/);
    assert.match(executor, /await spotPageTextLines\(/);
    assert.doesNotMatch(executor, /preserveOriginalSourcePdf/);
    // Pages that already have text get neither a second layer nor a spotting pass.
    assert.match(
      executor,
      /!hasUsableTextLayer\(embedded\.get\(page\.pageNumber\)\)/,
    );
  });

  test("the viewer opens the searchable twin when the note has one", () => {
    const route = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "app",
        "api",
        "documents",
        "[slug]",
        "source-pdf",
        "route.ts",
      ),
      "utf8",
    );
    assert.match(route, /frontmatter\.searchable_pdf/);
    assert.match(route, /pdfPath: useSearchable \? searchablePath : originalPath/);
  });

  test("image-only VLM PDFs get an anydoc text-companion fallback", () => {
    assert.match(executor, /Retrying anydoc with the VLM OCR text companion/);
    assert.match(executor, /await createOcrTextCompanionPdf\(/);
    assert.match(executor, /applyAnydocCrossCheck\(conversion\)/);
  });
});
