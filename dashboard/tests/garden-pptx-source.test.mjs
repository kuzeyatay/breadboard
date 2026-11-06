import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFParse } from "pdf-parse";
import "../scripts/learn-worker-import-hook.mjs";
import { gardenSourceDisplay, sourcePdfFileName } from "../src/lib/garden-source-display.ts";
const { runIngest } = await import("../src/lib/runtime-v2/ingest-executor.ts");
const { createKnowledgeWriteTransaction, writeDocumentKnowledge, scanClusterKnowledge } = await import("../src/lib/knowledge.ts");
const { renderPresentationPdf } = await import("../src/lib/office/presentation-pdf.ts");

const filename = "Lecture 03 – Signals.PPTX";
const bytes = fs.readFileSync(path.resolve("../genoffice/packages/pptx-engine/tests/fixtures/01_standard_business.pptx"));

test("PPTX sources retain the filename, describe their content, and expose the PDF viewer", () => {
  const legacy = {
    sourceType: "pptx", sourceFile: filename, sourcePdf: "/garden/assets/slides.pdf",
    title: "Frequency response and filters", description: "", name: "lecture-03",
  };
  assert.deepEqual(gardenSourceDisplay(legacy), {
    title: filename, description: legacy.title, hasPdf: true,
  });
  assert.deepEqual(gardenSourceDisplay({ ...legacy, title: filename, description: legacy.title }), gardenSourceDisplay(legacy));
  assert.equal(gardenSourceDisplay({ ...legacy, sourcePdf: "" }).hasPdf, false);
  assert.equal(gardenSourceDisplay({ ...legacy, sourceType: "PDF", sourceFile: "Lecture 03.pdf" }).title, "Lecture 03.pdf");
  assert.equal(sourcePdfFileName(filename), "Lecture 03 – Signals.pdf");
  assert.equal(sourcePdfFileName("Notes.pdf"), "Notes.pdf");
});

function options(root, transaction, anydoc = false) {
  return {
    request: new Request("http://localhost/runtime-v2/ingest"),
    contentPath: root, normalizedClusterSlug: "garden", filename,
    ext: "pptx", nameWithoutExt: "Lecture 03 – Signals", source: "upload", model: "",
    isHandwriting: false, parseWithVlm: false, parseWithAnydoc: anydoc,
    vlmTask: "transcribe", generateMap: false,
    file: { name: filename, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: bytes.length,
      async readBuffer() { return bytes; }, async text() { throw new Error("PPTX is binary"); } },
    createdFilePaths: [], createdMarkdownPaths: [], knowledgeWriteTransaction: transaction, emit() {},
  };
}

