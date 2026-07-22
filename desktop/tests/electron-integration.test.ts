import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test(
  "real Electron window loads the sandboxed preload bridge",
  { skip: process.platform !== "win32" },
  () => {
    const desktopRoot = path.resolve(__dirname, "..", "..");
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const windowManager = path.join(desktopRoot, "dist", "main", "window-manager.js");
    const ipcContract = path.join(desktopRoot, "dist", "shared", "ipc-contract.js");
    const preload = path.join(desktopRoot, "dist", "preload", "preload.js");
    for (const required of [electron, windowManager, ipcContract, preload]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-electron-integration-"));
    const resultFile = path.join(fixture, "result.json");
    const htmlFile = path.join(fixture, "index.html");
    fs.writeFileSync(htmlFile, "<!doctype html><html><body>bridge fixture</body></html>");
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const { app, ipcMain } = require("electron");
const { WindowManager } = require(${JSON.stringify(windowManager)});
const { IPC_CHANNELS } = require(${JSON.stringify(ipcContract)});
const resultFile = ${JSON.stringify(resultFile)};
app.whenReady().then(async () => {
  ipcMain.handle(IPC_CHANNELS.getVersions, () => ({ app: "0.1.0", electron: process.versions.electron }));
  ipcMain.handle(IPC_CHANNELS.getStartupState, () => ({ phase: "preparing", message: "Preparing", services: [] }));
  const manager = new WindowManager({
    allowed: { origins: new Set() },
    startupHtmlPath: ${JSON.stringify(htmlFile)},
    preloadPath: ${JSON.stringify(preload)},
  });
  await manager.showStartupScreen();
  const window = manager.window;
  const sameWindow = manager.createMainWindow() === window;
  const keys = await window.webContents.executeJavaScript("Object.keys(window.breadboardDesktop).sort()");
  const versions = await window.webContents.executeJavaScript("window.breadboardDesktop.getVersions()");
  await window.webContents.executeJavaScript(
    "window.__breadboardStatePromise = new Promise((resolve) => { const off = window.breadboardDesktop.onStartupState((state) => { off(); resolve(state); }); }); true",
  );
  manager.sendToRenderer(IPC_CHANNELS.startupState, { phase: "ready", message: "Ready", services: [] });
  const state = await window.webContents.executeJavaScript("window.__breadboardStatePromise");
  fs.writeFileSync(resultFile, JSON.stringify({
    keys,
    versions,
    state,
    sameWindow,
    preferences: window.webContents.getLastWebPreferences(),
  }));
  window.destroy();
  app.quit();
}).catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  app.exit(1);
});`,
    );

    const electronEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    };
    delete electronEnv["ELECTRON_RUN_AS_NODE"];
    const run = spawnSync(electron, [fixture], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 30_000,
      env: electronEnv,
    });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `electron stderr: ${run.stderr}`);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
      error?: string;
      keys: string[];
      versions: { app: string; electron: string };
      state: { phase: string; message: string };
      sameWindow: boolean;
      preferences: Record<string, unknown>;
    };
    assert.equal(result.error, undefined, result.error);
    assert.deepEqual(result.keys, [
      "copyDiagnostics",
      "getStartupState",
      "getVersions",
      "onStartupState",
      "openLogsFolder",
      "pickFolder",
      "quit",
      "retryService",
    ]);
    assert.equal(result.versions.app, "0.1.0");
    assert.equal(result.state.phase, "ready");
    assert.equal(result.sameWindow, true);
    assert.equal(result.preferences["contextIsolation"], true);
    assert.equal(result.preferences["nodeIntegration"], false);
    assert.equal(result.preferences["sandbox"], true);
  },
);
