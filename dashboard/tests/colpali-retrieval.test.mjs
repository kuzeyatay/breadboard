// ColPali page retrieval, and — mostly — everything it must not break.
//
// The interesting behaviour of this feature is not the retrieval. It is that
// retrieval runs for *every* attachment, on every question, and therefore has
// as many ways to be absent as to work: no service, no index, an index still
// being written, an index from a different checkpoint, a format with no page
// renderer. Each of those must leave the turn exactly as Breadboard built it
// before ColPali existed — the whole document, inlined. A regression here is
// silent and looks like a model that suddenly cannot find things in a file it
// was given.
//
// The service itself is covered by colpali-service/tests. Nothing here loads a
// model or expects a sidecar to be running.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { splitTextByPage, retrieveDocumentAttachments } from "../src/lib/colpali/retrieval.ts";
import { indexIsUsable, readIndexStatus, writeIndexStatus } from "../src/lib/colpali/index-status.ts";
import { colpaliMode, colpaliTopK } from "../src/lib/colpali/config.ts";
import { colpaliHealth, colpaliSearch } from "../src/lib/colpali/service.ts";

const MODEL = "vidore/colSmol-500M";

function documentAttachment(overrides = {}) {
  return {
    type: "document",
    name: "supply.pdf",
    blobId: "doc_0123456789abcdef0123456789abcdef",
    format: "pdf",
    text: "[[Page 1]]\nfirst\n\n[[Page 2]]\nsecond",
    ...overrides,
  };
}

/** An environment with no service behind it, which is the default everywhere. */
function offlineEnv(extra = {}) {
  return {
    COLPALI_SERVICE_SECRET: "test-secret",
    // Port 1 is privileged and unbound: connecting fails immediately rather
    // than hanging the test for the client's timeout.
    COLPALI_SERVICE_URL: "http://127.0.0.1:1",
    ...extra,
  };
}

// ── Splitting an extracted document back into its pages ──────────────

test("a PDF's page markers and a deck's slide headings both split", () => {
  const pdf = splitTextByPage("[[Page 1]]\nalpha\n\n[[Page 2]]\nbeta\n\n[[Page 3]]\ngamma");
  assert.equal(pdf.length, 3);
  assert.deepEqual(
    pdf.map((slice) => slice.pageNumber),
    [1, 2, 3],
  );
  assert.match(pdf[1].text, /beta/);
  // The marker rides along with its page, so a retrieved page still says which
  // page it is once it reaches the model out of order.
  assert.match(pdf[1].text, /\[\[Page 2\]\]/);

  const deck = splitTextByPage("## Slide 1: Title\nalpha\n\n## Slide 2\nbeta");
  assert.equal(deck.length, 2);
  assert.deepEqual(
    deck.map((slice) => slice.pageNumber),
    [1, 2],
  );
});

test("a document with no page boundaries is not split at all", () => {
  // A .docx has no pages until something paginates it, and inventing
  // boundaries would attribute text to a page it is not on.
  assert.equal(splitTextByPage("# Agreement\n\nA clause. Another clause."), null);
  assert.equal(splitTextByPage(""), null);
});

// ── The fallbacks, which are the point ───────────────────────────────

test("with ColPali turned off, attachments pass through untouched", async () => {
  const attachments = [documentAttachment()];
  const out = await retrieveDocumentAttachments(1, attachments, "where is the chart", {
    COLPALI_MODE: "disabled",
  });
  assert.deepEqual(out, attachments);
});

test("a question with no words retrieves nothing and changes nothing", async () => {
  const attachments = [documentAttachment()];
  assert.deepEqual(await retrieveDocumentAttachments(1, attachments, "   ", offlineEnv()), attachments);
});

test("a turn with no document attachment never calls the service", async () => {
  const attachments = [
    { type: "image", name: "shot.png", dataUrl: "data:image/png;base64,AAAA" },
    { type: "text", name: "notes.txt", text: "hello" },
  ];
  assert.deepEqual(
    await retrieveDocumentAttachments(1, attachments, "what is this", offlineEnv()),
    attachments,
  );
});

test("a document whose blob is not this user's is left alone", async () => {
  // findDocumentBlob answers null, and the attachment must survive that rather
  // than being dropped from the turn.
  const attachments = [documentAttachment()];
  const out = await retrieveDocumentAttachments(987654, attachments, "anything", offlineEnv());
  assert.deepEqual(out, attachments);
});

// ── The index status sidecar ─────────────────────────────────────────

test("only a ready index written by the running checkpoint is usable", () => {
  const ready = { state: "ready", pages: 12, modelId: MODEL, truncated: false, detail: "", updatedAt: "" };
  assert.equal(indexIsUsable(ready, MODEL), true);

  // Every other state means "inline the whole document".
  for (const state of ["pending", "failed", "unsupported"]) {
    assert.equal(indexIsUsable({ ...ready, state }, MODEL), false, `${state} must not retrieve`);
  }
  assert.equal(indexIsUsable(null, MODEL), false);
  assert.equal(indexIsUsable({ ...ready, pages: 0 }, MODEL), false);
  // Two checkpoints embed into different spaces. Scoring across them returns
  // numbers, which is worse than returning nothing.
  assert.equal(indexIsUsable({ ...ready, modelId: "vidore/colqwen2-v1.0" }, MODEL), false);
});

