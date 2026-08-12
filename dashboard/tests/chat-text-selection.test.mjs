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
  const prompt = chatTextSelectionQuestionPrompt("like how many?", {
    id: "inline:12345678",
    mode: "inline",
    sourceMessageId: "message:12345678",
    start: 15,
    end: 30,
    quote: "several minutes",
    prefix: "Expect this to take ",
    suffix: ". It only reads file metadata.",
  });
  assert.match(prompt, /specifically in relation to that excerpt/);
  assert.match(prompt, /"highlightedText":"several minutes"/);
  assert.match(prompt, /"contextBefore":"Expect this to take "/);
  assert.match(prompt, /User question:\nlike how many\?/);
  assert.match(prompt, /Do not switch to another topic/);
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
  const sessions = source("src/app/api/hermes/sessions/route.ts");
  const hook = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(route, /surfaceContext\.selectedText = textSelection\.quote/);
  assert.match(turns, /\{ textSelection: input\.textSelection \}/);
  assert.match(turns, /chatTextSelectionQuestionPrompt/);
  assert.match(sessions, /normalizeChatTextSelectionReference/);
  assert.match(hook, /selectedText: options\?\.textSelection\?\.quote/);
  assert.match(hook, /textSelection: options\?\.textSelection/);
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
