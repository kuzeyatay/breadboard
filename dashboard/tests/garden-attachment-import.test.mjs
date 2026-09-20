import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-attachment-test-"));
process.env.BREADBOARD_DATA_DIR = root;
process.env.QUARTZ_CONTENT_PATH = path.join(root, "content");
const { default: db } = await import("../src/lib/db.ts");
const { createRuntimeSession } = await import("../src/lib/hermes/runtime-store.ts");
const { beginRuntimeRun } = await import("../src/lib/hermes/run-store.ts");
const { resolveGardenAttachment } = await import("../src/lib/hermes/garden-attachment-source.ts");
const { importGardenSource } = await import("../src/lib/hermes/garden-source-import.ts");
const { executeGardenTool } = await import("../src/lib/hermes/garden-tools.ts");
const { issueCapabilityToken } = await import("../src/lib/hermes/capability-token.ts");
const { gardenSourceImportNotice } = await import("../src/lib/hermes/garden-source-import-client.ts");
const { writeDocumentBlob } = await import("../src/lib/conversations/document-blob-store.ts");
const { writeStoredFileBlob } = await import("../src/lib/conversations/stored-file-blob-store.ts");
const { writeAudioBlob } = await import("../src/lib/conversations/audio-blob-store.ts");
const { writeVideoBlob } = await import("../src/lib/conversations/video-blob-store.ts");
const { setBrowserTerminalContext } = await import("../src/lib/hermes/browser-terminal-context.ts");
const { resolveGardenBrowserSource } = await import("../src/lib/hermes/garden-browser-source.ts");
db.exec(`
  INSERT INTO users (id, username, email, password_hash) VALUES (1, 'owner', 'owner@test', 'unused'), (2, 'other', 'other@test', 'unused');
  INSERT INTO clusters (id, user_id, name, slug) VALUES (1, 1, 'Physics', 'physics'), (2, 2, 'Other', 'other');
`);
after(() => {
  db.close();
  assert.equal(path.dirname(root), os.tmpdir());
  assert.ok(path.basename(root).startsWith("garden-attachment-test-"));
  fs.rmSync(root, { recursive: true, force: true });
});

function conversation(messages, activeIndex = messages.length - 1) {
  const publicId = randomUUID();
  const id = Number(db.prepare("INSERT INTO conversations (public_id, user_id, title) VALUES (?, 1, 'Import')").run(publicId).lastInsertRowid);
  messages.forEach((attachments, index) => db.prepare(`INSERT INTO conversation_messages
    (conversation_id, client_message_id, role, surface, content, status, order_index, metadata)
    VALUES (?, ?, 'user', 'garden_chat', 'Add these to my Garden', 'complete', ?, ?)`)
    .run(id, `${publicId}-${index}`, index, JSON.stringify({ attachments })));
  const session = createRuntimeSession({
    conversationId: id, surface: "garden_chat", userId: 1, chatSessionId: null,
    agentName: "breadboard-garden", clusterId: 1, gardenId: "physics", pageSlug: null,
    allowedGardenIds: [1], workspaceKey: publicId, activeDirectory: root,
    filesystemMode: "restricted", hermesSessionId: publicId,
  });
  beginRuntimeRun({ runtimeSessionId: session.id, instruction: "Add these to my Garden", dispatch: { clientMessageId: `${publicId}-${activeIndex}` } });
  const context = { userId: 1, conversationId: id, runtimeSessionId: session.id, clusterId: 1, clusterSlug: "physics", contentPath: process.env.QUARTZ_CONTENT_PATH };
  const scope = { userId: 1, conversationId: id, breadboardSessionId: String(session.id), surface: "garden_chat", hermesSessionId: publicId, allowedGardenIds: [1], activeGardenId: 1, allowedTools: ["garden_import_source"] };
  return { context, scope };
}

async function attachment(type, format, bytes, userId = 1, name = `source.${format}`) {
  const writer = { document: writeDocumentBlob, file: writeStoredFileBlob, audio: writeAudioBlob, video: writeVideoBlob }[type];
  const stored = await writer({ userId, format, body: new Blob([bytes]).stream() });
  return { type, format, blobId: stored.blobId, name, sizeBytes: stored.byteSize };
}

