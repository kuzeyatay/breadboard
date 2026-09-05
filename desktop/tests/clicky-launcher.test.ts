import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createClickyLauncher } from "../src/main/clicky-launcher";

function temporaryRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-clicky-"));
}

function createClickyApplication(applicationPath: string): void {
  const executableDirectory = path.join(applicationPath, "Contents", "MacOS");
  fs.mkdirSync(executableDirectory, { recursive: true });
  fs.writeFileSync(path.join(executableDirectory, "Clicky"), "clicky");
}

test("Clicky is reported as unsupported on Linux", async () => {
  const root = temporaryRoot();
  try {
    const applicationPath = path.join(root, "Clicky.app");
    createClickyApplication(applicationPath);
    const opened: string[] = [];
    const launcher = createClickyLauncher({
      platform: "linux",
      appRoot: root,
      resourcesRoot: root,
      homeDirectory: root,
      configuredApplicationPath: applicationPath,
      openPath: async (candidate) => {
        opened.push(candidate);
        return "";
      },
    });

    assert.deepEqual(launcher.state(), {
      supported: false,
      available: false,
      projectAvailable: false,
      status: "unsupported",
      message: "Clicky is available on Windows and macOS.",
    });
    assert.equal((await launcher.launch()).code, "unsupported");
    assert.deepEqual(opened, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Windows launches its built-in companion without opening a Mac bundle or Xcode", async () => {
  const root = temporaryRoot();
  try {
    createClickyApplication(path.join(root, "clicky", "Clicky.app"));
    fs.mkdirSync(path.join(root, "clicky", "leanring-buddy.xcodeproj"), { recursive: true });
    let launched = 0;
    const launcher = createClickyLauncher({
      platform: "win32", appRoot: root, resourcesRoot: root, homeDirectory: root,
      openPath: async () => { assert.fail("Windows must not open a Mac artifact"); },
      launchWindowsCompanion: async () => { launched++; },
    });
    assert.equal(launcher.state().supported, true);
    assert.equal(launcher.state().available, true);
    assert.equal(launcher.state().status, "ready");
    assert.equal(launcher.state().projectAvailable, false);
    assert.equal((await launcher.launch()).ok, true);
    assert.equal(launched, 1);
    assert.equal((await launcher.openProject()).code, "not_found");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Windows reports companion startup failures instead of claiming success", async () => {
  const launcher = createClickyLauncher({
    platform: "win32", appRoot: "missing", resourcesRoot: "missing", homeDirectory: "missing",
    openPath: async () => "",
    launchWindowsCompanion: async () => { throw new Error("Dashboard unavailable"); },
  });
  const result = await launcher.launch();
  assert.equal(result.ok, false);
  assert.equal(result.code, "launch_failed");
  assert.match(result.message, /Dashboard unavailable/);
});

test("an older Windows host without the companion callback is supported but unavailable", async () => {
  const launcher = createClickyLauncher({
    platform: "win32", appRoot: "missing", resourcesRoot: "missing", homeDirectory: "missing",
    openPath: async () => { assert.fail("Must not fall through to shell.openPath"); },
  });
  assert.equal(launcher.state().supported, true);
  assert.equal(launcher.state().available, false);
  assert.equal((await launcher.launch()).code, "not_found");
});

test("the configured Clicky bundle launches without accepting a renderer path", async () => {
  const root = temporaryRoot();
  try {
    const applicationPath = path.join(root, "Clicky.app");
    createClickyApplication(applicationPath);
    const opened: string[] = [];
    const launcher = createClickyLauncher({
      platform: "darwin",
      appRoot: root,
      resourcesRoot: root,
      homeDirectory: root,
      configuredApplicationPath: applicationPath,
      openPath: async (candidate) => {
        opened.push(candidate);
        return "";
      },
    });

    assert.equal(launcher.state().status, "ready");
    const result = await launcher.launch();
    assert.equal(result.ok, true);
    assert.equal(result.code, "launched");
    assert.deepEqual(opened, [path.resolve(applicationPath)]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unbuilt clone opens its Xcode project instead of claiming it launched", async () => {
  const root = temporaryRoot();
  try {
    const projectPath = path.join(root, "clicky", "leanring-buddy.xcodeproj");
    fs.mkdirSync(projectPath, { recursive: true });
    const opened: string[] = [];
    const launcher = createClickyLauncher({
      platform: "darwin",
      appRoot: root,
      resourcesRoot: root,
      homeDirectory: root,
      openPath: async (candidate) => {
        opened.push(candidate);
        return "";
      },
    });

    const state = launcher.state();
    assert.equal(state.status, "not_built");
    assert.equal(state.available, false);
    assert.equal(state.projectAvailable, true);
    assert.equal((await launcher.launch()).code, "not_built");
    const projectResult = await launcher.openProject();
    assert.equal(projectResult.ok, true);
    assert.equal(projectResult.code, "project_opened");
    assert.deepEqual(opened, [path.resolve(projectPath)]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a native open error is returned as a launch failure", async () => {
  const root = temporaryRoot();
  try {
    const applicationPath = path.join(root, "Clicky.app");
    createClickyApplication(applicationPath);
    const launcher = createClickyLauncher({
      platform: "darwin",
      appRoot: root,
      resourcesRoot: root,
      homeDirectory: root,
      configuredApplicationPath: applicationPath,
      openPath: async () => "Launch Services refused the bundle",
    });

    const result = await launcher.launch();
    assert.equal(result.ok, false);
    assert.equal(result.code, "launch_failed");
    assert.match(result.message, /Launch Services refused the bundle/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
