import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

test("Windows companion runs its real UI and sandboxed bridge", { skip: process.platform !== "win32" }, () => {
  const desktopRoot = path.resolve(__dirname, "..", "..");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-clicky-ui-"));
  try {
    const esbuild = require(path.join(desktopRoot, "..", "dashboard", "node_modules", "esbuild"));
    const entry = path.join(fixtureRoot, "entry.tsx");
    fs.writeFileSync(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from ${JSON.stringify(path.join(desktopRoot, "..", "dashboard", "src", "app", "clicky", "page.tsx"))};
createRoot(document.getElementById('root')).render(<Page />);`);
    esbuild.buildSync({
      entryPoints: [entry], bundle: true, outfile: path.join(fixtureRoot, "ui.js"),
      jsx: "automatic", nodePaths: [path.join(desktopRoot, "..", "dashboard", "node_modules")],
      tsconfig: path.join(desktopRoot, "..", "dashboard", "tsconfig.json"),
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const resultPath = path.join(fixtureRoot, "result.json");
    const previewPath = path.join(desktopRoot, "..", ".tmp", "clicky-windows-preview.png");
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    const configPath = path.join(fixtureRoot, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ desktopRoot, fixtureRoot, resultPath, previewPath }));
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe"), [
      path.join(desktopRoot, "tests", "fixtures", "clicky-companion.cjs"), configPath,
    ], { encoding: "utf8", timeout: 60_000, windowsHide: true, env: environment });
    const receipt = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : result.stderr;
    assert.equal(result.status, 0, receipt);
    assert.equal(JSON.parse(receipt).ok, true, receipt);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
