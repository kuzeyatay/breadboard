#!/usr/bin/env node

/**
 * W2-3E / ARTIFACT_TURN_BINDING — does a Garden film bind to the turn that
 * asked for it?
 *
 * The failing test writes the Garden's turn with a raw INSERT into the legacy
 * `chat_messages` table, `canonical_message_id` explicitly NULL, on the stated
 * belief that "the Garden writes its turns the way its own transcript is saved
 * rather than through the canonical turn store the Terminal uses".
 *
 * That belief is the thing under test. If the Garden really does write turns
 * that way, the product must still bind the film and does not — a product
 * defect. If the Garden records external agent turns through the same canonical
 * path as the Terminal, the fixture is asserting against a path the product
 * never takes, and it will fail no matter how correct the product is.
 *
 * So this runs the real store against a real database, on the launch path the
 * Garden surface actually uses, and then attacks the binding with the cases
 * that would make it wrong: no turn at all, two runs in one chat, a run id from
 * another conversation, another user.
 *
 * Everything below runs against a throwaway BREADBOARD_DATA_DIR. No developer
 * database, garden or conversation is touched.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "turn-binding-arbitration.json");
const dashboardRoot = process.cwd();

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-w23e-binding-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);

const { default: db } = await load("src/lib/db.ts");
const store = await load("src/lib/conversations/store.ts");
const turns = await load("src/lib/conversations/external-agent-turns.ts");
const runtimeStore = await load("src/lib/hermes/runtime-store.ts");
const artifactStore = await load("src/lib/hermes/artifact-store.ts");
const { VIMAX_PRODUCTION_SCHEMA_VERSION } = await load("src/lib/vimax/types.ts");
const { closeVimaxArtifactContext, latestVimaxArtifact, openVimaxArtifactContext, publishProduction } =
  await load("src/lib/vimax/artifact.ts");

const FRAME = { description: "Wide shot.", visibleCharacterIdxs: [0], image: null };
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
      { idx: 0, identifier: "Ada", isVisible: true, staticFeatures: "Grey hair.", dynamicFeatures: "Oilskin.", portrait: null },
    ],
    scenes: [
      { idx: 0, isLast: true, heading: "EXT. QUAY STREET - DAY", location: "Quay Street", timeOfDay: "DAY", atmosphere: "Grey light.", characterIdxs: [0], script: "<Ada> hauls a crate." },
    ],
    shots: [
      {
        idx: 0, sceneIdx: 0, shotInScene: 0, camIdx: 0, isLast: true,
        visualDescription: "Wide shot.", audioDescription: "", firstFrame: FRAME, lastFrame: FRAME,
        motion: "Push in.", variation: "small", variationReason: "Subject moves.",
        durationSeconds: 6, dialogue: [], narration: null, videoPrompt: "Cartoon, 6s.",
      },
    ],
    renderPlan: { imageBackend: "none", videoBackend: "none", videoBackendReason: "No frames drawn.", totalDurationSeconds: 6, shotCount: 1, drawnFrameCount: 0 },
    status: "storyboarded",
    createdAt: "2026-08-05T00:00:00.000Z",
    revisions: [title],
  };
}

let nextUser = 0;
function user() {
  const id = ++nextUser;
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (?, ?, ?, 'x')")
    .run(id, `viewer${id}`, `viewer${id}@example.test`);
  return id;
}

function terminalChat(userId) {
  const conversation = store.createConversation({ userId, title: "New chat" });
  runtimeStore.createRuntimeSession({
    conversationId: conversation.id, surface: "dashboard_terminal", userId, chatSessionId: null,
    agentName: "Breadboard", clusterId: null, gardenId: null, pageSlug: null,
    workspaceKey: `terminal-${conversation.id}`, activeDirectory: ".", filesystemMode: "restricted",
    hermesSessionId: `hermes_${conversation.id}`,
  });
  return conversation;
}

/** A Garden chat, built the way the Garden surface's own launch path builds one. */
function gardenChat(userId) {
  const cluster = db
    .prepare("INSERT INTO clusters(user_id, name, slug, visibility, chat_accessible) VALUES (?, 'Aurora', ?, 'private', 1)")
    .run(userId, `aurora-${userId}`);
  const clusterId = Number(cluster.lastInsertRowid);
  const session = db
    .prepare("INSERT INTO chat_sessions(cluster_id, user_id, title) VALUES (?, ?, 'Garden chat')")
    .run(clusterId, userId);
  const chatSessionId = Number(session.lastInsertRowid);
  const conversation = store.ensureConversationForLegacyChatSession(chatSessionId, userId);
  runtimeStore.createRuntimeSession({
    conversationId: conversation.id, surface: "garden_chat", userId, chatSessionId,
    agentName: "Breadboard", clusterId, gardenId: `aurora-${userId}`, pageSlug: null,
    workspaceKey: `garden-${conversation.id}`, activeDirectory: ".", filesystemMode: "restricted",
    hermesSessionId: `hermes_${conversation.id}`,
  });
  return { conversation, chatSessionId, clusterId };
}

