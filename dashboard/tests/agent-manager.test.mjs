import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import * as crypto from "node:crypto";
import ts from "typescript";
import { MANAGED_SETUP_OPERATIONS } from "../scripts/runtime-v2-managed-setup-executor.mjs";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-manager-test-"));
const saved = process.env.BREADBOARD_DATA_DIR;
process.env.BREADBOARD_DATA_DIR = scratch;
process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.resolve(import.meta.dirname, "../src");
await import("../scripts/learn-worker-import-hook.mjs");
const { AGENT_MANAGER_CATALOG, AGENT_MANAGER_WORKFLOWS, agentManagerAction } = await import("../src/lib/agent-manager/catalog.ts");
const { agentManagerStatus } = await import("../src/lib/agent-manager/status.ts");
const { managerSetup, managerSetups, claimManagerSetup, saveManagerJob } = await import("../src/lib/agent-manager/store.ts");
after(async () => {
  (await import("../src/lib/db.ts")).default.close();
  if (saved === undefined) delete process.env.BREADBOARD_DATA_DIR;
  else process.env.BREADBOARD_DATA_DIR = saved;
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(scratch).startsWith("breadboard-agent-manager-test-"));
  fs.rmSync(scratch, { recursive: true, force: true });
});
const entry = (id) => AGENT_MANAGER_CATALOG.find((item) => item.id === id);
function load(file, modules) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", code)((id) => { assert.ok(id in modules, `Unexpected import: ${id}`); return modules[id]; }, exports);
  return exports;
}
function serviceFixture(userId, outcome = { ok: true, message: "Prepared", detail: "" }) {
  const calls = [];
  const job = { jobId: `job_${String(userId).padStart(64, "a")}`, jobType: "managed-setup", workerKind: "managed-setup-node", resourceClass: "document-processing", gardenId: null, conversationId: null, state: "queued", stage: null, attempt: 1, workerInstanceId: "worker_fixture", lastWorkerSequence: 8, failureMessage: null };
  let submitted = false;
  const output = { protocolVersion: 1, identity: { jobId: job.jobId, attempt: 1, workerInstanceId: "worker_fixture" }, completionSequence: 8, result: outcome };
  const supervisor = {
    RuntimeJobControlError: class extends Error {},
    inspectRuntimeJob: async (scope) => { calls.push(["inspect", scope]); return job; },
    lookupRuntimeJobByIdempotencyKey: async () => submitted ? job : null,
    submitRuntimeJob: async (scope, submission) => { submitted = true; calls.push(["submit", scope, submission]); return job; },
    cancelRuntimeJob: async (scope, jobId) => { calls.push(["cancel", scope, jobId]); job.cancellationRequested = true; return job; },
    readRuntimeJobOutput: async () => ({ content: output }),
  };
  const managed = load("../src/lib/runtime-v2/managed-setup-job.ts", { "server-only": {}, "node:crypto": crypto, "../supervisor-control.ts": supervisor, "./authority-error.ts": {} });
  const service = load("../src/lib/agent-manager/service.ts", {
    "server-only": {}, "node:crypto": crypto,
    "./catalog.ts": { agentManagerAction, agentManagerEntry: entry },
    "./store.ts": { managerSetup, claimManagerSetup, saveManagerJob },
    "./status.ts": { TERMINAL_SETUP_STATES: new Set(["succeeded", "failed", "cancelled", "resource_exhausted", "interrupted", "uncertain"]) },
    "../runtime-v2/managed-setup-job.ts": managed, "../supervisor-control.ts": supervisor,
  });
  return { service, calls, job, output, supervisor };
}