test("documents, text, images, audio and video import their exact attached bytes through the right pipeline", async () => {
  const fixtures = [
    ["document", "pdf", "%PDF-1.4 original", "pdf"],
    ["document", "docx", "PK original office bytes", "document"],
    ["file", "md", "# Original notes", "document"],
    ["audio", "mp3", "ID3 original audio", "audio"],
    ["video", "mp4", "original video bytes", "video"],
  ];
  for (const [type, format, bytes, kind] of fixtures) {
    const upload = await attachment(type, format, bytes);
    const { context } = conversation([[upload]]);
    let called = 0;
    const ingest = async (actual, file) => {
      called++;
      assert.equal(actual, context);
      assert.equal(file.name, upload.name);
      assert.equal(await file.text(), bytes);
      return { jobId: "job-original", processing: true };
    };
    const fail = async () => assert.fail("Attachment must not be downloaded as a URL");
    const result = await importGardenSource(context, { attachmentName: upload.name }, {
      assertHost: fail, link: fail, pdf: fail, media: fail,
      document: kind === "audio" || kind === "video" ? fail : ingest,
      mediaFile: kind === "audio" || kind === "video" ? ingest : fail,
    });
    assert.equal(called, 1);
    assert.equal(result.kind, kind);
    assert.equal(result.processing, true);
  }
  const { context } = conversation([[{ type: "image", name: "scan.png", dataUrl: "data:image/png;base64,aW1hZ2U=" }]]);
  const image = await resolveGardenAttachment(context, {});
  assert.equal(image.kind, "image");
  assert.equal(await image.file.text(), "image");
});

test("follow-ups resolve previous uploads, indexes disambiguate, and future turns stay out of scope", async () => {
  const first = await attachment("file", "txt", "first", 1, "same.txt");
  const second = await attachment("file", "txt", "second", 1, "same.txt");
  const future = await attachment("file", "txt", "future", 1, "future.txt");
  const { context } = conversation([[first, second], [], [future]], 1);
  await assert.rejects(resolveGardenAttachment(context, {}), /multiple attachments/);
  await assert.rejects(resolveGardenAttachment(context, { attachmentName: "same.txt" }), /Several attachments/);
  assert.equal(await (await resolveGardenAttachment(context, { attachmentIndex: 2 })).file.text(), "second");
  await assert.rejects(resolveGardenAttachment(context, { attachmentName: "future.txt" }), /No matching/);
  for (const args of [{ attachmentIndex: 0 }, { attachmentIndex: 1.5 }, { attachmentIndex: "1" }, { attachmentIndex: 3 }, { attachmentName: "same.txt", attachmentIndex: 1 }]) {
    await assert.rejects(resolveGardenAttachment(context, args));
  }
  const previous = conversation([[first], []]);
  assert.equal(await (await resolveGardenAttachment(previous.context, { attachmentName: "same.txt" })).file.text(), "first");
});

test("foreign, missing, legacy and unsupported originals fail without downloading or copying another user's bytes", async () => {
  const foreign = await attachment("document", "pdf", "%PDF private", 2);
  const { context } = conversation([[foreign]]);
  await assert.rejects(resolveGardenAttachment(context, {}), /no longer available/);
  await assert.rejects(resolveGardenAttachment({ ...context, userId: 2 }, {}), /does not belong/);
  await assert.rejects(resolveGardenAttachment({ ...context, conversationId: 999 }, {}), /does not belong/);
  const legacy = conversation([[{ type: "file", name: "lost.pdf" }]]);
  await assert.rejects(resolveGardenAttachment(legacy.context, {}), /original bytes/);
  const binary = await attachment("file", "bin", "binary", 1, "program.exe");
  await assert.rejects(resolveGardenAttachment(conversation([[binary]]).context, {}), /format cannot be ingested/);
  await assert.rejects(importGardenSource(context, { attachmentIndex: 1, url: "https://example.com/a.pdf" }), /not both/);
  const denied = await executeGardenTool({ rawToken: issueCapabilityToken({ ...conversation([[]]).scope, allowedGardenIds: [2], activeGardenId: 2 }), tool: "garden_import_source", args: { attachmentName: "lost.pdf" } });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /owner/);
});

