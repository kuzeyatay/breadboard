import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sanitizeSegment,
  workspaceKeyFor,
  resolveWorkspace,
  directoryForWorkspaceKey,
} from "../src/lib/hermes/workspace.ts";

const config = {
  enabled: true,
  baseUrl: "http://127.0.0.1:4096",
  username: "breadboard",
  password: "",
  root: path.join(os.tmpdir(), "bb-oh-test-root"),
  agents: { terminal: "t", garden: "g", quartz: "q", capabilityScout: "s" },
  requestTimeoutMs: 1000,
};

test("sanitizeSegment neutralizes traversal and separators", () => {
  assert.equal(sanitizeSegment("../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeSegment("a/b\\c"), "a-b-c");
  assert.equal(sanitizeSegment(""), "default");
  assert.equal(sanitizeSegment("Good_Name-1"), "good_name-1");
});

test("workspaceKeyFor builds per-surface keys", () => {
  assert.equal(
    workspaceKeyFor({ surface: "dashboard_terminal", sessionKey: "S1" }),
    "terminal/s1",
  );
  assert.equal(
    workspaceKeyFor({
      surface: "garden_chat",
      sessionKey: "S1",
      gardenKey: "Physics",
    }),
    "gardens/physics/s1",
  );
  assert.equal(
    workspaceKeyFor({
      surface: "quartz_ai",
      sessionKey: "S1",
      gardenKey: "Physics",
      pageKey: "Wave/Eq",
    }),
    "quartz/physics/wave-eq/s1",
  );
});

test("resolveWorkspace stays under the configured root", () => {
  const resolved = resolveWorkspace(config, {
    surface: "dashboard_terminal",
    sessionKey: "abc",
  });
  assert.ok(resolved.directory.startsWith(path.resolve(config.root)));
  assert.equal(resolved.workspaceKey, "terminal/abc");
});

test("resolveWorkspace creates an ordinary workspace without placing a secret inside it", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hermes-create-"));
  const localConfig = { ...config, root: path.join(parent, "runtime-root") };
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const resolved = resolveWorkspace(
    localConfig,
    {
      surface: "garden_chat",
      sessionKey: "all-platform-session",
      gardenKey: "all-platform-garden",
    },
    { create: true },
  );
  assert.equal(fs.lstatSync(resolved.runtimeDirectory).isDirectory(), true);
  assert.equal(fs.lstatSync(resolved.runtimeDirectory).isSymbolicLink(), false);
  assert.equal(
    fs.existsSync(
      path.join(resolved.runtimeDirectory, ".breadboard", "capability.json"),
    ),
    false,
  );
});

test("resolveWorkspace rejects a planted symlink or junction before creating outside it", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hermes-link-create-"));
  const root = path.join(parent, "runtime-root");
  const outside = path.join(parent, "outside");
  const link = path.join(root, "gardens", "linked-garden");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      fs.rmSync(parent, { recursive: true, force: true });
      t.skip("directory links are unavailable in this environment");
      return;
    }
    throw error;
  }
  t.after(() => {
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {}
    fs.rmSync(parent, { recursive: true, force: true });
  });

  assert.throws(
    () =>
      resolveWorkspace(
        { ...config, root },
        {
          surface: "garden_chat",
          sessionKey: "must-not-be-created",
          gardenKey: "linked-garden",
        },
        { create: true },
      ),
    /symbolic link or junction/u,
  );
  assert.equal(fs.existsSync(path.join(outside, "must-not-be-created")), false);
});

test("a planted capability directory cannot redirect a secret because refreshes are server-side", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hermes-link-refresh-"));
  const root = path.join(parent, "runtime-root");
  const outside = path.join(parent, "outside");
  const localConfig = { ...config, root };
  const resolved = resolveWorkspace(
    localConfig,
    { surface: "dashboard_terminal", sessionKey: "link-swap" },
    { create: true },
  );
  fs.mkdirSync(outside, { recursive: true });
  const outsideMarker = path.join(outside, "marker.txt");
  fs.writeFileSync(outsideMarker, "unchanged", "utf8");
  const capabilityDirectory = path.join(resolved.runtimeDirectory, ".breadboard");
  try {
    fs.symlinkSync(
      outside,
      capabilityDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      fs.rmSync(parent, { recursive: true, force: true });
      t.skip("directory links are unavailable in this environment");
      return;
    }
    throw error;
  }
  t.after(() => {
    try {
      if (fs.lstatSync(capabilityDirectory).isSymbolicLink()) {
        fs.unlinkSync(capabilityDirectory);
      }
    } catch {}
    fs.rmSync(parent, { recursive: true, force: true });
  });

  const refreshed = resolveWorkspace(
    localConfig,
    { surface: "dashboard_terminal", sessionKey: "link-swap" },
    { create: true },
  );
  assert.equal(refreshed.runtimeDirectory, resolved.runtimeDirectory);
  assert.equal(fs.readFileSync(outsideMarker, "utf8"), "unchanged");
  assert.equal(fs.existsSync(path.join(outside, "capability.json")), false);
});