test("the status sidecar round-trips and ignores anything malformed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "colpali-status-"));
  try {
    const blob = path.join(directory, "doc_0123456789abcdef0123456789abcdef.pdf");
    fs.writeFileSync(blob, "not really a pdf");
    assert.equal(readIndexStatus(blob), null);

    writeIndexStatus(blob, { state: "ready", pages: 9, modelId: MODEL, truncated: true, detail: "" });
    const status = readIndexStatus(blob);
    assert.equal(status.state, "ready");
    assert.equal(status.pages, 9);
    assert.equal(status.truncated, true);
    assert.ok(status.updatedAt, "a status records when it was written");

    // The sidecar sits beside the blob, so deleting the document's directory
    // takes it — there is no table to fall out of step with the file.
    assert.ok(fs.existsSync(path.join(directory, "doc_0123456789abcdef0123456789abcdef.colpali.json")));

    fs.writeFileSync(
      path.join(directory, "doc_0123456789abcdef0123456789abcdef.colpali.json"),
      "{\"state\":\"whatever\"}",
    );
    assert.equal(readIndexStatus(blob), null, "an unknown state is not a state");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ── The client answers rather than throwing ──────────────────────────

test("a service that is not running is reported, not raised", async () => {
  const health = await colpaliHealth(offlineEnv());
  assert.equal(health.status, "unreachable");
  assert.match(health.detail, /not running|answered/);

  const found = await colpaliSearch("doc_0123456789abcdef0123456789abcdef", "anything", offlineEnv());
  assert.equal(found.ok, false);
  assert.equal(found.pages.length, 0);
  assert.equal(found.reason, "unreachable");
});

test("turning ColPali off short-circuits the client entirely", async () => {
  const health = await colpaliHealth({ COLPALI_MODE: "disabled" });
  assert.equal(health.status, "unreachable");
  assert.equal(colpaliMode({ COLPALI_MODE: "disabled" }), "disabled");
  assert.equal(colpaliMode({}), "auto");
});

// ── Configuration ────────────────────────────────────────────────────

test("the page budget is what makes retrieval safe for a short document", () => {
  // A document with fewer pages than k has all of its pages retrieved, so a
  // two-page contract still arrives whole. Nothing special-cases it — this is
  // just what top-k does when k exceeds the page count.
  const k = colpaliTopK({});
  assert.ok(k >= 4, "a budget below four pages would start losing short documents");
  assert.equal(colpaliTopK({ BREADBOARD_COLPALI_TOP_K: "12" }), 12);
  assert.equal(colpaliTopK({ BREADBOARD_COLPALI_TOP_K: "0" }), k, "a nonsense budget falls back");
  assert.equal(colpaliTopK({ BREADBOARD_COLPALI_TOP_K: "nope" }), k);
});

// ── The seam every entry point has to keep ───────────────────────────

test("retrieved page images are appended, never interleaved with the user's files", () => {
  // `attachmentOrderManifest` numbers attachments so "the third screenshot"
  // resolves to the third thing the *person* attached. Page images inserted
  // inline would renumber them, and the model would answer about the wrong
  // file with total confidence. The guarantee lives in the source: pages are
  // collected separately and concatenated at the end.
  const source = fs.readFileSync(
    new URL("../src/lib/colpali/retrieval.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /return \[\.\.\.rewritten, \.\.\.pageImages\]/);
  assert.match(source, /pageImages\.push\(/);
});

test("a retrieved document says it is partial, so the model cannot claim otherwise", () => {
  // Without the header a model handed three pages of a fifty-page report will
  // answer "the document does not mention X" — confidently, and wrongly.
  const source = fs.readFileSync(
    new URL("../src/lib/colpali/retrieval.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Showing the \$\{kept\.length\} page/);
  assert.match(source, /most relevant to the question/);
});

// ── Startup wiring ───────────────────────────────────────────────────

test("every way Breadboard starts brings ColPali with it, and none require it", () => {
  const root = new URL("../../", import.meta.url);
  const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

  // The dev stack.
  const devAll = read("scripts/dev-all.mjs");
  assert.match(devAll, /start-colpali\.mjs/);
  assert.match(devAll, /const colpaliEnabled = colpaliMode !== "disabled" && existsSync\(colpaliPythonBinary\)/);
  // Never waited on: a readiness gate here would be a gate on `import torch`.
  assert.doesNotMatch(devAll, /waitFor\([^)]*colpali/i);
  // And when the environment was never provisioned the dashboard is told so,
  // rather than being left to discover it one refused connection per question.
  assert.match(devAll, /COLPALI_MODE: colpaliEnabled \? "auto" : "disabled"/);

  // The Windows launcher.
  const startBat = read("start.bat");
  assert.match(startBat, /colpali-venv/);
  assert.match(startBat, /start-colpali\.mjs/);

  // The desktop supervisor.
  const definitions = read("desktop/src/main/service-definitions.ts");
  assert.match(definitions, /id: "colpali"/);
  assert.match(definitions, /required: false/);
  assert.match(definitions, /if \(colpali\) definitions\.push\(colpali\);/);
});

test("a machine that never ran setup is told what to run, not left guessing", () => {
  const devAll = fs.readFileSync(new URL("../../scripts/dev-all.mjs", import.meta.url), "utf8");
  assert.match(devAll, /npm run setup:colpali/);
  // And what it costs them not to: the message has to say what changes, or it
  // is just noise on every start.
  assert.match(devAll, /inlined whole/);
});