test("all 41 specialists remain in the eight real workflows with supported fixed setup recipes", () => {
  assert.equal(AGENT_MANAGER_CATALOG.length, 41);
  assert.equal(new Set(AGENT_MANAGER_CATALOG.map((item) => item.id)).size, 41);
  assert.equal(AGENT_MANAGER_WORKFLOWS.length, 8);
  for (const agent of AGENT_MANAGER_CATALOG) {
    assert.ok(AGENT_MANAGER_WORKFLOWS.some((workflow) => workflow.id === agent.workflowId && workflow.agentIds.includes(agent.id)));
    if (agent.healthUrl) assert.ok(fs.existsSync(path.resolve(import.meta.dirname, `../src/app${agent.healthUrl}/route.ts`)), agent.healthUrl);
    for (const action of agent.actions) {
      assert.ok(MANAGED_SETUP_OPERATIONS[action.serviceId]?.includes(action.action), `${agent.id}/${action.id} needs a real native recipe`);
      assert.equal(agentManagerAction(agent.id, action.id), action);
    }
  }
  assert.equal(AGENT_MANAGER_CATALOG.flatMap((item) => item.actions.filter((action) => action.destructive)).length, 19);
  assert.equal(agentManagerAction("../../", "remove"), null);
  assert.equal(agentManagerAction("deep-tutor", "../remove"), null);
  assert.equal(agentManagerAction("codex", "remove"), null);
  for (const id of ["codex", "opencode", "agent-browser", "openplanter", "praxist", "max-research", "formsmith"]) assert.equal(entry(id).hasSettings, false, `${id} must not expose a button whose dialog returns null`);
  for (const id of ["ruflo", "deep-tutor", "agent-reach", "openwork", "agent-tars"]) assert.equal(entry(id).hasSettings, true);
});

test("source presence does not masquerade as a complete installation", () => {
  const partial = agentManagerStatus(entry("deep-tutor"), { ok: true, available: false, cloned: true, environmentReady: true, packageInstalled: false, reason: "Packages missing" });
  assert.equal(partial.installed, false);
  assert.equal(partial.sourcePresent, true);
  assert.equal(partial.state, "needs-setup");
  const account = agentManagerStatus(entry("codex"), { ok: true, available: false, installed: true, reason: "Connect a repository" });
  assert.equal(account.installed, true);
  assert.equal(account.state, "needs-configuration");
  for (const id of ["vibe-trading", "stock-analyst", "deer-flow"]) {
    const stale = agentManagerStatus(entry(id), { ok: true, available: true, cloned: true, environmentReady: false });
    assert.equal(stale.state, "needs-setup", `${id} must not hide a missing managed environment behind cached availability`);
    assert.equal(stale.installed, false);
  }
  assert.equal(agentManagerStatus(entry("music-producer"), { ok: true, state: "ready", environmentReady: false, settings: { mode: "external" } }).state, "ready");
  const error = agentManagerStatus(entry("deep-tutor"), { ok: false, error: "Runtime unavailable", secret: "never render this" }, false);
  assert.equal(error.state, "unknown");
  assert.ok(!JSON.stringify(error).includes("never render this"));
});

test("nested setup reports, on-demand models and bundled capabilities keep their actual semantics", () => {
  const status = agentManagerStatus(entry("bolt-slides"), { ok: true, available: true, status: { clone: { found: true, path: "C:\\managed\\bolt-slides" }, dependencies: { installed: true } } });
  assert.equal(status.state, "ready");
  assert.equal(status.storagePath, "C:\\managed\\bolt-slides");
  assert.equal(agentManagerStatus(entry("music-producer"), { ok: true, state: "stopped", message: "Prepared" }).installed, true);
  assert.equal(agentManagerStatus(entry("music-producer"), { ok: true, state: "missing-models" }).state, "needs-setup");
  assert.equal(agentManagerStatus(entry("hardware-blueprint")).state, "included");
  assert.equal(agentManagerStatus(entry("socials-manager")).state, "unknown");
});

