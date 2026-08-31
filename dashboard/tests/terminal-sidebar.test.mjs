import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { searchConversations, conversationSearchTerms } from "../src/lib/conversations/search.ts";
import { chatHighlight, isChatHighlight } from "../src/lib/conversations/highlights.ts";
import {
  chatActivityById,
  nextUnreadChats,
  readUnreadChats,
  sameChatIds,
  writeUnreadChats,
} from "../src/lib/conversations/unread.ts";
import {
  collectUploads,
  dataUrlByteLength,
  formatUploadSize,
  messageAttachments,
  parseUploadId,
} from "../src/lib/conversations/uploads.ts";
import { parseScheduleRequest } from "../src/lib/schedules/natural-language.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const sidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");
const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const gardenWorkspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
const agentSession = source("../src/app/components/hermes/use-agent-session.ts");
const globalCss = source("../src/app/globals.css");
const historyClient = source("../src/app/components/hermes/history-client.tsx");
const searchDialog = source("../src/app/components/hermes/chat-search-dialog.tsx");
const uploadsPanel = source("../src/app/components/hermes/uploads-panel.tsx");
const scheduledPanel = source("../src/app/components/hermes/terminal-scheduled-panel.tsx");
const commandHub = source("../src/app/components/hermes/command-hub.tsx");
const sessionRoute = source("../src/app/api/hermes/sessions/[sessionId]/route.ts");
const searchRoute = source("../src/app/api/hermes/sessions/search/route.ts");
const uploadsRoute = source("../src/app/api/hermes/uploads/route.ts");
const uploadContentRoute = source("../src/app/api/hermes/uploads/[uploadId]/content/route.ts");
const conversationSchema = source("../src/lib/conversations/schema.ts");
const conversationStore = source("../src/lib/conversations/store.ts");

test("the rail carries the seven fixed actions, in order, above the chat list", () => {
  const nav = sidebar.slice(
    sidebar.indexOf('<nav aria-label="Terminal actions"'),
    sidebar.indexOf("</nav>"),
  );
  const order = ["New chat", "Artifacts", "Uploads", "Search", "Scheduled", "Hooks", "Processes"].map((label) =>
    nav.indexOf(`label="${label}"`),
  );
  assert.ok(order.every((index) => index >= 0), "every rail action must render");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the rail keeps its order");

  // Artifacts, Uploads and Scheduled open the panel beside the transcript;
  // Search is a dialog, and New chat acts immediately.
  assert.match(nav, /label="Artifacts"[\s\S]{0,220}onClick=\{\(\) => onTogglePanel\("artifacts"\)\}/);
  assert.match(nav, /label="Uploads"[\s\S]{0,220}onClick=\{\(\) => onTogglePanel\("uploads"\)\}/);
  assert.match(nav, /label="Scheduled"[\s\S]{0,220}onClick=\{\(\) => onTogglePanel\("scheduled"\)\}/);
  assert.match(nav, /label="Search"[\s\S]{0,120}onClick=\{onOpenSearch\}/);
});

