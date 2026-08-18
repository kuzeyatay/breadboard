// Breadboard keeps whole conversations in state but only draws the rows around
// the fold. Three things are checked here, in increasing order of realism:
//
//   * the pure helpers — what makes a row the same row, and how tall it is
//     assumed to be before anyone has measured it;
//   * a real server render of the shared list against a 1,000-message fixture,
//     which is where the mounted-row count is actually counted;
//   * the virtualizer itself, driven through a scroll element made of plain
//     objects, which is the only way to assert the scrolling promises — stay
//     pinned while an answer grows, stay put when the reader has scrolled away,
//     land on the newest message on demand, and forget one conversation's
//     measurements when another is opened.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import { Virtualizer } from "@tanstack/virtual-core";

import {
  CHAT_OVERSCAN,
  chatRowKey,
  estimateChatRowHeight,
} from "../src/app/components/chat/chat-row-identity.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

// ── Row identity and size estimates ──────────────────────────────────────────

test("a row keeps its identity while its answer streams", () => {
  const partial = { role: "assistant", createdAt: "2026-01-01T10:00:00Z", content: "Th" };
  const grown = { ...partial, content: "Thinking about it in some detail" };

  assert.equal(chatRowKey(partial, 4), chatRowKey(grown, 4));
  assert.notEqual(chatRowKey(partial, 4), chatRowKey(partial, 5));
});

test("a persisted message id outranks the positional fallback", () => {
  const persisted = { id: "msg_91", role: "assistant", createdAt: "2026-01-01T10:00:00Z" };

  assert.equal(chatRowKey(persisted, 3), "id:msg_91");
  // The same message keeps its key even if it changes position, which is what
  // makes prepending history safe.
  assert.equal(chatRowKey(persisted, 800), "id:msg_91");
  assert.equal(
    chatRowKey({ clientMessageId: "draft-7", role: "user" }, 0),
    "id:draft-7",
  );
});

test("estimates are the shape of real messages, not arbitrary numbers", () => {
  const oneLiner = estimateChatRowHeight({ role: "user", content: "thanks" });
  const paragraph = estimateChatRowHeight({
    role: "assistant",
    content: "word ".repeat(400),
  });
  const enormous = estimateChatRowHeight({
    role: "assistant",
    content: "line\n".repeat(5_000),
  });

  assert.ok(oneLiner >= 60 && oneLiner <= 120, `one-liner estimated at ${oneLiner}`);
  assert.ok(paragraph > oneLiner);
  // Capped, so one giant answer cannot make the scrollbar meaningless.
  assert.ok(enormous <= 900);
  assert.equal(estimateChatRowHeight(undefined), estimateChatRowHeight({ content: "" }));
});

// ── The shared list, rendered for real ───────────────────────────────────────

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
  recursive: true,
});
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-chat-virtual-"),
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as VirtualizedMessageList } from "@/app/components/chat/virtualized-message-list";\n`,
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { VirtualizedMessageList } = require(bundle);

/** A conversation long enough that mounting all of it would be the bug. */
const longConversation = Array.from({ length: 1_000 }, (_, index) => ({
  id: `msg_${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  content:
    index % 2 === 0
      ? `Question number ${index}`
      : `Answer number ${index}. ${"Some prose that wraps over a couple of lines. ".repeat(3)}`,
}));

const inertBridge = () => ({
  programmaticRef: { current: false },
  activeRef: { current: false },
  scrollToEnd: () => {},
  attach: () => {},
});

const renderList = (items, overrides = {}) =>
  renderToStaticMarkup(
    React.createElement(VirtualizedMessageList, {
      surface: "test-surface",
      items,
      scrollRef: { current: null },
      bridge: inertBridge(),
      gap: 20,
      resetKey: "conversation-a",
      getItemKey: chatRowKey,
      estimateSize: (message) => estimateChatRowHeight(message),
      renderItem: (message, index) =>
        React.createElement("p", null, `${index}: ${message.content}`),
      // There is no element to observe on the server, so the viewport it would
      // have measured is stated instead.
      initialRect: { width: 900, height: 720 },
      ...overrides,
    }),
  );

