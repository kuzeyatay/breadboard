import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-settings-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const inspection = await import("../src/lib/conversations/memory-inspection.ts");
const account = await import("../src/lib/chatmock-account.ts");
const login = await import("../src/lib/chatmock-login.ts");

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const dialog = source("../src/app/components/settings-dialog.tsx");
const accountPanel = source("../src/app/components/settings-accounts.tsx");
const memoryPanel = source("../src/app/components/settings-agent-memory.tsx");
const agentSession = source("../src/app/components/hermes/use-agent-session.ts");
const eventStream = source("../src/lib/hermes/event-stream.ts");
const directTurns = source("../src/lib/conversations/direct-turn-service.ts");
const externalTurns = source("../src/lib/conversations/external-agent-turns.ts");
const turnService = source("../src/lib/conversations/turn-service.ts");
const accountRoute = source("../src/app/api/chatmock/account/route.ts");
const loginRoute = source("../src/app/api/chatmock/account/login/route.ts");
const memoryRoute = source("../src/app/api/agent-memory/route.ts");
const durableRoute = source("../src/app/api/agent-memory/durable/[memoryId]/route.ts");
const profileRoute = source("../src/app/api/agent-memory/profile/route.ts");
const conversationRoute = source(
  "../src/app/api/agent-memory/conversations/[conversationId]/route.ts",
);

const homes = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chatgpt-home-"));

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(homes, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM clusters;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')",
  ).run();
  db.prepare(
    "INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (10, 1, 'Aurora Garden', 'aurora', 'private', 0)",
  ).run();
  fs.rmSync(homes, { recursive: true, force: true });
  fs.mkdirSync(homes, { recursive: true });
});

