import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const runtimePanel = source(
  "../src/app/components/openharness/agent-runtime-panel.tsx",
);
const sessionHook = source(
  "../src/app/components/openharness/use-agent-session.ts",
);
const terminal = source(
  "../src/app/components/openharness/dashboard-agent-terminal.tsx",
);
const garden = source(
  "../src/app/components/openharness/garden-agent-chat.tsx",
);
const legacyActivity = source(
  "../src/app/components/openharness/use-legacy-agent-activity.ts",
);
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const gardenAdapter = source(
  "../src/lib/openharness/garden-chat-adapter.ts",
);
const steerRoute = source(
  "../src/app/api/openharness/sessions/[sessionId]/steer/route.ts",
);
const abortRoute = source(
  "../src/app/api/openharness/sessions/[sessionId]/abort/route.ts",
);
const eventStream = source("../src/lib/openharness/event-stream.ts");
const database = source("../src/lib/db.ts");

test("the shared composer keeps its controls stable during an active run", () => {
  for (const state of [
    "idle",
    "submitting",
    "connecting",
    "running",
    "waiting_for_permission",
    "steering",
    "stopping",
    "completed",
    "cancelled",
    "error",
  ]) {
    assert.match(sessionHook, new RegExp(`"${state}"`));
  }
  assert.match(composer, /placeholder=\{placeholder\}/);
  assert.doesNotMatch(composer, /Ask for follow-up changes/);
  assert.doesNotMatch(composer, /neu-active-task-rail/);
  assert.doesNotMatch(composer, /activeInstruction/);
  assert.doesNotMatch(composer, /Run permissions are enforced/);
  assert.doesNotMatch(composer, /locked during run/);
  assert.match(composer, /aria-disabled=\{activeRun\}/);
  assert.match(composer, /activeRun && permissionPending/);
  assert.match(composer, /onQueueSteer\?\.\(text\)/);
  assert.doesNotMatch(composer, /pendingSteer|applyingSteer|steerError/);
  assert.match(composer, /headerContent/);
  assert.doesNotMatch(composer, /steerQueued/);
  assert.match(runtimePanel, /onQueueSteer=\{queueFollowUp\}/);
  assert.match(runtimePanel, /queuedFollowUps\.map/);
  assert.match(runtimePanel, /await onSteer\(item\.text\)/);
  assert.match(runtimePanel, /Steer the active response with:/);
  assert.match(runtimePanel, /Delete queued message:/);
  assert.match(runtimePanel, /Edit queued message:/);
  assert.match(runtimePanel, /onSendQueued\(next\.text\)/);
  assert.doesNotMatch(composer, /Run status:/);
  assert.doesNotMatch(sessionHook, /Course correction applied/);
  assert.doesNotMatch(sessionHook, /steerFeedback/);
  assert.match(composer, /aria-label=\{runState === 'stopping' \? 'Stopping active run' : 'Stop active run'\}/);
  assert.match(composer, /h-11 w-11/);
  assert.match(runtimePanel, /disabled=\{disabled\}/);
});

test("Dashboard terminal and Garden Chat share real steering controls", () => {
  for (const surface of [terminal, garden]) {
    assert.match(surface, /runState=\{session\.runState\}/);
    assert.doesNotMatch(surface, /activeInstruction=\{session\.activeInstruction\}/);
    assert.match(surface, /return session\.steer\(trimmed\)/);
    assert.match(surface, /onSteer=\{steer\}/);
    assert.match(surface, /onSendQueued=\{sendQueued\}/);
    assert.match(surface, /onEditMessage=\{editMessage\}/);
    assert.match(surface, /onSelectBranch=\{selectBranch\}/);
    assert.match(surface, /onAbort=\{\(\) => void session\.abort\(\)\}/);
  }
});

