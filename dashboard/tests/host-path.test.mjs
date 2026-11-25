import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expandWindowsVariables,
  hostSearchPath,
  parseRegQueryPath,
  parseRegQueryValues,
  registryUserEnvironment,
  resetHostPathCacheForTest,
  resolveHostExecutable,
  toolSearchPath,
  withHostPath,
} from "../scripts/host-path.mjs";
import { commandEnvironment } from "../scripts/runtime-v2-terminal-command-worker.mjs";

const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
// What Runtime V2 really hands every service: bundled runtimes + System32.
const CLOSED_ENV = {
  SystemRoot: SYSTEM_ROOT,
  PATH: [path.join(os.tmpdir(), "breadboard-bundled-node"), path.join(SYSTEM_ROOT, "System32"), SYSTEM_ROOT].join(path.delimiter),
};

test("reg query output yields the PATH value for both registry types", () => {
  const machine = "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\...\\Environment\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\Git\\cmd\r\n";
  assert.equal(parseRegQueryPath(machine), "%SystemRoot%\\system32;C:\\Program Files\\Git\\cmd");
  assert.equal(parseRegQueryPath("    Path    REG_SZ    C:\\tools\r\n"), "C:\\tools");
  assert.equal(parseRegQueryPath("ERROR: not found"), "");
});

test("registry %VARS% expand even when the closed environment lacks them", () => {
  const expanded = expandWindowsVariables("%USERPROFILE%\\.local\\bin;%ProgramFiles%\\Git\\cmd;%UNKNOWN%", { SystemRoot: "C:\\Windows" });
  assert.match(expanded, /\\\.local\\bin;/);
  assert.match(expanded, /Program Files\\Git\\cmd;%UNKNOWN%$/);
});

test("an injected env keeps exactly its own PATH (tests and pinned callers)", () => {
  assert.deepEqual(toolSearchPath({ PATH: ["A", " B ", ""].join(path.delimiter) }), ["A", "B"]);
});

test("the bundled PATH keeps priority and discovered folders follow it once", () => {
  resetHostPathCacheForTest();
  const search = hostSearchPath(CLOSED_ENV);
  const base = CLOSED_ENV.PATH.split(path.delimiter);
  assert.deepEqual(search.slice(0, base.length), base);
  const keys = search.map((entry) => path.resolve(entry).toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
});

test("a .cmd shim resolves through PATHEXT, as Codex's resolver does", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "host-path-"));
  try {
    const shim = path.join(directory, process.platform === "win32" ? "fake-tool.cmd" : "fake-tool");
    fs.writeFileSync(shim, "@echo off\r\n");
    resetHostPathCacheForTest();
    assert.equal(resolveHostExecutable("fake-tool", { SystemRoot: SYSTEM_ROOT, PATH: directory }), shim);
    assert.equal(resolveHostExecutable("definitely-not-installed-tool", { SystemRoot: SYSTEM_ROOT, PATH: directory }), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("withHostPath leaves exactly one PATH spelling", () => {
  const env = withHostPath({ ...CLOSED_ENV, Path: "ignored" });
  assert.equal(Object.keys(env).filter((key) => key.toUpperCase() === "PATH").length, 1);
});

const gitInstalled = process.platform === "win32" &&
  ["Program Files", "Program Files (x86)"].some((root) => fs.existsSync(path.join(process.env.SystemDrive ?? "C:", "\\", root, "Git", "cmd", "git.exe")));

test("from Runtime V2's closed PATH, the installed Git is found (the reported failure)", { skip: !gitInstalled && "Git is not installed here" }, () => {
  resetHostPathCacheForTest();
  const git = resolveHostExecutable("git", CLOSED_ENV);
  assert.ok(git && /git\.exe$/i.test(git), `expected git.exe, got ${git}`);
});

test("the agent's terminal command environment reaches installed Git", { skip: !gitInstalled && "Git is not installed here" }, () => {
  resetHostPathCacheForTest();
  const env = commandEnvironment({ ...CLOSED_ENV, USERPROFILE: os.homedir() });
  const entries = env.PATH.split(path.delimiter);
  assert.ok(entries.some((entry) => fs.existsSync(path.join(entry, "git.exe"))), "terminal PATH should contain Git");
  assert.ok(env.USERNAME, "USERNAME is part of Codex's core Windows environment");
});

test("user-set Windows variables reach commands, secrets do not (Codex's exclude)", () => {
  const parsed = parseRegQueryValues("HKEY_CURRENT_USER\Environment\r\n    JAVA_HOME    REG_SZ    C:\jdk\r\n    OneDrive    REG_EXPAND_SZ    %USERPROFILE%\OneDrive - X\r\n");
  assert.deepEqual(parsed, { JAVA_HOME: "C:\jdk", OneDrive: "%USERPROFILE%\OneDrive - X" });
  const user = registryUserEnvironment({ SystemRoot: SYSTEM_ROOT });
  assert.ok(Object.keys(user).every((name) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(name)));
  assert.ok(!Object.keys(user).some((name) => /^(PATH|TEMP|TMP)$/i.test(name)));
  const env = commandEnvironment({ ...CLOSED_ENV, USERPROFILE: os.homedir() });
  for (const name of Object.keys(user)) assert.ok(name in env, `${name} should reach the terminal`);
});

test("machine-wide USERNAME=SYSTEM never replaces the user's identity", () => {
  const user = registryUserEnvironment({ SystemRoot: SYSTEM_ROOT });
  assert.ok(!Object.keys(user).some((name) => /^(USERNAME|USERDOMAIN|WINDIR|COMPUTERNAME)$/i.test(name)));
});
