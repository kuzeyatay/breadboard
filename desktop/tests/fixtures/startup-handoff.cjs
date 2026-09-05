const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { WindowManager } = require("../../dist/main/window-manager.js");

const dir = process.argv[2];
app.setPath("userData", path.join(dir, "profile"));
app.on("window-all-closed", () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const frames = new Map();
  ipcMain.on("fixture:frame", (event, size) => frames.set(event.sender.id, size));
  const preloadPath = path.join(dir, "preload.cjs");
  fs.writeFileSync(preloadPath, `
    const { ipcRenderer } = require("electron");
    const frame = () => {
      ipcRenderer.send("fixture:frame", [innerWidth, innerHeight]);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  `);
  const pagePath = path.join(dir, "page.html");
  fs.writeFileSync(pagePath, '<!doctype html><html><body style="margin:0;background:#e5c979;min-height:100vh">Workspace</body></html>');
  const pageUrl = pathToFileURL(pagePath).toString();
  const otherDisplay = screen.getAllDisplays().find(display => display.id !== screen.getPrimaryDisplay().id);
  const modes = ["resize", "maximize", "fullscreen", "premaximized",
    ...(otherDisplay ? ["move-maximize", "move-fullscreen"] : [])];
  for (const mode of modes) {
    const manager = new WindowManager({
      startupHtmlPath: pagePath, preloadPath, minimumStartupVisibleMs: 0,
      allowed: { origins: new Set(), localFiles: new Set([pageUrl]) },
    });
    await manager.showStartupScreen();
    const startup = manager.window;
    startup.setBounds({ x: 80, y: 80, width: 1000, height: 680 });
    if (mode === "premaximized") startup.maximize();
    await sleep(300);
    const showing = manager.showDashboard(pageUrl);
    await manager.waitForDashboardPaint();
    const dashboard = BrowserWindow.getAllWindows().find(window => window !== startup);
    assert.ok(dashboard);
    const revealed = [];
    let expectedBounds;
    let expectedSize;
    const visibleResizes = [];
    dashboard.on("resize", () => {
      if (dashboard.getOpacity() === 1) visibleResizes.push(dashboard.getContentSize());
    });
    const opacity = dashboard.setOpacity.bind(dashboard);
    dashboard.setOpacity = value => {
      if (value === 1) {
        expectedBounds = startup.getBounds();
        expectedSize = startup.getContentSize();
        revealed.push({
          native: dashboard.getContentSize(),
          painted: frames.get(dashboard.webContents.id),
        });
      }
      opacity(value);
    };
    if (mode.startsWith("move-")) {
      startup.setBounds({ x: otherDisplay.bounds.x + 80, y: otherDisplay.bounds.y + 80, width: 1000, height: 680 });
    }
    if (mode === "resize") startup.setBounds({ x: 110, y: 90, width: 1200, height: 800 });
    if (mode.endsWith("maximize")) startup.maximize();
    if (mode.endsWith("fullscreen")) startup.setFullScreen(true);
    manager.markStartupContinued();
    await showing;
    await sleep(300);
    assert.equal(revealed.length, 1, mode);
    assert.deepEqual(revealed[0].painted, revealed[0].native, mode + ": the first visible frame must already fill the window");
    assert.deepEqual(visibleResizes, [], mode + ": geometry must settle before the window becomes visible");
    // Windows rounds physical pixels to DIPs at fractional display scales.
    for (const [index, size] of expectedSize.entries()) {
      assert.ok(Math.abs(revealed[0].native[index] - size) <= 1, mode + ": native size at reveal");
    }
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(dashboard.getBounds()[key] - expectedBounds[key]) <= 1, mode + ": final " + key);
    }
    dashboard.destroy();
  }
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