test("an untouched new chat cannot be selected twice", () => {
  assert.match(sidebar, /newChatDisabled\?: boolean/);
  assert.match(sidebar, /disabled=\{newChatDisabled\}/);
  assert.match(
    terminal,
    /const blankSavedChatSelected =\s*!temporaryChat[\s\S]{0,180}!currentChatActive/,
  );
  assert.match(
    terminal,
    /function startNewSavedChat\(\) \{[\s\S]{0,320}if \(blankSavedChatSelected\) return;/,
  );
  assert.match(terminal, /newChatDisabled=\{blankSavedChatSelected\}/);
});

test("Recents stays in its loading state until the complete summary list arrives", () => {
  assert.match(sidebar, /count=\{loading \? 0 : recents\.length\}/);
  assert.match(sidebar, /\{sections\.recents \? \(\s*loading \? \(\s*<ChatHistoryLoading \/>/);
  assert.doesNotMatch(sidebar, /loading && chats\.length === 0/);
});

test("Pinned and Recents are separate collapsible sections that remember their state", () => {
  assert.match(sidebar, /const pinned = visibleChats\.filter\(\(chat\) => chat\.pinned\)/);
  assert.match(sidebar, /const recents = visibleChats\.filter\(\(chat\) => !chat\.pinned\)/);
  assert.match(sidebar, /label="Pinned"[\s\S]{0,200}onToggle=\{\(\) => toggleSection\("pinned"\)\}/);
  assert.match(sidebar, /label="Recents"[\s\S]{0,200}onToggle=\{\(\) => toggleSection\("recents"\)\}/);
  assert.match(sidebar, /aria-expanded=\{open\}/);
  assert.match(sidebar, /localStorage\.setItem\(SECTION_STATE_KEY/);
  // Pinned only takes space when something is pinned.
  assert.match(sidebar, /\{pinned\.length > 0 \? \(/);
});

test("per-chat actions are hover-revealed and cover pin, rename and delete", () => {
  assert.match(sidebar, /hidden group-hover:flex group-focus-within:flex/);
  assert.match(sidebar, /aria-label=\{chat\.pinned \? `Unpin \$\{chat\.title\}` : `Pin \$\{chat\.title\}`\}/);
  assert.match(sidebar, /\{chat\.pinned \? "Unpin chat" : "Pin chat"\}/);
  assert.match(sidebar, /Rename\s*<\/button>/);
  // Renaming happens in the row rather than in a dialog, and Escape restores.
  assert.match(sidebar, /if \(renaming\) \{/);
  assert.match(sidebar, /event\.key === "Escape"[\s\S]{0,160}setRenaming\(false\)/);
});

test("automatic titles replace New chat immediately and type into the rail", () => {
  assert.match(terminal, /title:\s*"New chat",\s*temporary:\s*temporaryChat/);
  assert.doesNotMatch(terminal, /title:\s*"Assistant conversation",\s*temporary:\s*temporaryChat/);
  assert.match(terminal, /let refreshQueued = false;/);
  assert.match(terminal, /if \(force\) refreshQueued = true;/);

  const append = agentSession.slice(
    agentSession.indexOf("const appendExternalAgentTurn = useCallback"),
    agentSession.indexOf("const finishExternalAgentTurn = useCallback"),
  );
  assert.match(append, /notifyHermesSessionsChanged\(surface\)/);
  assert.match(sidebar, /PLACEHOLDER_CHAT_TITLES/);
  // The rename plays as two moves: the placeholder is deleted, then the
  // generated name is written into the emptied row.
  assert.match(sidebar, /data-title-renaming=\{TITLE_PHASE_ATTRIBUTE\[titleTransition\.phase\]\}/);
  assert.match(sidebar, /erasing: "erase",[\s\S]*?typing: "type",/);
  assert.match(sidebar, /event\.animationName === "bb-chat-title-erase"/);
  assert.match(sidebar, /"--bb-title-character-count": Math\.max\(1, transitionTitle\.length\)/);
  assert.match(globalCss, /@keyframes bb-chat-title-type/);
  assert.match(globalCss, /@keyframes bb-chat-title-erase/);
  assert.match(globalCss, /steps\(var\(--bb-title-character-count, 1\), end\)/);
  assert.match(
    globalCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?bb-chat-title-fade/,
  );
});

test("a typed draft appears in the rail before its first turn is saved", () => {
  assert.match(
    terminal,
    /session\.sessionId === null &&\s*\(input \|\| submittedDraft \|\| ""\)\.trim\(\)\.length > 0\s*\? PENDING_CHAT_ROW_ID/,
  );
  assert.match(
    gardenWorkspace,
    /activeChatId === null && \(input\.trim\(\)\.length > 0 \|\| draftMessages !== null\)/,
  );
  assert.match(sidebar, /pending\?: boolean;/);
  assert.match(sidebar, /!chat\.pending \? \(/);
  assert.match(sidebar, /const workableRecents = recents\.filter\(\(chat\) => !chat\.pending\);/);
  assert.match(terminal, /activeChatId=\{pendingChatId \?\? session\.sessionId\}/);
});

test("the Recents header hides a menu of its own behind the same hover", () => {
  // A button inside a button is invalid markup, so the header is a row: the
  // collapse toggle and the dots are siblings.
  assert.match(sidebar, /<div className="group\/section flex w-full items-center">/);
  assert.match(sidebar, /hidden group-hover\/section:block group-focus-within\/section:block/);
  assert.match(sidebar, /aria-label=\{`More actions for \$\{label\}`\}/);
  assert.match(sidebar, /aria-label="Actions for Recents"/);
  // Two ways to work over the section, and no one-click sweep among them.
  assert.match(sidebar, /Select chats\s*<\/button>/);
  assert.match(sidebar, /Highlight chats\s*<\/button>/);
  assert.doesNotMatch(sidebar, /Delete all/);
  // Both menus dismiss the same way, and neither reopens on the press that
  // closed it.
  assert.match(sidebar, /function useDismissOnOutside/);
  assert.match(sidebar, /useDismissOnOutside\(menuRef, onClose\)/);
  // Nothing to act on, or already acting: no dots.
  assert.match(sidebar, /workableRecents\.length > 0 && mode === "idle" \? \(/);
});

test("Recents can be picked over and deleted in one go; Pinned cannot", () => {
  // Only the Recents rows are workable, so a chat the user pinned is out of
  // reach of both modes.
  assert.match(sidebar, /\{recents\.map\(\(chat\) => renderRow\(chat, true\)\)\}/);
  assert.match(sidebar, /\{pinned\.map\(\(chat\) => renderRow\(chat\)\)\}/);
  assert.match(sidebar, /mode=\{workable && !chat\.pending \? mode : "idle"\}/);
  assert.match(sidebar, /onDelete=\{\(\) => onDeleteChats\(selectedChats\)\}/);
  assert.match(
    sidebar,
    /setSelectedIds\(new Set\(workableRecents\.map\(\(chat\) => chat\.id\)\)\)/,
  );

  // While picking, the row checks instead of opening, and its own controls
  // step aside so the list reads as a set of choices.
  assert.match(sidebar, /type="checkbox"/);
  assert.match(sidebar, /aria-label=\{`Select \$\{chat\.title\}`\}/);
  assert.match(sidebar, /onClick=\{mode === "idle" \? onOpen : \(\) => onPick\?\.\(\)\}/);
  assert.match(sidebar, /mode !== "idle"\s*\?\s*"hidden"/);
  // One pressed material, read as "open" at rest and "picked" while selecting.
  assert.match(sidebar, /\(mode === "selecting" \? checked : selected\)/);

  // The mode is never alive but invisible: Escape leaves it, and so does
  // collapsing the section it belongs to.
  assert.match(sidebar, /if \(event\.key === "Escape"\) stopWorking\(\)/);
  assert.match(sidebar, /if \(key === "recents" && !next\.recents\) stopWorking\(\)/);
  // Checked ids are intersected with the live list rather than mirrored into a
  // second copy that could drift from it.
  assert.match(
    sidebar,
    /const selectedChats = workableRecents\.filter\(\(chat\) => selectedIds\.has\(chat\.id\)\)/,
  );
});

test("the rail's row menu is placed against the viewport, not inside the scroller", () => {
  // The rail scrolls, so an absolutely-positioned menu would clip. It is fixed,
  // measured from the button at click time, and clamped on both axes.
  assert.match(sidebar, /className="fixed z-\[70\]/);
  assert.match(sidebar, /export function menuPositionFor/);
  assert.match(sidebar, /Math\.max\(8, Math\.min\(anchor\.bottom \+ 4, viewport\.height - MENU_HEIGHT - 8\)\)/);
  assert.match(sidebar, /Math\.max\(8, Math\.min\(anchor\.right - MENU_WIDTH \+ 8, viewport\.width - MENU_WIDTH - 8\)\)/);
  assert.match(sidebar, /menuButtonRef\.current\?\.getBoundingClientRect\(\)/);
  // Measuring happens in the click handler, never in an effect.
  assert.doesNotMatch(sidebar, /useLayoutEffect/);
});

test("renaming and pinning go through one PATCH that never reorders Recents by itself", () => {
  assert.match(sessionRoute, /export async function PATCH/);
  assert.match(sessionRoute, /renameConversation\(conversation, title\.slice\(0, 200\)\)/);
  assert.match(sessionRoute, /setConversationPinned\(conversation, body\.pinned\)/);
  assert.match(sessionRoute, /invalid_title/);
  assert.match(sessionRoute, /invalid_pinned/);

  // Pinning is placement, not activity: neither touches updated_at.
  const rename = conversationStore.slice(
    conversationStore.indexOf("export function renameConversation"),
    conversationStore.indexOf("export function setConversationPinned"),
  );
  assert.doesNotMatch(rename, /updated_at/);
  assert.match(conversationSchema, /ensureColumn\(database, "conversations", "pinned_at", "pinned_at TEXT"\);/);
  // A pinned chat must survive the recent-conversations limit.
  assert.match(conversationStore, /ORDER BY \(pinned_at IS NOT NULL\) DESC, updated_at DESC/);
  assert.match(conversationStore, /pinned: row\.pinned_at !== null/);

  // The terminal applies both optimistically and rolls back on failure.
  assert.match(terminal, /async function patchHistorySession/);
  assert.match(terminal, /method: "PATCH"/);
});

test("a poll snapshot that overlapped a rename, pin or delete is dropped", () => {
  // Every mutation bumps the epoch when it starts and when it settles; a poll
  // response carrying an older epoch may predate the change and would revert
  // it on screen, so it is discarded instead of applied.
  assert.match(terminal, /const historyEpoch = useRef\(0\)/);
  assert.match(terminal, /const epoch = historyEpoch\.current;/);
  assert.match(terminal, /if \(cancelled \|\| historyEpoch\.current !== epoch\) return;/);
  const bumps = terminal.match(/historyEpoch\.current \+= 1;/g) ?? [];
  assert.ok(
    bumps.length >= 4,
    "patch start, patch settle and both delete paths must bump the epoch",
  );
});

test("a failed patch rolls back only the fields it wrote, and only if they are still its own", () => {
  // A later edit that landed while this one was in flight is the newer truth:
  // the rollback is a compare-and-swap per patched field, never a blanket
  // restore of the snapshot.
  assert.match(
    terminal,
    /if\s*\(body\.title !== undefined &&\s*entry\.title === body\.title\)\s*next\.title = item\.title;/,
  );
  assert.match(
    terminal,
    /if\s*\(body\.pinned !== undefined &&\s*entry\.pinned === body\.pinned\)\s*next\.pinned = item\.pinned;/,
  );
  assert.match(
    terminal,
    /body\.highlight !== undefined &&\s*entry\.highlight === body\.highlight/,
  );
});

test("a rename adopts the canonical title the route answers with", () => {
  // The server may normalize (the 200-char cap); waiting for the next poll
  // would let the row silently change later. The input also refuses to let a
  // longer title be typed in the first place.
  assert.match(terminal, /const canonical = data\?\.session\?\.title;/);
  assert.match(terminal, /canonical !== body\.title/);
  assert.match(sidebar, /maxLength=\{200\}/);
});

test("the rail freezes its order while a rename input is open", () => {
  // A refresh that reorders rows moves the focused input's DOM node, which
  // blurs it — and blur commits a half-typed title. The frozen list holds the
  // order still for the few seconds of typing, and the freeze follows the
  // input's mounted life so every way out releases it.
  assert.match(sidebar, /const visibleChats = frozen \? frozen\.chats : chats;/);
  assert.match(sidebar, /if \(renaming\) setFrozen\(\{ chatId, chats: liveChats\.current \}\);/);
  assert.match(sidebar, /onRenamingChange\(chat\.id, true\);/);
  assert.match(sidebar, /return \(\) => onRenamingChange\(chat\.id, false\);/);
});

test("a turn's conversation update cannot restore a title it read before a rename landed", () => {
  // updateConversation defaults unspecified columns from the live row, not
  // the caller's snapshot — turn flows hold their row across awaits, and a
  // rename that lands mid-turn must survive the turn's own updates.
  assert.match(
    conversationStore,
    /const current = getConversationById\(conversation\.id, database\) \?\? conversation;/,
  );
  assert.match(
    conversationStore,
    /input\.title === undefined \? current\.title : normalizeTitle\(input\.title\)/,
  );
});

test("a highlight is a stored palette slug, not a color the rail invented", () => {
  // Chats store the slug, so the palette can be restyled without rewriting
  // anyone's history and the server can validate a mark without knowing how it
  // is painted.
  assert.equal(isChatHighlight("butter"), true);
  assert.equal(isChatHighlight("#ff0000"), false);
  assert.equal(isChatHighlight(null), false);
  assert.equal(chatHighlight(null), null);
  assert.equal(chatHighlight("nope"), null);
  assert.equal(chatHighlight("sage")?.color, "#6f9e70");

  assert.match(
    conversationSchema,
    /ensureColumn\(database, "conversations", "highlight", "highlight TEXT"\);/,
  );
  // Like pinning, marking is placement rather than activity: neither may drag a
  // months-old chat back to the top of Recents.
  const setter = conversationStore.slice(
    conversationStore.indexOf("export function setConversationHighlight"),
    conversationStore.indexOf("export function updateConversation"),
  );
  assert.doesNotMatch(setter, /updated_at/);
  // A slug from an older palette presents as unmarked rather than as a color
  // the rail cannot paint.
  assert.match(
    conversationStore,
    /highlight: isChatHighlight\(row\.highlight\) \? row\.highlight : null/,
  );

  // The route takes null to clear, and refuses anything off the palette.
  assert.match(sessionRoute, /invalid_highlight/);
  assert.match(sessionRoute, /body\.highlight !== null && !isChatHighlight\(body\.highlight\)/);
  assert.match(sessionRoute, /setConversationHighlight\(conversation, body\.highlight\)/);
});

test("highlighting is a pen kept in hand, and a repeated color lifts the mark", () => {
  assert.match(sidebar, /const \[pen, setPen\] = useState<string \| null>\(CHAT_HIGHLIGHTS\[0\]\.id\)/);
  assert.match(sidebar, /onHighlightChat\(chat, chat\.highlight === pen \? null : pen\)/);
  assert.match(sidebar, /onPickPen=\{setPen\}/);
  // The eraser is the same pen holding no color, so clearing is one click too.
  assert.match(sidebar, /onClick=\{\(\) => onPickPen\(null\)\}/);
  assert.match(sidebar, /aria-label="Eraser"/);
  assert.match(sidebar, /aria-label=\{`\$\{highlight\.label\} highlighter`\}/);
  // The mark is mixed against the paper rather than painted over it, so one
  // palette works on the light surface and the dark one.
  assert.match(sidebar, /inset 3px 0 0 \$\{highlight\.color\}/);
  assert.match(sidebar, /color-mix\(in srgb, \$\{highlight\.color\} 15%, transparent\)/);

  // It rides the same optimistic PATCH as rename and pin: waiting out a round
  // trip between chats would make the pen feel stuck.
  assert.match(terminal, /highlight\?: string \| null/);
  assert.match(terminal, /onHighlightChat=\{\(chat, highlight\) =>/);
  assert.match(terminal, /\{ highlight \},[\s\S]{0,80}"This chat could not be highlighted\."/);
});

test("a chat that finishes while the user is elsewhere is marked unread", () => {
  // The user is reading conv_b while conv_a is still running.
  const running = [
    { id: "conv_a", active: true },
    { id: "conv_b", active: false },
  ];
  const seen = chatActivityById(running);

  const finished = [
    { id: "conv_a", active: false },
    { id: "conv_b", active: false },
  ];
  const unread = nextUnreadChats({
    unread: new Set(),
    previousActive: seen,
    chats: finished,
    viewingChatId: "conv_b",
  });
  assert.deepEqual([...unread], ["conv_a"]);

  // It survives the refreshes that follow, because the mark is state, not an
  // event: the chat stays finished and stays unread.
  const later = nextUnreadChats({
    unread,
    previousActive: chatActivityById(finished),
    chats: finished,
    viewingChatId: "conv_b",
  });
  assert.deepEqual([...later], ["conv_a"]);

  // Opening it is what reads it.
  const opened = nextUnreadChats({
    unread: later,
    previousActive: chatActivityById(finished),
    chats: finished,
    viewingChatId: "conv_a",
  });
  assert.deepEqual([...opened], []);
});

test("the dot is raised on the edge, so a reload cannot mark every finished chat", () => {
  // Nothing was ever seen running here: this is a first paint, or a reload.
  const first = nextUnreadChats({
    unread: new Set(),
    previousActive: new Map(),
    chats: [
      { id: "conv_a", active: false },
      { id: "conv_b", active: false },
    ],
    viewingChatId: null,
  });
  assert.deepEqual([...first], []);

  // A run that finishes in the open chat while the dock is showing it is read
  // as it lands; the same run finishing with the dock shut is not.
  const running = chatActivityById([{ id: "conv_a", active: true }]);
  const done = [{ id: "conv_a", active: false }];
  assert.deepEqual(
    [...nextUnreadChats({ unread: new Set(), previousActive: running, chats: done, viewingChatId: "conv_a" })],
    [],
  );
  assert.deepEqual(
    [...nextUnreadChats({ unread: new Set(), previousActive: running, chats: done, viewingChatId: null })],
    ["conv_a"],
  );
});

test("unread ids are pruned against a loaded list, never against an unloaded one", () => {
  const unread = new Set(["conv_a", "conv_gone"]);
  // A list that came back without conv_gone: it was deleted elsewhere.
  assert.deepEqual(
    [
      ...nextUnreadChats({
        unread,
        previousActive: new Map(),
        chats: [{ id: "conv_a", active: false }],
        viewingChatId: null,
      }),
    ],
    ["conv_a"],
  );
  // An empty list is an unloaded one far more often than it is a user with no
  // chats, so the first render cannot wipe what was restored from storage.
  assert.deepEqual(
    [...nextUnreadChats({ unread, previousActive: new Map(), chats: [], viewingChatId: null })],
    ["conv_a", "conv_gone"],
  );

  assert.equal(sameChatIds(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(sameChatIds(new Set(["a"]), new Set(["a", "b"])), false);
});

test("unread is reading state for one browser, kept in localStorage", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  writeUnreadChats(storage, new Set(["conv_a", "conv_b"]));
  assert.deepEqual([...readUnreadChats(storage)], ["conv_a", "conv_b"]);

  // A corrupted or foreign entry costs the dot, never the rail.
  store.set("breadboard:terminal:unread-chats", "{not json");
  assert.deepEqual([...readUnreadChats(storage)], []);
  store.set("breadboard:terminal:unread-chats", JSON.stringify(["conv_a", 7, null]));
  assert.deepEqual([...readUnreadChats(storage)], ["conv_a"]);
  assert.deepEqual([...readUnreadChats({ getItem: () => null })], []);
});

test("the row's one status spot runs spinner, then dot, then nothing", () => {
  // The dot takes the spinner's place rather than sitting beside it, so a row
  // never claims to be working and waiting at once.
  assert.match(
    sidebar,
    /\{chat\.active \? \([\s\S]{0,900}<ActiveChatIcon[\s\S]{0,900}\) : chat\.unread \? \([\s\S]{0,200}<UnreadChatDot/,
  );
  assert.match(sidebar, /unread: boolean;/);
  assert.match(terminal, /unread: unreadChats\.has\(item\.id\)/);

  // Breadboard's pale green — the dock handle's color — because this is a
  // "there is something here", not a warning.
  assert.match(historyClient, /export function UnreadChatDot/);
  assert.match(historyClient, /bg-\[var\(--signal-live\)\]/);
  assert.match(historyClient, /shadow-\[0_0_0_1px_var\(--signal-live-ring\)\]/);

  // The status spot is also the stop affordance. At rest it is an unambiguous
  // loading ring; hover or keyboard focus reveals the square without adding a
  // second control to the row.
  assert.match(historyClient, /onStop\?: \(\) => void/);
  assert.match(historyClient, /aria-label=\{actionLabel\}/);
  assert.match(historyClient, /group\/active-chat/);
  assert.match(historyClient, /group-hover\/active-chat:opacity-20/);
  assert.match(historyClient, /rounded-\[1\.5px\] bg-current opacity-0/);
  assert.match(historyClient, /group-hover\/active-chat:opacity-100/);
  assert.match(historyClient, /group-focus-visible\/active-chat:opacity-100/);
  assert.match(sidebar, /onStopChat\?: \(chat: TerminalSidebarChat\)/);
  assert.match(sidebar, /onStop=\{onStopChat \? \(\) => onStopChat\(chat\) : undefined\}/);
  assert.match(terminal, /onStopChat=\{stopHistorySession\}/);
  assert.match(
    terminal,
    /\/api\/hermes\/sessions\/\$\{encodeURIComponent\(item\.id\)\}\/abort/,
  );

  // Read means on screen: the open chat only counts while the dock shows it.
  assert.match(terminal, /const viewingChatId = bodyMounted \? session\.sessionId : null;/);
  // The previous activity map is captured before it is replaced — a state
  // updater runs during the next render, by which time the ref would already
  // hold the snapshot being compared against.
  assert.match(
    terminal,
    /const previousActive = chatActivity\.current;\s*chatActivity\.current = chatActivityById\(history\);/,
  );
  // Deleting a chat takes its dot with it: pruning deliberately does nothing
  // against an empty list, which is what deleting the last chat produces.
  assert.match(terminal, /forgetUnreadChats\(\[item\.id\]\)/);
  assert.match(terminal, /forgetUnreadChats\(deleted\)/);
});

test("the dock bar carries the rollup, so a shut terminal still says something landed", () => {
  assert.match(
    terminal,
    /const unreadCount = sidebarChats\.filter\(\s*\(chat\) => chat\.unread && !chat\.active,\s*\)\.length;/,
  );
  // Open, it sits beside the title with its count, so it cannot be read as a
  // second runtime light; shut, the bar is the button, so the count is spoken
  // through the button's own label.
  assert.match(
    terminal,
    /<UnreadChatDot[\s\S]{0,220}unreadCount > 0 \? unreadLabel : "Agent runtime is available"/,
  );
  assert.match(
    terminal,
    /\) : unreadCount > 0 \? \([\s\S]*?bg-\[var\(--signal-live\)\]/,
  );
  assert.match(terminal, /aria-label=\{isOpen \? undefined : `Open terminal\$\{unreadSuffix\}`\}/);
  assert.match(terminal, /const unreadSuffix = unreadCount > 0 \? ` — \$\{unreadLabel\}` : "";/);
});

test("search finds a chat by an exact word and by a description of it", () => {
  const now = Date.parse("2026-08-05T12:00:00Z");
  const candidates = [
    {
      id: "conv_a",
      title: "Kirchhoff current law",
      updatedAt: "2026-08-04T10:00:00Z",
      messages: [
        { role: "user", content: "Explain the junction rule for a parallel branch" },
        { role: "assistant", content: "The sum of currents into a node is zero." },
      ],
    },
    {
      id: "conv_b",
      title: "Sidebar layout argument",
      updatedAt: "2026-08-01T10:00:00Z",
      messages: [
        {
          role: "user",
          content: "I still think the left rail should keep pinned chats above recents",
        },
      ],
    },
    {
      id: "conv_c",
      title: "Dinner plans",
      updatedAt: "2026-07-20T10:00:00Z",
      messages: [{ role: "user", content: "Somewhere with good pasta" }],
    },
  ];

  const exact = searchConversations(candidates, "kirchhoff", { now });
  assert.equal(exact[0].id, "conv_a");
  assert.equal(exact[0].matchedOn, "title");

  // A description nobody wrote verbatim still lands on the right chat.
  const described = searchConversations(
    candidates,
    "the one where I was arguing about the sidebar and pinned chats",
    { now },
  );
  assert.equal(described[0].id, "conv_b");
  assert.ok(described[0].snippet.length > 0, "a hit explains itself with a snippet");

  // An unrelated chat is not dragged in by one shared word.
  assert.equal(
    searchConversations(candidates, "pasta recipe", { now }).some((hit) => hit.id === "conv_a"),
    false,
  );
  assert.deepEqual(searchConversations(candidates, "   ", { now }), []);

  // Stop words are dropped unless dropping them would leave nothing.
  assert.deepEqual(conversationSearchTerms("the one about the sidebar"), ["sidebar"]);
  assert.deepEqual(conversationSearchTerms("how do i"), ["how", "do"]);
});

test("search reads only the caller's chats, bounded on both axes", () => {
  assert.match(searchRoute, /WHERE user_id = \?/);
  assert.match(searchRoute, /MAX_CONVERSATIONS = 200/);
  assert.match(searchRoute, /MAX_MESSAGES_PER_CONVERSATION = 60/);
  assert.match(searchRoute, /substr\(content, 1, 2000\)/);
  assert.match(searchDialog, /const DEBOUNCE_MS = 180/);
  assert.match(searchDialog, /sessions\/search\?surface=/);
});

test("uploads are projected out of the transcript, with sizes and honest availability", () => {
  const dataUrl = `data:image/png;base64,${Buffer.from("breadboard-pixels").toString("base64")}`;
  const rows = [
    {
      message_id: 12,
      created_at: "2026-07-30T09:00:00Z",
      conversation_public_id: "conv_a",
      conversation_title: "Circuit review",
      surface: "dashboard_terminal",
      metadata: JSON.stringify({
        attachments: [
          { type: "image", name: "board.png", dataUrl },
          { type: "file", name: "datasheet.pdf", sizeBytes: 2_400_000 },
        ],
      }),
    },
    {
      message_id: 7,
      created_at: "2026-07-02T09:00:00Z",
      conversation_public_id: "conv_b",
      conversation_title: "Old chat",
      surface: "garden_chat",
      // Chats from before attachments were retained kept only the names.
      metadata: JSON.stringify({ attachmentNames: ["lecture-notes.md"] }),
    },
  ];

  const uploads = collectUploads(rows);
  assert.deepEqual(
    uploads.map((upload) => [upload.id, upload.name, upload.kind, upload.hasContent]),
    [
      ["12-0", "board.png", "image", true],
      ["12-1", "datasheet.pdf", "file", false],
      ["7-0", "lecture-notes.md", "file", false],
    ],
  );
  // An image without a recorded size still reports one, from its own bytes.
  assert.equal(uploads[0].sizeBytes, dataUrlByteLength(dataUrl));
  assert.equal(uploads[1].sizeBytes, 2_400_000);
  assert.equal(uploads[2].sizeBytes, null);
  assert.equal(uploads[0].previewAvailable, true);
  assert.equal(uploads[1].previewAvailable, false);
  assert.equal(uploads[2].previewAvailable, false);

  assert.equal(formatUploadSize(null), "—");
  assert.equal(formatUploadSize(512), "512 bytes");
  assert.equal(formatUploadSize(773_120), "755 KB");
  assert.equal(formatUploadSize(2_306_867), "2.20 MB");

  // Ids survive a round trip and reject anything else.
  assert.deepEqual(parseUploadId("12-1"), { messageId: 12, index: 1 });
  assert.equal(parseUploadId("../../etc/passwd"), null);
  assert.deepEqual(messageAttachments(null), []);
  assert.deepEqual(messageAttachments("{not json"), []);
});

test("upload bytes are served only to the owner, and only when they were kept", () => {
  assert.match(uploadsRoute, /WHERE c\.user_id = \?/);
  assert.match(uploadsRoute, /m\.role = 'user'/);
  assert.match(uploadContentRoute, /JOIN conversations c ON c\.id = m\.conversation_id/);
  assert.match(uploadContentRoute, /WHERE m\.id = \? AND c\.user_id = \?/);
  assert.match(uploadContentRoute, /upload_content_unavailable/);
  assert.match(uploadContentRoute, /Content-Disposition/);
  assert.match(uploadContentRoute, /previewRequested/);
  assert.match(uploadContentRoute, /attachment\.previewBlobId/);
  // The panel says so rather than offering a download that would fail.
  assert.match(uploadsPanel, /Only this file&apos;s name was kept\./);
});

test("an upload opens inside the Terminal instead of replacing it", () => {
  assert.match(uploadsPanel, /onClick=\{\(\) => setSelectedUpload\(upload\)\}/);
  assert.match(uploadsPanel, /<UploadViewer upload=\{selectedUpload\} onClose=\{closePreview\}/);
  assert.match(uploadsPanel, /role="dialog"/);
  assert.match(uploadsPanel, /createPortal\([\s\S]*?document\.body/);
  assert.match(uploadsPanel, /upload\.kind === "image"/);
  assert.match(uploadsPanel, /upload\.kind === "video"/);
  assert.match(uploadsPanel, /upload\.kind === "model" && upload\.previewFormat/);
  assert.match(uploadsPanel, /onPreview\(upload\)/);
  assert.doesNotMatch(uploadsPanel, /target="_blank"/);
});

test("a scheduling sentence resolves to a cron expression the panel shows back", () => {
  const friday = parseScheduleRequest("every friday at 6pm summarize the week");
  assert.equal(friday.cron, "0 18 * * 5");
  assert.equal(friday.recognized, true);
  assert.equal(friday.prompt, "summarize the week");

  assert.equal(parseScheduleRequest("every weekday at 8:30 brief me").cron, "30 8 * * 1-5");
  assert.equal(parseScheduleRequest("every hour check the build").cron, "0 * * * *");
  assert.equal(parseScheduleRequest("every weekend at 10am plan something").cron, "0 10 * * 0,6");
  assert.equal(parseScheduleRequest("every month on the 3rd review my notes").cron, "0 9 3 * *");
  assert.equal(parseScheduleRequest("each morning tell me the news").cron, "0 9 * * *");

  // Nothing recognized: a stated default, not a silent guess.
  const vague = parseScheduleRequest("keep an eye on my reading list");
  assert.equal(vague.cron, "0 9 * * *");
  assert.equal(vague.recognized, false);
  assert.ok(vague.title.length > 0);

  assert.match(scheduledPanel, /parseScheduleRequest\(text\)/);
  assert.match(scheduledPanel, /parsed\.recognized \? "Understood" : "Assuming"/);
  assert.match(scheduledPanel, /\{preview\}/);
});

test("the Terminal's Scheduled panel is where prompt scheduling now happens", () => {
  assert.match(terminal, /<TerminalScheduledPanel surface="dashboard_terminal" \/>/);
  // Nothing hands prompts over any more: the panel pulls them in itself.
  assert.doesNotMatch(terminal, /SCHEDULE_PROMPT_EVENT|scheduleDraft/);
  assert.doesNotMatch(commandHub, /requestPromptScheduling/);
  // The composer stays put so its palette can open over the list below it.
  assert.match(scheduledPanel, /className="shrink-0 px-4 pb-3 pt-4"/);
  assert.match(scheduledPanel, /className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"/);
});

test("one panel opens at a time beside the transcript", () => {
  assert.match(terminal, /const \[sidePanel, setSidePanel\] = useState<TerminalPanel \| null>\(\s*initialPanel,\s*\)/);
  assert.match(terminal, /function togglePanel\(panel: TerminalPanel\)/);
  assert.match(terminal, /setSidePanel\(\(current\) => \(current === panel \? null : panel\)\)/);
  assert.match(terminal, /sidePanel === "uploads" \? \(\s*<UploadsPanel/);
});
