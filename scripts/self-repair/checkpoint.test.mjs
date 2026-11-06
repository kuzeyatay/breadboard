import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initializeSourceRepair, readSourceRepair, updateSourceRepair } from "../../desktop/src/shared/source-repair.ts";
const directory = fs.mkdtempSync(path.resolve(".tmp/source-repair-tests/task-"));
process.env.BREADBOARD_DATA_DIR = directory;
process.env.BREADBOARD_GOAL_HOME = path.join(directory, "goals");
process.env.BREADBOARD_SOURCE_REPAIR_READY = "1";
initializeSourceRepair(directory, process.cwd(), true);
const { default: db } = await import("../../dashboard/src/lib/db.ts");
const { createConversation, reserveConversationTurn, failAssistantMessage, completeAssistantMessage } = await import("../../dashboard/src/lib/conversations/store.ts");
const { createRuntimeSession } = await import("../../dashboard/src/lib/hermes/runtime-store.ts");
const { beginRuntimeRun, finishRuntimeRun, getRuntimeRun, parseRuntimeRunDispatch } = await import("../../dashboard/src/lib/hermes/run-store.ts");
const { recordTaskRecoveryOutcome, cancelTaskRecovery, continueTaskRecovery, taskRecoveryForContinuation } = await import("../../dashboard/src/lib/hermes/task-recovery.ts");
const { releaseRepairCheckpoint, repairTaskStillCurrent } = await import("../../dashboard/src/lib/source-repair/checkpoint.ts");
const { taskRecoveryCheckpoint } = await import("../../dashboard/src/lib/hermes/task-recovery-policy.ts");
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'test','repair@example.test','x')").run();
test.after(() => db.close());
function setup() {
  const conversation = createConversation({ userId: 1, surface: "dashboard_terminal" });
  const data = path.join(directory, `repair-${conversation.id}`);
  process.env.BREADBOARD_DATA_DIR = data;
  initializeSourceRepair(data, process.cwd(), true);
  const session = createRuntimeSession({ conversationId: conversation.id, surface: conversation.surface, userId: 1, chatSessionId: null,
    agentName: "breadboard-assistant", clusterId: null, gardenId: null, pageSlug: null, workspaceKey: conversation.public_id,
    activeDirectory: directory, filesystemMode: "restricted" });
  const clientMessageId = `repair-input-${conversation.id}`;
  reserveConversationTurn({ conversation, clientMessageId, surface: conversation.surface, content: "Create the verified PDF" });
  const failure = { code: "render_failed", message: "Zero became ten" };
  const checkpoint = taskRecoveryCheckpoint({ status: "failed", failure, tools: [], turn: 1 }).checkpoint;
  const run = beginRuntimeRun({ runtimeSessionId: session.id, instruction: "Create the verified PDF", dispatch: { clientMessageId,
    modelIdentity: { modelID: "chosen-model" }, taskRecovery: { request: "Create the verified PDF", rootClientMessageId: clientMessageId,
      turn: 2, checkpoint: { ...checkpoint, repeated: 2 } } } });
  failAssistantMessage({ conversationId: conversation.id, clientMessageId, status: "failed", error: failure.message });
  const state = recordTaskRecoveryOutcome({ runId: run.id, status: "failed", failure, tools: [] }); finishRuntimeRun(run.id, "error");
  const request = readSourceRepair(data, state.sourceRepairId);
  return { conversation, session, run, state, request, data };
}

test("repeated failure queues one repair, resumes saved task once and commits verified success", async () => {
  const f = setup(); assert.equal(f.state.stopped, "awaiting_source_repair"); assert.equal(f.request.model, "chosen-model");
  assert.equal(repairTaskStillCurrent(f.request), true);
  updateSourceRepair(f.data, f.request.id, { stage: "probation" });
  assert.equal(releaseRepairCheckpoint(f.request, true), f.run.id);
  assert.equal(releaseRepairCheckpoint(f.request, true), null);
  let calls = 0;
  await continueTaskRecovery(f.conversation.id, f.run.id, async input => {
    calls++;
    reserveConversationTurn({ conversation: f.conversation, clientMessageId: input.clientMessageId, surface: f.conversation.surface,
      content: input.text, metadata: { internalAgentContinuation: true } });
    const run = beginRuntimeRun({ runtimeSessionId: f.session.id, instruction: input.text,
      dispatch: { clientMessageId: input.clientMessageId, taskRecovery: taskRecoveryForContinuation(f.run.id) } });
    completeAssistantMessage({ conversationId: f.conversation.id, clientMessageId: input.clientMessageId, content: "Verified PDF delivered" });
    recordTaskRecoveryOutcome({ runId: run.id, status: "idle", tools: [{ toolName: "publish", success: true }] }); finishRuntimeRun(run.id, "completed");
    return { accepted: true, run };
  });
  assert.equal(calls, 1); assert.equal(readSourceRepair(f.data, f.request.id).stage, "committed");
  assert.equal(await continueTaskRecovery(f.conversation.id, f.run.id, () => { throw new Error("duplicate"); }), false);
});

