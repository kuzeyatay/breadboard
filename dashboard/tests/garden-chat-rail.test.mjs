import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  readUnreadChats,
  writeUnreadChats,
} from "../src/lib/conversations/unread.ts";

// The Garden workspace's chat rail is the Terminal's rail. These tests hold the
// two promises that makes: the same component with the same controls, and every
// one of them answering about this garden alone while the Terminal keeps
// answering about everything.

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
const dashboardTerminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const sidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");
const uploadsPanel = source("../src/app/components/hermes/uploads-panel.tsx");
const hooksPanel = source("../src/app/components/hermes/hooks-panel.tsx");
const scheduledPanel = source("../src/app/components/hermes/terminal-scheduled-panel.tsx");
const searchDialog = source("../src/app/components/hermes/chat-search-dialog.tsx");
const sessionsRoute = source("../src/app/api/chat-sessions/route.ts");
const sessionRoute = source("../src/app/api/chat-sessions/[sessionId]/route.ts");
const searchRoute = source("../src/app/api/hermes/sessions/search/route.ts");
const uploadsRoute = source("../src/app/api/hermes/uploads/route.ts");
const hooksRoute = source("../src/app/api/hooks/route.ts");
const hooksStore = source("../src/lib/hooks/store.ts");
const hooksSchema = source("../src/lib/hooks/schema.ts");
const hooksDispatch = source("../src/lib/hooks/dispatch.ts");

