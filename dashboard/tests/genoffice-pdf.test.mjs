import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import JSZip from "jszip";
import "./helpers/genoffice-node-loader.mjs";

const { openDocx } = await import("../src/lib/genoffice/docx-edit.ts");
const { pdfToDocx, resolvePdfiumWasmPath } = await import(
  "../src/lib/genoffice/pdf-to-docx.ts"
);

test("the server runtime resolves PDFium through its JavaScript entry", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/genoffice/pdf-to-docx.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /require\.resolve\(["']@embedpdf\/pdfium["']\)/);
  assert.doesNotMatch(
    source,
    /require\.resolve\(["']@embedpdf\/pdfium\/pdfium\.wasm["']\)/,
  );
});

async function pdfFixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("GenOffice PDF conversion fixture", { x: 72, y: 700, size: 18, font });
  page.drawText("This sentence should survive as editable DOCX text.", {
    x: 72,
    y: 660,
    size: 12,
    font,
  });
  return document.save();
}

test("the packaged PDFium wasm converts a PDF fixture to an editable DOCX", async () => {
  assert.match(resolvePdfiumWasmPath(), /pdfium\.wasm$/i);
  const result = await pdfToDocx(await pdfFixture());
  assert.equal(result.pages, 1);
  assert.ok(result.bytes.byteLength > 0);

  const zip = await JSZip.loadAsync(result.bytes);
  assert.ok(zip.file("word/document.xml"), "conversion should return a DOCX package");
  const opened = await openDocx(result.bytes);
  const text = opened.blocks.map((block) => block.text).join("\n");
  assert.match(text, /GenOffice PDF conversion fixture/);
  assert.match(text, /editable DOCX text/);
});
