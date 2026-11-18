import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import ts from "typescript";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as blobs from "../src/lib/conversations/document-blob-store.ts";
import * as readings from "../src/lib/conversations/document-reading-store.ts";
import * as formats from "../src/lib/document-attachments.ts";
import * as ranges from "../src/lib/http-range.ts";
import { readPdfAttachment } from "../src/lib/pdf-attachment-reader.ts";
import * as gardenReading from "../src/lib/pdf-garden-reading.ts";
import { ApiError } from "../src/lib/hermes/route-core.ts";
import { isSpiceNetlistArtifact } from "../src/lib/netlist-viewer/format.ts";

const STORE_ONLY_HEADER = "x-document-store-only";

// Execute production functions with only their external boundaries supplied,
// following the existing Garden dispatch test harness.
function functions(file, names, scope) {
  const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  const compiled = ts.transpileModule(declarations.map(node => node.getText(tree)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("exports", ...Object.keys(scope), `${compiled}\nreturn {${names.join(",")}};`)({}, ...Object.values(scope));
}

async function pdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("The electric field exerts a force on a charged particle.", { font, x: 20, y: 400 });
  document.addPage();
  return document.save();
}

test("the web reader serves owned PDF byte ranges and defers cleanup until after upload", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-pdf-response-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let cleanup, swept = false;
  const scope = {
    ...formats, ...ranges, ...blobs, fs, Readable, NextResponse: Response,
    requireUserId: async () => 1,
    writeDocumentBlob: args => blobs.writeDocumentBlob({ ...args, root }),
    findDocumentBlob: args => blobs.findDocumentBlob({ ...args, root }),
    STORE_ONLY_HEADER, after: fn => { cleanup = fn; },
    sweepOpenedFiles: () => { swept = true; },
    apiErrorResponse: error => { throw error; },
  };
  const { POST } = functions("app/api/chat-attachments/documents/route.ts", ["POST"], scope);
  const bytes = await pdf();
  const upload = await POST(new Request("http://test/documents", {
    method: "POST", body: bytes, headers: { "x-document-filename": "web.pdf", "x-document-store-only": "true" },
  }));
  const stored = await upload.json();
  assert.equal(upload.status, 200, JSON.stringify(stored));
  const { blobId } = stored;
  assert.equal(swept, false);
  cleanup();
  assert.equal(swept, true);
  const route = "app/api/chat-attachments/documents/[blobId]/route.ts";
  const { GET } = functions(route, ["GET"], scope);
  const params = { params: Promise.resolve({ blobId }) };
  const read = headers => GET(new Request("http://test/document", { headers }), params);
  const whole = await read({});
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), bytes);
  assert.equal((await read({ "if-none-match": whole.headers.get("etag") })).status, 304);
  const slice = await read({ range: "bytes=0-4" });
  assert.equal(slice.status, 206);
  assert.equal(slice.headers.get("content-length"), "5");
  assert.equal(await slice.text(), "%PDF-");
  assert.equal((await read({ range: `bytes=${bytes.length}-` })).status, 416);
  const other = functions(route, ["GET"], { ...scope, requireUserId: async () => 2 });
  assert.equal((await other.GET(new Request("http://test/document"), params)).status, 404);
});

