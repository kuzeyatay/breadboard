import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-external-agent-history-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const runs = await import("../src/lib/conversations/external-agent-runs.ts");
const branches = await import("../src/lib/conversations/branch-history.ts");
const titles = await import("../src/lib/conversations/title-service.ts");
const presentation = await import("../src/lib/hermes/session-presentation.ts");
const runtimeStore = await import("../src/lib/hermes/runtime-store.ts");
const runtimeRuns = await import("../src/lib/hermes/run-store.ts");
const artifacts = await import("../src/lib/hermes/artifact-store.ts");
const hardwareDesigns = await import("../src/lib/hardware/design.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM chat_sessions;
    DELETE FROM clusters;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

function conversation() {
  return store.createConversation({
    userId: 1,
    title: "Assistant conversation",
    surface: "dashboard_terminal",
  });
}

const descriptors = [
  {
    kind: "agent_tars",
    agentId: "desktop-agent",
    runId: "tars-run-1",
    task: "Summarize the latest email",
  },
  {
    kind: "agent_browser",
    agentId: "browser-agent",
    runId: "browser-run-1",
    task: "Check the release notes",
  },
  {
    kind: "deep_research",
    runId: "research-run-1",
    query: "Compare battery chemistries",
    output: "report",
  },
  {
    kind: "openplanter",
    runId: "openplanter-run-1",
    task: "Map the evidence and produce a report",
  },
  {
    kind: "codex",
    runId: "codex-run-1",
    task: "Add the repository health check with Codex",
    gardenSlug: "research",
    repository: "breadboard",
  },
  {
    kind: "opencode",
    runId: "opencode-run-1",
    task: "Add the repository health check",
    gardenSlug: "research",
    repository: "breadboard",
  },
];

test("every external agent run descriptor round-trips through canonical history metadata", () => {
  for (const [index, run] of descriptors.entries()) {
    const parsed = runs.parseExternalAgentRun(run);
    assert.deepEqual(parsed, run);
    const fields = runs.externalAgentMessageFields({
      externalAgent: true,
      externalAgentRun: run,
      externalAgentOutcome: "running",
    });
    assert.equal(fields.externalAgentOutcome, "running");
    if (run.kind === "agent_tars") assert.deepEqual(fields.browserRun, {
      agentId: run.agentId,
      runId: run.runId,
      task: run.task,
    });
    if (run.kind === "agent_browser") assert.deepEqual(fields.agentBrowserRun, {
      agentId: run.agentId,
      runId: run.runId,
      task: run.task,
    });
    if (run.kind === "deep_research") assert.deepEqual(fields.deepResearchRun, {
      runId: run.runId,
      query: run.query,
      output: run.output,
    });
    if (run.kind === "openplanter") assert.deepEqual(fields.openPlanterRun, {
      runId: run.runId,
      task: run.task,
    });
    if (run.kind === "opencode") assert.deepEqual(fields.openCodeRun, {
      runId: run.runId,
      task: run.task,
      gardenSlug: run.gardenSlug,
      repository: run.repository,
    });
    if (run.kind === "codex") assert.deepEqual(fields.codexRun, {
      runId: run.runId,
      task: run.task,
      gardenSlug: run.gardenSlug,
      repository: run.repository,
    });
    assert.equal(
      runs.parseExternalAgentRun({ ...run, kind: `unknown-${index}` }),
      null,
    );
  }
});

test("external agent launches are durable, adjacent, and idempotent", () => {
  const chat = conversation();
  const run = descriptors[0];
  const input = {
    conversation: chat,
    clientMessageId: "external-turn-0001",
    surface: "dashboard_terminal",
    userContent: "/agents:agent-tars Summarize the latest email",
    run,
    attachments: [
      {
        type: "image",
        name: "inbox.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ],
  };

  const first = turns.recordExternalAgentTurn(input);
  assert.equal(first.userMessage.status, "complete");
  assert.equal(first.assistantMessage.status, "complete");
  assert.equal(first.assistantMessage.content, "");
  assert.equal(first.assistantMessage.order_index, first.userMessage.order_index + 1);

  const stored = store.listConversationMessages(chat.id);
  assert.equal(stored.length, 2);
  assert.deepEqual(
    store.presentConversationMessage(stored[1]).metadata.externalAgentRun,
    run,
  );
  assert.equal(
    store.presentConversationMessage(stored[1]).metadata.externalAgentOutcome,
    "running",
  );
  assert.ok(
    Number.isFinite(
      Date.parse(
        store.presentConversationMessage(stored[1]).metadata.externalAgentStartedAt,
      ),
    ),
  );
  assert.deepEqual(
    store.presentConversationMessage(stored[0]).metadata.attachmentNames,
    ["inbox.png"],
  );
  assert.deepEqual(
    store.presentConversationMessage(stored[0]).metadata.attachments,
    input.attachments,
  );
  // The authenticated route performs the separate LLM title call. The sync
  // persistence primitive never fabricates a heuristic title by itself.
  assert.equal(store.getConversationById(chat.id).title, "Assistant conversation");

  const replay = turns.recordExternalAgentTurn(input);
  assert.equal(replay.userMessage.id, first.userMessage.id);
  assert.equal(replay.assistantMessage.id, first.assistantMessage.id);
  assert.equal(store.listConversationMessages(chat.id).length, 2);

  assert.throws(
    () =>
      turns.recordExternalAgentTurn({
        ...input,
        run: { ...run, runId: "different-run" },
      }),
    (error) =>
      error?.code === "client_message_id_conflict" && error?.status === 409,
  );
});

test("a downloaded Video Use source becomes a normal attachment on its user turn", () => {
  const chat = conversation();
  const run = {
    kind: "video_use",
    runId: "video-use-youtube-run-1",
    task: "Turn the linked video into a reel",
  };
  turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: "video-use-youtube-turn-1",
    surface: "dashboard_terminal",
    userContent: "https://youtu.be/T-MUZP_rtzE make this a reel",
    run,
  });

  const attachment = {
    type: "video",
    name: "Multiversal World Tree.mp4",
    blobId: `vid_${"a".repeat(32)}`,
    format: "mp4",
    sizeBytes: 12_284_975,
  };
  const attached = turns.attachVideoToExternalAgentUserTurn({
    conversationId: chat.id,
    runId: run.runId,
    attachment,
  });
  assert.ok(attached);
  assert.deepEqual(
    store.presentConversationMessage(attached).metadata.attachments,
    [attachment],
  );
  assert.deepEqual(
    store.presentConversationMessage(attached).metadata.attachmentNames,
    [attachment.name],
  );

  // The run's assistant owns the result, not the source attachment.
  const [, assistant] = store.listConversationMessages(chat.id);
  assert.equal(
    store.presentConversationMessage(assistant).metadata.attachments,
    undefined,
  );

  // Event replay and stream reconnection are idempotent.
  turns.attachVideoToExternalAgentUserTurn({
    conversationId: chat.id,
    runId: run.runId,
    attachment,
  });
  const [user] = store.listConversationMessages(chat.id);
  assert.deepEqual(
    store.presentConversationMessage(user).metadata.attachments,
    [attachment],
  );
});

test("a delegated worker keeps its Super Agent message while storing the result privately", () => {
  const chat = conversation();
  const clientMessageId = "delegated-research-origin";
  const reserved = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    content: "Which elective is safest?",
  });
  const originalAssistant = store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId,
    content: "I’m checking the official sources now.",
    metadata: { responseDurationMs: 36_000 },
  });

  const attached = turns.attachExternalAgentRun({
    conversation: store.getConversationById(chat.id),
    clientMessageId,
    run: descriptors[2],
  });
  const presented = store.presentConversationMessage(attached);

  assert.equal(attached.id, originalAssistant.id);
  assert.equal(attached.content, "I’m checking the official sources now.");
  assert.equal(presented.metadata.delegatedAgentRun, true);
  assert.equal(
    presented.metadata.delegatedAgentPreamble,
    originalAssistant.content,
  );
  assert.equal(presented.metadata.externalAgentOutcome, "running");
  assert.ok(Number.isFinite(Date.parse(presented.metadata.externalAgentStartedAt)));
  assert.deepEqual(presented.metadata.externalAgentRun, descriptors[2]);
  assert.deepEqual(
    store.listConversationMessages(chat.id).map((message) => message.id),
    [reserved.userMessage.id, originalAssistant.id],
  );

  const replay = turns.attachExternalAgentRun({
    conversation: store.getConversationById(chat.id),
    clientMessageId,
    run: descriptors[2],
  });
  assert.equal(replay.id, originalAssistant.id);
  assert.equal(
    store.presentConversationMessage(replay).metadata.externalAgentStartedAt,
    presented.metadata.externalAgentStartedAt,
  );
  assert.equal(store.listConversationMessages(chat.id).length, 2);

  const finished = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId,
    outcome: "completed",
    content: "The verified recommendation.",
  });
  assert.equal(finished.id, originalAssistant.id);
  assert.equal(finished.content, originalAssistant.content);
  const finishedFields = runs.externalAgentMessageFields(
    store.presentConversationMessage(finished).metadata,
  );
  assert.equal(finishedFields.delegatedAgentRun, true);
  assert.equal(finishedFields.delegatedAgentPreamble, originalAssistant.content);
  assert.equal(finishedFields.externalAgentResult, "The verified recommendation.");
  assert.equal(finishedFields.externalAgentName, "Deep Research");
  assert.equal(
    runs.externalAgentCardContent({ ...finishedFields, content: finished.content }),
    "The verified recommendation.",
  );
  assert.equal(
    store.presentConversationMessage(finished).metadata.externalAgentOutcome,
    "completed",
  );
  assert.ok(
    store.presentConversationMessage(finished).metadata.responseDurationMs >=
      36_000,
  );

  const lateStartReplay = turns.attachExternalAgentRun({
    conversation: store.getConversationById(chat.id),
    clientMessageId,
    run: descriptors[2],
  });
  const replayedFields = runs.externalAgentMessageFields(
    store.presentConversationMessage(lateStartReplay).metadata,
  );
  assert.equal(replayedFields.externalAgentOutcome, "completed");
  assert.equal(replayedFields.externalAgentResult, "The verified recommendation.");
});

