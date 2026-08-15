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
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const sessionHook = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const terminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const garden = source(
  "../src/app/components/hermes/garden-agent-chat.tsx",
);
const legacyActivity = source(
  "../src/app/components/hermes/use-legacy-agent-activity.ts",
);
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const gardenAdapter = source(
  "../src/lib/hermes/garden-chat-adapter.ts",
);
const steerRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/steer/route.ts",
);
const abortRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/abort/route.ts",
);
const eventStream = source("../src/lib/hermes/event-stream.ts");
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
  assert.doesNotMatch(composer, /aria-disabled=\{activeRun\}/);
  assert.match(
    composer,
    /const sessionActionsDisabled = disabled \|\| runState === 'stopping'/,
  );
  assert.match(composer, /runInFlight &&\s*!disabled &&\s*canSubmit/);
  const textarea = composer.slice(
    composer.indexOf("<textarea"),
    composer.indexOf("<textarea") + 2_000,
  );
  assert.ok(composer.indexOf("<textarea") >= 0);
  assert.doesNotMatch(textarea, /disabled=\{/);
  // Nothing can be sent without something to send. `canSend` is `canSubmit` for
  // every agent that takes a message, and the request's validity for the one
  // that takes a form instead.
  assert.match(composer, /disabled=\{!canSend \|\| isSending \|\| disabled/);
  // Two agents take a form instead of a message — Trading Agent and Shorts —
  // so the rule is written once, against whichever of them is selected.
  assert.match(composer, /const canSend = formAgent \? formRequestReady : canSubmit/);
  assert.match(
    composer,
    /const formAgent = tradingAgentsAgent \?\? shortsAgent \?\? formsmithAgent \?\? paperTraderSelection \?\? null/,
  );
  assert.match(composer, /Boolean\(tradingAgentsRequest\)/);
  assert.match(composer, /Boolean\(shortsRequest\)/);
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
  assert.match(runtimePanel, /draggable=\{editingQueuedId !== item\.id\}/);
  assert.match(runtimePanel, /Drag to change steering order/);
  assert.match(runtimePanel, /event\.key === "ArrowUp"/);
  assert.match(runtimePanel, /event\.key === "ArrowDown"/);
  assert.match(runtimePanel, /reorderQueuedFollowUps\(current, draggedQueuedId, targetId\)/);
  assert.match(runtimePanel, /onSendQueued\(next\.text\)/);
  assert.doesNotMatch(composer, /Run status:/);
  assert.doesNotMatch(sessionHook, /Course correction applied/);
  assert.doesNotMatch(sessionHook, /steerFeedback/);
  assert.match(composer, /aria-label=\{runState === 'stopping' \? 'Stopping active run' : 'Stop active run'\}/);
  assert.match(composer, /h-11 w-11/);
  assert.match(runtimePanel, /disabled=\{disabled\}/);
});

