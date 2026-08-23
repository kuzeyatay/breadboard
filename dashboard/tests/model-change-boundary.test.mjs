import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-model-change-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const models = await import("../src/lib/ai-models.ts");
const store = await import("../src/lib/conversations/store.ts");
const presentation = await import("../src/lib/hermes/session-presentation.ts");

const hookSource = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const panelSource = fs.readFileSync(
  new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = fs.readFileSync(
  new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);
const gardenSource = fs.readFileSync(
  new URL("../src/app/components/hermes/garden-agent-chat.tsx", import.meta.url),
  "utf8",
);
const separatorSource = fs.readFileSync(
  new URL("../src/app/components/chat-model-change-separator.tsx", import.meta.url),
  "utf8",
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

test("model boundary labels contain only a readable dash-free model name", () => {
  assert.equal(
    models.formatAssistantModelChangeName(
      "cliproxy/claude-fable-5-20250805",
    ),
    "Claude Fable 5",
  );
  assert.equal(
    models.formatAssistantModelChangeName("gpt-5.6-sol"),
    "GPT 5.6 Sol",
  );
  assert.equal(
    models.formatAssistantModelChangeName(
      "openrouter/anthropic/claude-opus-4-1-20250805",
    ),
    "Claude Opus 4.1",
  );
});

test("every model change persists on its answer without adding fake messages", () => {
  const conversation = store.createConversation({
    userId: 1,
    surface: "dashboard_terminal",
  });
  store.reserveConversationTurn({
    conversation,
    clientMessageId: "model-boundary-turn-001",
    surface: "dashboard_terminal",
    content: "Explain this carefully.",
  });

  store.setConversationModelChange({
    conversationId: conversation.id,
    afterClientMessageId: "model-boundary-turn-001",
    modelId: "gpt-5.6-terra",
    modelLabel: models.formatAssistantModelChangeName("gpt-5.6-terra"),
  });
  store.setConversationModelChange({
    conversationId: conversation.id,
    afterClientMessageId: "model-boundary-turn-001",
    modelId: "cliproxy/claude-fable-5-20250805",
    modelLabel: models.formatAssistantModelChangeName(
      "cliproxy/claude-fable-5-20250805",
    ),
  });
  store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId: "model-boundary-turn-001",
    content: "Finished with the original model.",
  });

  const messages = store.listConversationMessages(conversation.id);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => message.order_index), [0, 1]);
  const metadata = JSON.parse(messages[1].metadata);
  assert.equal(metadata.modelChangeModelId, "cliproxy/claude-fable-5-20250805");
  assert.equal(metadata.modelChangeLabel, "Claude Fable 5");
  assert.deepEqual(metadata.modelChangeLabels, [
    "GPT 5.6 Terra",
    "Claude Fable 5",
  ]);

  const restored = presentation.presentHermesSessionDetail(conversation);
  assert.equal(restored.messages[1].content, "Finished with the original model.");
  assert.equal(restored.messages[1].modelChangeAfter, "Claude Fable 5");
  assert.deepEqual(restored.messages[1].modelChangesAfter, [
    "GPT 5.6 Terra",
    "Claude Fable 5",
  ]);
});

test("the client freezes active-answer intelligence and reveals durable boundaries", () => {
  for (const surface of [dashboardSource, gardenSource]) {
    assert.match(surface, /activeAnswerIntelligence/);
    assert.match(surface, /session\.queueModelChange\(nextModel\)/);
    assert.match(
      surface,
      /if \(currentChatActive\) \{[\s\S]*?setActiveAnswerIntelligence[\s\S]*?\}\s*void session\.queueModelChange\(nextModel\)/,
    );
    assert.match(surface, /onModelChange=\{changeModel\}/);
    assert.match(surface, /model=\{selectedModel\}/);
  }
  assert.match(hookSource, /queueModelChange: \(model: string\) => Promise<void>/);
  assert.match(hookSource, /if \(!target\?\.clientMessageId\) return;/);
  assert.match(hookSource, /formatAssistantModelChangeName\(model\)/);
  assert.match(panelSource, /storedMessage\.modelChangesAfter/);
  assert.match(panelSource, /ChatModelChangeSeparator/);
  assert.match(separatorSource, /Switched to \$\{modelName\}/);
  assert.match(separatorSource, /aria-label=\{label\}/);
});

test("changing models before the first message keeps a new chat empty", () => {
  const queueSource = hookSource.slice(
    hookSource.indexOf("const queueModelChange"),
    hookSource.indexOf("const beginDelegatedExternalAgentTurn"),
  );
  const emptyChatGuard = queueSource.indexOf(
    "if (!target?.clientMessageId) return;",
  );

  assert.ok(emptyChatGuard >= 0, "an empty chat must ignore model boundaries");
  assert.ok(
    emptyChatGuard < queueSource.indexOf("setMessages"),
    "the empty-chat guard must run before any separator can be painted",
  );
  assert.doesNotMatch(
    queueSource.slice(0, queueSource.indexOf("const answerClientMessageId")),
    /model-change:/,
    "an initial model selection must not create a presentation-only transcript row",
  );
});

test("the boundary is drawn on the switch, not on the write that confirms it", () => {
  const queueSource = hookSource.slice(
    hookSource.indexOf("const queueModelChange"),
    hookSource.indexOf("const beginDelegatedExternalAgentTurn"),
  );
  assert.ok(
    queueSource.indexOf("[...boundaries, optimisticLabel]") <
      queueSource.indexOf("await ensureConversation()"),
    "the label is derived from the chosen model, so the separator must appear before the write",
  );
  assert.match(queueSource, /const withdrawBoundary = \(\) =>/);
  assert.equal(
    (queueSource.match(/withdrawBoundary\(\)/g) ?? []).length,
    4,
    "every way the write can fail must take the painted boundary back",
  );
  assert.match(
    queueSource,
    /modelChange === optimisticLabel/,
    "a confirmation that matches what is on screen must leave the transcript alone",
  );
  assert.doesNotMatch(
    queueSource,
    /\[\.\.\.previousModelChanges, modelChange\]/,
    "the confirmation reconciles the painted boundary instead of appending a second one",
  );
});
