const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { isBrowserPdfHandoff } = require("../../dist/main/browser-web-pdf.js");

const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
const until = async (probe, message) => {
  for (const end = Date.now() + 10000; Date.now() < end;) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
};

app.whenReady().then(async () => {
  const pdf = Buffer.from("%PDF-1.4\n% single-use authenticated response\n%%EOF");
  let gets = 0, uploads = 0, slow;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/paper" || req.url === "/slow") {
      assert.match(req.headers.cookie, /site=reader/);
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Article.pdf"' });
      if (req.url === "/slow") { res.write(pdf.subarray(0, 5)); slow = res; return; }
      gets++;
      res.end(pdf);
    } else if (req.url === "/download") {
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="download.pdf"' });
      res.end(pdf);
    } else if (req.url === "/api/chat-attachments/documents") {
      assert.equal(req.headers["x-document-filename"], "Article.pdf");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), pdf);
      uploads++;
      res.end(JSON.stringify({ blobId: "doc_fixture" + uploads }));
    } else {
      res.setHeader("Content-Type", "text/html");
      if (req.url === "/article") res.setHeader("Set-Cookie", "site=reader; Path=/");
      res.end('<!doctype html><title>Article</title><a href="/paper">Read PDF</a>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const preload = path.resolve(__dirname, "../../dist/preload/preload.js");
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html>");
  const manager = new TabManager({ allowed: { origins: new Set([origin]) }, preloadPath: preload,
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene, theme: () => "light", openWindow() {}, log: console.log });
  manager.setBrowserUrl(origin + "/browser");
  const window = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true } });
  manager.attach(window);
  await window.loadURL(origin + "/dashboard");
  await manager.restoreSession(window, origin, () => { throw new Error("unexpected window"); });
  const command = value => {
    const host = manager.hosts.get(window.id);
    return manager.handleCommand(host.tabs.find(tab => tab.id === host.activeId).contents, value);
  };
  const active = () => { const state = manager.stateFor(window.webContents); return state.tabs.find(tab => tab.id === state.activeId); };
  await command({ type: "browser", url: origin + "/article" });
  const page = await until(() => webContents.getAllWebContents().find(wc => wc.getURL() === origin + "/article" && !wc.isLoading()), "article");
  let savedDownload = false;
  page.session.on("will-download", (_event, item) => {
    if (item.getURL() === origin + "/download") {
      assert.equal(isBrowserPdfHandoff(item), false);
      item.setSavePath(path.join(dir, "download.pdf"));
      item.once("done", (_event, state) => { savedDownload = state === "completed"; });
      return;
    }
    assert.ok(isBrowserPdfHandoff(item), "the PDF is private to the reader");
    assert.ok(item.getSavePath(), "the browser must never display a save dialog for an inline PDF");
  });
  await page.executeJavaScript("document.querySelector('a').click()", true);
  await until(() => active()?.browser?.pdfViewer, "PDF handoff");
  assert.equal(active().url, origin + "/paper");
  assert.equal(active().title, "Article.pdf");
  assert.equal(active().browser.canGoBack, true);
  assert.equal(gets, 1);
  assert.equal(uploads, 1);
  await command({ type: "reload" });
  await until(() => active()?.browser?.pdfViewer?.includes("doc_fixture2"), "reload the PDF");
  assert.equal(gets, 2);
  await command({ type: "back" });
  await until(() => !active()?.browser?.pdfViewer && active()?.url === origin + "/article", "Back to article");
  assert.equal(page.getURL(), origin + "/article");
  await page.executeJavaScript("location.href='/download'");
  await until(() => savedDownload, "ordinary attachment download");
  for (const type of ["browser-stop", "back"]) {
    slow = undefined;
    await page.executeJavaScript("location.href='/slow'");
    await until(() => slow && manager.hosts.get(window.id).tabs.find(tab => tab.id === active().id).browser.pdfTransfer, "pending transfer");
    assert.equal(await command({ type }), true);
    slow.end(pdf.subarray(5));
    await until(() => active()?.url === origin + "/article" && !active()?.loading, type + " restores article");
  }
  slow = undefined;
  await page.executeJavaScript("location.href='/slow'");
  await until(() => slow && active()?.loading, "slow PDF");
  assert.equal(await command({ type: "browser-navigate", input: origin + "/elsewhere" }), true);
  slow.end(pdf.subarray(5));
  await until(() => page.getURL() === origin + "/elsewhere" && !active()?.loading, "superseding page");
  assert.equal(active().browser.pdfViewer, undefined);
  assert.equal(uploads, 2, "cancelled transfers never publish a PDF");
  window.destroy();
  server.closeAllConnections();
  server.close();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
