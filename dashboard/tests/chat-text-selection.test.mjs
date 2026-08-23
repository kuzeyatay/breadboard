import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  chatTextSelectionQuestionPrompt,
  chatTextSelectionDraft,
  chatTextSelectionsOverlap,
  normalizeChatTextSelectionReference,
} from "../src/lib/chat-text-selection.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => fs.readFileSync(`${root}/${path}`, "utf8");

test("selected text becomes a bounded message-relative anchor", () => {
  const text = `${"p".repeat(190)}  selected words  ${"s".repeat(190)}`;
  const draft = chatTextSelectionDraft(text, 190, 208);
  assert.equal(draft?.quote, "selected words");
  assert.equal(draft?.start, 192);
  assert.equal(draft?.end, 206);
  assert.equal(draft?.prefix?.length, 160);
  assert.equal(draft?.suffix?.length, 160);
});

test("persisted selected-text metadata is strict and self-consistent", () => {
  const valid = {
    id: "inline:12345678",
    mode: "inline",
    sourceMessageId: "message:12345678",
    start: 4,
    end: 10,
    quote: "answer",
    prefix: "The ",
    suffix: " follows",
  };
  assert.deepEqual(normalizeChatTextSelectionReference(valid), valid);
  assert.equal(
    normalizeChatTextSelectionReference({ ...valid, end: 11 }),
    null,
  );
  assert.equal(
    normalizeChatTextSelectionReference({ ...valid, mode: "sidebar" }),
    null,
  );
});

test("overlap detection prevents nested clickable highlights", () => {
  assert.equal(
    chatTextSelectionsOverlap({ start: 10, end: 20 }, { start: 15, end: 25 }),
    true,
  );
  assert.equal(
    chatTextSelectionsOverlap({ start: 10, end: 20 }, { start: 20, end: 25 }),
    false,
  );
});

test("selected-text questions are explicitly grounded in their excerpt", () => {
  const prompt = chatTextSelectionQuestionPrompt(
    "like how many?",
    {
      id: "inline:12345678",
      mode: "inline",
      sourceMessageId: "message:12345678",
      start: 15,
      end: 30,
      quote: "several minutes",
      prefix: "Expect this to take ",
      suffix: ". It only reads file metadata.",
    },
    "The complete source response says the scan normally takes seven minutes.",
  );
  assert.match(prompt, /specifically in relation to that excerpt/);
  assert.match(prompt, /"highlightedText":"several minutes"/);
  assert.match(prompt, /"contextBefore":"Expect this to take "/);
  assert.match(prompt, /"sourceResponse":"The complete source response/);
  assert.match(prompt, /User question:\nlike how many\?/);
  assert.match(prompt, /Do not switch to another topic/);
});

test("a selection follow-up never owes live web evidence", () => {
  // "what would be places to go?" asked on a highlighted excerpt matches the
  // planner's live-recommendation signal, but the selection prompt binds the
  // answer to the excerpt — a contract that can never satisfy the web gate.
  // The dispatch must therefore leave the obligation off, and must not spend a
  // decider call deciding something the contract already settles.
  const turns = source("src/lib/conversations/turn-service.ts");
  assert.match(
    turns,
    /adjudicateWebGrounding\(\{[\s\S]*?skip: Boolean\(input\.internalAgentContinuation\) \|\| Boolean\(input\.textSelection\)/,
  );
});

test("the transcript exposes both actions and hides inline turns", () => {
  const ui = source("src/app/components/chat-text-selection-ui.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(ui, />\s*Ask in chat\s*</);
  assert.match(ui, />\s*Ask here\s*</);
  assert.match(panel, /message\.textSelection\?\.mode === "inline"/);
  assert.match(panel, /QuotedChatSelection/);
  assert.match(panel, /InlineSelectionAnswerPopover/);
  assert.match(panel, /INLINE_SELECTION_STORAGE_PREFIX/);
  assert.match(panel, /DELETED_INLINE_SELECTION_STORAGE_PREFIX/);
  assert.match(panel, /deleteInlineSelection/);
});

test("selection context and anchors persist through the canonical turn API", () => {
  const route = source("src/app/api/hermes/sessions/[sessionId]/messages/route.ts");
  const turns = source("src/lib/conversations/turn-service.ts");
  const presentation = source("src/lib/hermes/session-presentation.ts");
  const hook = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(route, /surfaceContext\.selectedText = textSelection\.quote/);
  assert.match(turns, /\{ textSelection: input\.textSelection \}/);
  assert.match(turns, /chatTextSelectionQuestionPrompt/);
  assert.match(presentation, /normalizeChatTextSelectionReference/);
  assert.match(hook, /selectedText: options\?\.textSelection\?\.quote/);
  assert.match(hook, /textSelection: options\?\.textSelection/);
});

test("an inline answer is stopped, retried and edited where it lives", () => {
  const ui = source("src/app/components/chat-text-selection-ui.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const popover = ui.slice(
    ui.indexOf("export function InlineSelectionAnswerPopover"),
    ui.indexOf("function SelectionArrowIcon"),
  );
  // The corner that used to close the popover carries the run instead: a stop
  // while the answer is being written, a retry once it is not.
  assert.doesNotMatch(popover, /aria-label="Close answer"/);
  assert.match(popover, /aria-label=\{stopRequested \? "Stopping this answer" : "Stop this answer"\}/);
  assert.match(popover, /aria-label="Ask this question again"/);
  assert.match(popover, /onStop\?\.\(\)/);
  // Escape and an outside click still close it, so removing the button leaves
  // no dead end.
  assert.match(popover, /closeOnOutsidePointer/);
  assert.match(popover, /if \(editing\) \{\s*setDraft\(null\);/);
  // The question itself is the edit affordance, and sending the edit is the
  // same path as a retry: ask again against the same highlight.
  assert.match(popover, /onClick=\{\(\) => setDraft\(question\)\}/);
  assert.match(popover, /aria-label="Edit question about highlighted text"/);
  assert.match(popover, /onAskAgain\?\.\(next\)/);
  assert.match(panel, /function askInlineSelectionAgain\(/);
  assert.match(panel, /void onAskSelection\(trimmed, selection\)/);
  // The composer's square is withheld for the whole "Ask here" turn, including
  // the frames before its answer row exists.
  assert.match(panel, /onStop=\{canStop && !respondingToInlineSelection \? stopEverything : undefined\}/);
  assert.match(
    panel,
    /if \(activeRun && messageIndex === messages\.length - 1\) \{\s*current\.pending = true;/,
  );
});

test("inline answers use Breadboard's pastel-yellow theme token", () => {
  const css = source("src/app/globals.css");
  const ui = source("src/app/components/chat-text-selection-ui.tsx");
  const popover = ui.slice(
    ui.indexOf("export function InlineSelectionAnswerPopover"),
    ui.indexOf("function SelectionArrowIcon"),
  );
  assert.match(css, /--selection-yellow: #f4e7ad/);
  assert.match(css, /\.bb-chat-text-highlight[\s\S]*background: var\(--selection-yellow\)/);
  assert.match(css, /\.bb-inline-answer[\s\S]*var\(--neu-shadow-strong\)/);
  assert.match(popover, /Math\.min\(580, window\.innerWidth - 32\)/);
  assert.match(popover, /neu-popover/);
  assert.match(popover, /AssistantResponseMeta/);
  assert.match(popover, /aria-label="Delete highlight"/);
  assert.match(popover, /onDelete/);
  assert.doesNotMatch(popover, /Asked here/);
});
