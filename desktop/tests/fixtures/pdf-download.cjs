const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain } = require("electron");
const { registerPdfDownloadHandler } = require("../../dist/main/pdf-download.js");
const { BrowserDownloads } = require("../../dist/main/browser-downloads.js");
const dir = process.argv[2];
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const downloadDir = path.join(dir, "Downloads");
  fs.mkdirSync(downloadDir);
  app.setPath("downloads", downloadDir);
  const pdf = Buffer.from("%PDF-1.7\nfolder export fixture\n%%EOF\n");
  const dashboard = path.resolve(__dirname, "../../../dashboard");
  const bundle = createRequire(path.join(dashboard, "package.json"))("esbuild").buildSync({
    stdin: { contents: `import { exportFolderPdf } from './src/lib/folder-pdf-export-client'; window.runExport = () => exportFolderPdf({ requestId: 'folder-test', cluster: 'demo', folderTitle: 'Notes', documents: [{ slug: 'demo/second', title: 'Second' }, { slug: 'demo/first', title: 'First' }] });`, resolveDir: dashboard },
    bundle: true, write: false, format: "iife", platform: "browser",
  }).outputFiles[0].text;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/documents/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, content: "# Selected note" }));
    } else if (req.url === "/api/markdown-to-pdf") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        assert.deepEqual(JSON.parse(body).documents.map(doc => doc.title), ["Second", "First"]);
        res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="notes.pdf"' });
        res.end(pdf);
      });
    } else if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript"); res.end(bundle);
    } else {
      res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><script src="/app.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, "../../dist/preload/preload.js"), contextIsolation: true, sandbox: true,
  } });
  const shown = [];
  const actions = { openPath: async () => "", showItemInFolder: file => shown.push(file) };
  const downloads = new BrowserDownloads(dir, actions);
  let destination = app.getPath("downloads");
  registerPdfDownloadHandler(ipcMain, {
    ownsSender: sender => sender === win.webContents, dashboardUrl: () => origin,
    downloadsDirectory: () => destination,
    onSaved: (file, url) => downloads.recordSavedPdf(file, url), log: console.error,
  });
  await win.loadURL(origin);
  for (const filename of ["notes.pdf", "notes (1).pdf"]) {
    const result = await win.webContents.executeJavaScript("window.runExport()");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.message, `Saved: ${filename}`);
    assert.deepEqual(fs.readFileSync(path.join(downloadDir, filename)), pdf);
  }
  const restored = new BrowserDownloads(dir, actions);
  assert.equal(restored.snapshot().items.length, 2);
  await restored.command({ type: "show", id: restored.snapshot().items[0].id });
  assert.deepEqual(shown, [path.join(downloadDir, "notes (1).pdf")]);

  // The same user-facing flow must report disk failures instead of success.
  destination = path.join(dir, "blocked");
  fs.writeFileSync(destination, "not a directory");
  const failed = await win.webContents.executeJavaScript("window.runExport()");
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Could not save.*download folder/);
  assert.equal(downloads.snapshot().items.length, 2);
  console.log("Verified sandbox bridge, saved bytes, duplicate names, persistent history, reveal, and failure reporting.");
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