function launch(userId, conversation, runId) {
  return openVimaxArtifactContext({
    userId,
    conversationPublicId: conversation.public_id,
    brief: "a lighthouse keeper who befriends a whale",
    agentRunId: runId,
  });
}

/**
 * Record the turn the way the surface actually records it: the Garden agent
 * chat and the Terminal share `useAgentSession`, which POSTs to the external
 * turns route, which calls exactly this function. The surface is a parameter,
 * not a different code path.
 */
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

const legacyAssistantRow = (chatSessionId) =>
  db
    .prepare(
      "SELECT canonical_message_id, content FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY order_index DESC LIMIT 1",
    )
    .get(chatSessionId) ?? null;

const cases = [];
const record = (entry) => cases.push(entry);

// --- positive control, both surfaces -------------------------------------
for (const surface of ["dashboard_terminal", "garden_chat"]) {
  const userId = user();
  const built = surface === "garden_chat" ? gardenChat(userId) : { conversation: terminalChat(userId), chatSessionId: null };
  const conversation = built.conversation;
  const runId = `vmxrun_${surface}`;
  const context = launch(userId, conversation, runId);
  // Read at open time: `assistantMessageFor` writes the resolved id back onto
  // the context, so reading this field after publishing would measure the
  // resolution rather than the state it started from.
  const messageIdAtOpen = context === null ? "context-was-null" : context.assistantMessageId;
  const turn = recordTurn(conversation, surface, runId, `vimax-${surface}-1`);
  const artifact = await publishProduction({ context, production: production(`Film ${surface}`) });
  const legacy = built.chatSessionId ? legacyAssistantRow(built.chatSessionId) : null;
  record({
    name: `positive control: a film launched on ${surface} binds to its turn`,
    kind: "POSITIVE",
    surface,
    messageIdAtOpen,
    contextOpenedBeforeTurnExisted: messageIdAtOpen === null,
    published: Boolean(artifact),
    boundToLaunchConversation: artifact?.conversation_id === conversation.id,
    originatingMessageId: artifact?.originating_message_id ?? null,
    expectedMessageId: turn.assistantMessage.id,
    boundToAskingTurn: artifact?.originating_message_id === turn.assistantMessage.id,
    legacyCanonicalMessageId: legacy?.canonical_message_id ?? null,
    legacyTranscriptCanAddressTheTurn:
      built.chatSessionId === null ? null : legacy?.canonical_message_id === artifact?.originating_message_id,
  });
}

// --- the fixture the failing test uses, executed on its own terms ---------
{
  const userId = user();
  const { conversation, chatSessionId } = gardenChat(userId);
  const runId = "vmxrun_legacy_only";
  const context = launch(userId, conversation, runId);
  // Exactly the failing test's fixture: a raw legacy insert with no canonical id.
  const metadata = JSON.stringify({
    externalAgent: true,
    externalAgentRun: { kind: "vimax", runId, brief: "a lighthouse keeper who befriends a whale" },
    externalAgentOutcome: "running",
  });
  const insert = db.prepare(
    "INSERT INTO chat_messages (session_id, role, content, order_index, tool_calls, canonical_message_id) VALUES (?, ?, ?, ?, ?, NULL)",
  );
  insert.run(chatSessionId, "user", "/agents:vimax …", 0, metadata);
  insert.run(chatSessionId, "assistant", "", 1, metadata);
  const artifact = await publishProduction({ context, production: production("Legacy Only") });
  const canonicalRows = db
    .prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?")
    .get(conversation.id);
  record({
    name: "the failing test's fixture: a legacy-only turn with no canonical row",
    kind: "FIXTURE_REPRODUCTION",
    canonicalRowsForConversation: canonicalRows.n,
    originatingMessageId: artifact?.originating_message_id ?? null,
    boundToAskingTurn: artifact?.originating_message_id !== null,
    note:
      "The resolver looks the turn up in conversation_messages. This fixture writes no row there, so there is nothing to find. The question is whether the Garden surface really writes turns this way.",
  });
}

