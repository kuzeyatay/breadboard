const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");
const { TabManager, REVEAL_MAX_WAIT_MS } = require("../../dist/main/tab-manager.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
// This invisible test window must render like the user's foreground window.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (probe, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await sleep(20);
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>${req.url}</title><body>
      <div class="desktop-title-bar"><div role="tablist">Tabs</div></div>
      <canvas width="1600" height="1000"></canvas><input id="draft" value="kept">
      <script>
        const ctx = document.querySelector('canvas').getContext('2d');
        ctx.fillStyle = '#a4cbb5'; ctx.fillRect(0, 0, 1600, 1000);
        window.holdFrames = () => {
          const raf = window.requestAnimationFrame;
          const queued = [];
          window.requestAnimationFrame = callback => queued.push(callback);
          window.releaseFrames = () => {
            window.requestAnimationFrame = raf;
            for (const callback of queued) raf(callback);
          };
        };
        if (location.search === '?hold') holdFrames();
      </script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scene = path.join(dir, "scene.html");
  fs.writeFileSync(scene, "<!doctype html><body>Loading</body>");
  const manager = new TabManager({
    allowed: { origins: new Set([origin]), localFiles: new Set([pathToFileURL(scene).href]) },
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    loadingHtmlPath: () => scene, recoveryHtmlPath: () => scene,
    theme: () => "dark", openWindow: () => assert.fail("Unexpected window"),
  });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  window.setOpacity(0);
  window.showInactive();
  manager.attach(window);
  await window.loadURL(origin + "/new-tab");
  const host = manager.hosts.get(window.id);
  manager.setMemoryPressure("critical"); // Explicitly exercise evicted surfaces; resident switches bypass probes.
  const command = value => manager.handleCommand(window.webContents, value);
  command({ type: "open", url: origin + "/gardens/telecom-1/pdf/study-guide" });
  const pdf = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => host.pending === null, "PDF canvas tab first revealed");
  command({ type: "open", url: origin + "/workspace" });
  const workspace = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => host.pending === null, "workspace revealed");
  const visibleViews = () => window.contentView.children.filter(view => view.webContents && view.getBounds().x === 0 && view.getBounds().y === 0);

  // A previously painted PDF can lose its frame while detached. A stalled
  // renderer then misses both the frame deadline and the outer reveal deadline.
  await pdf.contents.executeJavaScript("holdFrames()");
  command({ type: "activate", id: pdf.id });
  await sleep(REVEAL_MAX_WAIT_MS + 250);
  assert.equal(host.pending, pdf, "a paint timeout must not be treated as a successful frame");
  assert.ok(visibleViews().includes(workspace.view), "the previous page and its tab controls stay visible");
  assert.equal(pdf.view.getBounds().x > 0 || visibleViews().at(-1) === workspace.view, true);
  assert.equal(manager.stateFor(workspace.contents).navigationPending, true, "slow paint uses the normal progress bar");
  await pdf.contents.executeJavaScript("releaseFrames()");
  await until(() => host.pending === null, "PDF automatically appears when its frame arrives");
  assert.equal(visibleViews().at(-1), pdf.view);
  assert.equal(window.contentView.children.includes(workspace.view), false);
  assert.equal(await pdf.contents.executeJavaScript("document.querySelector('#draft').value"), "kept");
  assert.equal(pdf.contents.getBackgroundThrottling(), true, "normal throttling is restored after reveal");
  const pixels = await pdf.contents.capturePage({ x: 16, y: 60, width: 1, height: 1 }, { stayHidden: true });
  assert.deepEqual([...pixels.toBitmap().subarray(0, 3)], [181, 203, 164], "the revealed PDF canvas has painted pixels, not a blank surface");

  // Hold frames as the incoming native view moves into the viewport. A frame
  // from its parked position must not remove the page covering the dashboard.
  const setBounds = workspace.view.setBounds;
  let movedToFront = false;
  workspace.view.setBounds = function (bounds) {
    if (bounds.x === 0 && bounds.y === 0 && this.getBounds().x > 0) {
      movedToFront = true;
      void workspace.contents.mainFrame.executeJavaScript("holdFrames()");
    }
    return setBounds.call(this, bounds);
  };
  command({ type: "activate", id: workspace.id });
  await until(() => movedToFront, "workspace moved into the viewport");
  await sleep(150);
  assert.ok(window.contentView.children.includes(pdf.view), "outgoing PDF covers the dashboard until the incoming view paints in place");
  assert.equal(host.pending, workspace, "moving bounds is not a completed handoff");
  // A last-moment change of selection must cancel this final paint wait too.
  command({ type: "activate", id: pdf.id });
  workspace.view.setBounds = setBounds;
  await workspace.contents.executeJavaScript("releaseFrames()");
  await sleep(150);
  assert.equal(host.activeId, pdf.id);
  assert.equal(visibleViews().at(-1), pdf.view, "cancelled in-place frames cannot reveal the wrong page");
  assert.equal(workspace.contents.getBackgroundThrottling(), true);

  await pdf.contents.executeJavaScript("holdFrames()");
  command({ type: "activate", id: workspace.id });
  await until(() => host.pending === null, "workspace selected again");
  command({ type: "activate", id: pdf.id });
  command({ type: "activate", id: workspace.id });
  await pdf.contents.executeJavaScript("releaseFrames()");
  await sleep(150);
  assert.equal(host.activeId, workspace.id);
  assert.equal(visibleViews().at(-1), workspace.view, "a cancelled frame cannot steal the display later");
  assert.equal(pdf.contents.getBackgroundThrottling(), true, "cancellation restores normal throttling");

  // A new document supersedes a stalled probe. Its own first frame, not the
  // old document's completion/rejection, decides when the tab can come forward.
  await pdf.contents.executeJavaScript("holdFrames()");
  command({ type: "activate", id: pdf.id });
  await sleep(100);
  await pdf.contents.loadURL(origin + "/gardens/telecom-1/pdf/study-guide?hold");
  await sleep(100);
  assert.equal(host.pending, pdf);
  assert.equal(visibleViews().at(-1), workspace.view);
  await pdf.contents.executeJavaScript("releaseFrames()");
  await until(() => host.pending === null, "replacement PDF document earns its own frame");
  assert.equal(visibleViews().at(-1), pdf.view);

  manager.setBrowserUrl(origin + "/browser");
  command({ type: "browser", url: origin + "/website" });
  const browserTab = host.tabs.find(tab => tab.id === host.activeId);
  await until(() => host.pending === null && browserTab.browser.ready, "website first revealed");
  command({ type: "activate", id: workspace.id });
  await until(() => host.pending === null, "workspace before delayed website");
  await browserTab.browser.contents.executeJavaScript("holdFrames()");
  command({ type: "activate", id: browserTab.id });
  await until(() => browserTab.browser.attached, "website parked for its frame");
  manager.layout(host);
  assert.equal(host.pending, browserTab);
  assert.ok(browserTab.browser.view.getBounds().x >= window.getContentSize()[0] - 2, "resize cannot expose an unpainted website");
  assert.equal(visibleViews().at(-1), workspace.view);
  await browserTab.browser.contents.executeJavaScript("releaseFrames()");
  await until(() => host.pending === null, "website appears after its own frame");
  assert.equal(browserTab.browser.contents.getBackgroundThrottling(), true);
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
