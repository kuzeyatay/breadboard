const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { TabManager } = require("../../dist/main/tab-manager.js");
const { BrowserVisitedLinks } = require("../../dist/main/browser-visited-links.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});

const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const partition = session.fromPartition("loading-listeners");
  let releaseImage;
  partition.protocol.handle("https", request => {
    if (new URL(request.url).pathname === "/held-image") {
      return new Promise(resolve => { releaseImage = () => resolve(new Response(null, { status: 204 })); });
    }
    return new Response('<!doctype html><body><main id="search"><a href="https://example.org/article"><h3>Article</h3></a></main><img src="/held-image"></body>', {
      headers: { "Content-Type": "text/html" },
    });
  });
  const manager = new TabManager({
    allowed: { origins: new Set(), localFiles: new Set() },
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => "", recoveryHtmlPath: () => "",
    theme: () => "light", openWindow: () => {},
  });
  const tracker = new BrowserVisitedLinks();
  const window = new BrowserWindow({ show: false, webPreferences: { session: partition, sandbox: true, contextIsolation: true } });
  const contents = window.webContents;
  tracker.attach(contents);
  tracker.attach(contents);
  // Exercise the same hooks the browser tab installs, without backend services.
  const refreshStore = () => manager.refreshBrowserStoreInstallButton({ contents });
  contents.on("did-navigate-in-page", refreshStore);
  const domReady = new Promise(resolve => contents.once("dom-ready", resolve));
  const loaded = contents.loadURL("https://www.google.com/search?q=slow");
  await domReady;
  await until(() => releaseImage, "held subresource");
  assert.equal(contents.isLoadingMainFrame(), true);
  const baseline = contents.listenerCount("did-stop-loading");
  // A SPA changes its route repeatedly before its slow subresource finishes.
  // Execute on the ready frame so the test itself does not queue load listeners.
  await contents.mainFrame.executeJavaScript(`for (let i = 0; i < 40; i++) history.pushState({}, '', '/search?q=slow&step=' + i)`);
  for (let i = 0; i < 40; i++) tracker.remember(contents.getURL(), `https://example.org/article?visit=${i}`);
  tracker.remember(contents.getURL(), "https://example.org/article");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(contents.listenerCount("did-stop-loading") <= baseline + 1,
    `loading listeners grew from ${baseline} to ${contents.listenerCount("did-stop-loading")}`);
  releaseImage();
  await loaded;
  await until(() => contents.executeJavaScript("document.querySelector('a').hasAttribute('data-breadboard-visited')"), "visited styling after load");
  assert.equal(contents.listenerCount("did-stop-loading"), baseline - 1, "only the tracker remains after loadURL settles");
  console.log(`Loading listener regression: ${baseline} during the stalled load; ${contents.listenerCount("did-stop-loading")} after completion.`);
  window.destroy();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
