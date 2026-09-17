import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as blobs from "../src/lib/conversations/document-blob-store.ts";
import * as readings from "../src/lib/conversations/document-reading-store.ts";
import * as formats from "../src/lib/document-attachments.ts";
import { readPdfAttachment } from "../src/lib/pdf-attachment-reader.ts";
import { ApiError } from "../src/lib/hermes/route-core.ts";

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
    ...blobs, ...readings, ...formats, fs, ApiError, NextResponse: Response,
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
  unavailable = true;
  const failed = await handler.POST(request(true));
  assert.equal(failed.status, 422);
  assert.match((await failed.json()).message, /page 1.*Document reader unavailable/);
  assert.deepEqual(fs.readdirSync(path.join(root, "u1")), [], "an unreadable new upload must not leave a misleading attachment");
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
  const { artifactDescription } = functions("app/components/hermes/artifact-viewer.tsx", ["extensionLabel", "artifactDescription"], { kindLabels: { pdf: "PDF" } });
  assert.equal(artifactDescription({ kind: "pdf", filename: "notes.pdf", metadata: { importedFromUpload: true } }), "Uploaded file · PDF");
  assert.equal(artifactDescription({ kind: "pdf", filename: "answer.pdf" }), "PDF · PDF");
});
