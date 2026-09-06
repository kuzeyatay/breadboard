const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, clipboard, webContents } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const [dir] = process.argv.slice(2);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const until = async (probe, label) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const originalClipboard = {
    text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(),
    image: clipboard.readImage(), bookmark: clipboard.readBookmark().title,
  };
  const texts = {
    text: "Breadboard clipboard test: café ✓\nsecond line",
    rich: "Breadboard rich clipboard test",
    legacy: "Breadboard legacy clipboard test",
  };
  try {
    const external = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><title>Clipboard fixture</title>
        <button id="text" title="Copy to clipboard">⧉</button>
        <button id="rich" title="Copy rich text to clipboard">⧉</button>
        <button id="legacy" title="Copy using selection">⧉</button>
        <script>
          const texts = ${JSON.stringify(texts)};
          window.copyResult = null;
          for (const button of document.querySelectorAll('button')) button.onclick = async () => {
            try {
              if (button.id === 'rich') {
                await navigator.clipboard.write([new ClipboardItem({
                  'text/plain': new Blob([texts.rich], {type:'text/plain'}),
                  'text/html': new Blob(['<b>' + texts.rich + '</b>'], {type:'text/html'})
                })]);
              } else if (button.id === 'legacy') {
                const input = document.createElement('textarea');
                input.value = texts.legacy; document.body.append(input); input.select();
                const copied = document.execCommand('copy'); input.remove();
                if (!copied) throw new Error('Selection copy failed');
              } else await navigator.clipboard.writeText(texts.text);
              window.copyResult = 'Copied';
            } catch (error) { window.copyResult = error.name + ': ' + error.message; }
          };
        </script>`);
    });
    const web = await listen(external);
    const server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Browser shell fixture</title>");
    });
    const origin = await listen(server);
    const loading = path.join(dir, "loading.html");
    fs.writeFileSync(loading, "<!doctype html><body></body>");
    const preload = path.resolve(__dirname, "../../dist/preload/preload.js");
    const manager = new TabManager({
      allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(loading).href]) },
      preloadPath: preload, loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading,
      theme: () => "light", openWindow() {}, browserPreferencesConfigDir: path.join(dir, "preferences"),
    });
    manager.setBrowserUrl(origin + "/browser");
    const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
    manager.attach(window);
    await window.loadURL(origin + "/dashboard");
    window.showInactive();
    assert.equal(await manager.handleCommand(window.webContents, { type: "browser", url: web }), true);
    let page;
    await until(() => {
      page = webContents.getAllWebContents().find(contents => contents.getURL() === web + "/");
      return page && !page.isLoading();
    }, "browser document loaded");
    page.focus();
    assert.equal(await page.executeJavaScript("typeof window.breadboardDesktop"), "undefined");
    for (const id of ["text", "rich", "legacy"]) {
      console.log(`Checking ${id} copy button`);
      // Run the site's actual click handler with Chromium user activation.
      await page.executeJavaScript(`window.copyResult = null; document.getElementById('${id}').click(); true`, true);
      await until(() => page.executeJavaScript("window.copyResult !== null"), `${id} copy completed`);
      assert.equal(await page.executeJavaScript("window.copyResult"), "Copied", `${id} copy button succeeds`);
      assert.equal(clipboard.readText().replace(/\r\n/g, "\n"), texts[id], `${id} text reaches the OS clipboard`);
      if (id === "rich") assert.ok(clipboard.readHTML().includes(`<b>${texts.rich}</b>`), "rich formatting reaches the clipboard");
    }
    assert.equal(await page.executeJavaScript("navigator.permissions.query({name:'clipboard-write'}).then(value=>value.state)"), "granted");
    assert.equal(await page.executeJavaScript("navigator.permissions.query({name:'clipboard-read'}).then(value=>value.state)"), "denied");
    assert.equal(await page.executeJavaScript("navigator.clipboard.readText().then(()=> 'read', error=>error.name)", true), "NotAllowedError");

    const unregistered = new BrowserWindow({ show: false, webPreferences: { session: page.session, contextIsolation: true, sandbox: true } });
    await unregistered.loadURL(web);
    assert.equal(await unregistered.webContents.executeJavaScript("navigator.permissions.query({name:'clipboard-write'}).then(value=>value.state)"), "denied", "sharing a session does not grant clipboard access to unrelated renderers");
    console.log("Clipboard buttons and permission boundaries verified");
  } finally {
    // Keep the user's existing standard clipboard formats out of test output.
    if (Object.values(texts).includes(clipboard.readText().replace(/\r\n/g, "\n"))) clipboard.write(originalClipboard);
  }
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