test("the upload handler reads scans, persists the reading, and rejects unreadable uploads", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-upload-regression-"));
  const previous = process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    else process.env.BREADBOARD_CHAT_DOCUMENT_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  let unavailable = false;
  const ocr = [];
  const handler = functions("app/api/chat-attachments/documents/route.ts", ["POST", "DELETE"], {
    ...blobs, ...readings, ...formats, ...gardenReading, fs, ApiError, NextResponse: Response, STORE_ONLY_HEADER,
    requireReadableCluster: () => { throw new Error("Unexpected Garden access"); },
    requireUserId: async () => 1,
    apiErrorResponse: error => Response.json({ code: error.code, message: error.message }, { status: error.status ?? 500 }),
    readPdfAttachment: (bytes, options) => readPdfAttachment(bytes, { ...options, transcribe: async (_url, page) => {
      ocr.push(page);
      if (unavailable) throw new Error("Document reader unavailable");
      return "Handwritten notes explain that moving electric charge is current.";
    } }),
  });
  const bytes = await pdf();
  const request = handwriting => new Request("http://test/api/chat-attachments/documents", {
    method: "POST", body: bytes, headers: { "x-document-filename": "scan.pdf", "x-document-handwriting": String(handwriting) },
  });
  const response = await handler.POST(request(false));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(ocr, [2]);
  assert.match(result.text, /\[\[Page 2\]\]\nHandwritten/);
  assert.equal(readings.readStoredDocumentText({ userId: 1, blobId: result.blobId }), result.text);
  const deleted = await handler.DELETE(new Request(`http://test/api/chat-attachments/documents?blobId=${result.blobId}`));
  assert.deepEqual(await deleted.json(), { removed: true });
  const screenshotRequest = request(false);
  screenshotRequest.headers.set("x-pdf-ocr-pages", "[]");
  const screenshotResponse = await handler.POST(screenshotRequest);
  assert.equal(screenshotResponse.status, 200);
  const screenshotResult = await screenshotResponse.json();
  assert.deepEqual(ocr, [2], "a screenshot-backed upload must not call OCR");
  assert.match(screenshotResult.text, /Electric field|electric field/);
  assert.match(screenshotResult.text, /not been transcribed/);
  const savedBlob = blobs.findDocumentBlob({ userId: 1, blobId: screenshotResult.blobId });
  assert.deepEqual(fs.readFileSync(savedBlob.path), Buffer.from(bytes), "the full original survives scoped reading");
  blobs.removeDocumentBlob({ userId: 1, blobId: screenshotResult.blobId });
  for (const invalid of ['oops', '{}', '[0]', '[1.5]', '["2"]', '[1,2,3,4,5,6,7,8,9]']) {
    const bad = request(false); bad.headers.set("x-pdf-ocr-pages", invalid);
    assert.equal((await handler.POST(bad)).status, 400);
  }
  unavailable = true;
  const failed = await handler.POST(request(true));
  assert.equal(failed.status, 422);
  assert.match((await failed.json()).message, /page 1.*Document reader unavailable/);
  assert.deepEqual(fs.readdirSync(path.join(root, "u1")), [], "an unreadable new upload must not leave a misleading attachment");
});

