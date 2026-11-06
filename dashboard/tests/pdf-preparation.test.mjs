import assert from "node:assert/strict";
import test from "node:test";
import { currentPdfDocumentBytes, runPdfPreparationStep } from "../src/lib/pdf-preparation.ts";

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