test("actual specialist health schemas preserve configuration blockers and installed on-demand runtimes", () => {
  const cases = [
    { id: "inbox-zero", body: { ok: true, available: false, runtimeState: "stopping", message: "The controller is finishing its idle shutdown. Retry shortly." }, state: "unknown", label: "Stopping · retry shortly", installed: null, message: "The controller is finishing its idle shutdown. Retry shortly." },
    { id: "inbox-zero", body: { ok: true, available: true, installed: true, oauth: { configured: false }, setup: { ready: false, step: "oauth_client_missing", message: "Add your Google or Microsoft OAuth client." } }, state: "needs-configuration", message: "Add your Google or Microsoft OAuth client.", installed: true },
    { id: "inbox-zero", body: { ok: true, available: true, installed: true, setup: { ready: false, step: "mailbox_not_connected", message: "Connect a mailbox." } }, state: "needs-configuration", message: "Connect a mailbox." },
    { id: "inbox-zero", body: { ok: true, available: true, installed: true, setup: { ready: true, step: "ready", message: "Mailbox connected." } }, state: "ready" },
    { id: "agent-tars", body: { ok: true, runtimeState: "available", health: { status: "healthy" } }, state: "ready", label: "Runtime available", message: entry("agent-tars").requirements },
    { id: "agent-tars", body: { ok: true, runtimeState: "available", health: { status: "unavailable", realBrowser: false } }, state: "ready", label: "Installed · starts on demand", message: entry("agent-tars").requirements },
    { id: "agent-tars", body: { ok: true, runtimeState: "unavailable", health: { status: "unavailable" } }, state: "needs-configuration" },
    { id: "deep-research", body: { ok: true, runtimeState: "available", health: { status: "unavailable", ready: false } }, state: "ready", label: "Installed · starts on demand", installed: true },
    { id: "deep-research", body: { ok: true, runtimeState: "available", health: { status: "healthy", ready: true } }, state: "ready", label: "Ready" },
    { id: "deep-research", body: { ok: true, runtimeState: "misconfigured", health: { status: "healthy", ready: false } }, state: "needs-configuration" },
    { id: "deep-research", body: { ok: true, runtimeState: "unavailable", health: { status: "unavailable", ready: false } }, state: "needs-configuration" },
    { id: "video-use", body: { ok: true, health: { available: true, cloned: true, root: "D:\\VideoUse", transcriptionReady: false } }, state: "ready", sourcePresent: true, storagePath: "D:\\VideoUse" },
    { id: "video-use", body: { ok: true, health: { available: false, cloned: false, reason: "Video Use source is missing." } }, state: "needs-setup", sourcePresent: false, message: "Video Use source is missing." },
    { id: "parametric-cad", body: { ok: true, configured: true, status: "ok", engines: { cadquery: { available: true } } }, state: "ready" },
    { id: "parametric-cad", body: { ok: false, configured: true, status: "stopped", error: "cad_service_stopped", message: "The CAD service starts on demand when you create a design.", engines: { cadquery: { available: false } } }, state: "included", label: "Starts on demand", installed: null, message: "The CAD service starts on demand when you create a design." },
    { id: "parametric-cad", body: { ok: false, configured: true, status: "stopped", error: "cad_service_stopped", message: "The CAD service starts on demand when you create a design.", engines: { cadquery: { available: false }, solidworks: { available: true, code: "available" } } }, state: "included", label: "Starts on demand", installed: true, message: "The CAD service starts on demand when you create a design. SolidWorks is installed; it starts when a design needs it." },
    { id: "parametric-cad", body: { ok: false, configured: true, status: "unavailable", error: "cad_service_unavailable", message: "The CAD service is unavailable." }, state: "unknown", label: "Check failed", installed: null },
    { id: "wardrobe", body: { ok: true, available: false, setup: { ready: false, dependencies: { installed: false }, clone: { found: true, path: "D:\\Wardrobe" }, reason: "Install dependencies." } }, state: "needs-setup", installed: false, sourcePresent: true, message: "Install dependencies." },
    { id: "wardrobe", body: { ok: true, available: false, setup: { ready: false, dependencies: { installed: true }, identity: { found: false }, reason: "Add an identity photo." } }, state: "needs-configuration", installed: true, message: "Add an identity photo." },
    { id: "classroom", body: { ok: true, available: false, status: { ready: false, runtime: { installed: true, built: false, path: "D:\\openmaic" } } }, state: "needs-setup", installed: false, storagePath: "D:\\openmaic" },
    { id: "resource2skill", body: { ok: true, available: false, status: { ready: false, clone: { found: true }, runtime: { found: false, python: "", version: "" } } }, state: "needs-setup", installed: false, sourcePresent: true },
    { id: "resource2skill", body: { ok: true, available: true, status: { ready: true, runtime: { found: true }, domains: { web: false, blender: false } } }, state: "ready", installed: true },
    { id: "matraix", body: { ok: true, available: false, status: { ready: false, clone: { found: true }, python: { found: false, path: "", version: "" } } }, state: "needs-setup", installed: false, sourcePresent: true },
    { id: "openmontage", body: { ok: true, available: false, status: { ready: false, clone: { found: true }, python: { found: true, dependencies: false, installable: true } } }, state: "needs-setup", installed: false, sourcePresent: true },
    { id: "music-producer", body: { ok: true, state: "stopped", message: "Prepared." }, state: "ready", label: "Installed · starts on demand" },
    { id: "music-producer", body: { ok: true, state: "resource-blocked", message: "Insufficient current memory headroom." }, state: "needs-configuration", message: "Insufficient current memory headroom." },
    { id: "agent-tars", body: { ok: false, runtimeState: "available", error: "runtime_control_unavailable" }, state: "unknown", label: "Check failed", message: "runtime_control_unavailable" },
  ];
  for (const { id, body, ...expected } of cases) {
    const result = agentManagerStatus(entry(id), body);
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, `${id}: ${JSON.stringify(body)} (${key})`);
  }
});