test("Garden uploads authorize the source and reuse saved OCR through the real upload handler", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-garden-upload-"));
  const oldBlobs = process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
  const oldContent = process.env.QUARTZ_CONTENT_PATH;
  process.env.BREADBOARD_CHAT_DOCUMENT_DIR = path.join(root, "blobs");
  process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
  t.after(() => {
    if (oldBlobs === undefined) delete process.env.BREADBOARD_CHAT_DOCUMENT_DIR;
    else process.env.BREADBOARD_CHAT_DOCUMENT_DIR = oldBlobs;
    if (oldContent === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = oldContent;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const garden = path.join(process.env.QUARTZ_CONTENT_PATH, "circuits");
  fs.mkdirSync(path.join(garden, "sources"), { recursive: true });
  fs.mkdirSync(path.join(garden, "assets"));
  const bytes = await pdf();
  fs.writeFileSync(path.join(garden, "assets/source.pdf"), bytes);
  fs.writeFileSync(path.join(garden, "sources/notes.md"), '---\nsource_pdf: "/circuits/assets/source.pdf"\n---\n## Page 1\nSaved electric field explanation.\n## Page 2\nSaved transient state explanation.');
  let allowed = true;
  const handler = functions("app/api/chat-attachments/documents/route.ts", ["POST"], {
    ...blobs, ...readings, ...formats, ...gardenReading, fs, ApiError, NextResponse: Response, STORE_ONLY_HEADER,
    requireUserId: async () => 1,
    requireReadableCluster: (userId, slug) => {
      assert.equal(userId, 1); assert.equal(slug, "circuits");
      if (!allowed) throw new ApiError(403, "forbidden", "Garden access denied");
      return { slug };
    },
    apiErrorResponse: error => Response.json({ message: error.message }, { status: error.status ?? 500 }),
    readPdfAttachment: (data, options) => readPdfAttachment(data, { ...options,
      transcribe: async () => assert.fail("Saved Garden OCR must prevent another OCR job"),
    }),
  });
  const request = () => new Request("http://test/api/chat-attachments/documents", {
    method: "POST", body: bytes, headers: { "x-document-filename": "scan.pdf",
      referer: "http://test/gardens/circuits/pdf/notes" },
  });
  const response = await handler.POST(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.text, /\[\[Page 2\]\]\nSaved transient state explanation/);
  assert.deepEqual(result.warnings, []);
  assert.equal(readings.readStoredDocumentText({ userId: 1, blobId: result.blobId }), result.text);
  blobs.removeDocumentBlob({ userId: 1, blobId: result.blobId });
  allowed = false;
  assert.equal((await handler.POST(request())).status, 403);
  assert.deepEqual(fs.readdirSync(path.join(process.env.BREADBOARD_CHAT_DOCUMENT_DIR, "u1")), []);
});

test("the legacy extraction endpoint also detects scans without a handwriting checkbox", async () => {
  const optionsSeen = [];
  const { POST } = functions("app/api/extract-text/route.ts", ["POST"], {
    NextResponse: Response, ApiError, path,
    requireUserId: async () => 1,
    resolveChatmockBaseUrl: () => ({ baseURL: "http://reader.test/v1" }),
    readPdfAttachment: async (_bytes, options) => { optionsSeen.push(options); return { text: "The scanned notes.", warning: "" }; },
    routeErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
  });
  const form = new FormData();
  form.set("file", new File([await pdf()], "scan.pdf", { type: "application/pdf" }));
  const response = await POST(new Request("http://test/api/extract-text", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "The scanned notes.");
  assert.equal(optionsSeen[0].handwriting, false);
  assert.equal(optionsSeen[0].baseURL, "http://reader.test/v1");
  assert.ok(optionsSeen[0].signal instanceof AbortSignal);
});

test("failed response persistence retains the actionable cause and original partial answer", () => {
  const written = [];
  const { persistAssistantOnce } = functions("lib/hermes/event-stream.ts", ["persistAssistantOnce"], {
    normalizeChatTokenUsage: () => undefined,
    getActiveRuntimeRun: () => ({ started_at: new Date().toISOString() }),
    parseRuntimeRunDispatch: () => ({ clientMessageId: "turn-1" }),
    failAssistantMessage: input => written.push(input),
  });
  persistAssistantOnce({ row: { id: 2, conversation_id: 3 } }, "Partial answer", [], [], [], {}, "failed", [], undefined, undefined,
    { code: "interrupted_turn", message: "The agent was interrupted. Retry with the saved attachment." });
  assert.equal(written[0].content, "Partial answer");
  assert.equal(written[0].error, "The agent was interrupted. Retry with the saved attachment.");
  assert.equal(written[0].metadata.errorCode, "interrupted_turn");
  persistAssistantOnce({ row: { id: 2, conversation_id: 3 } }, "", [], [], [], {}, "failed", []);
  assert.match(written[1].error, /Retry this response with its saved attachments/);
});

test("the original PDF card identifies itself as an upload", () => {
  const { artifactDescription } = functions("app/components/hermes/artifact-viewer.tsx", ["extensionLabel", "artifactDescription"], { kindLabels: { pdf: "PDF" }, isSpiceNetlistArtifact });
  assert.equal(artifactDescription({ kind: "pdf", filename: "notes.pdf", metadata: { importedFromUpload: true } }), "Uploaded file · PDF");
  assert.equal(artifactDescription({ kind: "pdf", filename: "answer.pdf" }), "PDF · PDF");
});
