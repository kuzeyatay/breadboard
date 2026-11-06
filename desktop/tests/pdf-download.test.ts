import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { savePdfToDownloads, registerPdfDownloadHandler } from "../src/main/pdf-download";
import { BrowserDownloads } from "../src/main/browser-downloads";
import { IPC_CHANNELS } from "../src/shared/ipc-contract";
import type { IpcMainInvokeEvent } from "electron";

const bytes = new TextEncoder().encode("%PDF-1.7\nPDF download fixture\n%%EOF\n");
const request = () => ({ filename: "notes.pdf", data: bytes.slice().buffer });
function fixture(t: import("node:test").TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-pdf-save-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("PDF success means bytes are on disk; repeat and concurrent exports preserve existing files", async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "notes.pdf"), "existing user's file");
  const results = await Promise.all([savePdfToDownloads(dir, request()), savePdfToDownloads(dir, request())]);
  assert.deepEqual(results.map(r => r.ok && r.filename).sort(), ["notes (1).pdf", "notes (2).pdf"]);
  for (const result of results) {
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(fs.readFileSync(result.savePath), Buffer.from(bytes));
  }
  assert.equal(fs.readFileSync(path.join(dir, "notes.pdf"), "utf8"), "existing user's file");
});

test("invalid bytes and unsafe filenames cannot write files outside Downloads", async t => {
  const dir = fixture(t);
  for (const filename of ["../escape.pdf", "..\\escape.pdf", "C:\\escape.pdf", "file.pdf:payload", "notes.exe", "NUL.pdf", ".hidden.pdf", "a\u0000.pdf"]) {
    assert.equal((await savePdfToDownloads(dir, { ...request(), filename })).ok, false, filename);
  }
  for (const data of [new ArrayBuffer(0), new TextEncoder().encode("not a PDF").buffer, "%PDF-", bytes]) {
    assert.equal((await savePdfToDownloads(dir, { ...request(), data })).ok, false);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("unwritable destination reports failure without claiming a completed download", async t => {
  const dir = fixture(t);
  const blocked = path.join(dir, "blocked");
  fs.writeFileSync(blocked, "not a directory");
  const result = await savePdfToDownloads(blocked, request());
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Could not save.*download folder/);
  assert.equal(fs.readFileSync(blocked, "utf8"), "not a directory");
});

test("a disk flush failure removes the incomplete file and reports failure", async t => {
  const dir = fixture(t);
  const promises = require("node:fs/promises") as typeof import("node:fs/promises");
  const open = promises.open;
  t.mock.method(promises, "open", async (...args: Parameters<typeof open>) => {
    const file = await open(...args);
    file.sync = async () => { throw new Error("disk flush failed"); };
    return file;
  });
  assert.equal((await savePdfToDownloads(dir, request())).ok, false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("saved PDFs survive history reload and support Show in folder", async t => {
  const dir = fixture(t);
  const result = await savePdfToDownloads(dir, request());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const shown: string[] = [];
  const actions = { openPath: async () => "", showItemInFolder: (file: string) => { shown.push(file); } };
  new BrowserDownloads(dir, actions).recordSavedPdf(result.savePath, "http://localhost/garden/demo");
  const restored = new BrowserDownloads(dir, actions);
  const [entry] = restored.snapshot().items;
  assert.equal(entry!.state, "completed");
  assert.equal(entry!.totalBytes, bytes.length);
  await restored.command({ type: "show", id: entry!.id });
  assert.deepEqual(shown, [result.savePath]);
});

test("PDF save dialog honors the chosen filename and cancellation without writing", async t => {
  const dir = fixture(t);
  const chosen = path.join(dir, "renamed.pdf");
  fs.writeFileSync(chosen, "previous document");
  const result = await savePdfToDownloads(dir, request(), async suggested => {
    assert.equal(suggested, path.join(dir, "notes.pdf"));
    return chosen;
  });
  assert.deepEqual(result, { ok: true, filename: "renamed.pdf", savePath: chosen });
  assert.deepEqual(fs.readFileSync(chosen), Buffer.from(bytes));
  const cancelled = await savePdfToDownloads(dir, request(), async () => null);
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.cancelled, true);
  assert.deepEqual(fs.readdirSync(dir), ["renamed.pdf"]);
  let prompted = false;
  await savePdfToDownloads(dir, { ...request(), filename: "../escape.pdf" }, async () => { prompted = true; return chosen; });
  assert.equal(prompted, false, "validate before opening a native dialog");
});

test("failed PDF flush leaves the selected existing file intact", async t => {
  const dir = fixture(t);
  const chosen = path.join(dir, "existing.pdf");
  fs.writeFileSync(chosen, "keep the original");
  const promises = require("node:fs/promises") as typeof import("node:fs/promises");
  const open = promises.open;
  t.mock.method(promises, "open", async (...args: Parameters<typeof open>) => {
    const file = await open(...args);
    file.sync = async () => { throw new Error("disk flush failed"); };
    return file;
  });
  assert.equal((await savePdfToDownloads(dir, request(), async () => chosen)).ok, false);
  assert.equal(fs.readFileSync(chosen, "utf8"), "keep the original");
  assert.deepEqual(fs.readdirSync(dir), ["existing.pdf"]);
});

test("PDF IPC rejects subframes, foreign origins, and unowned windows", async t => {
  const dir = fixture(t);
  let handler!: (event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>;
  let owns = true;
  const saved: string[] = [];
  registerPdfDownloadHandler({ handle: (channel, listener) => {
    assert.equal(channel, IPC_CHANNELS.savePdfDownload);
    handler = listener;
  } }, {
    ownsSender: () => owns, dashboardUrl: () => "http://localhost:3000", downloadsDirectory: () => dir,
    onSaved: file => { saved.push(file); }, log: () => {},
  });
  const mainFrame = { url: "http://localhost:3000/garden/demo" };
  const event = { sender: { mainFrame }, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  for (const url of ["https://example.com", "invalid url"]) {
    mainFrame.url = url;
    assert.equal((await handler(event, request()) as { ok: boolean }).ok, false);
  }
  mainFrame.url = "http://localhost:3000/garden/demo";
  assert.equal((await handler({ ...event, senderFrame: { ...mainFrame } } as IpcMainInvokeEvent, request()) as { ok: boolean }).ok, false);
  owns = false;
  assert.equal((await handler(event, request()) as { ok: boolean }).ok, false);
  assert.deepEqual(fs.readdirSync(dir), []);
  owns = true;
  assert.equal((await handler(event, request()) as { ok: boolean }).ok, true);
  assert.deepEqual(saved, [path.join(dir, "notes.pdf")]);
});
