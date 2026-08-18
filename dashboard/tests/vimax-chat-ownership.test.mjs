// A ViMax film belongs to the chat — and the turn — it was generated in.
//
// The run is long and headless: it starts before the chat has written the turn
// it belongs to and finishes minutes later, from a background job that has no
// browser attached. Both halves of the promise are easy to lose there, so both
// are checked here against the real store:
//
//   1. the film binds to the assistant turn that asked for it, on both surfaces;
//   2. a film made in one chat never leaks into, or is revised by, another.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-vimax-ownership-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const runtimeStore = await import("../src/lib/hermes/runtime-store.ts");
const artifactStore = await import("../src/lib/hermes/artifact-store.ts");
const { VIMAX_PRODUCTION_SCHEMA_VERSION } = await import("../src/lib/vimax/types.ts");
const {
  closeVimaxArtifactContext,
  latestVimaxArtifact,
  openVimaxArtifactContext,
  publishProduction,
} = await import("../src/lib/vimax/artifact.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

const FRAME = {
  description: "Wide shot; a figure in a yellow oilskin stands left of frame.",
  visibleCharacterIdxs: [0],
  image: null,
};

function production(title) {
  return {
    schemaVersion: VIMAX_PRODUCTION_SCHEMA_VERSION,
    id: `vimax_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    title,
    logline: "Two rivals must share one umbrella.",
    brief: title,
    mode: "idea2video",
    style: "Cartoon",
    userRequirement: "",
    aspectRatio: "16:9",
    story: "Ada and Bo run the only two stalls on Quay Street.",
    characters: [
      {
        idx: 0,
        identifier: "Ada",
        isVisible: true,
        staticFeatures: "Short, cropped grey hair.",
        dynamicFeatures: "A patched yellow oilskin.",
        portrait: null,
      },
    ],
    scenes: [
      {
        idx: 0,
        isLast: true,
        heading: "EXT. QUAY STREET - DAY",
        location: "Quay Street",
        timeOfDay: "DAY",
        atmosphere: "Grey light.",
        characterIdxs: [0],
        script: "<Ada> hauls a crate under the awning.",
      },
    ],
    shots: [
      {
        idx: 0,
        sceneIdx: 0,
        shotInScene: 0,
        camIdx: 0,
        isLast: true,
        visualDescription: "Wide shot of the market.",
        audioDescription: "",
        firstFrame: FRAME,
        lastFrame: FRAME,
        motion: "The camera pushes in.",
        variation: "small",
        variationReason: "Only the subject's position changes.",
        durationSeconds: 6,
        dialogue: [],
        narration: null,
        videoPrompt: "Cartoon style, 6 seconds.",
      },
    ],
    renderPlan: {
      imageBackend: "none",
      videoBackend: "none",
      videoBackendReason: "No frames were drawn, so there was nothing to film.",
      totalDurationSeconds: 6,
      shotCount: 1,
      drawnFrameCount: 0,
    },
    status: "storyboarded",
    createdAt: "2026-08-05T00:00:00.000Z",
    revisions: [title],
  };
}

let nextUser = 0;
function user() {
  const id = ++nextUser;
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (?, ?, ?, 'x')",
  ).run(id, `viewer${id}`, `viewer${id}@example.test`);
  return id;
}

/** A Terminal chat with a runtime session, the way a launch finds one. */
function terminalChat(userId) {
  const conversation = store.createConversation({ userId, title: "New chat" });
  runtimeStore.createRuntimeSession({
    conversationId: conversation.id,
    surface: "dashboard_terminal",
    userId,
    chatSessionId: null,
    agentName: "Breadboard",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    workspaceKey: `terminal-${conversation.id}`,
    activeDirectory: ".",
    filesystemMode: "restricted",
    hermesSessionId: `hermes_${conversation.id}`,
  });
  return conversation;
}

/** A Garden chat, which still launches from a legacy chat session. */
function gardenChat(userId) {
  const cluster = db
    .prepare(
      "INSERT INTO clusters(user_id, name, slug, visibility, chat_accessible) VALUES (?, 'Aurora', ?, 'private', 1)",
    )
    .run(userId, `aurora-${userId}`);
  const clusterId = Number(cluster.lastInsertRowid);
  const session = db
    .prepare("INSERT INTO chat_sessions(cluster_id, user_id, title) VALUES (?, ?, 'Garden chat')")
    .run(clusterId, userId);
  const chatSessionId = Number(session.lastInsertRowid);
  const conversation = store.ensureConversationForLegacyChatSession(chatSessionId, userId);
  runtimeStore.createRuntimeSession({
    conversationId: conversation.id,
    surface: "garden_chat",
    userId,
    chatSessionId,
    agentName: "Breadboard",
    clusterId,
    gardenId: `aurora-${userId}`,
    pageSlug: null,
    workspaceKey: `garden-${conversation.id}`,
    activeDirectory: ".",
    filesystemMode: "restricted",
    hermesSessionId: `hermes_${conversation.id}`,
  });
  return { conversation, chatSessionId, clusterId };
}

/**
 * Launch the way the run manager does: the context is opened first, because the
 * drawn frames need a run to hang off, and only then does the chat write the
 * turn. Anything that resolves the message at this moment resolves it to null.
 */
function launch(userId, conversation, runId) {
  const context = openVimaxArtifactContext({
    userId,
    conversationPublicId: conversation.public_id,
    brief: "a lighthouse keeper who befriends a whale",
    agentRunId: runId,
  });
  assert.ok(context, "the artifact context could not be opened");
  assert.equal(context.assistantMessageId, null, "the turn cannot exist yet");
  return context;
}

function recordTurn(conversation, surface, runId, clientMessageId) {
  return turns.recordExternalAgentTurn({
    conversation,
    clientMessageId,
    surface,
    userContent: "/agents:vimax a lighthouse keeper who befriends a whale",
    run: { kind: "vimax", runId, brief: "a lighthouse keeper who befriends a whale" },
    outcome: "running",
  });
}


test("a Terminal film binds to the turn that asked for it", async () => {
  const userId = user();
  const conversation = terminalChat(userId);
  const runId = "vmxrun_terminal";

  const context = launch(userId, conversation, runId);
  const turn = recordTurn(conversation, "dashboard_terminal", runId, "vimax-terminal-1");

  const artifact = await publishProduction({ context, production: production("The Long Note") });
  assert.ok(artifact, "the film was not published");
  assert.equal(artifact.conversation_id, conversation.id);
  assert.equal(
    artifact.originating_message_id,
    turn.assistantMessage.id,
    "the film did not stick to the turn that asked for it",
  );
});

test("a Garden film binds to the turn that asked for it", async () => {
  const userId = user();
  const { conversation, chatSessionId } = gardenChat(userId);
  const runId = "vmxrun_garden";

  const context = launch(userId, conversation, runId);
  // The Garden agent chat records external agent turns through the same
  // canonical store the Terminal uses: it runs on useAgentSession("garden_chat"),
  // which POSTs to the external-turns route, which calls this function. The
  // surface is a parameter, not a separate write path.
  recordTurn(conversation, "garden_chat", runId, "vimax-garden-1");

  const artifact = await publishProduction({ context, production: production("The Keeper") });
  assert.ok(artifact, "the film was not published");
  assert.equal(artifact.conversation_id, conversation.id);
  assert.ok(
    artifact.originating_message_id,
    "the film did not stick to the turn that asked for it",
  );

  // The Garden reads its transcript through the legacy projection, so the turn
  // has to carry the canonical id there too or the card has nothing to match.
  const legacy = db
    .prepare(
      "SELECT canonical_message_id FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY order_index DESC LIMIT 1",
    )
    .get(chatSessionId);
  assert.equal(
    legacy?.canonical_message_id,
    artifact.originating_message_id,
    "the Garden transcript cannot address the turn the film belongs to",
  );
});

test("a film made in one chat is neither shown in nor revised by another", async () => {
  const userId = user();
  const first = terminalChat(userId);
  const second = terminalChat(userId);

  const firstContext = launch(userId, first, "vmxrun_first");
  recordTurn(first, "dashboard_terminal", "vmxrun_first", "vimax-scope-1");
  const firstFilm = await publishProduction({
    context: firstContext,
    production: production("The First Film"),
  });
  assert.ok(firstFilm);

  // The other chat has no previous film, so nothing to fork.
  assert.equal(
    latestVimaxArtifact({ userId, conversationPublicId: second.public_id }),
    null,
    "another chat's film was offered as this chat's previous film",
  );
  assert.equal(
    latestVimaxArtifact({ userId, conversationPublicId: first.public_id })?.id,
    firstFilm.id,
  );

  const secondContext = launch(userId, second, "vmxrun_second");
  recordTurn(second, "dashboard_terminal", "vmxrun_second", "vimax-scope-2");
  const secondFilm = await publishProduction({
    context: secondContext,
    production: production("The Second Film"),
  });
  assert.ok(secondFilm);
  assert.notEqual(secondFilm.id, firstFilm.id, "the second chat forked the first chat's film");

  const inFirst = artifactStore.listArtifactsForUser({
    userId,
    conversationPublicId: first.public_id,
  });
  assert.deepEqual(
    inFirst.map((row) => row.id),
    [firstFilm.id],
    "a chat listed a film it did not make",
  );

  // Another user's chat can never reach it, whatever id is presented.
  const stranger = user();
  assert.equal(
    latestVimaxArtifact({ userId: stranger, conversationPublicId: first.public_id }),
    null,
  );
});

test("a follow-up in the same chat forks the film and follows the new turn", async () => {
  const userId = user();
  const conversation = terminalChat(userId);

  const firstContext = launch(userId, conversation, "vmxrun_v1");
  recordTurn(conversation, "dashboard_terminal", "vmxrun_v1", "vimax-fork-1");
  const first = await publishProduction({
    context: firstContext,
    production: production("The Draft"),
  });
  // A chat holds one active run at a time, so the first film's run has to be
  // closed before the follow-up can open its own — exactly what the run manager
  // does when it finishes.
  closeVimaxArtifactContext(firstContext, "completed");

  const secondContext = launch(userId, conversation, "vmxrun_v2");
  const revisionTurn = recordTurn(
    conversation,
    "dashboard_terminal",
    "vmxrun_v2",
    "vimax-fork-2",
  );
  const revised = await publishProduction({
    context: secondContext,
    production: production("The Cut"),
    previousArtifactId: first.id,
  });

  assert.equal(revised.id, first.id, "a revision must fork the same film");
  assert.equal(revised.current_version, 2);
  assert.equal(
    revised.originating_message_id,
    revisionTurn.assistantMessage.id,
    "the revised film did not follow the turn that asked for the change",
  );
});