test("a private delegated worker persists its sealed brief as a valid hidden turn", () => {
  const chat = conversation();
  const brief = "Research the hypertrophy evidence and reconcile the findings.";
  const parent = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "super-agent-parent-turn",
    surface: "dashboard_terminal",
    content: brief,
  });
  const recorded = turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: "agent-launch-private-max-research",
    surface: "dashboard_terminal",
    userContent: brief,
    run: {
      kind: "max_research",
      runId: "max-research-private-run",
      query: brief,
    },
    delegatedAgentRun: true,
    internalAgentContinuation: true,
  });

  assert.equal(recorded.userMessage.content, brief);
  const userMetadata = store.presentConversationMessage(recorded.userMessage).metadata;
  assert.equal(userMetadata.internalAgentContinuation, true);
  const assistantMetadata = store.presentConversationMessage(
    recorded.assistantMessage,
  ).metadata;
  assert.equal(assistantMetadata.delegatedAgentRun, true);
  assert.equal(assistantMetadata.externalAgentOutcome, "running");
  assert.equal(
    store.getConversationMessageById(parent.assistantMessage.id).status,
    "pending",
  );
});

test("a server-started Max Research run preserves a later Super Agent hand-off", () => {
  const chat = conversation();
  const clientMessageId = "delegated-max-research-pending-origin";
  const run = {
    kind: "max_research",
    runId: "max-research-server-started-1",
    query: "Compare the evidence for hypertrophy programming",
  };
  const reserved = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    content: run.query,
  });

  // The tool route owns Max Research and can attach it before the parent model
  // has finished writing its immediate hand-off message.
  const attached = turns.attachExternalAgentRun({
    conversation: store.getConversationById(chat.id),
    clientMessageId,
    run,
  });
  const attachedFields = runs.externalAgentMessageFields(
    store.presentConversationMessage(attached).metadata,
  );
  assert.equal(attached.status, "pending");
  assert.equal(attached.content, "");
  assert.equal(attachedFields.delegatedAgentRun, true);
  assert.equal(attachedFields.delegatedAgentPreamble, undefined);
  assert.deepEqual(attachedFields.maxResearchRun, {
    runId: run.runId,
    query: run.query,
  });

  const completed = store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId,
    content: "I’m researching this thoroughly and will return with the verified result.",
    metadata: { responseDurationMs: 1_200 },
  });
  const completedFields = runs.externalAgentMessageFields(
    store.presentConversationMessage(completed).metadata,
  );
  assert.equal(completed.status, "complete");
  assert.equal(
    completed.content,
    "I’m researching this thoroughly and will return with the verified result.",
  );
  assert.equal(completedFields.delegatedAgentRun, true);
  assert.equal(completedFields.delegatedAgentPreamble, completed.content);
  assert.equal(completedFields.externalAgentOutcome, "running");
  assert.deepEqual(completedFields.maxResearchRun, {
    runId: run.runId,
    query: run.query,
  });
  assert.deepEqual(
    store.listConversationMessages(chat.id).map((message) => message.id),
    [reserved.userMessage.id, attached.id],
  );
});