test("direct and AnyDoc PPTX imports save slide PDFs, original bytes and stable source names", { timeout: 120_000 }, async () => {
  for (const anydoc of [false, true]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-pptx-test-"));
    fs.mkdirSync(path.join(root, "garden"));
    const transaction = createKnowledgeWriteTransaction(root, "garden");
    try {
      const result = await runIngest(options(root, transaction, anydoc));
      assert.equal(result.success, true);
      const source = fs.readFileSync(path.join(root, "garden", result.sourceRelPath), "utf8");
      assert.ok(source.includes(`title: ${JSON.stringify(filename)}`));
      assert.match(source, /source_type: "pptx"/);
      const pdfPath = JSON.parse(source.match(/^source_pdf: (.+)$/m)[1]);
      const pptxPath = JSON.parse(source.match(/^source_presentation: (.+)$/m)[1]);
      assert.deepEqual(fs.readFileSync(path.join(root, pptxPath)), bytes);
      const parser = new PDFParse({ data: fs.readFileSync(path.join(root, pdfPath)) });
      try {
        const text = await parser.getText();
        assert.equal(text.total, 5, "one PDF page per slide");
        assert.match(text.pages[0].text, /Q3 Business Review/);
        assert.match(text.pages[3].text, /Revenue by Region/);
        assert.match(text.pages[4].text, /Thank you/);
      } finally { await parser.destroy(); }
      const again = await runIngest({ ...options(root, transaction, anydoc), file: {
        ...options(root, transaction).file, async readBuffer() { throw new Error("duplicate must not render again"); },
      } });
      assert.equal(again.duplicate, true);
      transaction.rollback();
      assert.equal(fs.existsSync(path.join(root, pdfPath)), false);
      assert.equal(fs.existsSync(path.join(root, pptxPath)), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("re-uploading a legacy PPTX adds a viewer without duplicating or rewriting its lessons", { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-pptx-legacy-test-"));
  const sources = path.join(root, "garden", "sources");
  fs.mkdirSync(sources, { recursive: true });
  const notePath = path.join(sources, "original-slug.md");
  const note = `---\ntitle: "Signals and filters"\nsource_type: "pptx"\nsource_file: ${JSON.stringify(filename)}\nknowledge_type: "source-document"\nflag_color: "green"\nlearning_pages: ["lesson-one"]\n---\n\nOriginal source text and notes.\n`;
  fs.writeFileSync(notePath, note);
  const transaction = createKnowledgeWriteTransaction(root, "garden");
  try {
    const result = await runIngest(options(root, transaction));
    assert.equal(result.slug, "original-slug");
    const updated = fs.readFileSync(notePath, "utf8");
    assert.match(updated, /description: "Signals and filters"/);
    assert.match(updated, /flag_color: "green"/);
    assert.match(updated, /learning_pages: \["lesson-one"\]/);
    assert.match(updated, /source_pdf:/);
    assert.match(updated, /Original source text and notes/);
    assert.deepEqual(fs.readdirSync(sources), ["original-slug.md"]);
    transaction.rollback();
    assert.equal(fs.readFileSync(notePath, "utf8"), note);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AI-generated PowerPoint titles are stored as descriptions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-pptx-title-test-"));
  fs.mkdirSync(path.join(root, "garden"));
  const transaction = createKnowledgeWriteTransaction(root, "garden");
  try {
    await writeDocumentKnowledge({
      client: null, model: "", contentPath: root, clusterSlug: "garden",
      sourceTitle: "Lecture 03", sourceFileName: filename, sourceType: "pptx", sourceLabel: "upload",
      sourcePdfPath: "/garden/assets/slides.pdf", isHandwriting: false,
      markdownText: "Frequency response and filters", plainText: "Frequency response and filters", pages: [],
      extraction: { documentTitle: "Frequency response and filters", summary: "An introduction to filters.", topics: [], relationships: [], suggestedTags: [] },
      knowledgeWriteTransaction: transaction,
    });
    const node = scanClusterKnowledge(root, "garden", { migrateSources: false }).nodes.find(node => node.type === "source-document");
    assert.equal(node.title, filename);
    assert.equal(node.description, "Frequency response and filters");
    transaction.rollback();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("cancelled presentation conversion does not start a renderer", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderPresentationPdf(bytes, controller.signal), { name: "AbortError" });
});

test("PowerPoint rendering survives an unusable inherited Windows TMP", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-pptx-temp-test-"));
  const previousTmp = process.env.TMP;
  const previousTemp = process.env.TEMP;
  const blockedTmp = path.join(root, "not-a-directory");
  fs.writeFileSync(blockedTmp, "A converter must not use this inherited path.");
  process.env.TMP = blockedTmp;
  process.env.TEMP = root;
  try {
    const pdf = await renderPresentationPdf(bytes);
    const parser = new PDFParse({ data: pdf });
    try {
      const text = await parser.getText();
      assert.equal(text.total, 5);
      assert.match(text.pages[0].text, /Q3 Business Review/);
    } finally { await parser.destroy(); }
    assert.deepEqual(fs.readdirSync(root), ["not-a-directory"], "renderer cleans up its scratch directory");
  } finally {
    if (previousTmp === undefined) delete process.env.TMP;
    else process.env.TMP = previousTmp;
    if (previousTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = previousTemp;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