test("Hermes capabilities are minted from server state instead of workspace files", () => {
  const workspaceSource = fs.readFileSync(
    new URL("../src/lib/hermes/workspace.ts", import.meta.url),
    "utf8",
  );
  const sessionSource = fs.readFileSync(
    new URL("../src/lib/hermes/session-service.ts", import.meta.url),
    "utf8",
  );
  const toolAuthSource = fs.readFileSync(
    new URL("../src/lib/hermes/tool-service-auth.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(workspaceSource, /capability\.json|writeWorkspaceCapability/u);
  assert.doesNotMatch(
    sessionSource,
    /capability\.json|writeWorkspaceCapability|refreshWorkspaceCapability/u,
  );
  assert.match(toolAuthSource, /timingSafeEqual/u);
  assert.match(toolAuthSource, /getRuntimeSessionByExternalId/u);
  assert.match(toolAuthSource, /return issueCapabilityToken\(\{/u);
});

test("resolveWorkspace creates a session beneath a Runtime V2 extended Windows root", {
  skip: process.platform !== "win32",
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hermes-extended-root-"));
  try {
    const extendedRoot = `\\\\?\\${root}`;
    const resolved = resolveWorkspace(
      { ...config, root: extendedRoot },
      {
        surface: "garden_chat",
        sessionKey: "extended-path-session",
        gardenKey: "extended-path-garden",
      },
      { create: true },
    );
    assert.equal(fs.statSync(resolved.runtimeDirectory).isDirectory(), true);
    assert.match(fs.realpathSync.native(resolved.runtimeDirectory), /^[A-Za-z]:\\/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("full mode uses an existing previous directory without moving runtime metadata there", () => {
  const previousDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bb-oh-active-"),
  );
  try {
    const resolved = resolveWorkspace(config, {
      surface: "dashboard_terminal",
      sessionKey: "full-mode",
      filesystemMode: "full",
      previousDirectory,
    });
    assert.equal(resolved.directory, fs.realpathSync(previousDirectory));
    assert.ok(resolved.runtimeDirectory.startsWith(path.resolve(config.root)));
    assert.notEqual(resolved.runtimeDirectory, resolved.directory);
  } finally {
    fs.rmSync(previousDirectory, { recursive: true, force: true });
  }
});

test("QA mode forces a full-mode terminal into its disposable runtime workspace", (t) => {
  const previous = process.env.BREADBOARD_QA_MODE;
  process.env.BREADBOARD_QA_MODE = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_QA_MODE;
    else process.env.BREADBOARD_QA_MODE = previous;
  });
  const previousDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-forbidden-cwd-"));
  t.after(() => fs.rmSync(previousDirectory, { recursive: true, force: true }));

  const resolved = resolveWorkspace(config, {
    surface: "dashboard_terminal",
    sessionKey: "qa-isolated",
    filesystemMode: "full",
    previousDirectory,
  });

  assert.equal(resolved.directory, resolved.runtimeDirectory);
  assert.notEqual(resolved.directory, fs.realpathSync(previousDirectory));
  assert.ok(resolved.directory.startsWith(path.resolve(config.root)));
});

test("directoryForWorkspaceKey rejects escaping keys", () => {
  assert.throws(() => directoryForWorkspaceKey(config, "../../../etc"));
});

test("resolveWorkspace with malicious garden key cannot escape root", () => {
  const resolved = resolveWorkspace(config, {
    surface: "garden_chat",
    sessionKey: "s",
    gardenKey: "../../escape",
  });
  assert.ok(resolved.directory.startsWith(path.resolve(config.root)));
  assert.ok(!resolved.directory.includes(".."));
});
