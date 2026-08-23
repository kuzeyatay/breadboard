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
const queuedFollowUpsModule = source(
  "../src/app/components/hermes/queued-follow-ups.tsx",
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
    /const sessionActionsDisabled = disabled \|\| stopping/,
  );
  assert.match(
    composer,
    /queueHeld &&\s*!queueDisabled &&\s*Boolean\(value\.trim\(\)\)/,
  );
  const textarea = composer.slice(
    composer.indexOf("<textarea"),
    composer.indexOf("<textarea") + 2_000,
  );
  assert.ok(composer.indexOf("<textarea") >= 0);
  assert.doesNotMatch(textarea, /disabled=\{/);
  // Nothing can be sent without something to send. `canSend` is `canSubmit` for
  // every agent that takes a message, and the request's validity for the one
  // that takes a form instead.
  assert.match(composer, /queueHeld\s*\? !canQueueFollowUp\s*:\s*disabled \|\| isSending/);
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
  assert.match(runtimePanel, /headerContent=\{queuedFollowUpsHeader\}/);
  // The queue itself is shared: every chat surface renders the same list with
  // the same edit, reorder, steer, and delete affordances.
  assert.match(queuedFollowUpsModule, /visibleQueued\.map/);
  assert.match(queuedFollowUpsModule, /await onSteer\(item\.text\)/);
  assert.match(queuedFollowUpsModule, /Steer the active response with:/);
  assert.match(queuedFollowUpsModule, /Delete queued message:/);
  assert.match(queuedFollowUpsModule, /Edit queued message:/);
  assert.match(queuedFollowUpsModule, /onRestoreDraft\(item\.text\)/);
  assert.match(queuedFollowUpsModule, /textarea\.focus\(\)/);
  assert.match(
    queuedFollowUpsModule,
    /textarea\.setSelectionRange\(text\.length, text\.length\)/,
  );
  assert.doesNotMatch(queuedFollowUpsModule, /editingQueuedId|queuedEditText/);
  assert.match(queuedFollowUpsModule, /\sdraggable\s/);
  assert.match(queuedFollowUpsModule, /Drag to change steering order/);
  assert.match(queuedFollowUpsModule, /event\.key === "ArrowUp"/);
  assert.match(queuedFollowUpsModule, /event\.key === "ArrowDown"/);
  assert.match(queuedFollowUpsModule, /reorderQueuedFollowUps\(current, draggedQueuedId, targetId\)/);
  assert.match(queuedFollowUpsModule, /onSendQueued\(next\.text\)/);
  assert.doesNotMatch(composer, /Run status:/);
  assert.doesNotMatch(sessionHook, /Course correction applied/);
  assert.doesNotMatch(sessionHook, /steerFeedback/);
  assert.match(
    composer,
    /const stopping = runState === 'stopping' \|\| stopPending/,
  );
  assert.match(
    composer,
    /aria-label=\{stopping \? 'Stopping active run' : 'Stop active run'\}/,
  );
  assert.match(composer, /aria-busy=\{stopping\}/);
  assert.match(composer, /h-11 w-11/);
  assert.match(runtimePanel, /disabled=\{conversationLocked\}/);
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
  // A delegation occupies the conversation for far longer than its run row
  // exists, so the panel counts it alongside the runs it can actually see.
  assert.match(
    runtimePanel,
    /externalRunLaunching \|\|\s*delegationInFlight \|\|\s*messages\.some\(externalAgentRunInFlight\)/,
  );
  assert.match(runtimePanel, /!\(runInFlight && index === lastAssistantIndex\)/);
  assert.match(
    queuedFollowUpsModule,
    /if \(runInFlight \|\| applyingSteerId \|\| sendingQueuedId\) return/,
  );
  assert.match(runtimePanel, /externalRunActive=\{externalRunActive\}/);
  // The dispatch window, before the launched turn reaches the transcript.
  for (const surface of [terminal, garden]) {
    assert.match(surface, /const externalRunLaunching =/);
  }
  assert.match(garden, /externalRunLaunching=\{externalRunLaunching\}/);
  assert.match(
    terminal,
    /externalRunLaunching \|\| delegationInFlight/,
  );
  // Steering stays a chat-turn affordance: an agent card owns its own run, so
  // the queued message waits for it rather than trying to redirect it.
  assert.match(
    queuedFollowUpsModule,
    /Boolean\(onSteer\) && steerableRunActive && !stopping/,
  );
  assert.match(runtimePanel, /steerableRunActive: activeRun/);
  assert.match(runtimePanel, /stopping: runState === "stopping"/);
  // Stopping, though, is not a chat-turn affordance. A run card can be
  // suppressed (a quiet run) or never arrive, and then nothing on screen could
  // stop a working conversation — so the composer's square covers both.
  assert.match(composer, /runInFlight && onStop && !canQueueFollowUp \? \(/);
  assert.match(
    runtimePanel,
    /onStop=\{canStop && !respondingToInlineSelection \? stopEverything : undefined\}/,
  );
  // An "Ask here" turn is the exception: it never enters the transcript, so the
  // composer's square would be stopping something it is not showing. That run
  // is stopped from the popover it belongs to.
  assert.match(runtimePanel, /onStop=\{openThread\.pending \? stopInlineAnswer : undefined\}/);
  assert.match(runtimePanel, /stopPending=\{stopRequestPending\}/);
  assert.match(runtimePanel, /if \(stopRequestPendingRef\.current\) return/);
  assert.match(runtimePanel, /stopRequestPendingRef\.current = true/);
  assert.match(runtimePanel, /setStopRequestPending\(true\)/);
  assert.match(
    runtimePanel,
    /stopRequestPendingRef\.current = false;[\s\S]*?setStopRequestPending\(false\);[\s\S]*?\}, \[sessionId\]\)/,
  );
  assert.match(runtimePanel, /if \(activeRun\) onAbort\(\)/);
  assert.match(runtimePanel, /onStopRequested\?\.\([\s\S]*?externalStops\.flatMap/);
  // The cancellations themselves, wherever the loop lives. It was extracted
  // into `abortExternalRuns` so a stop asked for during the dispatch window can
  // send exactly the same requests once the run registers.
  assert.match(runtimePanel, /stops\.map\(async \(\{ url, clientMessageId \}\)/);
  assert.match(runtimePanel, /const abortExternalRuns = useCallback\(/);
  assert.match(runtimePanel, /externalAgentAbortUrls\(\[message\]\)/);
  assert.match(runtimePanel, /deepResearchAbortTerminalResult\(payload\)/);
  assert.match(
    runtimePanel,
    /onExternalAgentTerminal\?\.\(clientMessageId, terminal\)/,
  );
  // Stop is offered from the moment a run is asked for, including the seconds
  // a long research launch spends dispatching. The square used to be withheld
  // there on the grounds that it could cancel nothing yet; in practice someone
  // who has decided to stop wants to say so once rather than watch for a button
  // to appear, so the request is now held and spent when the run registers.
  assert.match(
    runtimePanel,
    /const canStop = activeRun \|\| externalStops\.length > 0 \|\| externalRunActive/,
  );
  assert.match(runtimePanel, /awaitingStopRef\.current = true;/);
  // A stop is the end of an awaited delegation, not a signal to send the
  // worker's terminal snapshot back through Hermes as another hidden turn.
  assert.match(terminal, /const handleStopRequested = useCallback/);
  assert.match(
    terminal,
    /continuedDelegatedTurnsRef\.current\.add\(clientMessageId\)/,
  );
  assert.match(terminal, /setPendingLaunchContinuation\(null\)/);
  assert.match(terminal, /onStopRequested=\{handleStopRequested\}/);
  assert.match(terminal, /message\.externalAgentOutcome === "aborted"/);
  assert.match(terminal, /result\.outcome === "aborted"/);
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
  // A mid-run message queues — it is never fired directly at a run that may
  // not exist (an external agent run has no steerable Hermes turn behind it).
  assert.match(composerBlock, /onQueueSteer=\{queueFollowUp\}/);
  assert.match(composerBlock, /headerContent=\{queuedFollowUpsHeader\}/);
  // Stop aborts only a Hermes turn. While only an external agent is working,
  // withholding onStop keeps the send button, which queues — its card carries
  // the run's own stop control.
  assert.match(
    composerBlock,
    /onStop=\{steerableTurnActive \? agentActivity\.abort : undefined\}/,
  );
  assert.match(composerBlock, /externalRunActive=\{externalRunHoldsQueue\}/);
  // Everything that occupies the conversation — a running agent card, a queued
  // or in-flight launch — holds the queue rather than dropping the message.
  assert.match(
    workspace,
    /const externalRunHoldsQueue =\s*hasRunningExternalAgentInActiveChat \|\|\s*delegationInFlight \|\|\s*launchingExternalAgent !== null/,
  );
  assert.match(workspace, /onSteer: steerActiveResponse/);
  assert.match(gardenAdapter, /sessionId: session\.row\.id,\s*runId,/);
  assert.match(legacyActivity, /const runtimeRunId = useRef<string \| null>\(null\)/);
  assert.match(legacyActivity, /sessions\/\$\{sessionId\}\/steer/);
  assert.match(legacyActivity, /clientRequestId: crypto\.randomUUID\(\)/);
  assert.match(workspace, /\.\.\.steerContext\.messages/);
  assert.match(workspace, /context\.messages\.push\(correctionMessage\)/);
});

test("the garden assistant and knowledge terminal queue and steer like the terminals", () => {
  const gardenAssistant = source("../src/app/garden/garden-assistant.tsx");
  const knowledgeTerminal = source(
    "../src/app/components/knowledge-terminal.tsx",
  );
  for (const surface of [gardenAssistant, knowledgeTerminal]) {
    assert.match(surface, /useQueuedFollowUps\(\{/);
    assert.match(surface, /onQueueSteer=\{queueFollowUp\}/);
    assert.match(surface, /headerContent=\{queuedFollowUpsHeader\}/);
    assert.match(surface, /runState=\{/);
    assert.match(surface, /onStop=\{/);
  }
  // The garden assistant runs on the legacy Hermes transport, so its queued
  // messages can steer the streaming turn and the correction joins the
  // transcript the same way the workspace's does.
  assert.match(gardenAssistant, /onSteer: steerActiveResponse/);
  assert.match(gardenAssistant, /agentActivity\.steer\(correction\)/);
  assert.match(gardenAssistant, /context\.messages\.push\(correctionMessage\)/);
  assert.match(gardenAssistant, /\.\.\.steerContext\.messages/);
  // The knowledge terminal has no runtime session behind it: queued messages
  // wait their turn, and its stop control aborts the in-flight request.
  assert.match(knowledgeTerminal, /steerableRunActive: false/);
  assert.match(knowledgeTerminal, /streamControllerRef\.current\?\.abort\(\)/);
  assert.match(knowledgeTerminal, /signal: controller\.signal/);
  // Enter must reach the shared composer handler, whose busy branch queues; a
  // surface-level Enter handler would send into a guard that drops the turn.
  assert.doesNotMatch(knowledgeTerminal, /onKeyDown=\{handleInputKeyDown\}/);
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
  const inlineError = runtimePanel.search(
    /\{failureInline &&\s*index === lastAssistantIndex &&/,
  );
  assert.ok(inlineError > stateRow);
  const inlineBlock = runtimePanel.slice(inlineError, inlineError + 700);
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
  assert.match(
    fallbackBlock,
    /label=\{messages\.length === 0 \? "Couldn’t run that turn" : "Interrupted"\}/,
  );
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

test("message dispatch retries the same turn across a local dashboard restart", () => {
  assert.match(sessionHook, /AGENT_MESSAGE_DISPATCH_ATTEMPTS/);
  assert.match(sessionHook, /async function dispatchAgentMessage/);
  assert.match(sessionHook, /signal: AbortSignal\.timeout\(policy\.timeoutMs\)/);
  assert.match(sessionHook, /retry: payload\.retry === true \|\| attempt > 0/);
  assert.match(sessionHook, /await dispatchAgentMessage\(/);
  assert.doesNotMatch(sessionHook, /setError\(\s*["']Failed to fetch/);
});

test("send and stop use one stable responsive button shell", () => {
  const sendLabel = composer.indexOf("'Queue until the conversation is ready'");
  assert.ok(sendLabel >= 0);
  const sendButton = composer.slice(sendLabel - 2_000, sendLabel + 500);
  const stopButton = composer.slice(
    composer.indexOf("aria-label={stopping") - 1_000,
    composer.indexOf("aria-label={stopping") + 500,
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