test("the capability broker streams the original into a scoped document job, tracks it and reuses duplicates", async () => {
  const bytes = "# Durable lecture notes\nOriginal source text.";
  const upload = await attachment("file", "md", bytes);
  const { scope } = conversation([[upload]]);
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = "http://127.0.0.1:7739";
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "0123456789abcdef0123456789abcdef";
  const originalFetch = globalThis.fetch;
  let submitted = false;
  let uploads = 0;
  const job = {
    jobId: "job_import", jobType: "document-ingestion", workerKind: "document-ingestion-node", resourceClass: "large-generation",
    state: "queued", stage: null, attempt: 0, workerInstanceId: null, gardenId: "physics", conversationId: null,
    createdAt: 100, startedAt: null, updatedAt: 100, finishedAt: null, lastHeartbeatAt: null,
    lastWorkerSequence: 0, progressCurrent: 0, progressTotal: 0, failureCode: null, failureMessage: null,
    resourceExhaustion: null, cancellationRequested: false,
  };
  globalThis.fetch = async (url, init) => {
    const endpoint = new URL(url).pathname;
    assert.equal(init.headers["x-breadboard-user-id"], "1");
    assert.equal(init.headers["x-breadboard-garden-id"], "physics");
    if (endpoint === "/v1/jobs/lookup") return submitted
      ? Response.json({ type: "runtime-job", protocolVersion: 1, job })
      : Response.json({ type: "runtime-error", protocolVersion: 1, code: "JOB_NOT_FOUND", message: "Not found", retryable: false, resource: null, requiredHeadroomMb: null, availableHeadroomMb: null }, { status: 404 });
    if (endpoint === "/v1/job-inputs") {
      const body = JSON.parse(init.body);
      assert.match(body.displayName, /^source-[a-f0-9]{10}\.md$/);
      assert.equal(body.declaredSizeBytes, Buffer.byteLength(bytes));
      return Response.json({ uploadId: "upload_original", expiresAt: Date.now() + 60_000, maximumBytes: 1024 * 1024 });
    }
    if (endpoint === "/v1/job-inputs/upload_original") {
      uploads++;
      assert.equal(await new Response(init.body).text(), bytes);
      return Response.json({ type: "runtime-job-input", protocolVersion: 1, uploadId: "upload_original", state: "sealed", sizeBytes: Buffer.byteLength(bytes), sha256: "a".repeat(64) });
    }
    assert.equal(endpoint, "/v1/jobs");
    const body = JSON.parse(init.body);
    assert.equal(body.jobType, "document-ingestion");
    assert.deepEqual(body.inputUploads, [{ uploadId: "upload_original" }]);
    assert.equal(body.requestPayload.generateMap, true);
    submitted = true;
    return Response.json({ type: "runtime-job", protocolVersion: 1, job });
  };
  try {
    const invoke = () => executeGardenTool({ rawToken: issueCapabilityToken(scope), tool: "garden_import_source", args: { attachmentName: upload.name } });
    const result = await invoke();
    assert.equal(result.ok, true, result.error);
    const notice = gardenSourceImportNotice(result);
    assert.equal(notice.kind, "document");
    assert.equal(notice.filename, "source.md");
    assert.equal(notice.processing, true);
    assert.equal(notice.jobId, "job_import");
    const duplicate = await invoke();
    assert.equal(duplicate.ok, true, duplicate.error);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(uploads, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("browser imports carry original bytes and parser choices through the Garden broker; duplicates respect parsing", async () => {
  const bytes = "%PDF-1.4\nCanvas lab original\n%%EOF";
  const { scope, context } = conversation([[]]);
  const secret = "c".repeat(64);
  let received = 0;
  let invalidate = false;
  const bridge = http.createServer(async (req, res) => {
    received++;
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    assert.equal(req.headers.cookie, undefined);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    assert.deepEqual(JSON.parse(raw), { action: "download", url: "https://canvas.example/courses/42/files/7/download" });
    if (invalidate) setBrowserTerminalContext(context.runtimeSessionId);
    const transferId = "d".repeat(32);
    const receipt = Buffer.alloc(40);
    receipt.write(transferId, 0, "ascii");
    receipt.writeBigUInt64BE(BigInt(Buffer.byteLength(bytes)), 32);
    res.writeHead(200, { "content-type": "application/octet-stream", "x-breadboard-filename": "5ECE0_LAB.pdf", "x-breadboard-transfer-id": transferId });
    res.end(Buffer.concat([Buffer.from(bytes), receipt]));
  });
  await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
  const access = { port: bridge.address().port, token: secret };
  setBrowserTerminalContext(context.runtimeSessionId, access);
  const originalFetch = globalThis.fetch;
  const jobs = new Map();
  const submitted = [];
  const uploads = [];
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = "http://127.0.0.1:7739";
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "0123456789abcdef0123456789abcdef";
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    if (target.port === String(access.port)) return originalFetch(url, init);
    assert.equal(init.headers["x-breadboard-user-id"], "1");
    assert.equal(init.headers["x-breadboard-garden-id"], "physics");
    if (target.pathname === "/v1/jobs/lookup") {
      const key = JSON.parse(init.body).idempotencyKey;
      const job = jobs.get(key);
      return job ? Response.json({ type: "runtime-job", protocolVersion: 1, job })
        : Response.json({ type: "runtime-error", protocolVersion: 1, code: "JOB_NOT_FOUND", message: "Not found", retryable: false, resource: null, requiredHeadroomMb: null, availableHeadroomMb: null }, { status: 404 });
    }
    if (target.pathname === "/v1/job-inputs") return Response.json({ uploadId: "upload_browser", expiresAt: Date.now() + 60_000, maximumBytes: 1024 * 1024 });
    if (target.pathname === "/v1/job-inputs/upload_browser") {
      uploads.push(await new Response(init.body).text());
      return Response.json({ type: "runtime-job-input", protocolVersion: 1, uploadId: "upload_browser", state: "sealed", sizeBytes: Buffer.byteLength(bytes), sha256: "a".repeat(64) });
    }
    assert.equal(target.pathname, "/v1/jobs");
    const body = JSON.parse(init.body);
    submitted.push(body);
    const job = {
      jobId: `job_browser_${submitted.length}`, jobType: "document-ingestion", workerKind: "document-ingestion-node", resourceClass: "large-generation",
      state: "queued", stage: null, attempt: 0, workerInstanceId: null, gardenId: "physics", conversationId: null,
      createdAt: 100, startedAt: null, updatedAt: 100, finishedAt: null, lastHeartbeatAt: null,
      lastWorkerSequence: 0, progressCurrent: 0, progressTotal: 0, failureCode: null, failureMessage: null,
      resourceExhaustion: null, cancellationRequested: false,
    };
    jobs.set(body.idempotencyKey, job);
    return Response.json({ type: "runtime-job", protocolVersion: 1, job });
  };
  const args = { useBrowserSession: true, url: "https://canvas.example/courses/42/files/7/download" };
  const invoke = (flags = {}) => executeGardenTool({ rawToken: issueCapabilityToken(scope), tool: "garden_import_source", args: { ...args, ...flags } });
  try {
    const first = await invoke();
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(first.data.parsing, { parseWithVlm: false, parseWithAnydoc: false });
    const flags = { parseWithVlm: true, parseWithAnydoc: true };
    const both = await invoke(flags);
    assert.equal(both.ok, true, both.error);
    assert.deepEqual(both.data.parsing, flags);
    assert.equal(gardenSourceImportNotice(both).kind, "pdf");
    assert.equal(gardenSourceImportNotice(both).filename, "5ECE0_LAB.pdf");
    assert.equal(gardenSourceImportNotice(both).processing, true);
    assert.equal(submitted.length, 2);
    assert.notEqual(submitted[0].idempotencyKey, submitted[1].idempotencyKey);
    assert.equal(submitted[1].requestPayload.parseWithVlm, true);
    assert.equal(submitted[1].requestPayload.parseWithAnydoc, true);
    assert.deepEqual(uploads, [bytes, bytes]);
    const duplicate = await invoke(flags);
    assert.equal(duplicate.ok, true, duplicate.error);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(submitted.length, 2);
    for (const bad of [{ parseWithVlm: "true" }, { parseWithAnydoc: 1 }, { useBrowserSession: "true" }]) {
      const before = received;
      const result = await invoke(bad);
      assert.equal(result.ok, false);
      assert.equal(received, before, "invalid options must not download");
    }
    const before = received;
    await assert.rejects(resolveGardenBrowserSource({ ...context, userId: 2 }, args.url), /linked signed-in/);
    const foreign = await executeGardenTool({ rawToken: issueCapabilityToken({ ...scope, allowedGardenIds: [2], activeGardenId: 2 }), tool: "garden_import_source", args });
    assert.equal(foreign.ok, false);
    assert.equal(received, before);
    invalidate = true;
    const stale = await invoke();
    assert.equal(stale.ok, false);
    assert.match(stale.error, /conversation changed/);
    assert.equal(submitted.length, 2);
    const missing = await invoke();
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Terminal beside/);
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserTerminalContext(context.runtimeSessionId);
    bridge.closeAllConnections();
    await new Promise(resolve => bridge.close(resolve));
  }
});

test("public PDF and attachment imports preserve explicitly selected AnyDoc and VLM flags", async () => {
  const options = { parseWithVlm: true, parseWithAnydoc: true };
  const { context } = conversation([[]]);
  const calls = [];
  const fail = async () => assert.fail("Unexpected ingestion path");
  const deps = { assertHost: async () => {}, link: fail, media: fail,
    pdf: async (_context, _url, _title, flags) => { calls.push(flags); return { processing: true }; },
    attachment: async () => ({ kind: "pdf", file: new File(["%PDF-original"], "lecture.pdf") }),
    document: async (_context, _file, _label, flags) => { calls.push(flags); return { processing: true }; },
  };
  await importGardenSource(context, { kind: "pdf", url: "https://example.com/lecture.pdf", ...options }, deps);
  await importGardenSource(context, { attachmentName: "lecture.pdf", ...options }, deps);
  assert.deepEqual(calls, [options, options]);
  await assert.rejects(importGardenSource(context, { useBrowserSession: true }, deps), /exact file URL/);
  await assert.rejects(importGardenSource(context, { useBrowserSession: true, url: "https://example.com/lecture.pdf", attachmentName: "lecture.pdf" }, deps), /not both/);
});