test("the Garden workspace mounts the Terminal's own rail, not a list of its own", () => {
  assert.match(workspace, /import TerminalSidebar, \{/);
  assert.match(workspace, /<TerminalSidebar\b/);

  // Every control the rail offers is wired, so the row menu, the pin, the
  // Recents menu and its bulk delete all work here exactly as they do there.
  for (const handler of [
    "onNewChat",
    "onTogglePanel",
    "onOpenSearch",
    "onOpenChat",
    "onRenameChat",
    "onTogglePin",
    "onDeleteChat",
    "onDeleteChats",
    "onHighlightChat",
    "onToggleCollapsed",
  ]) {
    assert.match(workspace, new RegExp(`${handler}=`), `${handler} must be wired`);
  }

  // The hand-rolled list this replaced is gone: its inline rename input, its
  // "Delete?" popover, and the drag-to-any-width sidebar that could be left at
  // a width where the list was unreadable but still rendered.
  assert.doesNotMatch(workspace, /editingChatTitle/);
  assert.doesNotMatch(workspace, /confirmDeleteChatId/);
  assert.doesNotMatch(workspace, /leftSidebarWidth/);
});

test("the garden and Terminal rails keep their green surface", () => {
  // The shared rail class paints a green-tinted gradient and is unlayered CSS.
  // Both first-party navigation rails opt into that surface explicitly; paper
  // remains available to embedded callers that should merge into their page.
  assert.match(sidebar, /surface\?: "paper" \| "tinted"/);
  assert.match(sidebar, /surface = "paper"/);
  assert.match(
    sidebar,
    /\.\.\.\(surface === "paper" \? \{ background: "var\(--paper-surface\)" \} : null\)/,
  );
  assert.match(workspace, /surface="tinted"/);
  assert.match(dashboardTerminal, /<TerminalSidebar[\s\S]{0,120}?surface="tinted"/);
});

test("the rail's panel buttons are the Terminal's, minus the artifact archive", () => {
  assert.match(
    workspace,
    /const GARDEN_PANELS: readonly TerminalPanel\[\] = \[\s*"uploads",\s*"scheduled",\s*"hooks",\s*"processes",\s*\]/,
  );
  assert.match(workspace, /panels=\{GARDEN_PANELS\}/);

  // The rail defaults to every panel, so the Terminal keeps all of them without
  // naming them, and each one is gated on the same list.
  assert.match(sidebar, /panels = TERMINAL_PANELS/);
  for (const panel of ["artifacts", "uploads", "scheduled", "hooks", "processes"]) {
    assert.match(
      sidebar,
      new RegExp(`panels\\.includes\\("${panel}"\\)`),
      `${panel} must be gated on the panel list`,
    );
  }
  // Search is not a panel and is never gated away.
  assert.doesNotMatch(sidebar, /panels\.includes\("search"\)/);
});

test("the rail's rows come from a summary read, not from every transcript", () => {
  assert.match(workspace, /summary: "1"/);
  assert.match(sessionsRoute, /searchParams\.get\("summary"\) === "1"/);
  assert.match(sessionsRoute, /function readSessionSummaries\(/);

  // The marks the rail draws are read off the canonical conversation, which is
  // the same row the Terminal marks — one chat cannot be pinned in one view and
  // loose in the other.
  assert.match(sessionsRoute, /LEFT JOIN conversations c ON c\.id = cs\.conversation_id/);
  assert.match(sessionsRoute, /pinned: row\.pinned_at !== null/);
  assert.match(sessionsRoute, /isChatHighlight\(row\.highlight\)/);

  // "Working" is one query for the whole list, not a runtime lookup per chat.
  assert.match(
    sessionsRoute,
    /SELECT DISTINCT rs\.chat_session_id[\s\S]{0,220}WHERE r\.status = 'active'/,
  );
});

test("the Garden capability palette is scoped by canonical conversation id", () => {
  // A Garden addresses its legacy chat rows numerically, but Hermes capability
  // endpoints authorize either a runtime row id or the canonical `conv_*` id.
  // Passing the legacy id made the whole palette return session_not_found.
  assert.match(
    sessionsRoute,
    /c\.public_id AS conversation_public_id/,
  );
  assert.match(
    sessionsRoute,
    /conversationId: conversationId \?\? null/,
  );
  assert.match(
    workspace,
    /capabilitySessionId=\{activeChat\?\.conversationId \?\? null\}/,
  );
  assert.doesNotMatch(
    workspace,
    /capabilitySessionId=\{activeChatId\}/,
  );
});

test("pinning and highlighting a Garden chat write the canonical conversation", () => {
  assert.match(sessionRoute, /setConversationPinned\(conversation, body\.pinned\)/);
  assert.match(sessionRoute, /setConversationHighlight\(conversation, body\.highlight\)/);
  // An unknown slug is refused rather than stored as a color nothing can paint.
  assert.match(sessionRoute, /!isChatHighlight\(body\.highlight\)/);
  assert.match(workspace, /patchChatMark\(/);
  assert.match(workspace, /\{ pinned: !chat\.pinned \}/);
});

test("deleting a Garden chat removes it for good, on both sides of the seam", () => {
  assert.match(workspace, /window\.confirm\(/);
  // The legacy row and the canonical conversation go together; a stranded
  // conversation would still show up in search, Uploads and Processes.
  assert.match(
    sessionRoute,
    /DELETE FROM chat_sessions WHERE id = \?[\s\S]{0,220}deleteConversation\(conversation\)/,
  );
});

test("search, uploads, schedules, hooks and processes are all garden-scoped", () => {
  // Search answers in the id this surface opens a chat by, and never offers a
  // conversation it could not open.
  assert.match(searchDialog, /gardenSlug \? `&gardenSlug=\$\{encodeURIComponent\(gardenSlug\)\}` : ""/);
  assert.match(searchRoute, /AND default_garden_id = \? AND legacy_chat_session_id IS NOT NULL/);
  assert.match(searchRoute, /String\(row\.legacy_chat_session_id\)/);

  assert.match(uploadsRoute, /AND c\.default_garden_id = \?/);
  assert.match(uploadsPanel, /gardenSlug\s*\n?\s*\? `\/api\/hermes\/uploads\?gardenSlug=/);

  assert.match(
    scheduledPanel,
    /job\.surface === "garden_chat" && job\.gardenSlug === gardenSlug/,
  );

  assert.match(hooksRoute, /searchParams\.get\("gardenSlug"\)/);
  assert.match(hooksStore, /AND garden_slug = \? ORDER BY created_at DESC/);
  assert.match(hooksPanel, /gardenSlug \? `\/api\/hooks\?gardenSlug=/);

  // Each panel is handed this garden and only this garden.
  for (const wiring of [
    /<UploadsPanel[\s\S]{0,220}gardenSlug=\{clusterSlug\}/,
    /<TerminalScheduledPanel[\s\S]{0,120}surface="garden_chat"[\s\S]{0,120}gardenSlug=\{clusterSlug\}/,
    /<HooksPanel gardenSlug=\{clusterSlug\}/,
    /<ProcessesPanel[\s\S]{0,120}gardenSlug=\{clusterSlug\}/,
  ]) {
    assert.match(workspace, wiring);
  }
});

test("a hook bound to a garden answers inside it, and is re-authorized each firing", () => {
  assert.match(hooksSchema, /ensureColumn\(db, "hooks", "garden_slug", "garden_slug TEXT"\)/);
  assert.match(hooksDispatch, /authorizeGardenAccess\(hook\.user_id, gardenSlug\)/);
  assert.match(
    hooksDispatch,
    /const surface = garden \? \("garden_chat" as const\) : \("dashboard_terminal" as const\)/,
  );
  assert.match(hooksDispatch, /defaultGardenId: garden\?\.clusterId \?\? null/);
  assert.match(hooksDispatch, /surfaceContext: \{ activeGardenSlug: garden\.slug \}/);
});

test("the public-chats switch stays on the header of the list it filters", () => {
  assert.match(sidebar, /recentsAction\?: React\.ReactNode/);
  assert.match(sidebar, /\{mode === "idle" \? recentsAction : null\}/);
  assert.match(workspace, /recentsAction=\{/);
  assert.match(workspace, /setViewPublicChats\(\(value\) => !value\)/);
});

test("each rail keeps its own unread dots, so two rails cannot erase each other", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };

  writeUnreadChats(storage, new Set(["conv_a", "conv_b"]));
  writeUnreadChats(storage, new Set(["17"]), "aurora");

  // The Terminal keeps the original, unscoped entry, so nobody loses the dots
  // they already had.
  assert.deepEqual([...readUnreadChats(storage)], ["conv_a", "conv_b"]);
  assert.deepEqual([...readUnreadChats(storage, "aurora")], ["17"]);
  assert.deepEqual([...readUnreadChats(storage, "other-garden")], []);

  assert.match(workspace, /readUnreadChats\(window\.localStorage, clusterSlug\)/);
  assert.match(workspace, /writeUnreadChats\(window\.localStorage, unreadChats, clusterSlug\)/);
});
