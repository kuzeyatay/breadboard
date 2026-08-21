import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import "./helpers/genoffice-node-loader.mjs";

const { buildBlankDocx } = await import(
  "../src/vendor/genoffice/docx-engine/src/index.ts"
);
const {
  openDocx,
  patchBlocks: patchDocxBlocks,
  saveDocx,
} = await import("../src/lib/genoffice/docx-edit.ts");
const {
  openPptx,
  patchBlocks: patchPptxBlocks,
  savePptx,
} = await import("../src/lib/genoffice/pptx-edit.ts");
const { openPptx: openEnginePptx } = await import(
  "../src/vendor/genoffice/pptx-engine/src/index.ts"
);
const { renderPptxPreviewHtml } = await import("../src/lib/genoffice/pptx-preview.ts");
const { GenOfficeError } = await import("../src/lib/genoffice/types.ts");
const { resolveGenOfficeWorkspacePath } = await import(
  "../src/lib/genoffice/paths.ts"
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function paragraph(text, rsid) {
  return `<w:p w:rsidR="${rsid}"><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
}

async function docxFixture() {
  const zip = await JSZip.loadAsync(await buildBlankDocx());
  const documentPart = zip.file("word/document.xml");
  assert.ok(documentPart);
  const xml = await documentPart.async("string");
  zip.file(
    "word/document.xml",
    xml.replace(
      "<w:p/>",
      paragraph("Alpha sentinel", "11111111") +
        paragraph("Beta changes", "22222222") +
        paragraph("Gamma sentinel", "33333333"),
    ),
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function zipPart(bytes, part) {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(part);
  assert.ok(entry, `${part} should exist`);
  return entry.async("nodebuffer");
}

test("DOCX patching changes one paragraph and preserves every other document.xml byte", async () => {
  const before = await docxFixture();
  const opened = await openDocx(before);
  const target = opened.blocks.find((block) => block.text === "Beta changes");
  assert.ok(target?.editable);

  const originalPart = await zipPart(before, "word/document.xml");
  const originalParagraph = Buffer.from(paragraph("Beta changes", "22222222"));
  const dirtyStart = originalPart.indexOf(originalParagraph);
  assert.notEqual(dirtyStart, -1, "fixture paragraph should be present byte-for-byte");
  const untouchedPrefix = originalPart.subarray(0, dirtyStart);
  const untouchedSuffix = originalPart.subarray(dirtyStart + originalParagraph.length);

  patchDocxBlocks(opened, [{ anchor: target.anchor, text: "Beta was patched" }]);
  const after = await saveDocx(opened);
  const savedPart = await zipPart(after, "word/document.xml");

  assert.deepEqual(savedPart.subarray(0, untouchedPrefix.length), untouchedPrefix);
  assert.deepEqual(savedPart.subarray(savedPart.length - untouchedSuffix.length), untouchedSuffix);
  assert.ok(savedPart.includes(Buffer.from("Beta was patched")));

  const reopened = await openDocx(after);
  assert.equal(
    reopened.blocks.find((block) => block.anchor === target.anchor)?.text,
    "Beta was patched",
  );
});

test("PPTX patching round-trips one anchored text element", async () => {
  const fixture = path.join(
    repoRoot,
    "genoffice",
    "packages",
    "pptx-engine",
    "tests",
    "fixtures",
    "01_standard_business.pptx",
  );
  const before = fs.readFileSync(fixture);
  const opened = await openPptx(before);
  const target = opened.blocks.find((block) => block.editable && block.text.trim().length > 0);
  assert.ok(target);

  const match = /^\/slides\/slide\[(\d+)]\/sp\[(\d+)]$/.exec(target.anchor);
  assert.ok(match, `unexpected PPTX anchor: ${target.anchor}`);
  const slideIndex = Number(match[1]) - 1;
  const spIndex = Number(match[2]) - 1;
  const engineCopy = await openEnginePptx(before);
  const engineSlide = engineCopy.deck.slides[slideIndex];
  const engineElement = engineSlide.elements.find((element) => element.anchor.spIndex === spIndex);
  assert.ok(engineElement);
  const [dirtyStart, dirtyEnd] = engineElement.anchor.range;
  const untouchedPrefix = engineSlide.originalXml.slice(0, dirtyStart);
  const untouchedSuffix = engineSlide.originalXml.slice(dirtyEnd);

  const replacement = "Breadboard GenOffice element patch";
  patchPptxBlocks(opened, [{ anchor: target.anchor, text: replacement }]);
  const after = await savePptx(opened);
  const savedSlide = (await zipPart(after, `ppt/slides/slide${slideIndex + 1}.xml`)).toString("utf8");
  assert.ok(savedSlide.startsWith(untouchedPrefix));
  assert.ok(savedSlide.endsWith(untouchedSuffix));

  const reopened = await openPptx(after);
  assert.equal(reopened.blocks.find((block) => block.anchor === target.anchor)?.text, replacement);
});

test("pptx-render produces the static HTML fallback preview", async () => {
  const fixture = path.join(
    repoRoot,
    "genoffice",
    "packages",
    "pptx-engine",
    "tests",
    "fixtures",
    "01_standard_business.pptx",
  );
  const html = await renderPptxPreviewHtml(fs.readFileSync(fixture));
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /class="pptx-slide"/);
  assert.match(html, /Slide 1/);
});

test("tool file paths cannot escape their workspace", (context) => {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "genoffice-path-test-")));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  assert.throws(
    () => resolveGenOfficeWorkspacePath(workspace, "../escape.docx", "The document path"),
    (error) =>
      error instanceof GenOfficeError && error.code === "document_path_outside_workspace",
  );
});