test("a delegated start failure also leaves its Super Agent hand-off intact", () => {
  const chat = conversation();
  const clientMessageId = "delegated-failed-origin";
  const reserved = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    content: "Ask the specialist to verify this.",
  });
  const originalAssistant = store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId,
    content: "I’m handing this to the specialist.",
  });

  const failed = turns.attachExternalAgentRun({
    conversation: store.getConversationById(chat.id),
    clientMessageId,
    outcome: "failed",
    assistantContent: "The specialist could not start.",
  });
  const presented = store.presentConversationMessage(failed);

  assert.equal(failed.id, originalAssistant.id);
  assert.equal(failed.content, originalAssistant.content);
  assert.equal(failed.status, "failed");
  assert.equal(presented.metadata.delegatedAgentRun, true);
  assert.equal(presented.metadata.externalAgentOutcome, "failed");
  assert.equal(presented.metadata.externalAgentRun, undefined);
  assert.equal(
    presented.metadata.externalAgentResult,
    "The specialist could not start.",
  );
  assert.deepEqual(
    store.listConversationMessages(chat.id).map((message) => message.id),
    [reserved.userMessage.id, originalAssistant.id],
  );
});

test("a background run can find the assistant turn its artifacts belong to", () => {
  const chat = conversation();
  const blueprint = {
    kind: "hardware_blueprint",
    runId: "hwrun_abc123",
    brief: "A Kindle-like reading device",
  };
  const launched = turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: "external-turn-blueprint",
    surface: "dashboard_terminal",
    userContent: "/agents:hardware-blueprint A Kindle-like reading device",
    run: blueprint,
  });

  // The run publishes its artifact from the background, long after the turn was
  // stored, so the run id is the only handle it has on the owning message.
  const owner = turns.findExternalAgentAssistantMessage({
    conversationId: chat.id,
    runId: blueprint.runId,
  });
  assert.equal(owner?.id, launched.assistantMessage.id);
  assert.equal(owner?.role, "assistant");

  assert.equal(
    turns.findExternalAgentAssistantMessage({
      conversationId: chat.id,
      runId: "hwrun_unknown",
    }),
    null,
  );
  assert.equal(
    turns.findExternalAgentAssistantMessage({ conversationId: chat.id, runId: "  " }),
    null,
  );
});

