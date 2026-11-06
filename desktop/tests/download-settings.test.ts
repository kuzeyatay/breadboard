import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, Session, SaveDialogOptions } from "electron";
import { DownloadSettings, DOWNLOAD_SETTINGS_FILE, registerDownloadSettingsHandlers } from "../src/main/download-settings";
import { IPC_CHANNELS } from "../src/shared/ipc-contract";
import { createDesktopApi } from "../src/preload/preload";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-download-settings-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "Downloads");
  fs.mkdirSync(directory);
  const settings = new DownloadSettings(root, directory);
  const session = new EventEmitter();
  settings.attach(session as Session);
  const download = (filename: string, existingPath = "") => {
    let savePath = existingPath;
    let dialog: SaveDialogOptions | undefined;
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => filename,
      getSavePath: () => savePath,
      setSavePath: (next: string) => { savePath = next; },
      setSaveDialogOptions: (next: SaveDialogOptions) => { dialog = next; },
      getSaveDialogOptions: () => dialog,
    });
    session.emit("will-download", {}, item);
    return item;
  };
  return { root, directory, settings, session, download };
}

test("downloads save automatically, preserving existing files and simultaneous names", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, "notes.txt"), "keep me");
  f.settings.attach(f.session as Session);
  assert.equal(f.session.listenerCount("will-download"), 1);
  const first = f.download("notes.txt");
  const second = f.download("notes.txt");
  assert.equal(first.getSavePath(), path.join(f.directory, "notes (1).txt"));
  assert.equal(second.getSavePath(), path.join(f.directory, "notes (2).txt"));
  assert.equal(fs.readFileSync(path.join(f.directory, "notes.txt"), "utf8"), "keep me");
  first.emit("done", {}, "cancelled");
  assert.equal(f.download("notes.txt").getSavePath(), first.getSavePath());
});

test("asking leaves Electron's picker enabled, starts in the chosen folder, and persists", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "Chosen folder");
  fs.mkdirSync(directory);
  f.settings.setDirectory(directory);
  f.settings.setAskWhereToSave(true);
  const item = f.download("notes.txt");
  assert.equal(item.getSavePath(), "");
  assert.equal(item.getSaveDialogOptions()?.defaultPath, path.join(directory, "notes.txt"));
  const restored = new DownloadSettings(f.root, f.directory);
  assert.deepEqual(restored.read(), { directory, askWhereToSave: true });
  f.settings.setAskWhereToSave(false);
  assert.equal(f.download("notes.txt").getSavePath(), path.join(directory, "notes.txt"));
});

test("unsafe download names stay inside the folder; existing native destinations remain intact", t => {
  const f = fixture(t);
  for (const filename of ["../escape.txt", "..\\escape.txt", "CON.txt", "a:b.txt", "..", ""]) {
    const destination = f.download(filename).getSavePath();
    assert.equal(path.dirname(destination), f.directory);
    assert.doesNotMatch(path.basename(destination), /[<>:"/\\|?*]/);
  }
  const explicit = path.join(f.root, "explicit.txt");
  assert.equal(f.download("notes.txt", explicit).getSavePath(), explicit);
});

test("unavailable folders fall back to the native picker; failed preference writes keep the last state", t => {
  const f = fixture(t);
  fs.rmdirSync(f.directory);
  fs.writeFileSync(f.directory, "not a folder");
  assert.equal(f.download("notes.txt").getSavePath(), "");
  assert.throws(() => f.settings.setDirectory(f.directory));
  fs.mkdirSync(path.join(f.root, DOWNLOAD_SETTINGS_FILE));
  assert.throws(() => f.settings.setAskWhereToSave(true));
  assert.equal(f.settings.read().askWhereToSave, false);
});

test("IPC accepts only a trusted boolean or native folder selection; cancellation keeps settings", async t => {
  const f = fixture(t);
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  let trusted = false, selections = 0;
  registerDownloadSettingsHandlers({ handle: (channel, handler) => { handlers.set(channel, handler); } }, {
    settings: f.settings, trusted: () => trusted,
    chooseDirectory: async () => { selections++; return null; },
  });
  const event = {} as IpcMainInvokeEvent;
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args);
  assert.throws(() => call(IPC_CHANNELS.getDownloadSettings));
  assert.equal((await call(IPC_CHANNELS.chooseDownloadDirectory) as { ok: boolean }).ok, false);
  assert.equal(selections, 0);
  trusted = true;
  for (const invalid of ["false", {}, { directory: "C:/arbitrary" }, null]) {
    assert.equal((call(IPC_CHANNELS.setDownloadPrompt, invalid) as { ok: boolean }).ok, false);
  }
  assert.deepEqual(call(IPC_CHANNELS.setDownloadPrompt, true), { ok: true, settings: { directory: f.directory, askWhereToSave: true } });
  assert.deepEqual(await call(IPC_CHANNELS.chooseDownloadDirectory), { ok: true, settings: f.settings.read() });
  assert.equal(selections, 1);
});

test("preload sends preferences without accepting arbitrary destination paths", async () => {
  const calls: unknown[][] = [];
  const api = createDesktopApi({ on: () => {}, invoke: async (channel, ...args) => { calls.push([channel, ...args]); } });
  await api.getDownloadSettings();
  await api.setDownloadPrompt(false);
  await api.chooseDownloadDirectory();
  assert.deepEqual(calls, [[IPC_CHANNELS.getDownloadSettings], [IPC_CHANNELS.setDownloadPrompt, false], [IPC_CHANNELS.chooseDownloadDirectory]]);
});
