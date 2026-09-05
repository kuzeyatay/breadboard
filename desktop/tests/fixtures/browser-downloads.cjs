const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { BrowserDownloads } = require("../../dist/main/browser-downloads.js");
const { IPC_CHANNELS, isBrowserDownloadCommand } = require("../../dist/shared/ipc-contract.js");
const [dir, phase] = process.argv.slice(2);
app.setPath("userData", path.join(dir, `profile-${phase}`));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const opened = [], shown = [];
  const downloads = new BrowserDownloads(dir, {
    openPath: async file => { opened.push(file); return ""; },
    showItemInFolder: file => shown.push(file),
  });
  const browserSession = session.fromPartition("persist:breadboard-browser");
  // Only the fixture supplies a save path, avoiding a native dialog in CI.
  browserSession.on("will-download", (_event, item) => item.setSavePath(path.join(dir, item.getFilename())));
  downloads.attach(browserSession);
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => downloads.snapshot());
  ipcMain.handle(IPC_CHANNELS.browserDownloadCommand, (_event, command) => {
    assert.equal(isBrowserDownloadCommand(command), true);
    return downloads.command(command);
  });

  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const dashboardRequire = createRequire(path.join(dashboard, "package.json"));
  const bundle = dashboardRequire("esbuild").buildSync({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import BrowserDownloadsPanel from './src/app/browser/browser-downloads';
        createRoot(document.getElementById('root')).render(<BrowserDownloadsPanel active={true} closeButton={<button aria-label="Close downloads">×</button>} />);
      `,
      resolveDir: dashboard, loader: "tsx",
    },
    bundle: true, write: false, outdir: "out", format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles;
  const globalCss = fs.readFileSync(path.join(dashboard, "src/app/globals.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (["/complete", "/cancel", "/slow"].includes(req.url)) {
      const filename = req.url === "/complete" ? "Breadboard guide.txt" : req.url === "/cancel" ? "Cancelled notes.zip" : "Large reference library.zip";
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      if (req.url === "/complete") {
        res.end("Breadboard download test\n");
      } else {
        res.setHeader("Content-Length", 100_000_000);
        res.write(Buffer.alloc(4096));
        const timer = setInterval(() => res.write(Buffer.alloc(4096)), 40);
        res.on("close", () => clearInterval(timer));
      }
      return;
    }
    if (req.url === "/app.js" || req.url === "/app.css" || req.url === "/global.css") {
      const css = req.url.endsWith(".css");
      res.setHeader("Content-Type", css ? "text/css" : "text/javascript");
      res.end(req.url === "/global.css" ? globalCss : bundle.find(file => file.path.endsWith(css ? ".css" : ".js")).text);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>
      :root { --font-schibsted: Arial; --font-source-sans: Arial; --ink-heading: #27372c; --ink-muted: #68766a; --botanical: #537958; --paper-surface: #fafbf8; --paper-raised: white; --botanical-3: #dae7d8; --line-strong: #c3d2c1; }
      body { margin: 0; background: var(--paper-surface); font-family: Arial; }
      button { border: 0; background: transparent; } input { outline: none; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = new BrowserWindow({ show: false, webPreferences: { partition: "persist:breadboard-browser", sandbox: true, nodeIntegration: false } });
  if (phase === "save") {
    page.webContents.downloadURL(origin + "/complete");
    await until(() => downloads.snapshot().items.some(item => item.state === "completed"), "download completes");
    page.webContents.downloadURL(origin + "/cancel");
    await until(() => downloads.snapshot().items.some(item => item.filename === "Cancelled notes.zip" && item.active), "cancel download starts");
    const cancelId = downloads.snapshot().items.find(item => item.filename === "Cancelled notes.zip").id;
    await downloads.command({ type: "cancel", id: cancelId });
    await until(() => downloads.snapshot().items.some(item => item.state === "cancelled"), "download cancelled");
    page.webContents.downloadURL(origin + "/slow");
    await until(() => downloads.snapshot().items.some(item => item.active && item.receivedBytes > 0), "progress recorded");
  }

  const panel = new BrowserWindow({ show: false, width: 480, height: 700, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"), contextIsolation: true, sandbox: true,
  } });
  await panel.loadURL(origin);
  const text = () => panel.webContents.executeJavaScript("document.body.innerText");
  await until(async () => !(await text()).includes("Loading downloads"), "panel loads");
  if (phase === "save") {
    await until(async () => (await text()).includes("Downloading") && (await text()).includes("Breadboard guide.txt"), "live panel shows downloads");
    assert.equal(await panel.webContents.executeJavaScript("document.querySelectorAll('progress').length"), 1);
    const screenshot = process.env.BREADBOARD_DOWNLOADS_TEST_SCREENSHOT;
    if (screenshot) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      fs.writeFileSync(screenshot, (await panel.webContents.capturePage()).toPNG());
    }
    downloads.prepareForQuit();
    assert.equal(fs.readFileSync(path.join(dir, "Breadboard guide.txt"), "utf8"), "Breadboard download test\n");
    // Exit during a transfer: its disk record must recover as interrupted.
    app.exit(0);
    return;
  }
  if (phase === "restore") {
    assert.equal(downloads.snapshot().items.length, 3);
    assert.equal(downloads.snapshot().items.some(item => item.active), false);
    assert.equal(downloads.snapshot().items.find(item => item.filename === "Large reference library.zip").state, "interrupted");
    await until(async () => (await text()).includes("Interrupted") && (await text()).includes("Open file"), "restored download actions visible");
    const click = async label => {
      const selector = `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
      await until(() => panel.webContents.executeJavaScript(`Boolean(${selector} && !${selector}.disabled)`), `${label} enabled`);
      await panel.webContents.executeJavaScript(`${selector}.click()`);
    };
    await click("Open file");
    await until(() => opened.length === 1, "open completed file");
    await click("Show in folder");
    await until(() => shown.length === 1, "reveal completed file");
    assert.deepEqual(shown, opened);
    await click("Clear finished");
    await until(() => downloads.snapshot().items.length === 0, "clear downloads from panel");
    assert.equal(fs.existsSync(path.join(dir, "Breadboard guide.txt")), true);
  } else {
    await until(async () => (await text()).includes("No downloads yet"), "cleared history stays cleared after restart");
    assert.deepEqual(downloads.snapshot().items, []);
  }
  downloads.flush();
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
