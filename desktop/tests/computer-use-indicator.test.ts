import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  COMPUTER_USE_STATE_MAX_AGE_MS,
  freshComputerUseAppearance,
  isComputerUseStateFilename,
  isFreshComputerUseState,
} from "../src/main/computer-use-state";

const desktopRoot = path.resolve(__dirname, "..", "..");
const overlayRoot = path.join(desktopRoot, "src", "computer-use-overlay");

test("computer-use heartbeat accepts only a fresh active signal", () => {
  const now = 10_000;
  assert.equal(
    isFreshComputerUseState(JSON.stringify({ version: 1, active: true, updatedAt: now }), now),
    true,
  );
  assert.equal(
    isFreshComputerUseState(
      JSON.stringify({ version: 1, active: true, updatedAt: now - COMPUTER_USE_STATE_MAX_AGE_MS - 1 }),
      now,
    ),
    false,
  );
  assert.equal(
    isFreshComputerUseState(JSON.stringify({ version: 1, active: false, updatedAt: now }), now),
    false,
  );
  assert.equal(isFreshComputerUseState("not-json", now), false);
  assert.equal(
    freshComputerUseAppearance(
      JSON.stringify({ version: 1, active: true, updatedAt: now, appearance: "red" }),
      now,
    ),
    "red",
  );
  assert.equal(
    freshComputerUseAppearance(
      JSON.stringify({ version: 1, active: true, updatedAt: now, appearance: "purple" }),
      now,
    ),
    null,
  );
  assert.equal(isComputerUseStateFilename("computer-use-state.ui-tars.json"), true);
  assert.equal(isComputerUseStateFilename("computer-use-state.teach.json"), true);
  assert.equal(isComputerUseStateFilename("computer-use-state.json"), true);
  assert.equal(isComputerUseStateFilename("computer-use-state.../secret.json"), false);
});