test("Stop cancels the source repair and prevents saved-task replay", () => {
  const f = setup(); cancelTaskRecovery(f.conversation.id);
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "cancelled");
  assert.equal(releaseRepairCheckpoint(f.request, true), null);
});

test("new human input supersedes a queued source repair", () => {
  const f = setup(); reserveConversationTurn({ conversation: f.conversation, clientMessageId: "new-human", surface: f.conversation.surface, content: "Different task" });
  assert.equal(repairTaskStillCurrent(f.request), false); assert.equal(releaseRepairCheckpoint(f.request, true), null);
});

for (const denial of [false, true]) test(`failed replay requests rollback and ${denial ? 'respects denial' : 'resumes once on the previous release'}`, async () => {
  const f = setup(); updateSourceRepair(f.data, f.request.id, { stage: "probation" }); releaseRepairCheckpoint(f.request, true);
  let child;
  await continueTaskRecovery(f.conversation.id, f.run.id, async input => {
    reserveConversationTurn({ conversation: f.conversation, clientMessageId: input.clientMessageId, surface: f.conversation.surface,
      content: input.text, metadata: { internalAgentContinuation: true } });
    child = beginRuntimeRun({ runtimeSessionId: f.session.id, instruction: input.text,
      dispatch: { clientMessageId: input.clientMessageId, taskRecovery: taskRecoveryForContinuation(f.run.id) } });
    failAssistantMessage({ conversationId: f.conversation.id, clientMessageId: input.clientMessageId, status: "failed", error: "Replay failed" });
    recordTaskRecoveryOutcome({ runId: child.id, status: "failed", failure: { code: denial ? "permission_denied" : "render_failed" }, tools: [] });
    finishRuntimeRun(child.id, "error"); return { accepted: true, run: child };
  });
  let request = readSourceRepair(f.data, f.request.id); assert.equal(request.stage, "rollback_requested");
  assert.equal(parseRuntimeRunDispatch(getRuntimeRun(child.id)).taskRecovery.pending, false);
  request = updateSourceRepair(f.data, f.request.id, { stage: "rolled_back" });
  assert.equal(releaseRepairCheckpoint(request, false), denial ? null : child.id);
  assert.equal(releaseRepairCheckpoint(request, false), null);
});

for (const attempt of [1, 2]) test(`persistent defect after rollback ${attempt === 1 ? 'uses the remaining repair attempt' : 'respects the two-candidate bound'}`, async () => {
  const f = setup();
  const request = updateSourceRepair(f.data, f.request.id, { stage: "rolled_back", attempt, jobId: "old-job", reason: "Candidate startup failed" });
  assert.equal(releaseRepairCheckpoint(request, false), f.run.id);
  let previous = f.run;
  for (let index = 0; index < 3; index++) {
    const readyAt = parseRuntimeRunDispatch(getRuntimeRun(previous.id)).taskRecovery.checkpoint.notBefore;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, readyAt - Date.now()) + 5));
    await continueTaskRecovery(f.conversation.id, previous.id, async input => {
      reserveConversationTurn({ conversation: f.conversation, clientMessageId: input.clientMessageId, surface: f.conversation.surface,
        content: input.text, metadata: { internalAgentContinuation: true } });
      const child = beginRuntimeRun({ runtimeSessionId: f.session.id, instruction: input.text,
        dispatch: { clientMessageId: input.clientMessageId, taskRecovery: taskRecoveryForContinuation(previous.id) } });
      failAssistantMessage({ conversationId: f.conversation.id, clientMessageId: input.clientMessageId, status: "failed", error: "Zero became ten" });
      recordTaskRecoveryOutcome({ runId: child.id, status: "failed", failure: { code: "render_failed", message: "Zero became ten" }, tools: [] });
      finishRuntimeRun(child.id, "error");previous=child;return { accepted:true, run:child };
    });
  }
  const retried=readSourceRepair(f.data,f.request.id);
  assert.equal(retried.stage, attempt === 1 ? "queued" : "blocked");
  assert.equal(retried.attempt,attempt,"rollback must not reset the candidate budget");
  assert.equal(retried.deadline,f.request.deadline,"rollback must not extend the deadline");
  if(attempt===1){
    assert.equal(retried.sourceRunId,previous.id);
    assert.equal(retried.jobId,undefined);
    assert.equal(retried.generation,1);
    assert.equal(parseRuntimeRunDispatch(getRuntimeRun(previous.id)).taskRecovery.stopped,"awaiting_source_repair");
    assert.equal(repairTaskStillCurrent(retried),true);
  }
});
