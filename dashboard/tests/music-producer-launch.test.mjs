import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { fakeAceStep } from "./helpers/fake-acestep.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-music-launch-"));
process.env.BREADBOARD_DATA_DIR = root;
delete process.env.BREADBOARD_RUNTIME_V2_CONTROL_URL;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const runtime = await import("../src/lib/hermes/runtime-store.ts");
const runs = await import("../src/lib/hermes/run-store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const launches = await import("../src/lib/music-producer/store.ts");
const artifacts = await import("../src/lib/hermes/artifact-store.ts");
const { musicArtifactContext } = await import("../src/lib/music-producer/artifacts.ts");
const { executeMusicWorker } = await import("../src/lib/music-producer/worker.ts");
const { saveAceStepSettings } = await import("../src/lib/acestep/config.ts");
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'music','music@example.test','unused'),(2,'other','other@example.test','unused')").run();
db.prepare("INSERT INTO clusters(id,user_id,name,slug) VALUES(10,1,'Music garden','music-garden')").run();
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function createSession(conversation, externalId = crypto.randomUUID()) {
  return runtime.createRuntimeSession({
    conversationId: conversation.id, userId: conversation.user_id, surface: conversation.surface,
    chatSessionId: conversation.legacy_chat_session_id, agentName: "Hermes", clusterId: conversation.default_garden_id,
    gardenId: conversation.default_garden_id ? "music-garden" : null, pageSlug: null,
    workspaceKey: crypto.randomUUID(), activeDirectory: root, filesystemMode: "restricted", hermesSessionId: externalId,
  });
}

function inputFor(conversation) {
  return {
    userId: 1, clientMessageId: crypto.randomUUID(), conversationPublicId: conversation.public_id,
    task: "create me a symphony", model: "fixture", reasoningEffort: "medium", baseUrl: "http://127.0.0.1:1/v1",
    conversationContext: "", defaults: { duration: 60, vocalMode: "instrumental" }, explicit: {},
  };
}

// Run the real launcher and persistence. Replace only runtime session creation
// and native job admission so this regression cannot start real generation.
async function launcher(resolveSession, admit, readView) {
  const resolutions = [], admissions = [];
  const modules = {
    "../hermes/session-service.ts": {
      resolveConversationRuntime: async (input) => {
        resolutions.push(input);
        if (resolveSession) return resolveSession(input);
        const existing = runtime.getRuntimeSessionByConversation(input.conversation.id);
        if (existing) runtime.setHermesSessionId(existing.id, crypto.randomUUID());
        else createSession(input.conversation);
      },
    },
    "../runtime-v2/outer-agent-run.ts": {
      readOuterAgentRunView: readView,
      startOuterAgentRun: async (input) => {
        admissions.push(input);
        const launch = launches.musicLaunch(input.userId, input.requestId);
        const context = JSON.parse(launch.context_json);
        const conversation = store.getConversationForUser(launch.conversation_public_id, input.userId);
        assert.equal(context.assistantMessageId, turns.findExternalAgentAssistantMessage({ conversationId: conversation.id, runId: input.requestId }).id);
        assert.equal(context.runtimeSessionId, runtime.getRuntimeSessionByConversation(conversation.id).id);
        if (admit) return admit(input);
        return { runId: `job_${input.requestId}` };
      },
    },
  };
  const url = new URL("../src/lib/music-producer/run-manager.ts", import.meta.url);
  const compiled = ts.transpileModule(fs.readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [, id] of compiled.matchAll(/require\("([^"]+)"\)/g)) {
    if (!(id in modules)) modules[id] = await import(id.startsWith(".") ? new URL(id, url).href : id);
  }
  const exports = {};
  new Function("require", "exports", compiled)((id) => {
    assert.ok(id in modules, `Unexpected import: ${id}`);
    return modules[id];
  }, exports);
  return { ...exports, resolutions, admissions };
}

