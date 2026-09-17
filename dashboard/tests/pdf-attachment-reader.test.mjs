import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { readPdfAttachment, hasReadablePdfText } from "../src/lib/pdf-attachment-reader.ts";
import { writeDocumentBlob, removeDocumentBlob } from "../src/lib/conversations/document-blob-store.ts";
import { storeDocumentText, readStoredDocumentText } from "../src/lib/conversations/document-reading-store.ts";
import { hydrateDocumentAttachments } from "../src/lib/document-attachments-server.ts";

async function fixture() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Electric fields act on charges throughout space.", { x: 20, y: 500, font });
  pdf.addPage();
  return pdf.save();
}

test("mixed PDFs keep text pages and automatically OCR scanned pages once", async () => {
  const calls = [];
  const result = await readPdfAttachment(await fixture(), { transcribe: async (url, page) => {
    assert.match(url, /^data:image\/png;base64,/);
    calls.push(page);
    return "Handwritten notes about electric current and magnetic fields.";
  } });
  assert.deepEqual(calls, [2]);
  assert.deepEqual(result.ocrPages, [2]);
  assert.match(result.text, /\[\[Page 1\]\][\s\S]*Electric fields/);
  assert.match(result.text, /\[\[Page 2\]\][\s\S]*Handwritten notes/);
});

test("page markers and scanner branding never count as extracted content", () => {
  assert.equal(hasReadablePdfText("[[Page 1]]\n[[Page 2]]\n[[Page 3]]"), false);
  assert.equal(hasReadablePdfText("Scanned with CamScanner https://camscanner.com"), false);
});

test("OCR failure stops before a tool-search loop or a filename-only prompt", async () => {
  let calls = 0;
  await assert.rejects(readPdfAttachment(await fixture(), { transcribe: async () => {
    calls++; throw new Error("reader unavailable");
  } }), /Could not read PDF page 2.*reader unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(readPdfAttachment(await fixture(), { signal: AbortSignal.abort() }), { name: "AbortError" });
});

test("the extracted reading survives retries, is owner scoped and is removed with the upload", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-reading-test-"));
  try {
    const blob = await writeDocumentBlob({ userId: 1, format: "pdf", body: new Blob([await fixture()]).stream(), root });
    const owner = { userId: 1, blobId: blob.blobId, root };
    storeDocumentText(owner, "The complete scanned notes.");
    assert.equal(readStoredDocumentText(owner), "The complete scanned notes.");
    assert.equal(readStoredDocumentText({ ...owner, userId: 2 }), null);
    removeDocumentBlob(owner);
    assert.equal(fs.existsSync(`${blob.path}.reading.json`), false);
    assert.equal(readStoredDocumentText(owner), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a pointer-only PDF retry restores its saved reading before dispatch", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-retry-test-"));
  const previous = process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    else process.env.BREADBOARD_CHAT_DOCUMENT_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const blob = await writeDocumentBlob({ userId: 1, format: "pdf", body: new Blob([await fixture()]).stream() });
  const text = "[[Page 1]]\nElectric fields act on charges throughout space.\n\n[[Page 2]]\nThe original handwritten notes explain current.";
  storeDocumentText({ userId: 1, blobId: blob.blobId }, text);
  const pointer = { type: "document", name: "scan.pdf", format: "pdf", blobId: blob.blobId, text: "" };
  const [retry] = await hydrateDocumentAttachments(1, [pointer]);
  assert.equal(retry.text, text);
  assert.equal(pointer.text, "", "hydration must not mutate the persisted pointer");
  await assert.rejects(hydrateDocumentAttachments(2, [pointer]), error => error.status === 404 && error.code === "document_unavailable");
});