test("computer-use overlay identifies Bread, Escape, green corners, and the cursor", () => {
  const html = fs.readFileSync(path.join(overlayRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(overlayRoot, "overlay.css"), "utf8");
  const script = fs.readFileSync(path.join(overlayRoot, "overlay.js"), "utf8");
  const copyStatic = fs.readFileSync(path.join(desktopRoot, "scripts", "copy-static.mjs"), "utf8");

  assert.match(html, /<strong>Bread<\/strong>/);
  assert.match(html, /is using your computer/);
  assert.match(html, /<kbd>esc<\/kbd>/);
  assert.match(html, /to cancel/);
  assert.match(css, /--signal:\s*#34d17a/);
  assert.match(css, /data-appearance="red"/);
  assert.match(css, /--signal:\s*#ff485c/);
  assert.equal((css.match(/radial-gradient\(ellipse 310px 240px/g) ?? []).length, 4);
  assert.match(css, /data-surface="cursor"/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /dataset\.appearance/);
  assert.match(copyStatic, /computer-use-overlay/);
  assert.match(copyStatic, /"overlay\.css"/);
});

test("the Electron indicator is click-through, always on top, capture excluded, and globally cancellable", () => {
  const source = fs.readFileSync(
    path.join(desktopRoot, "src", "main", "computer-use-indicator.ts"),
    "utf8",
  );
  assert.match(source, /setIgnoreMouseEvents\(true/);
  assert.match(source, /setAlwaysOnTop\(true, "screen-saver"\)/);
  assert.match(source, /setContentProtection\(true\)/);
  assert.match(source, /globalShortcut\.register\("Escape"/);
  assert.match(source, /screen\.getCursorScreenPoint\(\)/);
});

test(
  "a real Electron shell shows every edge, a cursor halo, and switches from green to red",
  { skip: process.platform !== "win32" },
  () => {
    const electron = path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe");
    const indicatorModule = path.join(desktopRoot, "dist", "main", "computer-use-indicator.js");
    const securityModule = path.join(desktopRoot, "dist", "main", "security.js");
    const overlayHtml = path.join(desktopRoot, "dist", "computer-use-overlay", "index.html");
    for (const required of [electron, indicatorModule, securityModule, overlayHtml]) {
      assert.ok(fs.existsSync(required), `missing integration-test input: ${required}`);
    }

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "bb-computer-use-indicator-"));
    const resultFile = path.join(fixture, "result.json");
    fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ main: "main.cjs" }));
    fs.writeFileSync(
      path.join(fixture, "main.cjs"),
      `const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, globalShortcut, screen } = require("electron");
const { ComputerUseIndicator } = require(${JSON.stringify(indicatorModule)});
const { allowedOriginsFor, installGlobalSecurity } = require(${JSON.stringify(securityModule)});
const fixture = ${JSON.stringify(fixture)};
const resultFile = ${JSON.stringify(resultFile)};
const overlayHtml = ${JSON.stringify(overlayHtml)};
const statePath = path.join(fixture, "computer-use-state.ui-tars.json");
const waitFor = async (predicate, label) => {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > 8_000) throw new Error("timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const allowed = allowedOriginsFor([pathToFileURL(overlayHtml).toString()]);
  installGlobalSecurity(allowed);
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, active: true, updatedAt: Date.now(), appearance: "green" }));
  const indicator = new ComputerUseIndicator({ dataDir: fixture, overlayHtmlPath: overlayHtml, allowed });
  indicator.start();
  const expectedWindowCount = screen.getAllDisplays().length + 1;
  await waitFor(
    () => BrowserWindow.getAllWindows().length === expectedWindowCount &&
      BrowserWindow.getAllWindows().every((window) => !window.webContents.isLoading()),
    "overlay windows",
  );
  const windows = BrowserWindow.getAllWindows();
  const surfaces = await Promise.all(windows.map(async (window) => ({
    surface: await window.webContents.executeJavaScript("document.documentElement.dataset.surface"),
    banner: await window.webContents.executeJavaScript("document.documentElement.dataset.banner"),
    appearance: await window.webContents.executeJavaScript("document.documentElement.dataset.appearance"),
    text: await window.webContents.executeJavaScript("document.body.textContent"),
    alwaysOnTop: window.isAlwaysOnTop(),
    focusable: window.isFocusable(),
  })));
  const escapeRegisteredWhileActive = globalShortcut.isRegistered("Escape");
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, active: true, updatedAt: Date.now(), appearance: "red" }));
  await waitFor(async () => {
    const switched = BrowserWindow.getAllWindows();
    if (switched.length !== expectedWindowCount || switched.some((window) => window.webContents.isLoading())) return false;
    const appearances = await Promise.all(switched.map((window) =>
      window.webContents.executeJavaScript("document.documentElement.dataset.appearance")
    ));
    return appearances.every((appearance) => appearance === "red");
  }, "red overlay switch");
  const redAfterSwitch = true;
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, active: false, updatedAt: Date.now() }));
  await waitFor(() => BrowserWindow.getAllWindows().length === 0, "overlay dismissal");
  const result = {
    expectedEdges: screen.getAllDisplays().length,
    edges: surfaces.filter((surface) => surface.surface === "edge").length,
    cursors: surfaces.filter((surface) => surface.surface === "cursor").length,
    green: surfaces.every((surface) => surface.appearance === "green"),
    redAfterSwitch,
    primaryBanner: surfaces.some((surface) => surface.surface === "edge" && surface.banner === "true" && surface.text.includes("Bread") && surface.text.includes("esc") && surface.text.includes("to cancel")),
    alwaysOnTop: surfaces.every((surface) => surface.alwaysOnTop),
    focusable: surfaces.some((surface) => surface.focusable),
    escapeRegisteredWhileActive,
    escapeRegisteredAfterDismiss: globalShortcut.isRegistered("Escape"),
  };
  indicator.stop();
  fs.writeFileSync(resultFile, JSON.stringify(result));
  app.quit();
}).catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error) }));
  app.exit(1);
});`,
    );

    const electronEnv: NodeJS.ProcessEnv = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
    delete electronEnv["ELECTRON_RUN_AS_NODE"];
    const run = spawnSync(electron, [fixture], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 15_000,
      env: electronEnv,
    });
    try {
      assert.equal(run.error, undefined, run.error?.message);
      assert.equal(run.status, 0, `electron stderr: ${run.stderr}`);
      const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
        error?: string;
        expectedEdges: number;
        edges: number;
        cursors: number;
        green: boolean;
        redAfterSwitch: boolean;
        primaryBanner: boolean;
        alwaysOnTop: boolean;
        focusable: boolean;
        escapeRegisteredWhileActive: boolean;
        escapeRegisteredAfterDismiss: boolean;
      };
      assert.equal(result.error, undefined, result.error);
      assert.equal(result.edges, result.expectedEdges);
      assert.equal(result.cursors, 1);
      assert.equal(result.green, true);
      assert.equal(result.redAfterSwitch, true);
      assert.equal(result.primaryBanner, true);
      assert.equal(result.alwaysOnTop, true);
      assert.equal(result.focusable, false);
      assert.equal(result.escapeRegisteredWhileActive, true);
      assert.equal(result.escapeRegisteredAfterDismiss, false);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  },
);
