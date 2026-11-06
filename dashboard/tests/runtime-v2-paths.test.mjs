import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runtimePathWithin, sameRuntimePath, runtimeProcessPath } from "../scripts/runtime-v2-paths.mjs";
import { trustedPath } from "../scripts/runtime-v2-cinema-agent-worker-core.mjs";

test("process paths retain filesystem identity without the Windows namespace", () => {
  for (const original of [String.raw`D:\BreadboardLargeFiles\agent\.venv\Scripts\python.exe`, String.raw`\\server\share\agent\python.exe`]) {
    const canonical = path.win32.toNamespacedPath(original);
    const launched = runtimeProcessPath(canonical, "win32");
    assert.equal(launched, original);
    assert.equal(sameRuntimePath(canonical, launched, "win32"), true);
    assert.equal(runtimeProcessPath(canonical, "linux"), canonical);
  }
  for (const unchanged of ["python", "/opt/python", String.raw`\\.\pipe\control`, String.raw`\\?\GLOBALROOT\Device\example`]) {
    assert.equal(runtimeProcessPath(unchanged, "win32"), unchanged);
  }
});

test("Windows Runtime identity and containment accept every canonical spelling", () => {
  for (const root of [String.raw`C:\Users\Example\Data`, String.raw`\\server\share\Data`]) {
    const child = path.win32.join(root, "loopx-goals", "goal");
    const roots = [root, path.win32.toNamespacedPath(root), root.toUpperCase()];
    const children = [child, path.win32.toNamespacedPath(child), child.toUpperCase()];
    for (const left of roots) {
      for (const right of roots) {
        assert.equal(sameRuntimePath(left, right, "win32"), true, `${left} = ${right}`);
        assert.equal(runtimePathWithin(left, right, "win32"), true);
      }
      for (const right of children) {
        assert.equal(runtimePathWithin(left, right, "win32"), true, `${right} within ${left}`);
        assert.equal(sameRuntimePath(left, right, "win32"), false);
        assert.equal(runtimePathWithin(right, left, "win32"), false);
      }
      for (const outside of [root + "-other", path.win32.join(root, "..", "outside"), String.raw`D:\Data`]) {
        for (const right of [outside, path.win32.toNamespacedPath(outside)]) {
          assert.equal(runtimePathWithin(left, right, "win32"), false);
          assert.equal(sameRuntimePath(left, right, "win32"), false);
        }
      }
    }
  }
});

test("POSIX checks retain case sensitivity and reject traversal and sibling prefixes", () => {
  assert.equal(sameRuntimePath("/data/agent", "/data/./agent", "linux"), true);
  assert.equal(sameRuntimePath("/data/Agent", "/data/agent", "linux"), false);
  assert.equal(runtimePathWithin("/data/agent", "/data/agent/output", "linux"), true);
  for (const outside of ["/data/agent-other", "/data/agent/../outside", "/data/Agent"]) {
    assert.equal(runtimePathWithin("/data/agent", outside, "linux"), false);
  }
});

test("normalizing a Windows spelling does not trust junction redirection", { skip: process.platform !== "win32" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-paths-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const direct = path.join(root, "direct");
  const link = path.join(root, "redirected");
  fs.mkdirSync(direct);
  fs.writeFileSync(path.join(direct, "python.exe"), "fixture");
  fs.symlinkSync(direct, link, "junction");
  const name = "BREADBOARD_PATH_REGRESSION_TEST";
  const previous = process.env[name];
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  for (const spelling of [direct, path.toNamespacedPath(direct)]) {
    process.env[name] = path.join(spelling, "python.exe");
    assert.equal(trustedPath(name, "file"), path.resolve(process.env[name]));
  }
  for (const spelling of [link, path.toNamespacedPath(link)]) {
    process.env[name] = path.join(spelling, "python.exe");
    assert.throws(() => trustedPath(name, "file"), /indirect/u);
  }
});

test("Runtime V2 packages the shared path helper", () => {
  const scripts = path.resolve(import.meta.dirname, "../scripts");
  for (const name of ["prepare-app-resources.mjs", "verify-package.mjs"]) {
    const source = fs.readFileSync(path.resolve(scripts, "../../desktop/scripts", name), "utf8");
    assert.ok(source.includes('"runtime-v2-paths.mjs"'), `${name} must include the shared helper`);
  }
});