test("explicit blockers take precedence over optimistic lifecycle labels", () => {
  for (const state of ["ready", "healthy", "busy", "stopped", "available-but-stopped"]) {
    const result = agentManagerStatus(entry("music-producer"), { ok: true, available: false, state, reason: "Provider is unavailable." });
    assert.equal(result.state, "needs-configuration", state);
    assert.equal(result.message, "Provider is unavailable.");
  }
  for (const state of ["missing-models", "unavailable", "resource-blocked", "failed", "installation-unavailable"]) {
    assert.notEqual(agentManagerStatus(entry("music-producer"), { ok: true, available: true, state }).state, "ready", state);
  }
});

test("available Vox Director reports its title-card fallback instead of hiding reduced capability", () => {
  const warning = "ComfyUI is installed but not running. Posters fall back to the deterministic paper title cards.";
  const result = agentManagerStatus(entry("vox-director"), {
    ok: true, available: true, status: "degraded", blocking: [], degraded: [warning],
  });
  assert.equal(result.state, "ready");
  assert.equal(result.installed, true);
  assert.equal(result.label, "Ready · with limits");
  assert.equal(result.message, warning);
});

test("setup claims survive reload, converge racing clicks and stay scoped to user and agent", () => {
  const first = claimManagerSetup(101, "deep-tutor", "install", null, "request-one");
  const race = claimManagerSetup(101, "deep-tutor", "remove", null, "request-two");
  assert.deepEqual(race, first);
  const samePending = claimManagerSetup(101, "deep-tutor", "install", first.request_id, "request-three");
  assert.deepEqual(samePending, first);
  assert.equal(managerSetup(102, "deep-tutor"), undefined);
  assert.equal(managerSetup(101, "legal"), undefined);
  saveManagerJob(101, "deep-tutor", "wrong-request", "job_wrong");
  assert.equal(managerSetup(101, "deep-tutor").job_id, null);
  const nativeId = `job_${"a".repeat(64)}`;
  saveManagerJob(101, "deep-tutor", first.request_id, nativeId);
  assert.equal(managerSetups(101)[0].job_id, nativeId);
  assert.equal(managerSetups(102).length, 0);
  const replacement = claimManagerSetup(101, "deep-tutor", "remove", first.request_id, "request-four");
  assert.equal(replacement.action_id, "remove");
  assert.equal(replacement.job_id, null);
});

test("manager validates user actions and dispatches one durable native recipe without arbitrary fields", async () => {
  const { service, calls, job } = serviceFixture(301);
  for (const input of [null, {}, { agentId: "legal", actionId: "remove" }, { agentId: "legal", actionId: "install", path: "C:\\outside" }, { agentId: "codex", actionId: "remove", confirmRemoval: true }]) {
    await assert.rejects(service.startAgentManagerOperation(301, input));
  }
  assert.equal(calls.length, 0);
  const first = await service.startAgentManagerOperation(301, { agentId: "legal", actionId: "install" });
  assert.equal(first.finished, false);
  assert.equal(first.jobId, job.jobId);
  const submit = calls.find((call) => call[0] === "submit");
  assert.deepEqual(submit[1], { userId: 301, gardenId: null, conversationId: null });
  assert.deepEqual(submit[2].requestPayload, { protocolVersion: 1, operation: "legal", action: "install" });
  await service.startAgentManagerOperation(301, { agentId: "legal", actionId: "install" });
  assert.equal(calls.filter((call) => call[0] === "submit").length, 1);
  assert.equal(await service.readAgentManagerOperation(302, "legal"), null);
  await assert.rejects(service.startAgentManagerOperation(301, { agentId: "legal", actionId: "remove", confirmRemoval: true }), /still running/);
  assert.equal(await service.cancelAgentManagerOperation(302, "legal"), null);
  const cancelling = await service.cancelAgentManagerOperation(301, "legal");
  assert.equal(cancelling.finished, false);
  assert.match(cancelling.message, /Waiting for Runtime/);
  assert.deepEqual(calls.find((call) => call[0] === "cancel"), ["cancel", { userId: 301, gardenId: null, conversationId: null }, job.jobId]);
});