test("a later external-agent turn cannot replace an existing chat title", () => {
  const chat = conversation();
  store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "normal-turn-0001",
    surface: "dashboard_terminal",
    content: "Plan the launch checklist",
  });
  store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId: "normal-turn-0001",
    content: "Ready.",
  });

  turns.recordExternalAgentTurn({
    conversation: store.getConversationById(chat.id),
    clientMessageId: "external-turn-after-normal",
    surface: "dashboard_terminal",
    userContent: "/agents:openplanter Investigate the dependency graph",
    run: descriptors[3],
  });

  assert.equal(
    store.getConversationById(chat.id).title,
    "Assistant conversation",
  );
});

test("automatic titles stay in sync with linked Garden chat history", () => {
  db.prepare(
    "INSERT INTO clusters(id, user_id, name, slug, visibility) VALUES (10, 1, 'Research', 'research', 'private')",
  ).run();
  const chatSessionId = Number(
    db.prepare(
      "INSERT INTO chat_sessions(cluster_id, user_id, title) VALUES (10, 1, 'New chat')",
    ).run().lastInsertRowid,
  );
  const chat = conversation();
  db.prepare(
    "UPDATE conversations SET legacy_chat_session_id = ? WHERE id = ?",
  ).run(chatSessionId, chat.id);
  db.prepare(
    "UPDATE chat_sessions SET conversation_id = ? WHERE id = ?",
  ).run(chat.id, chatSessionId);

  turns.recordExternalAgentTurn({
    conversation: store.getConversationById(chat.id),
    clientMessageId: "external-linked-garden",
    surface: "garden_chat",
    userContent: "/agents:openplanter Map the evidence graph",
    run: descriptors[3],
  });
  titles.applyGeneratedConversationTitle({
    conversationId: chat.id,
    expectedTitle: "Assistant conversation",
    generatedTitle: "Map Evidence Graph",
  });

  const legacy = db.prepare(
    "SELECT title FROM chat_sessions WHERE id = ?",
  ).get(chatSessionId);
  assert.equal(legacy.title, "Map Evidence Graph");
});

