import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
// `server-only` is a Next-provided alias; plain Node cannot resolve it.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier === "next/server") return next("next/server.js", context);
    const candidate = specifier.startsWith("@/")
      ? new URL(`../src/${specifier.slice(2)}${path.extname(specifier) ? "" : ".ts"}`, import.meta.url)
      : /^\.{1,2}\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")
        ? new URL(`${specifier}.ts`, context.parentURL) : null;
    if (candidate && fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    return next(specifier, context);
  },
});
const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp-chat-coordination-continuation-"));
process.env.BREADBOARD_DATA_DIR = directory;
const { default: db } = await import("../src/lib/db.ts");
const { createConversation, reserveConversationTurn, completeAssistantMessage, failAssistantMessage } = await import("../src/lib/conversations/store.ts");
const { createRuntimeSession } = await import("../src/lib/hermes/runtime-store.ts");
const { beginRuntimeRun, finishRuntimeRun } = await import("../src/lib/hermes/run-store.ts");
const { activateGoalMode, setGoalModeStatus } = await import("../src/lib/goal-mode.ts");
const { goalContinuationCurrent } = await import("../src/lib/goal-continuation.ts");
const { taskRecoveryCurrent, recordTaskRecoveryOutcome } = await import("../src/lib/hermes/task-recovery.ts");
test.after(async () => {
  await import("../src/lib/hooks/chat-completed.ts");
  await new Promise(resolve => setImmediate(resolve));
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'test','peer-continuation@example.invalid','x')").run();

function setup(goalMode) {
  const conversation = createConversation({ userId: 1 });
  const session = createRuntimeSession({ conversationId: conversation.id, surface: "dashboard_terminal", userId: 1,
    chatSessionId: null, agentName: "breadboard-assistant", clusterId: null, gardenId: null, pageSlug: null,
    workspaceKey: conversation.public_id, activeDirectory: directory, filesystemMode: "restricted" });
  const clientMessageId = "original-human-request";
  reserveConversationTurn({ conversation, clientMessageId, surface: conversation.surface, content: "Finish the requested work." });
  const goal = goalMode ? activateGoalMode({ conversationPublicId: conversation.public_id, objective: "Finish the requested work" }) : null;
  const run = beginRuntimeRun({ runtimeSessionId: session.id, instruction: "Finish the requested work", dispatch: { clientMessageId,
    ...(goal ? { goalMode: { enabled: true, goalId: goal.goal_id } } : {
      taskRecovery: { request: "Finish the requested work", rootClientMessageId: clientMessageId, turn: 0 },
    }),
  } });
  if (goal) completeAssistantMessage({ conversationId: conversation.id, clientMessageId, content: "Progress saved." });
  else {
    failAssistantMessage({ conversationId: conversation.id, clientMessageId, status: "failed", error: "required_artifact_missing" });
    recordTaskRecoveryOutcome({ runId: run.id, status: "failed", tools: [], failure: { code: "required_artifact_missing", message: "Output is still missing." } });
  }
  finishRuntimeRun(run.id, goal ? "completed" : "error");
  const check = () => goal ? goalContinuationCurrent(conversation.id, run.id, goal.goal_id) : taskRecoveryCurrent(conversation.id, run.id);
  const peerId = "chat-message:peer-request";
  reserveConversationTurn({ conversation, clientMessageId: peerId, surface: conversation.surface, content: "Peer question",
    metadata: { chatCoordination: { messageId: "peer-request", sourceChatId: "another-chat" } } });
  const peer = beginRuntimeRun({ runtimeSessionId: session.id, instruction: "Peer question", dispatch: { clientMessageId: peerId } });
  const finishPeer = () => {
    completeAssistantMessage({ conversationId: conversation.id, clientMessageId: peerId, content: "Peer answer" });
    finishRuntimeRun(peer.id, "completed");
  };
  return { conversation, session, goal, check, finishPeer };
}

test("a peer turn yields back to the existing goal, while pause and newer human work still win", () => {
  const state = setup(true);
  assert.equal(state.check(), false);
  state.finishPeer();
  assert.equal(state.check(), true);
  setGoalModeStatus({ conversationPublicId: state.conversation.public_id, status: "paused" });
  assert.equal(state.check(), false);
  setGoalModeStatus({ conversationPublicId: state.conversation.public_id, status: "active" });
  assert.equal(state.check(), true);
  beginRuntimeRun({ runtimeSessionId: state.session.id, instruction: "New human task", dispatch: { clientMessageId: "new-human-task" } });
  assert.equal(state.check(), false);
});

test("a peer answer preserves pending task recovery but a newer human message supersedes it", () => {
  const state = setup(false);
  assert.equal(state.check(), false);
  state.finishPeer();
  assert.equal(state.check(), true);
  reserveConversationTurn({ conversation: state.conversation, clientMessageId: "new-human-task", surface: state.conversation.surface, content: "Do something else" });
  completeAssistantMessage({ conversationId: state.conversation.id, clientMessageId: "new-human-task", content: "Understood" });
  assert.equal(state.check(), false);
});