test("a completed worker is not reported as a successful installation without a successful fenced result", async () => {
  for (const [index, ok] of [true, false].entries()) {
    const userId = 310 + index;
    const fixture = serviceFixture(userId, { ok, message: ok ? "Installed" : "Packages unavailable", detail: "internal log not returned" });
    await fixture.service.startAgentManagerOperation(userId, { agentId: "deep-tutor", actionId: "install" });
    fixture.job.state = "succeeded";
    const result = await fixture.service.readAgentManagerOperation(userId, "deep-tutor");
    assert.equal(result.state, ok ? "succeeded" : "failed");
    assert.equal(result.finished, true);
    assert.ok(!JSON.stringify(result).includes("internal log"));
    fixture.output.identity.attempt++;
    await assert.rejects(fixture.service.readAgentManagerOperation(userId, "deep-tutor"), /unfenced/);
  }
});

test("native installation conflicts explain the active work and retry condition", async () => {
  const { service, supervisor } = serviceFixture(320);
  const submit = supervisor.submitRuntimeJob;
  supervisor.submitRuntimeJob = async () => { throw Object.assign(new supervisor.RuntimeJobControlError("JOB_CONFLICT"), { code: "JOB_CONFLICT" }); };
  await assert.rejects(service.startAgentManagerOperation(320, { agentId: "legal", actionId: "remove", confirmRemoval: true }), (error) =>
    error.status === 409 && /Agent work or another setup action is still active/.test(error.message) && /retry/.test(error.message) && !error.message.includes("JOB_CONFLICT"));
  const pending = managerSetup(320, "legal");
  assert.equal(pending.job_id, null);
  assert.equal((await service.readAgentManagerOperation(320, "legal")).state, "unconfirmed");
  supervisor.submitRuntimeJob = submit;
  const retry = await service.startAgentManagerOperation(320, { agentId: "legal", actionId: "remove", confirmRemoval: true });
  assert.equal(retry.finished, false);
  assert.equal(managerSetup(320, "legal").request_id, pending.request_id, "retry uses the same durable request after the rejected native transaction");
  assert.equal(managerSetup(320, "legal").job_id, retry.jobId);
});

test("catalog, submission and cancellation routes require an authenticated user before reading or mutating setup", async () => {
  class RouteError extends Error { constructor() { super("Unauthorized"); this.status = 401; } }
  const touched = [];
  const route = load("../src/app/api/agent-manager/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/server-auth": { requireUserId: async () => { throw new RouteError(); }, RouteError },
    "@/lib/agent-manager/catalog.ts": { AGENT_MANAGER_CATALOG, AGENT_MANAGER_WORKFLOWS },
    "@/lib/agent-manager/store.ts": { managerSetups: () => touched.push("read") },
    "@/lib/agent-manager/service.ts": { AgentManagerError: class extends Error {}, readAgentManagerOperation: () => touched.push("read"), startAgentManagerOperation: () => touched.push("install"), cancelAgentManagerOperation: () => touched.push("cancel") },
    "@/lib/runtime-v2/authority-errors.ts": { runtimeAuthorityErrorResponse: () => null },
    "@/lib/runtime-paths.ts": { dashboardDataDir: () => "D:\\BreadboardData" },
  });
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = await route[method](new Request("http://localhost/api/agent-manager?agentId=deep-tutor", { method }));
    assert.equal(response.status, 401);
  }
  assert.deepEqual(touched, []);
});