test("a Codex result updates linked Garden history without a mounted chat", () => {
  db.prepare(
    "INSERT INTO clusters(id, user_id, name, slug, visibility) VALUES (10, 1, 'Research', 'research', 'private')",
  ).run();
  const chatSessionId = Number(
    db.prepare(
      "INSERT INTO chat_sessions(cluster_id, user_id, title) VALUES (10, 1, 'New chat')",
    ).run().lastInsertRowid,
  );
  const chat = store.ensureConversationForLegacyChatSession(chatSessionId, 1);
  const clientMessageId = "codex-background-turn-0001";

  turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId,
    surface: "garden_chat",
    userContent: "/agents:codex Repair the Garden workspace",
    run: descriptors[4],
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?")
      .get(chatSessionId).count,
    2,
  );

  turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId,
    outcome: "completed",
    content: "Codex repaired and verified the Garden workspace.",
    usage: {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  });

  const projected = db.prepare(`
    SELECT content, token_usage, tool_calls
    FROM chat_messages
    WHERE session_id = ? AND role = 'assistant'
  `).get(chatSessionId);
  assert.match(projected.content, /repaired and verified/);
  assert.equal(JSON.parse(projected.token_usage).totalTokens, 100);
  assert.equal(JSON.parse(projected.tool_calls).externalAgentOutcome, "completed");
});

test("a finished run keeps the record of what it did", () => {
  const chat = conversation();
  const clientMessageId = "codex-activity-turn-0001";
  turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    userContent: "/agents:codex Add the repository health check",
    run: descriptors[4],
  });

  // The run manager keeps events in memory only, so the timeline is stored
  // with the turn when it finishes.
  const activity = runs.externalAgentActivityFromRunEvents([
    { sequenceNumber: 1, type: "reasoning.completed", payload: { text: "Reading the route" } },
    {
      sequenceNumber: 2,
      type: "tool.completed",
      payload: {
        tool: "functions.apply_patch",
        status: "completed",
        title: "src/app/api/health/route.ts",
        summary: "+12 -0",
      },
    },
    { sequenceNumber: 3, type: "run.started", payload: {} },
  ]);
  assert.equal(activity.length, 2);

  const completed = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId,
    outcome: "completed",
    content: "Added the health check.",
    activity,
  });
  const restored = runs.externalAgentMessageFields(
    store.presentConversationMessage(completed).metadata,
  );
  assert.deepEqual(restored.externalAgentActivity, activity);
  assert.equal(restored.externalAgentActivity[1].tool, "functions.apply_patch");

  // A replayed terminal frame must not drop it.
  const replayed = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId,
    outcome: "completed",
    content: "Added the health check.",
  });
  assert.deepEqual(
    runs.externalAgentMessageFields(
      store.presentConversationMessage(replayed).metadata,
    ).externalAgentActivity,
    activity,
  );
});

test("a finished coding run keeps the snapshots that make its edits undoable", () => {
  const chat = conversation();
  const clientMessageId = "codex-edits-turn-0001";
  turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    userContent: "/agents:codex Add the repository health check",
    run: descriptors[4],
  });

  const edits = {
    before: "a".repeat(40),
    after: "b".repeat(40),
  };
  assert.deepEqual(runs.parseExternalAgentEdits(edits), edits);
  assert.equal(runs.parseExternalAgentEdits({ before: "nope", after: "b".repeat(40) }), null);

  const completed = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId,
    outcome: "completed",
    content: "Added the health check.",
    edits,
  });
  const restored = runs.externalAgentMessageFields(
    store.presentConversationMessage(completed).metadata,
  );
  assert.deepEqual(restored.externalAgentEdits, edits);

  // The legacy Garden projection carries them too, so the card survives there.
  const projected = db
    .prepare("SELECT tool_calls FROM hermes_messages WHERE canonical_message_id = ?")
    .get(completed.id);
  if (projected?.tool_calls) {
    assert.deepEqual(JSON.parse(projected.tool_calls).externalAgentEdits, edits);
  }
});

