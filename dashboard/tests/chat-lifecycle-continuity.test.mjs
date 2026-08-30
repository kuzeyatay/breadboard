import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const panel = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const terminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const gardenChat = source(
  "../src/app/components/hermes/garden-agent-chat.tsx",
);
const gardenWorkspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const gardenAssistant = source("../src/app/garden/garden-assistant.tsx");
const sessionHook = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const sessionClient = source("../src/lib/hermes/session-client.ts");
const sessionRoute = source("../src/app/api/hermes/sessions/route.ts");
const messageRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
);
const directRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/direct/route.ts",
);
const presentation = source("../src/lib/hermes/session-presentation.ts");
const runClock = source(
  "../src/app/components/hermes/external-run-clock.ts",
);
const maxResearchCard = source(
  "../src/app/components/hermes/inline-max-research-run.tsx",
);
const chatSessionsRoute = source("../src/app/api/chat-sessions/route.ts");
const quartzChatRoute = source("../src/app/api/quartz-ai/chat/route.ts");
const quartzSessionsRoute = source("../src/app/api/quartz-ai/sessions/route.ts");
const quartzPanel = source(
  "../../quartz/quartz/components/scripts/breadboardAI.inline.ts",
);

test("the first durable id does not replace its visible turn with a chat loader", () => {
  assert.match(panel, /createdSessionId\?: string \| null/);
  assert.match(
    panel,
    /const visibleConversationJustCreated =\s*Boolean\(sessionId\) && sessionId === createdSessionId;/,
  );
  assert.match(
    panel,
    /loadingTranscript \|\| \(!visibleConversationJustCreated && !artifactsReady\)/,
  );
  for (const owner of [terminal, gardenChat]) {
    assert.match(owner, /createdSessionId=\{session\.createdSessionId\}/);
  }
  assert.match(
    gardenWorkspace,
    /activeChatId !== null && activeChatId === createdChatId/,
  );
});

