import assert from "node:assert/strict";
import test from "node:test";
import { currentPdfDocumentBytes, pdfReadingCovers, pdfReadingPages, pdfUploadTimeoutMs, runPdfPreparationStep } from "../src/lib/pdf-preparation.ts";

test("an unedited PDF uses existing bytes without visiting every page to save", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const pdf = {
    annotationStorage: { size: 0 },
    getData: async () => bytes,
    saveDocument: () => { throw new Error("Unnecessary full-document save"); },
  };
  assert.equal(await currentPdfDocumentBytes(pdf), bytes);
});

test("PDF bytes retain annotation edits rather than returning the unedited file", async () => {
  const edited = new Uint8Array([1, 2, 3]);
  assert.equal(await currentPdfDocumentBytes({
    annotationStorage: { size: 1 },
    getData: () => { throw new Error("Would lose annotations"); },
    saveDocument: async () => edited,
  }), edited);
});

test("a hung PDF worker times out even when it ignores cancellation", async () => {
  let workerSignal;
  let complete;
  const result = runPdfPreparationStep({
    signal: new AbortController().signal,
    label: "Preparing the PDF file",
    timeoutMs: 10,
    run: signal => { workerSignal = signal; return new Promise(resolve => { complete = resolve; }); },
  });
  await assert.rejects(result, /Preparing the PDF file took too long.*Regenerate/);
  assert.equal(workerSignal.aborted, true);
  assert.notEqual(workerSignal.reason.name, "AbortError", "a timeout must display an error, not look like Stop");
  complete(new Uint8Array([1]));
  await assert.rejects(result, /took too long/, "a late worker result cannot revive a failed preparation");
});

test("Stop settles a hung preparation immediately and cancels network work", async () => {
  const controller = new AbortController();
  let workerSignal;
  const result = runPdfPreparationStep({
    signal: controller.signal,
    label: "Uploading and reading the PDF",
    run: signal => { workerSignal = signal; return new Promise(() => {}); },
  });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(workerSignal.aborted, true);
});

test("stopped preparations never start another step and failed steps can be retried", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => runPdfPreparationStep({
    signal: controller.signal, label: "Reading", run: () => assert.fail("started after Stop"),
  }), { name: "AbortError" });
  const original = new Error("PDF worker failed");
  await assert.rejects(runPdfPreparationStep({
    signal: new AbortController().signal, label: "Reading", run: async () => { throw original; },
  }), error => error === original);
  assert.equal(await runPdfPreparationStep({
    signal: new AbortController().signal, label: "Reading", run: async () => "retry succeeded",
  }), "retry succeeded");
});

const reading = [
  "[[Page 1]]\nIntro text",
  "[[Page 2]]\n\n[This page has not been transcribed. Read it from the original PDF if needed.]",
  "[[Page 34]]\nPerceptron learning rule",
].join("\n\n");

test("one saved reading answers questions on any page it already read", () => {
  assert.equal(pdfReadingCovers(reading, { wholeDocument: false, page: 1 }), true);
  assert.equal(pdfReadingCovers(reading, { wholeDocument: false, page: 34 }), true);
  assert.equal(pdfReadingCovers(reading, { wholeDocument: false }), true);
});

test("a scanned page left untranscribed, or never read, needs a fresh reading", () => {
  assert.equal(pdfReadingCovers(reading, { wholeDocument: false, page: 2 }), false);
  assert.equal(pdfReadingCovers(reading, { wholeDocument: false, page: 3 }), false);
  assert.equal(pdfReadingCovers(reading, { wholeDocument: true }), false);
  assert.equal(pdfReadingCovers("[[Page 1]]\nA\n\n[[Page 2]]\nB", { wholeDocument: true }), true);
});

test("the upload deadline grows with a large book instead of a fixed three minutes", () => {
  assert.equal(pdfUploadTimeoutMs(1024 * 1024, 10, false), 180_000);
  assert.ok(pdfUploadTimeoutMs(215 * 1024 * 1024, 376, false) > 300_000);
  assert.equal(pdfUploadTimeoutMs(0, 4, true), 380_000);
});

test("a saved reading hands back the pages it holds, without untranscribed ones", () => {
  const pages = pdfReadingPages(`${reading}\n\n[Document reading incomplete: OCR was limited to the requested pages.]`);
  assert.deepEqual(pages, { 1: "Intro text", 34: "Perceptron learning rule" });
});