test("terminal external agent results survive replay and cannot be overwritten by expiry errors", () => {
  const chat = conversation();
  turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: "external-turn-0002",
    surface: "dashboard_terminal",
    userContent: "/agents:deep-research Compare battery chemistries",
    run: descriptors[2],
  });

  const completed = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId: "external-turn-0002",
    outcome: "completed",
    content: "# Durable report\n\nThe result remains in chat history.",
    usage: {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  });
  assert.equal(completed.status, "complete");
  assert.match(completed.content, /Durable report/);
  assert.equal(
    store.presentConversationMessage(completed).metadata.externalAgentOutcome,
    "completed",
  );
  assert.equal(
    store.presentConversationMessage(completed).usage.totalTokens,
    150,
  );

  const replayedExpiry = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId: "external-turn-0002",
    outcome: "failed",
    content: "This run is no longer available.",
  });
  assert.equal(replayedExpiry.status, "complete");
  assert.match(replayedExpiry.content, /Durable report/);
  assert.doesNotMatch(replayedExpiry.content, /no longer available/);
});

test("a background terminal event uses runtime time instead of the later chat reopen", () => {
  const chat = conversation();
  const clientMessageId = "max-research-background-clock";
  const recorded = turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    userContent: "/agents:max-research investigate muscle hypertrophy",
    run: {
      kind: "max_research",
      runId: "max-research-background-clock-run",
      query: "investigate muscle hypertrophy",
    },
  });
  const startedAt = Date.parse(
    store.presentConversationMessage(recorded.assistantMessage).metadata
      .externalAgentStartedAt,
  );
  const runtimeDurationMs = 21 * 60_000 + 45_000;
  const finished = turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId,
    outcome: "failed",
    content: "Sources could not be fetched.",
    // This can be persisted much later, when the person reopens the chat.
    terminalAtMs: startedAt + runtimeDurationMs,
  });

  assert.equal(
    store.presentConversationMessage(finished).metadata.responseDurationMs,
    runtimeDurationMs,
  );
});

test("legacy Max Research timing is repaired without changing its saved failure", () => {
  const chat = conversation();
  const clientMessageId = "max-research-legacy-clock";
  const recorded = turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId,
    surface: "dashboard_terminal",
    userContent: "/agents:max-research investigate muscle hypertrophy",
    run: {
      kind: "max_research",
      runId: "max-research-legacy-clock-run",
      query: "investigate muscle hypertrophy",
    },
  });
  const startedAt = Date.parse(
    store.presentConversationMessage(recorded.assistantMessage).metadata
      .externalAgentStartedAt,
  );
  const parentDurationMs = 42_000;
  const runtimeDurationMs = 21 * 60_000 + 45_000;
  const legacyMetadata = {
    ...store.presentConversationMessage(recorded.assistantMessage).metadata,
    externalAgentOutcome: "failed",
    responseDurationMs: 41 * 60_000,
    responseStartedAt: new Date(startedAt - parentDurationMs).toISOString(),
  };
  delete legacyMetadata.externalAgentBaseDurationMs;
  db.prepare(`
    UPDATE conversation_messages
    SET content = ?, status = 'failed', metadata = ?
    WHERE id = ?
  `).run(
    "Sources could not be fetched.",
    JSON.stringify(legacyMetadata),
    recorded.assistantMessage.id,
  );

  const repaired = turns.reconcileExternalAgentTerminalTiming({
    conversationId: chat.id,
    clientMessageId,
    terminalAtMs: startedAt + runtimeDurationMs,
  });
  const presented = store.presentConversationMessage(repaired);
  assert.equal(presented.content, "Sources could not be fetched.");
  assert.equal(presented.metadata.externalAgentOutcome, "failed");
  assert.equal(
    presented.metadata.responseDurationMs,
    parentDurationMs + runtimeDurationMs,
  );
});

