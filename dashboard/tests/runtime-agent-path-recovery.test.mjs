import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

import { runtimePathWithin, sameRuntimePath } from "../src/lib/runtime-v2/path-policy.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-path-regression-"));
const savedEnvironment = { ...process.env };
Object.assign(process.env, {
  NODE_ENV: "test",
  BREADBOARD_DATA_DIR: fixtureRoot,
  BREADBOARD_REPO_ROOT: path.join(fixtureRoot, "repository"),
  BREADBOARD_LEARN_SOURCE_ROOT: path.join(dashboardRoot, "src"),
});
await import("../scripts/learn-worker-import-hook.mjs");
const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, "src/lib", relative)));
after(async () => {
  // The real adapter imports initialize the isolated dashboard database. Close
  // that handle before removing its directory on Windows.
  (await load("db.ts")).default.close();
  for (const key of ["NODE_ENV", "BREADBOARD_DATA_DIR", "BREADBOARD_REPO_ROOT", "BREADBOARD_LEARN_SOURCE_ROOT"]) {
    if (savedEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[key];
  }
  // Delete only the scratch directory this test created, never a configured root.
  assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixtureRoot).startsWith("breadboard-agent-path-regression-"));
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(filename, content = "fixture") {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
}

test("managed Python adapters launch the ordinary spelling of the sealed Windows environment", {skip: process.platform !== "win32"}, async () => {
  const prior = process.env.BREADBOARD_DATA_DIR;
  const data = path.join(fixtureRoot, "python-launch");
  const expected = path.join(data, "runtime-v2", "services", "legal", ".venv");
  write(path.join(expected, "Scripts", "python.exe"));
  try {
    process.env.BREADBOARD_DATA_DIR = path.toNamespacedPath(data);
    const runtime = await load("legal/runtime.ts");
    assert.equal(runtime.venvPython("unused"), path.join(expected, "Scripts", "python.exe"));
  } finally { process.env.BREADBOARD_DATA_DIR = prior; }
});

test("dashboard paths share the worker policy for drive, UNC, containment and case", () => {
  for (const root of [String.raw`C:\Users\Test\Data`, String.raw`\\server\share\Data`]) {
    const namespaced = path.win32.toNamespacedPath(root);
    assert.equal(sameRuntimePath(root, namespaced.toUpperCase(), "win32"), true);
    assert.equal(runtimePathWithin(namespaced, path.win32.join(root, "output"), "win32"), true);
    assert.equal(runtimePathWithin(root, path.win32.toNamespacedPath(root + "-sibling"), "win32"), false);
    assert.equal(runtimePathWithin(root, path.win32.join(root, "..", "outside"), "win32"), false);
  }
  assert.equal(sameRuntimePath("/data/Agent", "/data/agent", "linux"), false);
});

const definitions = [
  ["bolt-slides", "BoltSlides", "", "src/App.tsx", "deck", "text/plain; charset=utf-8"],
  ["matraix", "Matraix", "output", "study.md", "report", "text/markdown; charset=utf-8"],
  ["resource2skill", "Resource2Skill", "output", "report.md", "document", "text/markdown; charset=utf-8"],
  ["openmontage", "OpenMontage", "projects", "production-test/renders/final.mp4", "video", "video/mp4"],
  ["openplanter", "OpenPlanter", ".openplanter/sessions/20261106-120000-a1b2c3", "artifacts/outputs/result.md", "md", "text/markdown"],
];

for (const [id, suffix, directory, relativePath, kind, contentType] of definitions) {
  test(`${id} recovers real artifacts with both Windows path spellings without trusting redirection`, async () => {
    const dataRoot = path.join(fixtureRoot, id);
    const job = { jobId: `job_${"a".repeat(64)}`, attempt: 1, workerInstanceId: "worker_path_fixture" };
    const runtimeRoot = path.join(dataRoot, "runtime");
    const file = path.join(runtimeRoot, "jobs", job.jobId, "attempts", "1", job.workerInstanceId, "workspace", directory, relativePath);
    write(file, "audit");
    const record = id === "openplanter"
      ? { id: "0123456789abcdefabcd", name: "result.md", path: relativePath, kind, size: 5, preview: "audit" }
      : { id: Buffer.from(relativePath).toString("base64url"), relativePath, name: path.posix.basename(relativePath), kind, contentType, size: 5, modifiedAt: new Date().toISOString() };
    const events = [{ sequenceNumber: 1, type: "run.completed", payload: { artifacts: [record], ...(id === "openplanter" ? { sessionId: "20261106-120000-a1b2c3" } : {}) }, at: new Date().toISOString() }];
    const manager = await load(`${id}/runtime-run-manager.ts`);
    const resolve = manager[`resolve${suffix}ArtifactPath`];
    const spellings = [dataRoot, path.toNamespacedPath(dataRoot)];
    for (const spelling of spellings) {
      const resolved = resolve({ dataRoot: spelling, job, events, artifactId: record.id });
      assert.ok(resolved, `${id} must resolve an artifact below ${spelling}`);
      assert.equal(fs.readFileSync(resolved.canonicalPath, "utf8"), "audit");
      assert.equal(resolve({ dataRoot: spelling, job: { ...job, jobId: "../outside" }, events, artifactId: record.id }), null);
      assert.equal(resolve({ dataRoot: spelling, job, events, artifactId: "missing" }), null);
      const badSize = [{ ...events[0], payload: { ...events[0].payload, artifacts: [{ ...record, size: 6 }] } }];
      assert.equal(resolve({ dataRoot: spelling, job, events: badSize, artifactId: record.id }), null);
    }
    // Redirect an ancestor rather than just the file itself: lstat(file) still
    // returns an ordinary file, so the canonical identity check must catch it.
    fs.renameSync(runtimeRoot, runtimeRoot + "-direct");
    fs.symlinkSync(runtimeRoot + "-direct", runtimeRoot, process.platform === "win32" ? "junction" : "dir");
    for (const spelling of spellings) {
      assert.equal(resolve({ dataRoot: spelling, job, events, artifactId: record.id }), null);
    }
  });
}

test("managed Agent Reach source and Python accept extended paths and reject redirected installs", async () => {
  const dataRoot = path.join(fixtureRoot, "agent-reach");
  const source = path.join(dataRoot, "runtime-v2/toolchains/agent-reach/source");
  const python = path.join(dataRoot, "runtime-v2/services/agent-reach/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  write(path.join(source, "agent_reach/cli.py"));
  write(python);
  const runtime = await load("agent-reach/runtime.ts");
  for (const data of [dataRoot, path.toNamespacedPath(dataRoot)]) {
    const result = runtime.resolveAgentReachRuntime({ BREADBOARD_DATA_DIR: data });
    assert.ok(result);
    assert.equal(sameRuntimePath(result.command, python), true);
  }
  fs.renameSync(source, source + "-direct");
  fs.symlinkSync(source + "-direct", source, process.platform === "win32" ? "junction" : "dir");
  assert.equal(runtime.resolveAgentReachRuntime({ BREADBOARD_DATA_DIR: path.toNamespacedPath(dataRoot) }), null);
});

test("OpenPlanter resolves its clone and bridge with native paths and rejects redirected sources", async () => {
  const root = path.join(fixtureRoot, "openplanter-clone");
  for (const file of ["agent/runtime.py", "agent/builder.py", "pyproject.toml"]) write(path.join(root, file));
  const dashboard = path.join(fixtureRoot, "bridge-dashboard");
  write(path.join(dashboard, "scripts/openplanter-chatmock-runner.py"));
  const runtime = await load("openplanter/runtime.ts");
  for (const spelling of [root, path.toNamespacedPath(root)]) {
    const env = { OPENPLANTER_ROOT: spelling, BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT: path.toNamespacedPath(dashboard) };
    assert.equal(sameRuntimePath(runtime.resolveOpenPlanterRoot(env), root), true);
    assert.equal(runtime.runtimeAvailability(env).available, true);
  }
  fs.renameSync(root, root + "-direct");
  fs.symlinkSync(root + "-direct", root, process.platform === "win32" ? "junction" : "dir");
  assert.equal(runtime.resolveOpenPlanterRoot({ OPENPLANTER_ROOT: path.toNamespacedPath(root) }), null);
});

test("Praxist preserves direct clone and task-project validation for extended paths", async () => {
  const root = path.join(fixtureRoot, "praxist-clone");
  for (const file of ["pyproject.toml", "praxist/__init__.py", "task.yaml"]) write(path.join(root, file));
  const runtime = await load("praxist/runtime.ts");
  for (const spelling of [root, path.toNamespacedPath(root)]) {
    assert.equal(sameRuntimePath(runtime.resolvePraxistRoot({ PRAXIST_ROOT: spelling }), root), true);
    assert.equal(sameRuntimePath(runtime.resolvePraxistTaskProject(spelling), root), true);
  }
  fs.renameSync(root, root + "-direct");
  fs.symlinkSync(root + "-direct", root, process.platform === "win32" ? "junction" : "dir");
  assert.equal(runtime.resolvePraxistRoot({ PRAXIST_ROOT: path.toNamespacedPath(root) }), null);
  assert.throws(() => runtime.resolvePraxistTaskProject(path.toNamespacedPath(root)), /direct directory/);
});

test("Formsmith recovery accepts a native data root and rejects a redirected recovery store", async () => {
  const dataRoot = path.join(fixtureRoot, "formsmith");
  const recovery = path.join(dataRoot, "runtime-v2-formsmith-runs");
  fs.mkdirSync(recovery, { recursive: true });
  const manager = await load("shaper/run-manager.ts");
  const readMissing = () => manager.getFormsmithEventsSince(1, `fmsrun_${"a".repeat(32)}`, 0);
  for (const spelling of [dataRoot, path.toNamespacedPath(dataRoot)]) {
    process.env.BREADBOARD_DATA_DIR = spelling;
    assert.throws(readMissing, /^Error: run_not_found$/);
  }
  fs.renameSync(recovery, recovery + "-direct");
  fs.symlinkSync(recovery + "-direct", recovery, process.platform === "win32" ? "junction" : "dir");
  assert.throws(readMissing, /recovery store is unavailable/);
});
