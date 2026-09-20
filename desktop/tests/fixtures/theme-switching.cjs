const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, webContents } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");
const dir = process.argv.at(-1);
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
};

app.whenReady().then(async () => {
  let releaseSlow;
  const server = http.createServer((req, res) => {
    const respond = () => {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>Theme fixture</title><body><input value="unsaved work"></body>');
    };
    if (req.url === "/slow") releaseSlow = respond;
    else respond();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scenePath = path.join(dir, "loading.html");
  fs.writeFileSync(scenePath, '<!doctype html><html data-theme="light"><body>Loading</body></html>');
  const sceneUrl = pathToFileURL(scenePath).toString();
  const manager = new WindowManager({
    startupHtmlPath: scenePath, loadingHtmlPath: scenePath, recoveryHtmlPath: scenePath,
    preloadPath: path.resolve(__dirname, "../../dist/preload/preload.js"),
    allowed: { origins: new Set([origin]), localFiles: new Set([sceneUrl]) },
    minimumStartupVisibleMs: 0,
  });
  await manager.showDashboard(origin + "/dashboard");
  const main = manager.window;
  main.setBounds({ x: -12000, y: -12000, width: 900, height: 700 });
  const crashes = [];
  app.on("render-process-gone", (_event, contents, details) => crashes.push({ id: contents.id, ...details }));
  await main.webContents.executeJavaScript('window.documentMarker = "workspace"');
  assert.equal(manager.tabs.handleCommand(main.webContents, { type: "open", url: origin + "/slow" }), true);
  // Change the choice while the scene's first document is still being loaded.
  manager.rememberTheme("dark");
  manager.rememberTheme("light");
  manager.rememberTheme("dark");
  const scene = await until(() => webContents.getAllWebContents().find(contents => contents.getURL().startsWith(sceneUrl) && !contents.isLoading()), "loading scene");
  await until(() => scene.executeJavaScript('document.documentElement.dataset.theme === "dark"'), "latest in-flight theme");
  await scene.executeJavaScript('window.documentMarker = "loading"');
  const navigations = [];
  scene.on("did-start-navigation", (_event, url, inPlace) => { if (!inPlace) navigations.push(url); });
  for (const theme of ["light", "dark", "light", "light", "dark"]) {
    manager.rememberTheme(theme);
    await until(() => scene.executeJavaScript(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`), theme);
    assert.equal(await scene.executeJavaScript("window.documentMarker"), "loading", "changing theme must preserve the loading renderer");
    assert.equal(await main.webContents.executeJavaScript("window.documentMarker"), "workspace");
    assert.equal(await main.webContents.executeJavaScript("document.querySelector('input').value"), "unsaved work");
  }
  assert.deepEqual(navigations, []);
  assert.deepEqual(crashes, []);
  await until(() => releaseSlow, "slow page request");
  releaseSlow();
  await until(() => webContents.getAllWebContents().some(contents => contents.getURL() === origin + "/slow" && !contents.isLoading()), "workspace finishes loading");
  server.closeAllConnections();
  server.close();
  fs.writeFileSync(path.join(dir, "passed.json"), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error); app.exit(1); });