test("launch failures are also canonical history turns", () => {
  const chat = conversation();
  const failed = turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: "external-turn-0003",
    surface: "dashboard_terminal",
    userContent: "/agents:agent-browser Open the dashboard",
    assistantContent: "The Agent Browser run could not start.",
    outcome: "failed",
  });
  assert.equal(failed.assistantMessage.status, "failed");
  assert.match(failed.assistantMessage.content, /could not start/);
  assert.equal(store.listConversationMessages(chat.id).length, 2);
});

test("legacy Hardware Blueprint cards recover rich state from their owned artifact", () => {
  const chat = conversation();
  const recorded = turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: "hardware-blueprint-legacy-state",
    surface: "dashboard_terminal",
    userContent: "/agents:hardware-blueprint Build a weather station",
    run: {
      kind: "hardware_blueprint",
      runId: "hardware-run-legacy-state",
      brief: "Build a weather station",
    },
  });
  turns.finishExternalAgentTurn({
    conversationId: chat.id,
    clientMessageId: "hardware-blueprint-legacy-state",
    outcome: "completed",
    content: "The blueprint is complete.",
    // Deliberately omit state: this is the legacy row the compatibility path
    // has to repair at presentation time.
  });

  const runtime = runtimeStore.createRuntimeSession({
    conversationId: chat.id,
    surface: "dashboard_terminal",
    userId: 1,
    chatSessionId: null,
    agentName: "Hermes",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    workspaceKey: "legacy-card-recovery",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
    hermesSessionId: "hermes-legacy-card-recovery",
  });
  const artifactRun = runtimeRuns.beginRuntimeRun({
    runtimeSessionId: runtime.id,
    instruction: "Build a weather station",
    dispatch: { conversationPublicId: chat.public_id },
  });
  const { design } = hardwareDesigns.buildDesign({
    request: {
      purpose: "Build an ESP32 weather station with a BME280 and OLED",
      controller: "ESP32",
      inputs: [{ type: "BME280", quantity: 1 }],
      outputs: [{ type: "128x64 OLED", quantity: 1 }],
      communication: ["i2c", "wifi"],
      power: { source: "usb" },
      prototypeType: "breadboard",
      firmware: { platform: "platformio", language: "cpp" },
      constraints: {
        beginnerFriendly: true,
        preferredComponents: [],
        forbiddenComponents: [],
      },
    },
    designId: "hwd_legacy_card_recovery",
  });
  artifacts.createArtifact({
    userId: 1,
    runtimeSessionId: runtime.id,
    hermesSessionId: "hermes-legacy-card-recovery",
    conversationId: chat.id,
    clusterId: null,
    runId: artifactRun.id,
    assistantMessageId: recorded.assistantMessage.id,
    surface: "dashboard_terminal",
    kind: "data",
    rendererId: "hardware-blueprint",
    title: `Hardware Blueprint: ${design.title}`,
    filename: "hardware-design.json",
    content: `${JSON.stringify(design, null, 2)}\n`,
    sourceHermesTool: "hardware_blueprint_compile",
  });
  artifacts.createArtifact({
    userId: 1,
    runtimeSessionId: runtime.id,
    hermesSessionId: "hermes-legacy-card-recovery",
    conversationId: chat.id,
    clusterId: null,
    runId: artifactRun.id,
    assistantMessageId: recorded.assistantMessage.id,
    surface: "dashboard_terminal",
    kind: "data",
    rendererId: "parametric-cad",
    title: "CAD: Weather station housing",
    filename: "cad-project.json",
    content: JSON.stringify({
      schemaVersion: "1.0.0",
      id: "cad_legacy_card_recovery",
      title: "Weather station housing",
      brief: "A compact weather station housing",
      status: "ready",
      units: "mm",
      revision: 1,
      parameters: [],
      bodies: [],
      validation: [],
      exports: [],
      source: "",
    }),
    sourceHermesTool: "parametric_cad_design",
  });

  const detail = presentation.presentHermesSessionDetail(chat);
  const assistant = detail.messages.find(
    (message) => message.role === "assistant" && message.hardwareBlueprintRun,
  );
  assert.ok(assistant, "the saved Hardware Blueprint turn is missing");
  assert.equal(
    "metadata" in assistant,
    false,
    "detail responses should project metadata fields instead of duplicating the raw envelope",
  );
  assert.equal(assistant.externalAgentState.kind, "hardware-blueprint");
  assert.equal(assistant.externalAgentState.designTitle, design.title);
  assert.equal(
    assistant.externalAgentState.enclosureTitle,
    "Weather station housing",
  );
  assert.deepEqual(assistant.externalAgentState.counts, {
    errors: design.validationResults.filter((finding) => finding.severity === "error").length,
    warnings: design.validationResults.filter((finding) => finding.severity === "warning").length,
    info: design.validationResults.filter((finding) => finding.severity === "info").length,
  });
  assert.deepEqual(
    assistant.externalAgentState.firmwareFiles,
    design.firmware.files.map((file) => file.path),
  );
  assert.ok(
    assistant.externalAgentState.pins.some((pin) => pin.purpose === "i2c-sda"),
    "the stored netlist did not restore the pin map",
  );
  assert.ok(
    assistant.externalAgentState.specs.some(
      ([label, value]) => label === "Controller" && value === "ESP32 DevKit V1",
    ),
    "the stored component list did not restore the controller spec",
  );
});