// --- adversarial: could the binding attach to the WRONG turn? ------------
{
  // Two runs in one chat: each film must follow its own turn, not the newest.
  const userId = user();
  const conversation = terminalChat(userId);
  const firstContext = launch(userId, conversation, "vmxrun_a");
  const firstTurn = recordTurn(conversation, "dashboard_terminal", "vmxrun_a", "vimax-run-a");
  const firstFilm = await publishProduction({ context: firstContext, production: production("Film A") });
  closeVimaxArtifactContext(firstContext, "completed");
  const secondContext = launch(userId, conversation, "vmxrun_b");
  const secondTurn = recordTurn(conversation, "dashboard_terminal", "vmxrun_b", "vimax-run-b");
  const secondFilm = await publishProduction({ context: secondContext, production: production("Film B") });
  record({
    name: "adversarial: two runs in one chat each keep their own turn",
    kind: "NEGATIVE",
    firstBoundCorrectly: firstFilm?.originating_message_id === firstTurn.assistantMessage.id,
    secondBoundCorrectly: secondFilm?.originating_message_id === secondTurn.assistantMessage.id,
    filmsAreDistinct: firstFilm?.id !== secondFilm?.id,
    detail: "A resolver that took the newest assistant message would bind both films to the second turn.",
  });
}
{
  // A run id that belongs to another conversation must not bind across chats.
  const userId = user();
  const home = terminalChat(userId);
  const elsewhere = terminalChat(userId);
  recordTurn(elsewhere, "dashboard_terminal", "vmxrun_foreign", "vimax-foreign");
  const context = launch(userId, home, "vmxrun_foreign");
  const artifact = await publishProduction({ context, production: production("Foreign Run") });
  record({
    name: "adversarial: a run id recorded in another conversation does not bind here",
    kind: "NEGATIVE",
    originatingMessageId: artifact?.originating_message_id ?? null,
    leakedAcrossConversations: artifact?.originating_message_id !== null,
    boundToLaunchConversation: artifact?.conversation_id === home.id,
    detail: "The lookup is scoped by conversation id as well as run id; dropping that scope would bind a film to another chat's turn.",
  });
}
{
  // No turn was ever recorded: the film must stay unbound rather than adopt one.
  const userId = user();
  const conversation = terminalChat(userId);
  recordTurn(conversation, "dashboard_terminal", "vmxrun_other", "vimax-other");
  const context = launch(userId, conversation, "vmxrun_missing");
  const artifact = await publishProduction({ context, production: production("No Turn") });
  record({
    name: "adversarial: a run with no recorded turn adopts no other turn",
    kind: "NEGATIVE",
    originatingMessageId: artifact?.originating_message_id ?? null,
    adoptedSomeoneElsesTurn: artifact?.originating_message_id !== null,
    detail: "A fallback to 'the latest assistant message in this conversation' would attach the film to an unrelated reply.",
  });
}
{
  // Cross-scope: another user must never reach this chat's film.
  const userId = user();
  const conversation = terminalChat(userId);
  const context = launch(userId, conversation, "vmxrun_scope");
  recordTurn(conversation, "dashboard_terminal", "vmxrun_scope", "vimax-scope");
  const film = await publishProduction({ context, production: production("Scoped") });
  const stranger = user();
  const other = terminalChat(userId);
  record({
    name: "adversarial: a film is scoped to its chat and its owner",
    kind: "NEGATIVE",
    strangerSeesIt: latestVimaxArtifact({ userId: stranger, conversationPublicId: conversation.public_id }) !== null,
    otherChatSeesIt: latestVimaxArtifact({ userId, conversationPublicId: other.public_id }) !== null,
    ownChatSeesIt: latestVimaxArtifact({ userId, conversationPublicId: conversation.public_id })?.id === film?.id,
    listedOnlyInOwnChat:
      JSON.stringify(
        artifactStore.listArtifactsForUser({ userId, conversationPublicId: conversation.public_id }).map((row) => row.id),
      ) === JSON.stringify([film?.id]),
  });
}

// --- which write path does the Garden surface actually use? --------------
const readSource = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const gardenAgentChat = readSource("src/app/components/hermes/garden-agent-chat.tsx");
const agentSession = readSource("src/app/components/hermes/use-agent-session.ts");
const externalTurnsRoute = readSource("src/app/api/hermes/sessions/[sessionId]/external-turns/route.ts");
const legacyChatRoute = readSource("src/app/api/chat-sessions/[sessionId]/route.ts");