for (const surface of ["dashboard_terminal", "garden_chat"]) {
  test(`a first music turn in ${surface} initializes its runtime and publishes to its own message`, async (t) => {
    const fake = await fakeAceStep(); t.after(() => fake.close());
    saveAceStepSettings(1, { mode: "external", externalUrl: fake.connection.baseUrl, apiKey: "fixture-key", model: fake.connection.model });
    const conversation = store.createConversation({ userId: 1, title: "Fresh music chat", surface, defaultGardenId: surface === "garden_chat" ? 10 : null });
    assert.equal(runtime.getRuntimeSessionByConversation(conversation.id), null);
    const manager = await launcher(), input = inputFor(conversation);
    const result = await manager.startRun(input);
    assert.equal(result.status, "queued");
    assert.equal(manager.resolutions.length, 1);
    assert.equal(manager.resolutions[0].conversation.id, conversation.id);
    assert.equal(manager.resolutions[0].surface, surface);
    if (surface === "garden_chat") assert.equal(manager.resolutions[0].activeGardenSlug, "music-garden");
    assert.equal((await manager.startRun(input)).runId, result.runId);
    assert.equal(manager.resolutions.length, 1);
    assert.equal(manager.admissions.length, 1);

    // Supply a validated plan while exercising the real receipt, WAV and artifact pipeline.
    launches.updateMusicLaunch(1, result.runId, { request_json: JSON.stringify({ brief: input.task }) });
    const workspace = path.join(root, result.runId); fs.mkdirSync(workspace);
    const events = [];
    const completed = await executeMusicWorker({
      ...manager.admissions[0].requestPayload, userId: 1, workspace, signal: new AbortController().signal,
      update: (next) => events.push(...next),
    }, {
      acquireServiceLease: async () => { throw Error("External provider needs no lease"); },
      releaseSupervisorLease: async () => {}, runAudioAnalysis: async () => { throw Error("Optional analyzer unavailable"); },
    });
    assert.equal(completed.status, "completed");
    assert.equal(fake.submissions, 1);
    assert.equal(events.at(-1).type, "run.completed");
    const [audio] = artifacts.listArtifactsForUser({ userId: 1, conversationPublicId: conversation.public_id });
    assert.equal(audio.conversation_id, conversation.id);
    assert.equal(audio.cluster_id, conversation.default_garden_id);
    assert.equal(audio.originating_message_id, turns.findExternalAgentAssistantMessage({ conversationId: conversation.id, runId: result.runId }).id);
  });
}

test("initialized sessions are reused and incomplete sessions are initialized", async () => {
  for (const externalId of [crypto.randomUUID(), null]) {
    const conversation = store.createConversation({ userId: 1, title: "Existing chat" });
    const session = createSession(conversation, externalId), manager = await launcher();
    await manager.startRun(inputFor(conversation));
    assert.equal(runtime.getRuntimeSessionByConversation(conversation.id).id, session.id);
    assert.equal(manager.resolutions.length, externalId ? 0 : 1);
    assert.equal(manager.admissions.length, 1);
  }
});

test("runtime initialization failures persist and an explicit new run can retry", async () => {
  const conversation = store.createConversation({ userId: 1, title: "Retry music" });
  const manager = await launcher(() => { throw Error("Runtime temporarily unavailable"); });
  const input = inputFor(conversation);
  await assert.rejects(() => manager.startRun(input), /Runtime temporarily unavailable/);
  const failed = await manager.startRun(input);
  assert.equal(failed.status, "failed");
  assert.equal(manager.resolutions.length, 1);
  assert.equal(manager.admissions.length, 0);
  const message = turns.findExternalAgentAssistantMessage({ conversationId: conversation.id, runId: failed.runId });
  assert.match(message.content, /Runtime temporarily unavailable/);
  assert.equal(JSON.parse(message.metadata).externalAgentOutcome, "failed");
  const retry = await launcher();
  const retried = await retry.startRun({ ...input, clientMessageId: crypto.randomUUID(), branchGroupId: input.clientMessageId });
  assert.equal(retried.status, "queued");
  const retriedMessage = turns.findExternalAgentAssistantMessage({ conversationId: conversation.id, runId: retried.runId });
  assert.equal(JSON.parse(retriedMessage.metadata).branchGroupId, input.clientMessageId);
  assert.equal(retry.admissions.length, 1);
});

test("a missing assistant message and a missing runtime have distinct diagnostics", () => {
  const conversation = store.createConversation({ userId: 1, title: "Incomplete music turn" });
  const id = `music_${crypto.randomBytes(16).toString("hex")}`, clientMessageId = crypto.randomUUID();
  launches.createMusicLaunch({ id, userId: 1, conversationPublicId: conversation.public_id, clientMessageId, task: "music" });
  assert.throws(() => musicArtifactContext(1, id), /originating assistant message/);
  turns.recordExternalAgentTurn({ conversation, clientMessageId, surface: conversation.surface, userContent: "music", run: { kind: "music_producer", runId: id, task: "music" } });
  assert.throws(() => musicArtifactContext(1, id), /runtime session/);
  assert.throws(() => musicArtifactContext(2, id), /run_not_found/);
});