test("retried external-agent turns preserve and replace the original response branch", () => {
  const chat = conversation();
  const originalClientMessageId = "external-turn-retry-original";
  turns.recordExternalAgentTurn({
    conversation: chat,
    clientMessageId: originalClientMessageId,
    surface: "dashboard_terminal",
    userContent: "/agents:deep-research Compare battery chemistries",
    assistantContent: "The research service is not reachable.",
    outcome: "failed",
  });

  const retry = turns.recordExternalAgentTurn({
    conversation: store.getConversationById(chat.id),
    clientMessageId: "external-turn-retry-sibling",
    surface: "dashboard_terminal",
    userContent: "/agents:deep-research Compare battery chemistries",
    run: descriptors[2],
    branchGroupId: originalClientMessageId,
  });

  assert.equal(
    store.presentConversationMessage(retry.userMessage).metadata.branchGroupId,
    originalClientMessageId,
  );
  assert.equal(
    store.presentConversationMessage(retry.assistantMessage).metadata.branchGroupId,
    originalClientMessageId,
  );
  const projected = branches.projectConversationBranchMessages(
    store.listConversationMessages(chat.id),
  );
  assert.deepEqual(
    projected.map((message) => message.client_message_id),
    ["external-turn-retry-sibling", "external-turn-retry-sibling"],
  );
  assert.equal(
    store.presentConversationMessage(projected[1]).metadata.externalAgentRun.kind,
    "deep_research",
  );
});

test("chat restore and all external launchers use the shared persistence path", () => {
  const sessionRoute = fs.readFileSync(
    new URL("../src/app/api/hermes/sessions/route.ts", import.meta.url),
    "utf8",
  );
  const sessionPresentation = fs.readFileSync(
    new URL("../src/lib/hermes/session-presentation.ts", import.meta.url),
    "utf8",
  );
  const terminal = fs.readFileSync(
    new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
    "utf8",
  );
  const deepResearch = fs.readFileSync(
    new URL("../src/app/components/hermes/use-deep-research-agent.ts", import.meta.url),
    "utf8",
  );
  const openCode = fs.readFileSync(
    new URL("../src/app/components/hermes/use-opencode-agent.ts", import.meta.url),
    "utf8",
  );
  const panel = fs.readFileSync(
    new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(sessionRoute, /presentHermesSessionSummary/);
  assert.match(sessionPresentation, /externalAgentMessageFields\(metadata\)/);
  assert.match(terminal, /kind: "agent_tars"/);
  assert.match(terminal, /kind: "agent_browser"/);
  assert.match(terminal, /kind: "openplanter"/);
  assert.ok(
    terminal.match(/appendExternalAgentTurn\(/g)?.length >= 4,
    "Agent TARS and Agent Browser should persist launches and launch failures",
  );
  assert.match(deepResearch, /kind: "deep_research"/);
  assert.match(deepResearch, /appendExternalAgentTurn\(/);
  assert.match(openCode, /kind: "opencode"/);
  assert.match(openCode, /appendExternalAgentTurn\(/);
  assert.match(panel, /onExternalAgentTerminal/);
  assert.match(panel, /message\.openPlanterRun/);
  assert.match(panel, /message\.openCodeRun/);
});