test("a working external agent holds the composer and the queue", () => {
  // External agents run outside the Hermes run-state machine: their inline card
  // polls the run while runState stays "idle". Watching runState alone let the
  // next message overtake a working agent instead of queueing behind it.
  // One list pairs each per-kind message field with its run kind, so a message
  // can be read both ways: is this a run card, and where is that run stopped.
  for (const [run, kind] of [
    ["browserRun", "agent_tars"],
    ["agentBrowserRun", "agent_browser"],
    ["agentReachRun", "agent_reach"],
    ["deepResearchRun", "deep_research"],
    ["openPlanterRun", "openplanter"],
    ["socialsManagerRun", "socials_manager"],
    ["hardwareBlueprintRun", "hardware_blueprint"],
    ["openCodeRun", "opencode"],
    ["codexRun", "codex"],
    ["rufloRun", "ruflo"],
    ["videoUseRun", "video_use"],
  ]) {
    assert.match(sessionHook, new RegExp(`\\["${run}", "${kind}"\\]`));
  }
  assert.match(sessionHook, /export function externalAgentRunInFlight/);
  assert.match(sessionHook, /externalAgentOutcome \?\? "running"\) === "running"/);
  assert.match(
    runtimePanel,
    /externalRunLaunching \|\| messages\.some\(externalAgentRunInFlight\)/,
  );
  assert.match(runtimePanel, /!\(runInFlight && index === lastAssistantIndex\)/);
  assert.match(runtimePanel, /queuedFollowUps\.length === 0 \|\|\s*runInFlight \|\|/);
  assert.match(runtimePanel, /externalRunActive=\{externalRunActive\}/);
  // The dispatch window, before the launched turn reaches the transcript.
  for (const surface of [terminal, garden]) {
    assert.match(surface, /const externalRunLaunching =/);
  }
  assert.match(garden, /externalRunLaunching=\{externalRunLaunching\}/);
  assert.match(
    terminal,
    /externalRunLaunching \|\| agentLaunchQueue\.queued/,
  );
  // Steering stays a chat-turn affordance: an agent card owns its own run, so
  // the queued message waits for it rather than trying to redirect it.
  assert.match(runtimePanel, /!activeRun \|\|\s*runState === "stopping"/);
  // Stopping, though, is not a chat-turn affordance. A run card can be
  // suppressed (a quiet run) or never arrive, and then nothing on screen could
  // stop a working conversation — so the composer's square covers both.
  assert.match(composer, /runInFlight && onStop \? \(/);
  assert.match(runtimePanel, /onStop=\{canStop \? stopEverything : undefined\}/);
  assert.match(runtimePanel, /if \(activeRun\) onAbort\(\)/);
  assert.match(runtimePanel, /for \(const url of externalStops\)/);
  assert.match(runtimePanel, /externalAgentAbortUrls\(messages\)/);
  // Nothing to stop during the dispatch window, so the composer keeps its send
  // button and the draft queues rather than meeting a square that does nothing.
  assert.match(
    runtimePanel,
    /const canStop = activeRun \|\| externalStops\.length > 0/,
  );
  // Every kind reaches a real endpoint, so the square is never a dead control.
  const kinds = source("../src/lib/conversations/external-agent-runs.ts");
  const slugs = kinds.slice(
    kinds.indexOf("const EXTERNAL_AGENT_API_SLUG_BY_KIND"),
    kinds.indexOf("export function externalAgentAbortUrl"),
  );
  for (const kind of kinds
    .slice(
      kinds.indexOf("export const EXTERNAL_AGENT_RUN_KINDS"),
      kinds.indexOf("] as const;"),
    )
    .matchAll(/"([a-z_]+)"/g)) {
    assert.match(slugs, new RegExp(`\\b${kind[1]}:`), kind[1]);
  }
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

test("the garden workspace stays editable and steers its active Hermes run", () => {
  const composerStart = workspace.lastIndexOf("<AssistantComposer");
  const composerBlock = workspace.slice(composerStart, composerStart + 2_500);
  assert.ok(composerStart >= 0);
  assert.match(composerBlock, /disabled=\{loadingChats\}/);
  assert.doesNotMatch(composerBlock, /disabled=\{isStreaming \|\| loadingChats\}/);
  assert.match(composerBlock, /runState=\{/);
  assert.match(composerBlock, /onQueueSteer=\{handleSteerActiveResponse\}/);
  assert.match(composerBlock, /onStop=\{agentActivity\.abort\}/);
  assert.match(composerBlock, /externalRunActive=\{/);
  assert.match(composerBlock, /agentLaunchQueue\.queued/);
  assert.match(composerBlock, /delegatedAgentLaunching/);
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

test("steering maps request UUIDs to deterministic native Hermes message IDs", async () => {
  const messageIdUrl = new URL(
    "../src/lib/hermes/message-id.ts",
    import.meta.url,
  ).href;
  const { hermesMessageId } = await import(messageIdUrl);
  const first = hermesMessageId("2ccce7d7-32c4-47be-baf3-90d039aeec76");
  assert.match(first, /^msg_[A-Za-z0-9_-]{26}$/);
  assert.equal(
    hermesMessageId("2ccce7d7-32c4-47be-baf3-90d039aeec76"),
    first,
  );
  assert.notEqual(hermesMessageId("another-request"), first);
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
  assert.match(
    steerRoute,
    /getAgentRuntimeByKind\(session\.runtimeKind\)\.steerRun/,
  );
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
  assert.match(sessionHook, /isExpectedCancellationError/);
  assert.match(
    sessionHook,
    /case "cancelled":\s*failed = false;\s*setError\(null\)/,
  );
  assert.match(runtimePanel, /stateLabel=\{\s*responseInterrupted\s*\?\s*"Interrupted"/);
});

test("runtime problems render as recoverable in-chat errors", () => {
  // The failure renders inside the assistant message that broke. Interrupted
  // occupies its normal lifecycle row, with the error text below. Retry stays
  // in the response action row instead of being repeated as a text control.
  const stateRow = runtimePanel.search(
    /stateLabel=\{\s*responseInterrupted\s*\?\s*"Interrupted"/,
  );
  assert.ok(stateRow >= 0);
  const stateBlock = runtimePanel.slice(stateRow, stateRow + 900);
  assert.doesNotMatch(stateBlock, /stateAction=/);
  assert.doesNotMatch(stateBlock, /Try again/);
  const inlineError = runtimePanel.indexOf(
    "{failureInline && index === lastAssistantIndex ? (",
  );
  assert.ok(inlineError > stateRow);
  const inlineBlock = runtimePanel.slice(inlineError, inlineError + 300);
  assert.match(inlineBlock, /role="alert"/);
  assert.match(inlineBlock, /<ChatMarkdown content=\{failureText/);
  // Failures that cannot attach to a plain assistant message — run cards,
  // inline selection answers, turns with no assistant message yet — keep the
  // standalone notice at the end of the transcript.
  const fallback = runtimePanel.indexOf("{failureText && !failureInline ? (");
  assert.ok(fallback >= 0);
  const fallbackBlock = runtimePanel.slice(fallback, fallback + 2_000);
  assert.match(fallbackBlock, /role="alert"/);
  assert.match(fallbackBlock, /<AssistantResponseMeta/);
  assert.match(fallbackBlock, /label="Interrupted"/);
  assert.match(fallbackBlock, /action=/);
  assert.match(fallbackBlock, /aria-label="Regenerate response"/);
  assert.doesNotMatch(fallbackBlock, /Try again/);
  assert.doesNotMatch(fallbackBlock, /Response interrupted/);
  assert.doesNotMatch(fallbackBlock, /backdrop-blur|red-950/);

  const actions = runtimePanel.indexOf("<AssistantMessageActions", stateRow);
  assert.ok(actions > stateRow);
  const actionsBlock = runtimePanel.slice(actions, actions + 1_500);
  assert.match(actionsBlock, /onRetry=/);
  assert.match(actionsBlock, /\(!responseInterrupted \|\| !disabled\)/);
  assert.match(actionsBlock, /retryAssistantAsBranch\(index\)/);
});

test("a newly opened turn stream ignores stale zero-output completion events", () => {
  assert.match(eventStream, /let streamRun = getActiveRuntimeRun/);
  assert.match(eventStream, /if \(!streamRun\) continue/);
  assert.match(eventStream, /let sawTurnOutput = false/);
  assert.match(eventStream, /sawTurnOutput = sawTurnOutput \|\| event\.payload\.text\.length > 0/);
  assert.match(eventStream, /if \(!sawTurnOutput\) continue/);
  assert.match(eventStream, /event\.messageId !== assistantMessageId/);
});

test("an accepted run is reattached when its pre-dispatch viewer closes", () => {
  assert.match(sessionHook, /let streamFailedBeforeDispatch = false/);
  assert.match(
    sessionHook,
    /if \(!dispatchAccepted\) streamFailedBeforeDispatch = true/,
  );
  assert.match(
    sessionHook,
    /if \(streamFailedBeforeDispatch\)[\s\S]*setRunToResume\(\{[\s\S]*runId: responseBody\.runId/,
  );
  assert.match(sessionHook, /transition\("connecting"\)/);
});

test("an active turn reconnects after a transient event-stream network drop", () => {
  assert.match(sessionHook, /AgentStreamDisconnectedError/);
  assert.match(sessionHook, /isRecoverableAgentStreamDisconnect\(streamError\)/);
  assert.match(sessionHook, /agentStreamReconnectDelay\(reconnectAttempt\)/);
  assert.match(sessionHook, /waitForAgentStreamReconnect\(delayMs, controller\.signal\)/);
  assert.match(
    sessionHook,
    /return streamEvents\([\s\S]*reconnectAttempt \+ 1,[\s\S]*controller,[\s\S]*seenEventFrames/,
  );
  assert.match(sessionHook, /if \(seenEventFrames\.has\(dataLine\)\) continue/);
  assert.match(sessionHook, /seenEventFrames\.add\(dataLine\)/);
  assert.match(
    sessionHook,
    /failed \|\|[\s\S]*stopRequestedRef\.current \|\|[\s\S]*controller\.signal\.aborted/,
  );
});

test("send and stop use one stable responsive button shell", () => {
  const sendLabel = composer.indexOf("'Queue message' : 'Send'");
  assert.ok(sendLabel >= 0);
  const sendButton = composer.slice(sendLabel - 1_000, sendLabel + 500);
  const stopButton = composer.slice(
    composer.indexOf("aria-label={runState === 'stopping'") - 1_000,
    composer.indexOf("aria-label={runState === 'stopping'") + 500,
  );
  for (const button of [sendButton, stopButton]) {
    assert.match(button, /neu-button-accent/);
    assert.match(button, /compact \? 'h-9 w-9' : 'h-11 w-11'/);
    assert.match(button, /border-\[var\(--botanical-hover\)\]/);
  }
});

test("run and steer identities are durable in the additive database schema", () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS hermes_runs/);
  assert.match(database, /idx_hermes_runs_one_active/);
  assert.match(database, /WHERE status = 'active'/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS hermes_steer_requests/);
  assert.match(database, /UNIQUE\(runtime_session_id, client_request_id\)/);
});

test("the durable steer store accepts a client request exactly once", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-steer-"));
  try {
    const dbUrl = new URL("../src/lib/db.ts", import.meta.url).href;
    const storeUrl = new URL("../src/lib/hermes/run-store.ts", import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      const db = (await import(${JSON.stringify(dbUrl)})).default;
      const store = await import(${JSON.stringify(storeUrl)});
      const inserted = db.prepare(
        "INSERT INTO hermes_runtime_sessions (surface, agent_name, workspace_key) VALUES (?, ?, ?)",
      ).run("dashboard_terminal", "breadboard-terminal", "terminal/test");
      const sessionId = Number(inserted.lastInsertRowid);
      const run = store.beginRuntimeRun({
        runtimeSessionId: sessionId,
        instruction: "Initial task",
        dispatch: { variant: "high" },
      });
      assert.equal(store.getActiveRuntimeRun(sessionId).id, run.id);
      assert.equal(store.parseRuntimeRunDispatch(run).submittedAt, undefined);
      assert.equal(store.markRuntimeRunSubmitted(run.id), true);
      assert.match(
        store.parseRuntimeRunDispatch(store.getRuntimeRun(run.id)).submittedAt,
        /^\\d{4}-\\d{2}-\\d{2}T/,
      );
      assert.equal(store.markRuntimeRunSubmitted(run.id), false);
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
        "SELECT count(*) AS count FROM hermes_messages WHERE runtime_session_id = ? AND role = 'user'",
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