test("the garden workspace stays editable and steers its active OpenHarness run", () => {
  const composerStart = workspace.lastIndexOf("<AssistantComposer");
  const composerBlock = workspace.slice(composerStart, composerStart + 2_500);
  assert.ok(composerStart >= 0);
  assert.match(composerBlock, /disabled=\{loadingChats\}/);
  assert.doesNotMatch(composerBlock, /disabled=\{isStreaming \|\| loadingChats\}/);
  assert.match(composerBlock, /runState=\{/);
  assert.match(composerBlock, /onQueueSteer=\{handleSteerActiveResponse\}/);
  assert.match(composerBlock, /onStop=\{agentActivity\.abort\}/);
  assert.match(gardenAdapter, /sessionId: session\.row\.id,\s*runId,/);
  assert.match(legacyActivity, /const runtimeRunId = useRef<string \| null>\(null\)/);
  assert.match(legacyActivity, /sessions\/\$\{sessionId\}\/steer/);
  assert.match(legacyActivity, /clientRequestId: crypto\.randomUUID\(\)/);
  assert.match(workspace, /\.\.\.steerContext\.messages/);
  assert.match(workspace, /context\.messages\.push\(correctionMessage\)/);
});

test("the dashboard assistant header is labeled only as Terminal", () => {
  assert.match(terminal, />\s*Terminal\s*</);
  assert.doesNotMatch(terminal, /Breadboard Assistant|Public knowledge assistant|scopeTagline/);
});

test("steering reuses the active session and only falls back on run_not_active", () => {
  const start = sessionHook.indexOf("const steer = useCallback");
  const block = sessionHook.slice(start, start + 4_800);
  assert.ok(start >= 0);
  assert.match(block, /activeRunIdRef\.current/);
  assert.match(block, /clientRequestId = crypto\.randomUUID\(\)/);
  assert.match(block, /sessions\/\$\{activeSessionId\}\/steer/);
  assert.match(block, /response\.status === 409 && body\.code === "run_not_active"/);
  assert.match(block, /void send\(trimmed, latestSendOptionsRef\.current\)/);
  assert.doesNotMatch(block, /\/events/);
  assert.doesNotMatch(block, /ensureSession\(/);
});

test("steering maps request UUIDs to deterministic native OpenHarness message IDs", async () => {
  const messageIdUrl = new URL(
    "../src/lib/openharness/message-id.ts",
    import.meta.url,
  ).href;
  const { openHarnessMessageId } = await import(messageIdUrl);
  const first = openHarnessMessageId("2ccce7d7-32c4-47be-baf3-90d039aeec76");
  assert.match(first, /^msg_[A-Za-z0-9_-]{26}$/);
  assert.equal(
    openHarnessMessageId("2ccce7d7-32c4-47be-baf3-90d039aeec76"),
    first,
  );
  assert.notEqual(openHarnessMessageId("another-request"), first);
});

test("the steer route enforces auth, ownership, active-run validation, dedupe, and audit", () => {
  assert.match(steerRoute, /requireUserId\(\)/);
  assert.match(steerRoute, /authorizeRuntimeReference\(userId/);
  assert.match(steerRoute, /requestedRun\.runtime_session_id !== session\.row\.id/);
  assert.match(steerRoute, /"run_not_active"/);
  assert.match(steerRoute, /reserveSteerRequest/);
  assert.match(steerRoute, /client_request_conflict/);
  assert.match(steerRoute, /acceptSteerRequest/);
  assert.match(steerRoute, /eventType: stillActive \? "run\.steered" : "run\.steer_fallback"/);
  assert.match(steerRoute, /getOpenHarnessGateway\(\)\.steerRun/);
  assert.match(steerRoute, /appendConversationSteerMessage/);
  assert.match(steerRoute, /error instanceof ConversationStoreError/);
  assert.match(steerRoute, /error\.code !== "turn_not_active"/);
});

test("Stop is idempotent and cancelled output remains distinct from failure", () => {
  assert.match(abortRoute, /getActiveRuntimeRun/);
  assert.match(abortRoute, /alreadyFinished: true/);
  assert.match(abortRoute, /finishRuntimeRun\(activeRun\.id, "cancelled"\)/);
  assert.match(eventStream, /status === "aborted"\s*\? "cancelled"/);
  assert.match(eventStream, /type: event\.payload\.status === "aborted" \? "cancelled" : "done"/);
  assert.match(sessionHook, /interrupted: true/);
  assert.match(runtimePanel, />\s*Interrupted\s*</);
});

test("run and steer identities are durable in the additive database schema", () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS openharness_runs/);
  assert.match(database, /idx_openharness_runs_one_active/);
  assert.match(database, /WHERE status = 'active'/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS openharness_steer_requests/);
  assert.match(database, /UNIQUE\(runtime_session_id, client_request_id\)/);
});

test("the durable steer store accepts a client request exactly once", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-steer-"));
  try {
    const dbUrl = new URL("../src/lib/db.ts", import.meta.url).href;
    const storeUrl = new URL("../src/lib/openharness/run-store.ts", import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      const db = (await import(${JSON.stringify(dbUrl)})).default;
      const store = await import(${JSON.stringify(storeUrl)});
      const inserted = db.prepare(
        "INSERT INTO openharness_runtime_sessions (surface, agent_name, workspace_key) VALUES (?, ?, ?)",
      ).run("dashboard_terminal", "breadboard-terminal", "terminal/test");
      const sessionId = Number(inserted.lastInsertRowid);
      const run = store.beginRuntimeRun({
        runtimeSessionId: sessionId,
        instruction: "Initial task",
        dispatch: { variant: "high" },
      });
      assert.equal(store.getActiveRuntimeRun(sessionId).id, run.id);
      const first = store.reserveSteerRequest({
        runtimeSessionId: sessionId,
        runId: run.id,
        clientRequestId: "request-1",
        content: "Change direction",
      });
      const duplicate = store.reserveSteerRequest({
        runtimeSessionId: sessionId,
        runId: run.id,
        clientRequestId: "request-1",
        content: "Change direction",
      });
      assert.equal(first.created, true);
      assert.equal(duplicate.created, false);
      assert.equal(store.acceptSteerRequest({
        requestId: first.request.id,
        runtimeSessionId: sessionId,
        chatSessionId: null,
        content: "Change direction",
        resultRunId: run.id,
        resultMode: "steer",
      }), true);
      assert.equal(store.acceptSteerRequest({
        requestId: first.request.id,
        runtimeSessionId: sessionId,
        chatSessionId: null,
        content: "Change direction",
        resultRunId: run.id,
        resultMode: "steer",
      }), false);
      const visible = db.prepare(
        "SELECT count(*) AS count FROM openharness_messages WHERE runtime_session_id = ? AND role = 'user'",
      ).get(sessionId);
      assert.equal(visible.count, 1);
      assert.equal(store.finishRuntimeRun(run.id, "completed"), true);
      assert.equal(store.finishRuntimeRun(run.id, "cancelled"), false);
    `;
    const child = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
