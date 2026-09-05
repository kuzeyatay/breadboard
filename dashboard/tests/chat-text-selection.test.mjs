import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  chatTextSelectionQuestionPrompt,
  chatTextSelectionDraft,
  chatTextSelectionsOverlap,
  normalizeChatTextSelectionReference,
  resolveChatTextSelectionAnchor,
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

test("a highlight relocates by quote and context when rendered offsets drift", () => {
  const rendered =
    "Repeated phrase belongs above.A rich widget contributes hidden renderer text.Repeated phrase belongs here.";
  const expectedStart = rendered.lastIndexOf("Repeated phrase");
  const resolved = resolveChatTextSelectionAnchor(rendered, {
    // The DOM selection map omitted the rich widget, so this old offset points
    // at the first copy when replayed directly in the Markdown tree.
    start: 0,
    end: "Repeated phrase".length,
    quote: "Repeated phrase",
    prefix: "hidden renderer text.",
    suffix: " belongs here.",
  });
  assert.deepEqual(resolved, {
    start: expectedStart,
    end: expectedStart + "Repeated phrase".length,
  });
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

test("the transcript exposes highlight and both question actions", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  const ui = source("src/app/components/chat-text-selection-ui.tsx");
  const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(ui, /CHAT_HIGHLIGHT_COLORS\.map/);
  assert.match(ui, /aria-label="Highlight color"/);
  assert.match(ui, />\s*Ask in chat\s*</);
  assert.match(ui, />\s*Ask here\s*</);
  assert.match(panel, /CHAT_HIGHLIGHT_STORAGE_PREFIX/);
  assert.match(panel, /loadChatHighlights/);
  assert.match(panel, /applySelectionHighlight/);
  assert.match(panel, /removeSelectionHighlight/);
  assert.match(panel, /kind: "highlight"/);
  assert.match(panel, /message\.textSelection\?\.mode === "inline"/);
  assert.match(panel, /QuotedChatSelection/);
  assert.match(panel, /InlineSelectionAnswerPopover/);
  assert.match(panel, /INLINE_SELECTION_STORAGE_PREFIX/);
  assert.match(panel, /DELETED_INLINE_SELECTION_STORAGE_PREFIX/);
  assert.match(panel, /deleteInlineSelection/);
  // The selected-text context is part of the composer column, so it must use
  // the same responsive cap as the dialogue bar on every chat surface.
  assert.match(ui, /widthClassName = "max-w-3xl"/);
  assert.match(panel, /widthClassName=\{chatColumnWidthClass\}/);
  assert.match(garden, /widthClassName="max-w-5xl"/);
  // "Ask here" replaces a running response and keeps its rich selection
  // payload. It must never be flattened into the plain-text follow-up queue.
  assert.match(composer, /if \(canSubmitDuringRun\) \{\s*onSubmitDuringRun\?\.\(\);/);
  assert.match(
    panel,
    /onSubmitDuringRun=\{[\s\S]*?composerSelection\?\.mode === "inline"/,
  );
  assert.match(garden, /const replacesActiveTurn =[\s\S]*?mode === "inline"/);
  assert.match(garden, /agentActivity\.abort\(\)\.finally/);
  assert.match(
    garden,
    /handleSubmit\(question, undefined, \[\], false, undefined, \{\s*textSelection: selection/,
  );
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
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
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
  assert.match(popover, /\.bb-chat-selection-menu, \.bb-inline-answer/);
  assert.match(popover, /if \(editing\) \{\s*setDraft\(null\);/);
  // The question itself is the edit affordance, and sending the edit is the
  // same path as a retry: ask again against the same highlight.
  assert.match(popover, /onClick=\{\(\) => setDraft\(question\)\}/);
  assert.match(popover, /aria-label="Edit question about highlighted text"/);
  assert.match(popover, /onAskAgain\?\.\(next\)/);
  assert.match(panel, /function askInlineSelectionAgain\(/);
  assert.match(panel, /void onAskSelection\(trimmed, selection\)/);
  // The inline card owns its run. The dialogue stays visually free and the
  // transcript never follows an inline retry down to the bottom of the chat.
  assert.match(panel, /onStop=\{canStop && !respondingToInlineSelection \? stopEverything : undefined\}/);
  assert.match(panel, /isSending=\{streaming && !respondingToInlineSelection\}/);
  assert.match(panel, /isResponding: transcriptResponding/);
  assert.match(garden, /isResponding: transcriptResponding/);
  assert.match(garden, /isStreaming=\{transcriptResponding \|\| delegationInFlight\}/);
  assert.match(
    panel,
    /if \(activeRun && messageIndex === messages\.length - 1\) \{\s*current\.pending = true;/,
  );
});

test("nested Ask here cards preserve their ancestors", () => {
  const ui = source("src/app/components/chat-text-selection-ui.tsx");
  for (const file of [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const surface = source(file);
    assert.match(surface, /openInlineAnswers\.map/);
    assert.match(surface, /current\.slice\(0, parentIndex \+ 1\)/);
    assert.match(surface, /if \(mode === "chat"\) setOpenInlineAnswers\(\[\]\)/);
    assert.doesNotMatch(surface, /setOpenInlineAnswer\(null\)/);
  }
  // Interacting with a child card is not an outside click on its parent.
  assert.match(ui, /target\.closest\("\.bb-chat-selection-menu, \.bb-inline-answer"\)/);
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
  assert.match(popover, /neu-button-accent[^"]*bg-\[var\(--botanical\)\]/);
  assert.match(popover, /AssistantResponseMeta/);
  assert.match(popover, /aria-label="Delete highlight"/);
  assert.match(popover, /onDelete/);
  assert.doesNotMatch(popover, /Asked here/);
});

test("plain highlights use a neutral treatment instead of Ask here's yellow", () => {
  const css = source("src/app/globals.css");
  const markdown = source("src/app/components/chat-markdown.tsx");
  const palette = source("src/lib/chat-highlights.ts");
  assert.match(css, /--selection-highlight-blue: #8fc3eb/);
  assert.match(css, /--selection-highlight-green: #8ed09e/);
  assert.match(css, /--selection-highlight-pink: #e99abb/);
  assert.match(css, /--selection-highlight-purple: #b79be9/);
  assert.match(
    css,
    /\.bb-chat-text-highlight\[data-chat-selection-kind="highlight"\][\s\S]*background: var\(--bb-chat-highlight\)/,
  );
  assert.match(markdown, /'data-chat-selection-kind': annotation\.kind \?\? 'answer'/);
  assert.match(markdown, /'data-chat-highlight-color': annotation\.color \?\? 'blue'/);
  assert.match(markdown, /resolveChatTextSelectionAnchor/);
  assert.match(markdown, /language-image-results/);
  assert.match(markdown, /Open highlight options/);
  assert.doesNotMatch(palette, /yellow/i);
});
