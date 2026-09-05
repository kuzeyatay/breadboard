import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Session } from "electron";
import { BrowserDownloads, BROWSER_DOWNLOADS_FILE } from "../src/main/browser-downloads";
import { isBrowserDownloadCommand, IPC_CHANNELS } from "../src/shared/ipc-contract";
import { createDesktopApi } from "../src/preload/preload";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-downloads-"));
  const session = new EventEmitter();
  const opened: string[] = [];
  const shown: string[] = [];
  const files = { openPath: async (file: string) => { opened.push(file); return ""; }, showItemInFolder: (file: string) => { shown.push(file); } };
  const store = new BrowserDownloads(dir, files);
  store.attach(session as Session);
  function download(filename = "example.txt") {
    const item = Object.assign(new EventEmitter(), {
      bytes: 0,
      getFilename: () => filename,
      getURL: () => "https://example.com/file",
      getSavePath: () => path.join(dir, filename),
      getReceivedBytes: () => item.bytes,
      getTotalBytes: () => 100,
      cancel: () => item.emit("done", {}, "cancelled"),
    });
    session.emit("will-download", {}, item);
    return item;
  }
  return { dir, store, session, download, opened, shown, files, cleanup() {
    store.flush();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

test("download progress and completion persist; restarted active transfers become interrupted", () => {
  const f = fixture();
  try {
    f.store.attach(f.session as Session);
    const complete = f.download();
    complete.bytes = 100;
    complete.emit("done", {}, "completed");
    const partial = f.download("large.zip");
    partial.bytes = 35;
    partial.emit("updated", {}, "progressing");
    f.store.flush();
    const restarted = new BrowserDownloads(f.dir, f.files);
    const items = restarted.snapshot().items;
    assert.equal(items.length, 2, "attaching twice must not duplicate downloads");
    assert.equal(items[0]!.state, "interrupted");
    assert.equal(items[0]!.active, false);
    assert.equal(items[0]!.receivedBytes, 35);
    assert.equal(items[1]!.state, "completed");
    assert.equal(items[1]!.receivedBytes, 100);
  } finally { f.cleanup(); }
});

test("download actions use recorded files and clearing history keeps files and active transfers", async () => {
  const f = fixture();
  try {
    const item = f.download();
    const id = f.store.snapshot().items[0]!.id;
    assert.equal((await f.store.command({ type: "open", id })).ok, false);
    item.emit("done", {}, "completed");
    assert.match((await f.store.command({ type: "open", id })).error!, /moved or deleted/);
    const file = path.join(f.dir, "example.txt");
    fs.writeFileSync(file, "downloaded file");
    assert.equal((await f.store.command({ type: "open", id })).ok, true);
    assert.equal((await f.store.command({ type: "show", id })).ok, true);
    assert.deepEqual(f.opened, [file]);
    assert.deepEqual(f.shown, [file]);
    f.download("still-downloading.zip");
    const active = f.store.snapshot().items[0]!.id;
    await f.store.command({ type: "clear" });
    assert.deepEqual(f.store.snapshot().items.map(item => item.id), [active]);
    assert.equal(fs.existsSync(file), true);
    assert.equal((await f.store.command({ type: "cancel", id: active })).ok, true);
    assert.equal(f.store.snapshot().items[0]!.state, "cancelled");
    await f.store.command({ type: "remove", id: active });
    assert.deepEqual(new BrowserDownloads(f.dir, f.files).snapshot().items, []);
  } finally { f.cleanup(); }
});

test("shutdown cancellation remains distinct from an explicit user cancellation", () => {
  const f = fixture();
  try {
    const item = f.download();
    f.store.prepareForQuit();
    item.emit("done", {}, "cancelled");
    const restarted = new BrowserDownloads(f.dir, f.files);
    assert.equal(restarted.snapshot().items[0]!.state, "interrupted");
    assert.equal(restarted.snapshot().items[0]!.active, false);
  } finally { f.cleanup(); }
});

test("unreadable download history is preserved and reports a save error", async () => {
  const f = fixture();
  try {
    const file = path.join(f.dir, BROWSER_DOWNLOADS_FILE);
    fs.writeFileSync(file, '{"version":1,"items":');
    const store = new BrowserDownloads(f.dir, f.files);
    assert.match(store.snapshot().error!, /Couldn’t load/);
    assert.equal((await store.command({ type: "clear" })).ok, false);
    assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"items":');
  } finally { f.cleanup(); }
});

test("download bridge forwards bounded actions by ID, never a renderer-supplied file path", async () => {
  for (const value of [null, {}, { type: "open", path: "C:/file.exe" }, { type: "remove", id: "" }, { type: "delete", id: "known" }]) {
    assert.equal(isBrowserDownloadCommand(value), false);
  }
  assert.equal(isBrowserDownloadCommand({ type: "clear" }), true);
  const calls: unknown[][] = [];
  const api = createDesktopApi({ on: () => {}, invoke: async (channel, ...args) => {
    calls.push([channel, ...args]);
    return channel === IPC_CHANNELS.getBrowserDownloads ? { items: [], error: null } : { ok: true };
  } });
  assert.deepEqual(await api.getBrowserDownloads(), { items: [], error: null });
  assert.deepEqual(await api.browserDownloadCommand({ type: "show", id: "known" }), { ok: true });
  assert.deepEqual(calls, [[IPC_CHANNELS.getBrowserDownloads], [IPC_CHANNELS.browserDownloadCommand, { type: "show", id: "known" }]]);
});