const launchPathEvidence = {
  gardenAgentChatUsesSharedSession: /useAgentSession\("garden_chat"/.test(gardenAgentChat),
  sharedSessionPostsExternalTurns: /\/external-turns`/.test(agentSession),
  externalTurnsRouteRecordsCanonicalTurn: /recordExternalAgentTurn\(/.test(externalTurnsRoute),
  externalTurnsRouteAcceptsGardenSurface:
    /parseSurface\(body\.surface \?\? conversation\.surface\)/.test(externalTurnsRoute),
  legacyReplaceInPlaceRouteExists: /DELETE FROM chat_messages WHERE session_id = \?/.test(legacyChatRoute),
  legacyRouteReachedFromAgentChat: /api\/chat-sessions/.test(gardenAgentChat),
};

// --- invariants ----------------------------------------------------------
const invariants = [];
const say = (name, holds, detail) => invariants.push({ name, holds, detail });

const positives = cases.filter((entry) => entry.kind === "POSITIVE");
say(
  "a film binds to the asking turn on both surfaces",
  positives.every((entry) => entry.boundToAskingTurn === true),
  positives.map((entry) => `${entry.surface}: ${entry.boundToAskingTurn}`).join("; "),
);
say(
  "the Garden's legacy transcript can address the turn the film belongs to",
  positives
    .filter((entry) => entry.legacyTranscriptCanAddressTheTurn !== null)
    .every((entry) => entry.legacyTranscriptCanAddressTheTurn === true),
  "the Garden reads its transcript through the legacy projection, so the canonical id has to be there too",
);
say(
  "the context is opened before the turn exists, so the binding is genuinely resolved late",
  positives.every((entry) => entry.contextOpenedBeforeTurnExisted === true),
  "otherwise the test would be proving nothing about late resolution",
);
say(
  "two runs in one chat each keep their own turn",
  cases.find((entry) => entry.name.includes("two runs"))?.firstBoundCorrectly === true &&
    cases.find((entry) => entry.name.includes("two runs"))?.secondBoundCorrectly === true,
  "a 'newest assistant message' resolver would fail this",
);
say(
  "a run recorded in another conversation does not bind here",
  cases.find((entry) => entry.name.includes("another conversation"))?.leakedAcrossConversations === false,
  "cross-chat binding would show a film under a reply in a different chat",
);
say(
  "a run with no recorded turn stays unbound rather than adopting one",
  cases.find((entry) => entry.name.includes("no recorded turn"))?.adoptedSomeoneElsesTurn === false,
  "silently adopting a nearby turn is worse than staying unbound",
);
say(
  "a film is scoped to its chat and its owner",
  (() => {
    const entry = cases.find((item) => item.name.includes("scoped to its chat"));
    return entry?.strangerSeesIt === false && entry?.otherChatSeesIt === false && entry?.ownChatSeesIt === true && entry?.listedOnlyInOwnChat === true;
  })(),
  "cross-user or cross-chat visibility would be a leak, not a binding bug",
);
say(
  "the Garden surface records external agent turns through the canonical store, not the legacy replace-in-place route",
  launchPathEvidence.gardenAgentChatUsesSharedSession &&
    launchPathEvidence.sharedSessionPostsExternalTurns &&
    launchPathEvidence.externalTurnsRouteRecordsCanonicalTurn &&
    launchPathEvidence.legacyRouteReachedFromAgentChat === false,
  JSON.stringify(launchPathEvidence),
);

const allHold = invariants.every((entry) => entry.holds);

const summary = {
  generatedAt: new Date().toISOString(),
  subRoot: "ARTIFACT_TURN_BINDING",
  boundary: {
    publisher: "dashboard/src/lib/vimax/artifact.ts :: publishProduction -> assistantMessageFor",
    resolver: "dashboard/src/lib/conversations/external-agent-turns.ts :: findExternalAgentAssistantMessage",
    recorder: "dashboard/src/lib/conversations/external-agent-turns.ts :: recordExternalAgentTurn (+ dualWriteAssistantMessage)",
    method:
      "A throwaway SQLite database, the real store, the real publish path, and the real launch sequence: context opened first, turn recorded second, production published third.",
  },
  dataRoot,
  cases,
  launchPathEvidence,
  invariants,
  allInvariantsHold: allHold,
  brokenInvariants: invariants.filter((entry) => !entry.holds).map((entry) => entry.name),
  residualRisk: {
    name: "whole-transcript replacement preserving canonical_message_id across a content change",
    description:
      "PATCH /api/chat-sessions/[sessionId] deletes and reinserts the whole legacy message list, re-attaching each prior canonical_message_id by a (role, content) key. If an assistant row's content changes between saves, that key stops matching and the canonical link would be dropped.",
    whyNotExercisedHere:
      "That route is reached only from the legacy garden chats (workspace-client.tsx, garden-assistant.tsx), neither of which launches an external agent, and it authenticates through next-auth's getServerSession, which is not reachable from a unit harness without mocking Breadboard's own auth rather than an external edge.",
    experimentThatWouldSettleIt:
      "Drive the Electron app: launch a ViMax run in the garden agent chat, then edit and save the same cluster's transcript from the workspace client, then assert the film still resolves to its turn.",
    claimed: "neither safe nor broken — unexercised",
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

db.close();
fs.rmSync(dataRoot, { recursive: true, force: true });

for (const entry of invariants) console.log(`  ${entry.holds ? "HOLDS " : "BROKEN"} ${entry.name}`);
console.log(`[turn-binding] all invariants hold: ${allHold}`);