for (const surface of ["dashboard_terminal", "garden_chat"]) {
  test(`music publishes alongside an active parent in ${surface} without taking or finishing its lock`, async (t) => {
    const fake = await fakeAceStep(); t.after(() => fake.close());
    saveAceStepSettings(1, { mode: "external", externalUrl: fake.connection.baseUrl, apiKey: "fixture-key", model: fake.connection.model });
    const conversation = store.createConversation({ userId: 1, title: "Delegated music", surface, defaultGardenId: surface === "garden_chat" ? 10 : null });
    const session = createSession(conversation);
    const parent = runs.beginRuntimeRun({ runtimeSessionId: session.id, instruction: "Help me compose", dispatch: { clientMessageId: crypto.randomUUID() } });
    const manager = await launcher(), input = inputFor(conversation);
    const result = await manager.startRun(input);
    assert.equal(result.status, "queued");
    const context = musicArtifactContext(1, result.runId);
    assert.deepEqual(musicArtifactContext(1, result.runId), context, "Context lookup is idempotent");
    assert.equal(runs.getRuntimeRun(context.runId), null, "No runtime turn exists before publication");
    assert.equal(runs.getActiveRuntimeRun(session.id).id, parent.id);
    launches.updateMusicLaunch(1, result.runId, { request_json: JSON.stringify({ brief: input.task }) });
    const workspace = path.join(root, result.runId); fs.mkdirSync(workspace);
    const completed = await executeMusicWorker({ ...manager.admissions[0].requestPayload, userId: 1, workspace,
      signal: new AbortController().signal, update() {},
    }, { acquireServiceLease: async () => { throw Error("Unexpected lease"); }, releaseSupervisorLease: async () => {}, runAudioAnalysis: async () => { throw Error("Optional"); } });
    assert.equal(completed.status, "completed");
    assert.equal(fake.submissions, 1);
    assert.equal(runs.getActiveRuntimeRun(session.id).id, parent.id);
    assert.equal(runs.getRuntimeRun(context.runId).status, "completed");
    const [audio] = artifacts.listArtifactsForUser({ userId: 1, conversationPublicId: conversation.public_id });
    assert.equal(audio.originating_run_id, context.runId);
    assert.equal(audio.originating_message_id, context.assistantMessageId);
    assert.equal(audio.conversation_id, conversation.id);
    runs.finishRuntimeRun(parent.id, "completed");
  });
}

test("admission failure leaves no runtime lock and retry starts a fresh music run", async () => {
  const conversation = store.createConversation({ userId: 1, title: "Admission retry" });
  const session = createSession(conversation), input = inputFor(conversation);
  const failedManager = await launcher(undefined, () => { throw Error("Runtime admission unavailable"); });
  await assert.rejects(() => failedManager.startRun(input), /Runtime admission unavailable/);
  assert.equal(runs.getActiveRuntimeRun(session.id), null);
  const retry = await launcher();
  assert.equal((await retry.startRun({ ...input, clientMessageId: crypto.randomUUID(), branchGroupId: input.clientMessageId })).status, "queued");
  assert.equal(runs.getActiveRuntimeRun(session.id), null);
});

test("legacy terminal music locks recover without changing unrelated active chat turns", () => {
  const conversation = store.createConversation({ userId: 1, title: "Legacy failure" });
  const session = createSession(conversation);
  const legacy = runs.beginRuntimeRun({ runtimeSessionId: session.id, instruction: "music", dispatch: {} });
  const id = `music_${crypto.randomBytes(16).toString("hex")}`;
  launches.createMusicLaunch({ id, userId: 1, conversationPublicId: conversation.public_id, clientMessageId: crypto.randomUUID(), task: "music" });
  launches.updateMusicLaunch(1, id, { collection_state: "failed", context_json: JSON.stringify({ runId: legacy.id, runtimeSessionId: session.id }) });
  const otherConversation = store.createConversation({ userId: 1, title: "Still working" });
  const other = runs.beginRuntimeRun({ runtimeSessionId: createSession(otherConversation).id, instruction: "Chat", dispatch: {} });
  launches.recoverMusicArtifactRuns();
  assert.equal(runs.getRuntimeRun(legacy.id).status, "error");
  assert.equal(runs.getActiveRuntimeRun(session.id), null);
  assert.equal(runs.getRuntimeRun(other.id).status, "active");
  runs.finishRuntimeRun(other.id, "completed");
});

test("native failure before worker startup persists through reload and releases legacy music locks", async () => {
  const conversation = store.createConversation({ userId: 1, title: "Worker startup failure" });
  const session = createSession(conversation), cursors = [];
  const manager = await launcher(undefined, undefined, async (_kind, _user, _run, since) => {
    cursors.push(since);
    return { terminal: true, status: "failed", events: since ? [] : [{ sequenceNumber: 1, type: "run.failed", payload: { summary: "Music worker failed before startup." } }] };
  });
  const input = inputFor(conversation), result = await manager.startRun(input);
  const legacy = runs.beginRuntimeRun({ runtimeSessionId: session.id, instruction: input.task, dispatch: {} });
  launches.updateMusicLaunch(1, result.runId, { context_json: JSON.stringify({ ...musicArtifactContext(1, result.runId), runId: legacy.id }) });
  assert.equal((await manager.readRun(1, result.runId, 1)).terminal, true);
  assert.deepEqual(cursors, [1, 0], "Recovery reads the terminal summary even when the caller has consumed its event");
  const restored = launches.musicLaunch(1, result.runId);
  assert.equal(restored.collection_state, "failed");
  assert.equal(restored.summary, "Music worker failed before startup.");
  assert.equal(runs.getActiveRuntimeRun(session.id), null);
  const message = turns.findExternalAgentAssistantMessage({ conversationId: conversation.id, runId: result.runId });
  assert.equal(message.content, restored.summary);
  assert.equal(JSON.parse(message.metadata).externalAgentOutcome, "failed");
});