test("a 1,000-message conversation mounts only a viewport's worth of rows", () => {
  const markup = renderList(longConversation);

  const mounted = markup.match(/data-index="/g)?.length ?? 0;
  assert.equal(markup.match(/data-message-count="1000"/g)?.length, 1);
  assert.match(markup, new RegExp(`data-mounted-rows="${mounted}"`));

  // A 720px viewport over ~130px rows is roughly six rows, plus overscan at
  // both ends. The ceiling is what this whole change is for.
  assert.ok(mounted >= 1, "expected at least one row to be mounted");
  assert.ok(
    mounted <= 40,
    `expected tens of rows, not ${mounted} of ${longConversation.length}`,
  );
  // The far end of the conversation is emphatically not in the document.
  assert.doesNotMatch(markup, /Answer number 999/);
  assert.match(markup, /0: Question number 0/);
});

test("the sized container stands in for the whole conversation", () => {
  const markup = renderList(longConversation);

  const gaps = (longConversation.length - 1) * 20;
  const expected =
    longConversation.reduce(
      (total, message) => total + estimateChatRowHeight(message),
      0,
    ) + gaps;

  const height = Number(markup.match(/height:\s*(\d+(?:\.\d+)?)px/)?.[1]);
  assert.equal(height, expected);
  assert.match(markup, /position:\s*relative/);
});

test("each mounted row is measurable and positioned, not stacked", () => {
  const markup = renderList(longConversation);

  const rows = [
    ...markup.matchAll(/data-index="(\d+)"[^>]*style="([^"]*)"/g),
  ].map(([, index, style]) => ({ index: Number(index), style }));

  assert.ok(rows.length > 1);
  for (const row of rows) {
    assert.match(row.style, /position:\s*absolute/);
    assert.match(row.style, /translateY\(/);
  }
  // Consecutive rows sit at increasing offsets — an overlap would read as
  // messages drawn on top of each other.
  const offsets = rows.map((row) =>
    Number(row.style.match(/translateY\((\d+(?:\.\d+)?)px\)/)?.[1]),
  );
  for (let index = 1; index < offsets.length; index += 1) {
    assert.ok(
      offsets[index] > offsets[index - 1],
      `row ${rows[index].index} does not follow row ${rows[index - 1].index}`,
    );
  }
});

test("an empty conversation draws nothing rather than an empty frame", () => {
  const markup = renderList([]);

  assert.match(markup, /data-message-count="0"/);
  assert.doesNotMatch(markup, /data-index=/);
});

// ── Scrolling promises, against the real virtualizer ─────────────────────────

/**
 * The virtualizer driven through a scroll element made of plain objects. Every
 * hook it reaches for the DOM through — the rect, the offset, the write — is an
 * injectable option, so its actual anchoring behaviour can be exercised without
 * a browser.
 */
function transcriptHarness({
  count,
  estimate = () => 120,
  gap = 20,
  viewport = 600,
  getItemKey = (index) => `m${index}`,
}) {
  let notifyOffset = () => {};
  let virtualizer;
  const scroller = {
    get scrollHeight() {
      return virtualizer.getTotalSize();
    },
    get clientHeight() {
      return viewport;
    },
    scrollWidth: 900,
    clientWidth: 900,
  };
  const state = { offset: 0 };

  virtualizer = new Virtualizer({
    count,
    gap,
    overscan: CHAT_OVERSCAN,
    anchorTo: "end",
    initialRect: { width: 900, height: viewport },
    getScrollElement: () => scroller,
    estimateSize: estimate,
    getItemKey,
    observeElementRect: (_instance, callback) => {
      callback({ width: 900, height: viewport });
      return () => {};
    },
    observeElementOffset: (_instance, callback) => {
      notifyOffset = callback;
      callback(state.offset, false);
      return () => {};
    },
    // Mirrors the library's own element writer, including the measurement
    // corrections it sends through as `adjustments`.
    scrollToFn: (offset, { adjustments = 0 } = {}) => {
      state.offset = Math.max(0, offset + adjustments);
      notifyOffset(state.offset, false);
    },
    onChange: () => {},
  });
  virtualizer._didMount();
  virtualizer._willUpdate();

  return {
    virtualizer,
    state,
    scrollTo(offset) {
      state.offset = offset;
      notifyOffset(offset, false);
    },
    scrollToEnd() {
      state.offset = Math.max(0, virtualizer.getTotalSize() - viewport);
      notifyOffset(state.offset, false);
    },
    mountedIndexes: () => virtualizer.getVirtualItems().map((item) => item.index),
  };
}

test("a reader at the bottom stays there while the answer grows", () => {
  const harness = transcriptHarness({ count: 1_000 });
  harness.scrollToEnd();
  assert.equal(harness.virtualizer.getDistanceFromEnd(), 0);

  // Four rounds of streamed output, each one making the newest row taller.
  for (const height of [200, 340, 560, 900]) {
    harness.virtualizer.resizeItem(999, height);
    assert.equal(
      harness.virtualizer.getDistanceFromEnd(),
      0,
      `lost the bottom after growing to ${height}px`,
    );
  }
  assert.ok(harness.mountedIndexes().includes(999));
  assert.ok(harness.mountedIndexes().length <= 40);
});

test("a reader who has scrolled up is not dragged back down by the stream", () => {
  const harness = transcriptHarness({ count: 1_000 });
  harness.scrollTo(4_000);
  const readingAt = harness.state.offset;

  for (const height of [200, 340, 560, 900]) {
    harness.virtualizer.resizeItem(999, height);
  }

  assert.equal(harness.state.offset, readingAt);
  // Still reading the same part of the conversation, not the newest answer.
  assert.ok(!harness.mountedIndexes().includes(999));
});

test("jumping to the bottom lands on the newest message", () => {
  const harness = transcriptHarness({ count: 1_000 });
  harness.scrollTo(4_000);
  harness.virtualizer.resizeItem(999, 900);

  harness.virtualizer.scrollToEnd({ behavior: "auto" });

  assert.equal(harness.virtualizer.getDistanceFromEnd(), 0);
  assert.equal(harness.virtualizer.getVirtualItems().at(-1).index, 999);
});

test("a row that turns out to be taller than its estimate does not shove the rows below it", () => {
  const harness = transcriptHarness({ count: 200 });
  harness.scrollTo(6_000);

  const anchor = harness.virtualizer.getVirtualItems()[0];
  const offsetIntoAnchor = harness.state.offset - anchor.start;

  // A markdown block above the fold resolves to three times its estimate.
  harness.virtualizer.resizeItem(anchor.index - 3, 360);

  const movedAnchor = harness.virtualizer
    .getMeasurements()
    .find((item) => item.index === anchor.index);
  assert.equal(harness.state.offset - movedAnchor.start, offsetIntoAnchor);
});

test("opening another conversation does not inherit the first one's measurements", () => {
  const harness = transcriptHarness({ count: 300 });
  harness.scrollToEnd();
  for (let index = 280; index < 300; index += 1) {
    harness.virtualizer.resizeItem(index, 480);
  }
  const measured = harness.virtualizer.getTotalSize();
  assert.ok(measured > 300 * 120);

  // What the list does when its `resetKey` — the conversation — changes.
  harness.virtualizer.measure();

  assert.equal(
    harness.virtualizer.getTotalSize(),
    300 * 120 + 299 * 20,
    "a second conversation was laid out with the first one's row heights",
  );
});

test("a conversation opened onto estimates still settles on its last message", () => {
  // What a landing is for. On the frame a conversation is opened every row is
  // an estimate, so one jump aims at a height that is about to be wrong: as the
  // rows around the fold report their real heights the foot of the conversation
  // moves. Re-aiming over the following frames is what actually puts the reader
  // on the last message rather than somewhere near it.
  const harness = transcriptHarness({ count: 400 });
  harness.virtualizer.scrollToEnd({ behavior: "auto" });

  const landedOnEstimates = harness.state.offset;
  // The rows that mount at the foot turn out to be markdown three times their
  // estimate — the newest message most of all.
  for (const [index, height] of [[397, 360], [398, 300], [399, 720]]) {
    harness.virtualizer.resizeItem(index, height);
    // Each frame of the landing aims again at wherever the end is now.
    harness.virtualizer.scrollToEnd({ behavior: "auto" });
  }

  assert.ok(
    harness.state.offset > landedOnEstimates,
    "the end of the conversation should have moved as its rows were measured",
  );
  assert.equal(harness.virtualizer.getDistanceFromEnd(), 0);
  assert.equal(harness.virtualizer.getVirtualItems().at(-1).index, 399);
});

test("a reset costs a mounted row its real height until it resizes again", () => {
  // Why the reset must be spent only on a conversation the reader has left.
  // Clearing the cache is all `measure()` does: a row that is already in the
  // document and does not change size never reports its height again, so it is
  // laid out at its estimate from then on. On a real switch that is harmless —
  // every row remounts and measures itself — but on rows that stay put it is a
  // transcript drawn to the wrong shape until something happens to resize them.
  const harness = transcriptHarness({ count: 40 });
  harness.virtualizer.resizeItem(0, 240);
  const measured = harness.virtualizer.getMeasurements()[1].start;

  harness.virtualizer.measure();
  assert.equal(
    harness.virtualizer.getMeasurements()[1].start,
    140,
    "the row below a measured row should fall back to the estimate after a reset",
  );
  assert.ok(measured > 140, "the measured row was taller than its estimate");
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test("every unbounded transcript renders through the shared virtualized list", () => {
  const transcripts = {
    "src/app/components/hermes/agent-runtime-panel.tsx": "hermes-chat",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx": "garden-chat",
    "src/app/garden/garden-assistant.tsx": "garden-assistant",
    "src/app/components/knowledge-terminal.tsx": "knowledge-terminal",
  };

  for (const [relativePath, surface] of Object.entries(transcripts)) {
    const text = source(`../${relativePath}`);
    assert.match(text, /<VirtualizedMessageList/, relativePath);
    // The Hermes panel names two surfaces from one list, so the label is only
    // required to be present, not to sit directly after `surface=`.
    assert.ok(text.includes(`"${surface}"`), `${relativePath} names ${surface}`);
    // The scroller and the follow-the-answer hook are the existing ones.
    assert.match(text, /scrollRef=\{transcriptScrollRef\}/, relativePath);
    assert.match(text, /bridge=\{transcriptVirtual\}/, relativePath);
    assert.match(text, /virtual: transcriptVirtual/, relativePath);
    // The measurement cache is scoped to a conversation.
    assert.match(text, /resetKey=\{/, relativePath);
    // Nothing renders the whole conversation any more.
    assert.doesNotMatch(text, /\{messages\.map\(/, relativePath);
    // Time separators still belong to the row they head.
    assert.match(text, /<ChatTimeSeparator/, relativePath);
  }
});

test("the composer and the jump control stay outside the virtualizer", () => {
  const transcripts = [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
    "src/app/garden/garden-assistant.tsx",
    "src/app/components/knowledge-terminal.tsx",
  ];

  for (const relativePath of transcripts) {
    const text = source(`../${relativePath}`);
    const listStart = text.indexOf("<VirtualizedMessageList");
    if (listStart < 0) continue;
    const listEnd = text.indexOf("/>", text.indexOf("renderItem=", listStart));
    const inside = text.slice(listStart, listEnd);
    assert.doesNotMatch(inside, /<AssistantComposer/, relativePath);
    assert.doesNotMatch(inside, /<ChatJumpToBottom/, relativePath);
  }
});

test("the auto-scroll hook lets a virtualized transcript aim its own jumps", () => {
  const hook = source("../src/app/components/use-chat-auto-scroll.ts");

  assert.match(hook, /export function useChatVirtualBridge/);
  // A jump asks the virtualizer, which knows where the newest row will land.
  assert.match(hook, /virtual\?\.activeRef\.current/);
  assert.match(hook, /virtual\.scrollToEnd\(reduceMotion \? "auto" : "smooth"\)/);
  // A scroll the virtualizer performs to correct a measurement is not the
  // reader deciding to read upward.
  assert.match(hook, /virtual\?\.programmaticRef\.current/);
  // The original element-based path is untouched for anything not virtualized.
  assert.match(hook, /container\.scrollTop = container\.scrollHeight/);
});

test("the list reports what it mounted, and only in development", () => {
  const list = source("../src/app/components/chat/virtualized-message-list.tsx");

  assert.match(list, /data-message-count=\{count\}/);
  assert.match(list, /data-mounted-rows=\{virtualItems\.length\}/);
  assert.match(list, /process\.env\.NODE_ENV === "production"/);
  assert.match(list, /__breadboardChatVirtualization/);
  assert.doesNotMatch(list, /console\.log/);
  // Row spacing is the virtualizer's, so no row carries a phantom tail.
  assert.match(list, /\bgap,/);
  assert.match(list, /anchorTo: "end"/);
  assert.match(list, /ref=\{measureRow\}/);
  assert.match(list, /data-index=\{virtualRow\.index\}/);
});

test("a row is measured after the commit that mounted it, never inside it", () => {
  // React runs a ref callback inside the commit, and a measurement that moves
  // the scroller is reported with a synchronous flush — which React refuses to
  // perform there and logs. What that costs is asserted for real in
  // chat-virtualization-dom.test.mjs; this is the shape that keeps it fixed.
  const list = source("../src/app/components/chat/virtualized-message-list.tsx");

  const measure = list.slice(
    list.indexOf("const measureRow"),
    list.indexOf("const scrollToEnd"),
  );
  assert.match(measure, /queueMicrotask\(/);
  // A detached row still goes straight through, since that only sweeps caches.
  assert.match(measure, /if \(node === null\)/);
  // One flush for the whole commit's rows, not one per row.
  assert.match(measure, /flushSync\(\(\) => \{[\s\S]*for \(const row of rows\)/);
  assert.match(measure, /row\.isConnected/);
});

test("a conversation getting its id is not a conversation being switched", () => {
  // The first message of a new chat is sent before the chat exists, so the id
  // lands on a transcript that is already drawn. Resetting on that would strand
  // every mounted row on its estimate and pull the answer up onto the message
  // that asked for it.
  const list = source("../src/app/components/chat/virtualized-message-list.tsx");

  const effect = list.slice(
    list.indexOf("const previousResetRef"),
    list.indexOf("const virtualItems"),
  );
  assert.match(effect, /previous === null \|\| previous === undefined/);
  assert.ok(
    effect.indexOf("previous === null") < effect.indexOf("virtualizer.measure()"),
    "the first identity must be filtered out before the cache is cleared",
  );
  // Every transcript states the absence of a conversation the same way, or the
  // guard above reads a fresh chat as a switch.
  for (const [relativePath, key] of [
    ["src/app/components/hermes/agent-runtime-panel.tsx", "sessionId"],
    ["src/app/gardens/[clusterSlug]/workspace-client.tsx", "chatSessionId"],
    ["src/app/garden/garden-assistant.tsx", "activeChatId"],
    ["src/app/components/knowledge-terminal.tsx", "activeId"],
  ]) {
    const text = source(`../${relativePath}`);
    assert.match(text, new RegExp(`resetKey=\\{${key}\\}`), relativePath);
    assert.match(
      text,
      new RegExp(`${key}[?:][^\\n]*\\bnull\\b|useState<[^>]*\\| null>\\(null\\)`),
      `${relativePath}: ${key} should be null before a conversation exists`,
    );
  }
});

test("the overscan is moderate enough to still be virtualization", () => {
  assert.ok(CHAT_OVERSCAN >= 3 && CHAT_OVERSCAN <= 10);
});
