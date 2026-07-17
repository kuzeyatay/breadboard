import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  sanitizeSegment,
  workspaceKeyFor,
  resolveWorkspace,
  directoryForWorkspaceKey,
} from "../src/lib/openharness/workspace.ts";

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
  assert.equal(workspaceKeyFor({ surface: "dashboard_terminal", sessionKey: "S1" }), "terminal/s1");
  assert.equal(
    workspaceKeyFor({ surface: "garden_chat", sessionKey: "S1", gardenKey: "Physics" }),
    "gardens/physics/s1",
  );
  assert.equal(
    workspaceKeyFor({ surface: "quartz_ai", sessionKey: "S1", gardenKey: "Physics", pageKey: "Wave/Eq" }),
    "quartz/physics/wave-eq/s1",
  );
});

test("resolveWorkspace stays under the configured root", () => {
  const resolved = resolveWorkspace(config, { surface: "dashboard_terminal", sessionKey: "abc" });
  assert.ok(resolved.directory.startsWith(path.resolve(config.root)));
  assert.equal(resolved.workspaceKey, "terminal/abc");
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