test("reopening a live chat revalidates settled prefetches", () => {
  const openSession = sessionHook.slice(
    sessionHook.indexOf("const openSession = useCallback("),
    sessionHook.indexOf("const refreshSession = useCallback("),
  );
  assert.match(
    openSession,
    /loadHermesSessionDetail\(surface, id, \{\s*revalidateAfterPending: true/,
  );
  assert.doesNotMatch(openSession, /reuseRecentPrefetch:\s*true/);
  assert.match(
    sessionClient,
    /if \(!options\.revalidateAfterPending\) return shared;[\s\S]*return loadHermesSessionDetail\(surface, id, \{ signal: options\.signal \}\);/,
  );
  assert.match(openSession, /setRunToResume\(\{/);
  assert.match(openSession, /resumePendingConversation\(id, restoredMessages, viewEpoch\)/);
});

test("response clocks persist the original visible start across every transport", () => {
  assert.match(sessionHook, /responseStartedAt: turnCreatedAt/);
  assert.match(sessionRoute, /responseStartedAt/);
  assert.match(messageRoute, /responseStartedAt/);
  assert.match(directRoute, /responseStartedAt/);
  assert.match(presentation, /metadata\.responseStartedAt/);
  assert.match(
    panel,
    /message\.responseStartedAt \?\? message\.createdAt/,
  );
});

test("external run clocks are keyed to durable run timestamps, not card mounts", () => {
  assert.match(runClock, /const startedAtByRunId = new Map<string, number>\(\)/);
  assert.match(runClock, /MAX_REMEMBERED_RUNS = 256/);
  assert.match(sessionHook, /rememberExternalRunStartedAt\(/);
  assert.match(maxResearchCard, /externalRunStartedAtMs\(runId\)/);
  assert.match(maxResearchCard, /persistedDurationMs/);
  assert.doesNotMatch(maxResearchCard, /setSeconds\(\(value\) => value \+ 1\)/);

  const resetters = fs
    .readdirSync(new URL("../src/app/components/hermes/", import.meta.url))
    .filter((name) => /^inline-.*-run\.tsx$/.test(name))
    .map((name) => source(`../src/app/components/hermes/${name}`))
    .filter((file) => /setElapsed|setElapsedSeconds/.test(file));
  for (const card of resetters) {
    assert.doesNotMatch(card, /startedRef\.current = Date\.now\(\)/);
    assert.doesNotMatch(card, /const started = Date\.now\(\)/);
  }
});

test("an external run clock can move backward to durable history but never reset forward", async () => {
  const clock = await import(
    new URL(
      "../src/app/components/hermes/external-run-clock.ts",
      import.meta.url,
    ).href
  );
  const runId = `clock-${crypto.randomUUID()}`;
  clock.rememberExternalRunStartedAt(runId, "2026-08-28T10:00:10.000Z");
  clock.rememberExternalRunStartedAt(runId, "2026-08-28T10:00:20.000Z");
  assert.equal(
    clock.externalRunStartedAtMs(runId),
    Date.parse("2026-08-28T10:00:10.000Z"),
  );
  clock.rememberExternalRunStartedAt(runId, "2026-08-28T10:00:00.000Z");
  assert.equal(
    clock.externalRunStartedAtMs(runId),
    Date.parse("2026-08-28T10:00:00.000Z"),
  );
});

test("a health downgrade cannot swap transports after a chat has engaged", () => {
  assert.match(terminal, /const \[runtimeSurfaceEngaged, setRuntimeSurfaceEngaged\]/);
  assert.match(
    terminal,
    /health\.status === "checking" \|\|\s*runtimeSurfaceEngaged/,
  );
  assert.match(
    terminal,
    /if \(session\.sessionId \|\| session\.messages\.length > 0\) \{\s*onConversationEngaged\(\);/,
  );
});

test("Garden Workspace checkpoints a prompt before runtime dispatch", () => {
  const checkpointAt = gardenWorkspace.indexOf("await reserveGardenTurnCheckpoint");
  const dispatchAt = gardenWorkspace.indexOf('const res = await fetch("/api/chat"');
  assert.ok(checkpointAt >= 0 && dispatchAt > checkpointAt);
  assert.match(gardenWorkspace, /const clientMessageId = crypto\.randomUUID\(\)/);
  assert.match(gardenWorkspace, /assistantMsg\.id = checkpoint\.assistantMessageId/);
  assert.match(gardenWorkspace, /chatPersistenceChainsRef/);
  assert.match(gardenWorkspace, /chatPersistenceVersionsRef/);
  assert.match(gardenWorkspace, /inFlightChatMessagesRef/);
});

test("Garden Workspace restores active background turns without loading every chat", () => {
  assert.match(chatSessionsRoute, /sessionFilter/);
  assert.match(chatSessionsRoute, /r\.status = 'active'/);
  assert.match(chatSessionsRoute, /externalAgentActive/);
  assert.match(gardenWorkspace, /sessionId: String\(sessionId\)/);
  assert.match(gardenWorkspace, /activeServerChatIds/);
  assert.match(gardenWorkspace, /recoveredAssistantMessage/);
  assert.match(gardenWorkspace, /visibleAgentConnection/);
});

test("the page-side Garden assistant uses the same durable checkpoint contract", () => {
  const checkpointAt = gardenAssistant.indexOf(
    "await reserveGardenTurnCheckpoint",
  );
  const dispatchAt = gardenAssistant.indexOf("const response = await fetch('/api/chat'");
  assert.ok(checkpointAt >= 0 && dispatchAt > checkpointAt);
  assert.match(gardenAssistant, /const clientMessageId = crypto\.randomUUID\(\)/);
  assert.match(gardenAssistant, /persistenceChainsRef/);
  assert.match(gardenAssistant, /withRecoveredAssistant/);
  assert.match(gardenAssistant, /activeChatIdsKey/);
  assert.match(gardenAssistant, /visibleAgentConnection/);
});

test("Quartz dispatch is durable before its replaceable page viewer attaches", () => {
  const pumpStarts = quartzChatRoute.match(/startSessionEventPump\(/g) ?? [];
  assert.equal(pumpStarts.length, 3);
  const dispatchAt = quartzPanel.indexOf("const dispatchResponse = await fetch");
  const viewerAt = quartzPanel.indexOf("await streamEvents(state.sessionId!");
  assert.ok(dispatchAt >= 0 && viewerAt > dispatchAt);
  assert.match(quartzSessionsRoute, /active: activeRun !== null/);
  assert.match(quartzPanel, /reconnectActiveSession/);
  assert.match(quartzPanel, /window\.addCleanup\(\(\) => \{[\s\S]*abortController\?\.abort\(\)/);
  assert.match(quartzPanel, /generation !== viewGeneration/);
});
