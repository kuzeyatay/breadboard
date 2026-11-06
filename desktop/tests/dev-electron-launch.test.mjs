import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BRANDED_EXECUTABLE, devElectronBinary } from "../scripts/dev-electron-binary.mjs";
import { quoteWindowsArgument } from "../scripts/launch-outside-tree.mjs";

test("arguments survive the Windows command line unchanged", () => {
  assert.equal(quoteWindowsArgument("."), ".");
  assert.equal(quoteWindowsArgument("--breadboard-dev"), "--breadboard-dev");
  assert.equal(quoteWindowsArgument("a b"), '"a b"');
  assert.equal(quoteWindowsArgument('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteWindowsArgument("C:\\dir with space\\"), '"C:\\dir with space\\\\"');
  assert.equal(quoteWindowsArgument(""), '""');
});

function fakeElectron(root) {
  const dist = path.join(root, "electron-dist");
  fs.mkdirSync(path.join(dist, "locales"), { recursive: true });
  fs.writeFileSync(path.join(dist, "electron.exe"), "exe");
  fs.writeFileSync(path.join(dist, "version"), "33.4.11");
  fs.writeFileSync(path.join(dist, "resources.pak"), "pak");
  fs.writeFileSync(path.join(dist, "locales", "en-US.pak"), "en");
  const desktopRoot = path.join(root, "desktop");
  fs.mkdirSync(path.join(desktopRoot, "assets"), { recursive: true });
  fs.writeFileSync(path.join(desktopRoot, "assets", "icon.ico"), "ico");
  return { exe: path.join(dist, "electron.exe"), desktopRoot };
}

test("dev runs get a Breadboard executable beside the Electron files, built once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dev-electron-"));
  try {
    const { exe, desktopRoot } = fakeElectron(root);
    const edits = [];
    const editResources = async (file, icon) => { edits.push([path.basename(file), path.basename(icon)]); };
    const branded = await devElectronBinary(exe, { desktopRoot, platform: "win32", editResources, log: () => {} });
    assert.equal(path.basename(branded), BRANDED_EXECUTABLE);
    assert.equal(fs.readFileSync(path.join(path.dirname(branded), "locales", "en-US.pak"), "utf8"), "en");
    assert.equal(fs.existsSync(path.join(path.dirname(branded), "electron.exe")), false);
    assert.deepEqual(edits, [[BRANDED_EXECUTABLE, "icon.ico"]]);
    assert.equal(await devElectronBinary(exe, { desktopRoot, platform: "win32", editResources, log: () => {} }), branded);
    assert.equal(edits.length, 1, "an unchanged Electron is not rebranded on every launch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a branding failure falls back to the stock binary instead of failing the launch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-dev-electron-"));
  try {
    const { exe, desktopRoot } = fakeElectron(root);
    const lines = [];
    const result = await devElectronBinary(exe, {
      desktopRoot, platform: "win32", log: line => lines.push(line),
      editResources: async () => { throw new Error("no rcedit"); },
    });
    assert.equal(result, exe);
    assert.match(lines.join("\n"), /stock Electron binary/);
    assert.equal(await devElectronBinary(exe, { desktopRoot, platform: "linux" }), exe, "other platforms keep Electron as is");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