function jwt(claims, issuedAt) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "none" })}.${encode({ ...claims, iat: issuedAt })}.signature`;
}

function writeProfile(home, { email, plan, accountId, issuedAt, lastRefresh }) {
  const directory = path.join(homes, home);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        id_token: jwt({ email }, issuedAt),
        access_token: jwt(
          { "https://api.openai.com/auth": { chatgpt_plan_type: plan } },
          issuedAt,
        ),
        refresh_token: "rt.1.test",
        account_id: accountId,
      },
      ...(lastRefresh ? { last_refresh: lastRefresh } : {}),
    }),
  );
  return directory;
}

// --- ChatGPT account reading -------------------------------------------------

test("the signed-in ChatGPT account is read from the profile ChatMock resolves to", () => {
  writeProfile(".chatgpt-local", {
    email: "kuzey@example.test",
    plan: "plus",
    accountId: "acct-1",
    issuedAt: 1_700_000_000,
    lastRefresh: "2026-07-20T14:37:37.265Z",
  });
  const result = account.readChatmockAccount({}, homes);
  assert.equal(result.signedIn, true);
  assert.equal(result.email, "kuzey@example.test");
  assert.equal(result.plan, "Plus");
  assert.equal(result.accountId, "acct-1");
  assert.equal(result.profile, "chatmock");
  assert.equal(result.lastRefresh, "2026-07-20T14:37:37.265Z");
});

test("a missing profile reports signed out rather than throwing", () => {
  const result = account.readChatmockAccount({}, homes);
  assert.equal(result.signedIn, false);
  assert.equal(result.authPath, null);
  assert.deepEqual(result.fallbackProfiles, []);
});

test("the freshest of the ChatMock and Codex profiles wins, matching the proxy", () => {
  writeProfile(".chatgpt-local", {
    email: "stale@example.test",
    plan: "free",
    accountId: "acct-stale",
    issuedAt: 1_600_000_000,
    lastRefresh: "2026-01-01T00:00:00.000Z",
  });
  writeProfile(".codex", {
    email: "fresh@example.test",
    plan: "pro",
    accountId: "acct-fresh",
    issuedAt: 1_800_000_000,
    lastRefresh: "2026-07-01T00:00:00.000Z",
  });
  const result = account.readChatmockAccount({}, homes);
  assert.equal(result.email, "fresh@example.test");
  assert.equal(result.plan, "Pro");
  assert.equal(result.profile, "codex");
  assert.equal(result.fallbackProfiles.length, 1);
  assert.match(result.fallbackProfiles[0], /\.chatgpt-local/);
});

test("an explicitly configured home stays authoritative over the default stores", () => {
  const configured = writeProfile("configured", {
    email: "configured@example.test",
    plan: "team",
    accountId: "acct-configured",
    issuedAt: 1_700_000_000,
  });
  writeProfile(".chatgpt-local", {
    email: "default@example.test",
    plan: "plus",
    accountId: "acct-default",
    issuedAt: 1_900_000_000,
  });
  const result = account.readChatmockAccount({ CHATGPT_LOCAL_HOME: configured }, homes);
  assert.equal(result.email, "configured@example.test");
  assert.equal(result.profile, "configured");
});

test("a malformed configured profile falls through to the local stores", () => {
  const configured = path.join(homes, "broken");
  fs.mkdirSync(configured, { recursive: true });
  fs.writeFileSync(path.join(configured, "auth.json"), "not json");
  writeProfile(".chatgpt-local", {
    email: "fallback@example.test",
    plan: "plus",
    accountId: "acct-fallback",
    issuedAt: 1_700_000_000,
  });
  const result = account.readChatmockAccount({ CHATGPT_LOCAL_HOME: configured }, homes);
  assert.equal(result.email, "fallback@example.test");
});

test("signing out archives the active profile and leaves other profiles alone", () => {
  writeProfile(".chatgpt-local", {
    email: "active@example.test",
    plan: "plus",
    accountId: "acct-active",
    issuedAt: 1_900_000_000,
  });
  writeProfile(".codex", {
    email: "codex@example.test",
    plan: "plus",
    accountId: "acct-codex",
    issuedAt: 1_700_000_000,
  });

  const result = account.signOutChatmockAccount({}, homes, new Date("2026-07-25T12:00:00Z"));
  assert.equal(result.signedOut, true);
  assert.match(result.archivedPath, /auth\.json\.invalidated-20260725T120000Z$/);
  assert.equal(fs.existsSync(path.join(homes, ".chatgpt-local", "auth.json")), false);
  assert.equal(fs.existsSync(result.archivedPath), true);
  // The Codex CLI's own sign-in must survive a Breadboard sign-out.
  assert.equal(fs.existsSync(path.join(homes, ".codex", "auth.json")), true);
  assert.equal(account.readChatmockAccount({}, homes).email, "codex@example.test");
});

test("signing out with no profile present reports a reason instead of failing", () => {
  const result = account.signOutChatmockAccount({}, homes);
  assert.equal(result.signedOut, false);
  assert.equal(result.archivedPath, null);
  assert.match(result.detail, /No signed-in profile/);
});

// --- login flow helpers ------------------------------------------------------

test("the authorization URL is picked out of ChatMock's login output", () => {
  const output = [
    "Starting local login server on http://localhost:1455",
    "If your browser did not open, navigate to:",
    "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x&code_challenge=abc&state=s",
    "paste the full redirect URL here",
  ].join("\n");
  assert.equal(
    login.extractAuthorizationUrl(output),
    "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x&code_challenge=abc&state=s",
  );
});

test("non-authorization URLs in the login output are ignored", () => {
  assert.equal(
    login.extractAuthorizationUrl("see https://github.com/RayBytes/ChatMock for help"),
    null,
  );
});

test("a busy callback port is explained rather than reported as a generic failure", () => {
  assert.match(login.describeLoginExit(13, ""), /1455 is already in use/);
  assert.match(
    login.describeLoginExit(1, "ERROR: No OAuth client id configured."),
    /^No OAuth client id configured\.$/,
  );
  assert.match(login.describeLoginExit(2, "noise"), /exited with code 2/);
});

test("the initial login state is idle and exposes no stale URL", () => {
  const state = login.readChatmockLoginState();
  assert.equal(state.status, "idle");
  assert.equal(state.authorizationUrl, null);
});

// --- agent memory inspection -------------------------------------------------

function remember(userId, content, overrides = {}) {
  return memory.saveDurableMemory({
    userId,
    content,
    kind: "project_fact",
    scope: "global",
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
    ...overrides,
  });
}

test("the overview lists a user's memories with their source chat and garden name", async () => {
  const conversation = store.createConversation({ userId: 1, title: "Aurora planning" });
  remember(1, "The lab report is due in week 6", {
    sourceConversationId: conversation.id,
    scope: "garden",
    scopeId: "10",
  });
  remember(1, "Prefers short answers", { kind: "preference", state: "candidate", confidence: 0.4 });

  const overview = await inspection.loadAgentMemoryOverview(1);
  assert.equal(overview.durable.length, 2);
  assert.equal(overview.counts.confirmed, 1);
  assert.equal(overview.counts.candidate, 1);
  assert.equal(overview.counts.superseded, 0);

  const gardenMemory = overview.durable.find((item) => item.scope === "garden");
  assert.equal(gardenMemory.sourceConversationTitle, "Aurora planning");
  assert.equal(gardenMemory.scopeLabel, "Aurora Garden");
  // Confirmed entries sort ahead of unreviewed candidates.
  assert.equal(overview.durable[0].state, "confirmed");
});

test("one user's memory is never visible to another", () => {
  remember(1, "Alice's private constraint");
  remember(2, "Bob's private constraint");
  const alice = inspection.listDurableMemories(1);
  assert.equal(alice.length, 1);
  assert.equal(alice[0].content, "Alice's private constraint");
  assert.equal(inspection.countDurableMemories(2).confirmed, 1);
});

test("forgetting removes a memory from retrieval and is reflected in the counts", () => {
  const saved = remember(1, "Use metric units everywhere");
  const conversation = store.createConversation({ userId: 1, title: "Chat" });
  assert.equal(
    memory.retrieveDurableMemories({
      userId: 1,
      currentConversationId: conversation.id,
      query: "metric units everywhere",
    }).length,
    1,
  );

  assert.equal(inspection.forgetDurableMemory(1, saved.id), true);
  assert.equal(
    memory.retrieveDurableMemories({
      userId: 1,
      currentConversationId: conversation.id,
      query: "metric units everywhere",
    }).length,
    0,
    "a forgotten memory must not come back through retrieval",
  );
  assert.equal(inspection.countDurableMemories(1).superseded, 1);
  // Forgetting is idempotent, and hidden from the default listing.
  assert.equal(inspection.forgetDurableMemory(1, saved.id), false);
  assert.equal(inspection.listDurableMemories(1).length, 0);
  assert.equal(inspection.listDurableMemories(1, { includeSuperseded: true }).length, 1);
});

test("forgetting and deleting another user's memory is refused", () => {
  const saved = remember(2, "Bob's decision");
  assert.equal(inspection.forgetDurableMemory(1, saved.id), false);
  assert.equal(inspection.deleteDurableMemory(1, saved.id), false);
  assert.equal(inspection.countDurableMemories(2).confirmed, 1);
});

test("permanent deletion only applies to entries already forgotten", () => {
  const saved = remember(1, "Temporary scaffolding note");
  assert.equal(inspection.deleteDurableMemory(1, saved.id), false, "active rows are protected");
  inspection.forgetDurableMemory(1, saved.id);
  assert.equal(inspection.deleteDurableMemory(1, saved.id), true);
  assert.equal(inspection.listDurableMemories(1, { includeSuperseded: true }).length, 0);
});

test("confirming a candidate raises it to full retrieval weight", () => {
  const saved = remember(1, "Deploys go out on Thursdays", {
    state: "candidate",
    confidence: 0.4,
  });
  assert.equal(inspection.confirmDurableMemory(1, saved.id), true);
  const [row] = inspection.listDurableMemories(1);
  assert.equal(row.state, "confirmed");
  assert.ok(row.confidence >= 0.9);
  assert.equal(row.lastConfirmedAt !== null, true);
  assert.equal(inspection.confirmDurableMemory(1, saved.id), false);
});

test("editing changes only an active memory owned by the current user", () => {
  const saved = remember(1, "The user's name is Kuzey");
  assert.deepEqual(
    inspection.updateDurableMemoryContent(
      1,
      saved.id,
      "  The user's name is Kuzey Atay.  ",
    ),
    { status: "updated", content: "The user's name is Kuzey Atay." },
  );
  assert.equal(
    inspection.listDurableMemories(1)[0].content,
    "The user's name is Kuzey Atay.",
  );
  assert.equal(
    memory.saveDurableMemory({
      userId: 1,
      content: "The user's name is Kuzey Atay.",
      kind: "project_fact",
      scope: "global",
      state: "confirmed",
      confidence: 0.9,
      salience: 0.8,
    }).id,
    saved.id,
    "editing must update the deduplication key instead of creating a duplicate",
  );
  const duplicate = remember(1, "The user's preferred name is Kuzey");
  assert.deepEqual(
    inspection.updateDurableMemoryContent(
      1,
      saved.id,
      "The user's preferred name is Kuzey",
    ),
    { status: "conflict" },
  );
  assert.equal(duplicate.id !== saved.id, true);
  assert.deepEqual(
    inspection.updateDurableMemoryContent(2, saved.id, "Not allowed"),
    { status: "not_found" },
  );
  assert.deepEqual(
    inspection.updateDurableMemoryContent(1, saved.id, "password: hunter2"),
    { status: "rejected" },
  );
  inspection.forgetDurableMemory(1, saved.id);
  assert.deepEqual(
    inspection.updateDurableMemoryContent(1, saved.id, "Bring it back"),
    { status: "not_found" },
  );
});

test("chats appear in the working-memory list only once they hold compacted state", () => {
  const conversation = store.createConversation({ userId: 1, title: "Long thread" });
  memory.loadConversationMemoryState(conversation.id);
  assert.equal(inspection.listConversationMemoryStates(1).length, 0);

  db.prepare(
    `UPDATE conversation_memory_state
     SET rolling_summary = 'Current goal: finish the report',
         working_state = ?
     WHERE conversation_id = ?`,
  ).run(
    JSON.stringify({
      currentGoal: "finish the report",
      decisions: ["Use the 2026 dataset"],
      knownFacts: [],
      completedActions: [],
      openQuestions: [],
      referencedGardenIds: [10],
      referencedPages: [],
      referencedFiles: ["C:/tmp/report.md"],
      temporaryPreferences: [],
    }),
    conversation.id,
  );

  const [state] = inspection.listConversationMemoryStates(1);
  assert.equal(state.conversationId, conversation.id);
  assert.equal(state.title, "Long thread");
  assert.deepEqual(state.workingState.decisions, ["Use the 2026 dataset"]);
  assert.deepEqual(state.workingState.referencedFiles, ["C:/tmp/report.md"]);

  assert.equal(inspection.clearConversationMemoryState(1, conversation.id), true);
  assert.equal(inspection.listConversationMemoryStates(1).length, 0);
  assert.equal(
    inspection.clearConversationMemoryState(2, conversation.id),
    false,
    "another user cannot clear this chat's memory",
  );
});

test("malformed working state degrades to an empty structure", () => {
  const conversation = store.createConversation({ userId: 1, title: "Broken state" });
  memory.loadConversationMemoryState(conversation.id);
  db.prepare(
    `UPDATE conversation_memory_state
     SET rolling_summary = 'something', working_state = 'not json'
     WHERE conversation_id = ?`,
  ).run(conversation.id);
  const [state] = inspection.listConversationMemoryStates(1);
  assert.deepEqual(state.workingState.decisions, []);
  assert.deepEqual(state.workingState.referencedPages, []);
});

// --- wiring ------------------------------------------------------------------

test("Settings sits below Usage and opens as a sibling Intelligence popover", () => {
  const usageIndex = composer.indexOf("<UsageLimitsPopover");
  const settingsIndex = composer.indexOf("current === 'settings'");
  assert.ok(usageIndex > 0, "the Usage entry must still be present");
  assert.ok(settingsIndex > usageIndex, "Settings must render after Usage");
  assert.match(composer, /presentation="popover"/);
  assert.match(composer, /intelligencePanel === 'settings'/);
  assert.match(composer, /open=\{intelligencePanel === 'usage'\}/);
  assert.match(composer, /showBackdrop=\{false\}/);
  assert.doesNotMatch(composer, /setShowSettings/);
});

test("settings supports both a focus-trapped modal and an inline popover", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /presentation\?: "modal" \| "popover"/);
  assert.match(dialog, /aria-modal=\{presentation === "modal" \? "true" : undefined\}/);
  assert.match(dialog, /if \(presentation === "popover"\) return panel/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /previouslyFocused\?\.focus\(\)/);
  assert.match(dialog, /<SettingsAccounts onOpenProviders=/);
  assert.match(dialog, /<SettingsAgentMemory \/>/);
  assert.match(dialog, /role="tablist"/);
  // Shares the application's surface tokens rather than ad-hoc colors.
  assert.match(dialog, /neu-dialog/);
  assert.match(dialog, /var\(--paper-raised\)/);
});

test("the account panel drives ChatMock's own login flow and polls for completion", () => {
  assert.match(accountPanel, /fetch\("\/api\/chatmock\/account\/login", \{ method: "POST" \}\)/);
  assert.match(accountPanel, /fetch\("\/api\/chatmock\/account", \{ method: "DELETE" \}\)/);
  assert.match(accountPanel, /awaiting_authorization/);
  assert.match(accountPanel, /window\.setInterval/);
  assert.match(accountPanel, /window\.open\(payload\.login\.authorizationUrl/);
  // The browser's existing ChatGPT session is the main switching pitfall.
  assert.match(accountPanel, /private window/);
});

test("the memory panel reads the overview and offers edit, keep, forget, and delete", () => {
  assert.match(memoryPanel, /\/api\/agent-memory\?includeForgotten=1/);
  assert.match(memoryPanel, />\s*Edit\s*</);
  assert.match(memoryPanel, /JSON\.stringify\(\{ content \}\)/);
  assert.match(memoryPanel, /maxLength=\{1000\}/);
  assert.match(memoryPanel, /\/api\/agent-memory\/durable\/\$\{memory\.id\}`, \{ method: "PATCH" \}/);
  assert.match(memoryPanel, /\/api\/agent-memory\/durable\/\$\{memory\.id\}`, \{ method: "DELETE" \}/);
  assert.match(memoryPanel, /permanent=1/);
  assert.match(memoryPanel, /\/api\/agent-memory\/conversations\/\$\{conversation\.conversationId\}/);
  assert.match(memoryPanel, /neu-surface-subtle/);
  assert.match(memoryPanel, />\s*Memory\s*</);
  assert.match(memoryPanel, /fetch\("\/api\/agent-memory\/profile"/);
  assert.match(memoryPanel, /HERMES_SESSIONS_CHANGED_EVENT/);
  assert.match(memoryPanel, /handleMessageActivity/);
  assert.match(agentSession, /notifyHermesSessionsChanged\(surface\)/);
  assert.doesNotMatch(memoryPanel, />\s*Saved details\s*</);
  assert.doesNotMatch(memoryPanel, />\s*Build summary\s*</);
  assert.doesNotMatch(memoryPanel, />\s*Update now\s*</);
  assert.doesNotMatch(memoryPanel, />\s*Build from eligible chats\s*</);
  assert.doesNotMatch(memoryPanel, />\s*Use summary in chats\s*</);
  assert.doesNotMatch(profileRoute, /updateMemoryProfileSettings/);
});

test("every completed message path schedules and announces memory activity", () => {
  for (const [name, implementation] of [
    ["agent runtime", eventStream],
    ["direct provider", directTurns],
    ["external agent", externalTurns],
    ["clarification", turnService],
  ]) {
    assert.match(
      implementation,
      /scheduleMemoryProfileSynthesisForConversation\(/,
      `${name} must schedule profile regeneration`,
    );
  }
  assert.ok(
    agentSession.match(/notifyHermesSessionsChanged\(surface\)/g)?.length >= 3,
    "live agent, direct-provider, and external-agent completions must refresh an open Memory tab",
  );
});

test("every settings route authenticates before touching credentials or memory", () => {
  for (const [name, route] of [
    ["account", accountRoute],
    ["login", loginRoute],
    ["memory overview", memoryRoute],
    ["durable memory", durableRoute],
    ["memory profile", profileRoute],
    ["conversation memory", conversationRoute],
  ]) {
    assert.match(route, /requireUserId\(\)/, `${name} route must require a user`);
    assert.match(route, /routeErrorResponse/, `${name} route must map errors`);
  }
  // Memory mutations are scoped by the caller's own id, never a client-supplied one.
  assert.match(durableRoute, /forgetDurableMemory\(userId, memoryId\)/);
  assert.match(durableRoute, /deleteDurableMemory\(userId, memoryId\)/);
  assert.match(
    durableRoute,
    /updateDurableMemoryContent\(\s*userId,\s*memoryId,\s*body\.content/,
  );
  assert.match(conversationRoute, /clearConversationMemoryState\(userId, conversationId\)/);
});
