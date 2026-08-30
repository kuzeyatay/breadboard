// The message rail down the right edge of a transcript.
//
// Two claims are worth pinning down, and neither can be read off the source.
// The rail has to name both sides of the visible conversation, so a tick is a
// landmark rather than a scroll fraction. And the tick it lights has
// to keep moving as the reader scrolls — the rule is "the nearest question",
// not "the last one passed", because one answer here is routinely several
// screens tall and "last passed" leaves the highlight frozen through all of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const source = (relative) =>
  fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
  recursive: true,
});
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-message-rail-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export {
     default as ChatMessageRail,
     nearestRailTick,
     railPreview,
     railFocusLine,
     summarise,
   } from "@/app/components/chat-message-rail";\n`,
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
const { ChatMessageRail, nearestRailTick, railPreview, railFocusLine, summarise } =
  require(bundle);

/** A bridge no list has claimed, which is all a server render ever sees. */
const inertBridge = () => ({
  programmaticRef: { current: false },
  activeRef: { current: false },
  scrollToEnd: () => {},
  scrollToIndex: () => {},
  getRowStart: () => null,
  attach: () => {},
});

function render(items) {
  return renderToStaticMarkup(
    React.createElement(ChatMessageRail, {
      items,
      scrollRef: { current: null },
      bridge: inertBridge(),
      surface: "test",
    }),
  );
}

// ── What the rail draws ─────────────────────────────────────────────────────

test("the rail carries one tick per visible chat message", () => {
  const markup = render([
    { rowIndex: 0, label: "What is a breadboard?", role: "user" },
    { rowIndex: 1, label: "A reusable prototyping board.", role: "assistant" },
    { rowIndex: 2, label: "Show me an example", role: "user" },
  ]);

  const ticks = markup.match(/aria-label="Go to message /g) ?? [];
  const answers = markup.match(/aria-label="Go to AI response /g) ?? [];
  assert.equal(ticks.length, 2, "user turns remain named landmarks");
  assert.equal(answers.length, 1, "AI responses are landmarks too");
  assert.match(markup, /data-tick-count="3"/);
  assert.match(markup, /data-message-role="assistant"/);
});

test("a tick is never anonymous", () => {
  const markup = render([
    { rowIndex: 0, label: "What is a breadboard?", role: "user" },
    { rowIndex: 2, label: "Show me an example", role: "user" },
  ]);

  assert.match(
    markup,
    /aria-label="Go to message 1 of 2: What is a breadboard\?"/,
    "the label says which message, and where it sits in the conversation",
  );
  assert.match(markup, /aria-label="Go to message 2 of 2: Show me an example"/);
});

// The shape a research chat actually has for most of its life: one question,
// one enormous answer. The rail earns its place most here, so a minimum of two
// ticks would hide it in precisely the case it is most useful.
test("a single question still gets its tick", () => {
  const markup = render([
    { rowIndex: 0, label: "Research every TU/e team", role: "user" },
  ]);
  assert.match(markup, /data-tick-count="1"/);
  assert.match(markup, /aria-label="Go to message 1 of 1: Research every TU\/e team"/);
});

test("an empty transcript has nothing to point at, so no rail", () => {
  assert.equal(render([]), "");
});

test("the rail opens on its first tick and says which one that is", () => {
  const markup = render([
    { rowIndex: 0, label: "First", role: "user" },
    { rowIndex: 2, label: "Second", role: "assistant" },
  ]);

  assert.match(markup, /data-active-tick="0"/);
  assert.equal(
    (markup.match(/aria-current="true"/g) ?? []).length,
    1,
    "exactly one tick is ever current",
  );
});

test("the label is trimmed to something recognisable, never left empty", () => {
  assert.equal(summarise("  what   is\n a breadboard? "), "what is a breadboard?");
  assert.equal(summarise("   "), "Empty message");
  const long = summarise("x".repeat(400));
  assert.equal(long.length, 160);
  assert.ok(long.endsWith("…"), "a trimmed label says it was trimmed");
  // A whole question of ordinary length now survives intact rather than being
  // cut mid-sentence — the chip wraps to three lines to hold it.
  const question = "suggests bands that are similar to Radiohead, ideally ones with the same sense of melancholy";
  assert.equal(summarise(question), question);
});

test("AI response previews keep the complete answer without an ellipsis", () => {
  const answer = `${"complete response ".repeat(80)}final sentence`;
  const preview = railPreview({ rowIndex: 1, label: answer, role: "assistant" });
  assert.equal(preview, answer.trim());
  assert.ok(preview.endsWith("final sentence"));
  assert.ok(!preview.endsWith("…"));
});

// ── Which tick is the one being read ────────────────────────────────────────

// Three questions, the first with a 6,000px answer under it — the shape that
// made the highlight look frozen under a "last question passed" rule.
const STARTS = [0, 6_000, 6_600];

test("the lit tick is the question nearest what is being read", () => {
  assert.equal(nearestRailTick(STARTS, 0), 0);
  assert.equal(nearestRailTick(STARTS, 1_000), 0);
});

test("a long answer hands the highlight over at its midpoint, not its end", () => {
  // The whole point: scrolling through one enormous answer must not leave the
  // rail sitting on the same tick for ten viewports.
  assert.equal(nearestRailTick(STARTS, 2_900), 0);
  assert.equal(nearestRailTick(STARTS, 3_100), 1);
});

test("the foot of the transcript lands on the newest question", () => {
  // Every row past the scroller's travel reports the same saturated offset, so
  // the last few ticks tie. The tie has to go to the later one or the newest
  // question is unreachable.
  const saturated = [0, 4_000, 4_000, 4_000];
  assert.equal(nearestRailTick(saturated, 4_000), 3);
});

test("a row the virtualizer cannot place is skipped, not read as the top", () => {
  // Treating null as 0 would drag the highlight back to the first question.
  assert.equal(nearestRailTick([null, 6_000, 6_600], 6_100), 1);
  assert.equal(nearestRailTick([null, null], 5_000), 0);
});

// ── Where down the viewport the rail measures from ──────────────────────────

test("with room left to scroll the rail measures from the top of the viewport", () => {
  assert.equal(
    railFocusLine({ scrollTop: 1_000, clientHeight: 600, scrollHeight: 9_000 }),
    1_024,
    "the top, plus the slack a smooth glide lands short by",
  );
});

test("the focus line slides to the foot of the viewport as the scroll runs out", () => {
  const atBottom = { scrollTop: 5_900, clientHeight: 600, scrollHeight: 6_500 };
  assert.equal(railFocusLine(atBottom), 6_500, "the bottom edge, exactly");
  // Halfway through the last screenful it is halfway down the viewport.
  const halfway = { scrollTop: 5_600, clientHeight: 600, scrollHeight: 6_500 };
  assert.equal(railFocusLine(halfway), 5_912);
});

test("two questions close together at the bottom light the newer one", () => {
  // The reported case: a short exchange under a long one. Both are on screen at
  // the bottom, and the older sits nearer the top of the viewport — so measuring
  // from the top would light it even though the reader is plainly at the newest.
  const scroller = { scrollTop: 5_900, clientHeight: 600, scrollHeight: 6_500 };
  const starts = [20, 6_120, 6_320];
  assert.equal(
    nearestRailTick(starts, scroller.scrollTop + 24),
    1,
    "measuring from the top of the viewport picks the older question",
  );
  assert.equal(
    nearestRailTick(starts, railFocusLine(scroller)),
    2,
    "the sliding focus line picks the newest",
  );
});

// ── Wiring ──────────────────────────────────────────────────────────────────

// The dashboard Terminal the rail is actually read on is the Hermes panel, not
// the collapsible garden dock that shares the word: both exist, both have a
// composer reading "Ask anything across your gardens", and only one of them is
// the full-page Terminal. Every unbounded transcript gets the rail so the
// distinction cannot be got wrong again.
test("every transcript the rail was asked for actually mounts it", () => {
  const surfaces = {
    "src/app/components/hermes/agent-runtime-panel.tsx": null, // names two
    "src/app/gardens/[clusterSlug]/workspace-client.tsx": "garden-chat",
    "src/app/garden/garden-assistant.tsx": "garden-assistant",
    "src/app/components/knowledge-terminal.tsx": "knowledge-terminal",
  };

  for (const [relativePath, surface] of Object.entries(surfaces)) {
    const text = source(relativePath);
    // `\s` and not a bare prefix: `useMemo<ChatMessageRailItem[]>` also starts
    // with the component's name, and matching it lands on the wrong span.
    const railAt = text.search(/<ChatMessageRail\s/);
    assert.ok(railAt > 0, `${relativePath} renders the rail`);
    const railTag = text.slice(railAt, text.indexOf("/>", railAt));
    assert.match(
      railTag,
      /bridge=\{transcriptVirtual\}/,
      `${relativePath} hands the rail the transcript's own bridge`,
    );
    assert.match(
      railTag,
      /scrollRef=\{transcriptScrollRef\}/,
      `${relativePath} hands the rail the transcript's own scroller`,
    );
    if (surface) assert.ok(railTag.includes(`"${surface}"`), relativePath);
    // The rail floats over the scroller, so it cannot live inside it.
    const listAt = text.indexOf("<VirtualizedMessageList");
    assert.ok(railAt > 0 && listAt > 0, relativePath);
    assert.ok(
      !text.slice(listAt, text.indexOf("/>", listAt)).includes("<ChatMessageRail"),
      `${relativePath} keeps the rail outside the virtualizer`,
    );
    // Both sides of the visible conversation get a tick.
    assert.match(text, /role === ["']user["']/, relativePath);
    assert.match(text, /role === ["']assistant["']/, relativePath);
    assert.match(railTag, /onReply=/, `${relativePath} registers inline replies`);
  }
});

test("the AI preview is larger, scrollable, and owns a reply form", () => {
  const rail = source("src/app/components/chat-message-rail.tsx");
  assert.match(rail, /max-h-\[min\(70vh,42rem\)\]/);
  assert.match(rail, /w-\[min\(36rem,calc\(100vw-5rem\)\)\]/);
  assert.match(rail, /flex-1 overflow-y-auto overscroll-contain/);
  assert.match(rail, /Reply in this chat/);
  assert.match(rail, /await onReply\(text, item\)/);
});

test("the rail speaks row indices, not message indices", () => {
  // The garden transcript drops the hidden observer's turns before drawing, so
  // a message's place in the conversation is not its place in the list. Ticks
  // built from the message index would land on the wrong message from the
  // first delegated agent run onward.
  const text = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(text, /function buildTranscriptRows/);
  assert.match(
    text,
    /buildTranscriptRows\(messages\)\.flatMap\(\(row, rowIndex\)/,
    "rail items are numbered off the rows the virtualizer draws",
  );
  // The transcript and the rail agree because they call the same builder.
  assert.ok(
    (text.match(/buildTranscriptRows\(/g) ?? []).length >= 3,
    "the definition and both readers must share the same row projection",
  );
});

test("the virtualized list lends the rail a way to aim at one row", () => {
  const list = source("src/app/components/chat/virtualized-message-list.tsx");
  assert.match(list, /virtualizer\.scrollToIndex\(index, \{ align: "start", behavior \}\)/);
  assert.match(list, /getOffsetForIndex\(index, "start"\)/);
  assert.match(list, /bridge\.attach\(\{ scrollToEnd, scrollToIndex, getRowStart \}\)/);

  const hook = source("src/app/components/use-chat-auto-scroll.ts");
  assert.match(hook, /scrollToIndex: \(index: number, behavior: ScrollBehavior\)/);
  assert.match(hook, /getRowStart: \(index: number\)/);
});

test("clicking a tick asks the virtualizer, and only falls back to the DOM", () => {
  const rail = source("src/app/components/chat-message-rail.tsx");
  // A virtualized scroller's own scrollHeight is an estimate below the fold,
  // so the row a tick names is usually not in the DOM to be scrolled to.
  assert.match(rail, /if \(bridge\.activeRef\.current\) \{\s*bridge\.scrollToIndex/);
  assert.match(rail, /prefers-reduced-motion: reduce/);
});
