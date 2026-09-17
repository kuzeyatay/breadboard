import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as crypto from "node:crypto";

function load(file, modules) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(id => {
    assert.ok(id in modules, `Unexpected import: ${id}`);
    return modules[id];
  }, exports);
  return exports;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-music-settings-"));
process.env.BREADBOARD_DATA_DIR = root;
delete process.env.BREADBOARD_RUNTIME_V2_CONTROL_URL;
const { default: db } = await import("../src/lib/db.ts");
const config = await import("../src/lib/acestep/config.ts");
const { musicError } = await import("../src/lib/music-producer/errors.ts");
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function setupFixture(result, overrides = {}) {
  const snapshot = { jobId: "setup_fixture", jobType: "managed-setup", workerKind: "managed-setup-node", resourceClass: "document-processing", gardenId: null, conversationId: null, state: "succeeded", stage: "finalizing", attempt: 1, workerInstanceId: "worker_fixture", lastWorkerSequence: 8, failureCode: null, failureMessage: null, ...overrides };
  const output = { protocolVersion: 1, identity: { jobId: snapshot.jobId, attempt: 1, workerInstanceId: "worker_fixture" }, completionSequence: 8, result };
  const calls = [];
  const supervisor = {
    RuntimeJobControlError: class extends Error {},
    inspectRuntimeJob: async (authority, jobId) => { calls.push(["inspect", authority, jobId]); return snapshot; },
    readRuntimeJobOutput: async (authority, jobId, kind) => { calls.push(["output", authority, jobId, kind]); return { content: output }; },
  };
  const managed = load("../src/lib/runtime-v2/managed-setup-job.ts", {
    "server-only": {}, "node:crypto": crypto, "../supervisor-control.ts": supervisor, "./authority-error.ts": {},
  });
  const route = load("../src/app/api/music-producer/setup/route.ts", {
    "next/server": { NextResponse: Response }, "node:crypto": crypto,
    "@/lib/server-auth": { requireUserId: async () => 7 },
    "@/lib/hermes/route-helpers.ts": { readJsonBody: request => request.json() },
    "@/lib/supervisor-control.ts": supervisor,
    "@/lib/music-producer/route-error.ts": { musicRouteError: error => Response.json({ ok: false, error: musicError(error).message }, { status: 400 }) },
    "@/lib/music-producer/setup-state.ts": { musicSetup: () => ({ request_id: "fixture", job_id: snapshot.jobId }) },
    "@/lib/runtime-v2/managed-setup-job.ts": managed,
    "@/lib/music-producer/errors.ts": { musicError },
  });
  return { route, output, calls };
}

test("completed setup workers report the install outcome, including its failure reason", async () => {
  for (const ok of [true, false]) {
    const fixture = setupFixture({ ok, message: ok ? "Models prepared." : "ACE-Step setup failed.", detail: ok ? "" : "Insufficient disk space." });
    const response = await fixture.route.GET();
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.state, ok ? "succeeded" : "failed");
    if (ok) assert.equal(value.detail, "");
    else assert.match(value.detail, /disk space.*30 GiB/);
    assert.deepEqual(fixture.calls.map(call => call[1]), Array(2).fill({ userId: 7, gardenId: null, conversationId: null }));
  }
});

test("structured installer failures become durable failed setup status", async () => {
  const fixture = setupFixture({ ok: false, message: "Install the Runtime uv toolchain before preparing ACE-Step.", detail: "", error: { status: 503, code: "setup_uv_missing" } });
  const value = await (await fixture.route.GET()).json();
  assert.equal(value.state, "failed");
  assert.match(value.message, /uv toolchain/);
});

test("setup cannot show success from a stale, foreign or malformed result", async () => {
  for (const change of [output => output.identity.attempt++, output => output.identity.jobId = "foreign", output => output.completionSequence++, output => output.result = {}]) {
    const fixture = setupFixture({ ok: true, message: "Prepared", detail: "" });
    change(fixture.output);
    assert.equal((await fixture.route.GET()).status, 400);
  }
  const foreign = setupFixture({}, { jobType: "other-job" });
  assert.equal((await foreign.route.GET()).status, 400);
  assert.equal(foreign.calls.some(call => call[0] === "output"), false);
});

test("setup errors never expose provider keys or native paths", async () => {
  const fixture = setupFixture({ ok: false, message: "ACE-Step setup failed.", detail: "C:\\private\\runtime\\setup.py API_KEY=fixture-secret" });
  const value = await (await fixture.route.GET()).json();
  assert.equal(value.state, "failed");
  assert.doesNotMatch(JSON.stringify(value), /fixture-secret|private/);
  const native = setupFixture({}, { state: "failed", failureMessage: "The setup worker was interrupted." });
  assert.equal((await (await native.route.GET()).json()).message, "The setup worker was interrupted.");
});

test("external credentials stay with their origin, can be replaced and can be removed", () => {
  const settings = { mode: "external", externalUrl: "http://127.0.0.1:8001", model: "acestep-v15-turbo" };
  config.saveAceStepSettings(1, { ...settings, apiKey: "first-key" });
  config.saveAceStepSettings(1, settings);
  assert.equal(config.readAceStepSettings(1).apiKey, "first-key");
  config.saveAceStepSettings(1, { ...settings, apiKey: "replacement-key" });
  assert.equal(config.readAceStepSettings(1).apiKey, "replacement-key");
  config.saveAceStepSettings(1, { ...settings, apiKey: "" });
  assert.equal(config.readAceStepSettings(1).apiKey, "");
  config.saveAceStepSettings(1, { ...settings, apiKey: "private-key" });
  config.saveAceStepSettings(1, { ...settings, externalUrl: "http://127.0.0.1:8002" });
  assert.equal(config.readAceStepSettings(1).apiKey, "");
});

test("a disconnected optional arrangement connection cannot prevent saving the music provider", () => {
  const settings = { mode: "managed", externalUrl: "", model: "acestep-v15-turbo", apiKey: "", resonantSlug: "disconnected-studio" };
  fs.writeFileSync(path.join(root, "music-producer", "settings-2.json"), JSON.stringify(settings));
  config.saveAceStepSettings(2, { ...settings, mode: "external", externalUrl: "http://127.0.0.1:8001" });
  assert.equal(config.readAceStepSettings(2).mode, "external");
  assert.throws(() => config.saveAceStepSettings(2, { ...settings, resonantSlug: "new-unapproved-studio" }));
});

test("connection errors give actionable settings guidance", () => {
  assert.match(musicError(new Error("provider_http_401")).message, /API key/);
  assert.match(musicError(new Error("provider_http_404")).message, /endpoint URL/);
  assert.match(musicError(new Error("fetch failed")).message, /server is running/);
  const fullDisk = musicError(new Error("Failed to copy C:\\private\\torch.dll: There is not enough space on the disk. (os error 112)"));
  assert.equal(fullDisk.code, "insufficient_disk_space");
  assert.match(fullDisk.message, /30 GiB/);
  assert.doesNotMatch(fullDisk.message, /private/);
});
