import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  quartzAssistantSelectionPromptContext,
  quartzAssistantSelectionRequest,
  quartzInlineAnswerStopRequest,
} from "../src/lib/quartz-assistant-selection.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assistant = read("src/app/garden/garden-assistant.tsx");
const assistantSwitch = read(
  "src/app/components/hermes/garden-assistant-switch.tsx",
);
const sessionsRoute = read("src/app/api/chat-sessions/route.ts");
const database = read("src/lib/db.ts");
const gardenClient = read("src/app/garden/[clusterSlug]/garden-client.tsx");
const libraryClient = read("src/app/garden/library-garden-client.tsx");
const newNoteButton = read("src/app/components/new-note-button.tsx");
const dashboardStyles = read("src/app/globals.css");
const gardenAdapter = read("src/lib/hermes/garden-chat-adapter.ts");
const quartzHighlighter = read(
  "../quartz/quartz/components/scripts/highlighter.inline.ts",
);
const quartzHighlighterComponent = read(
  "../quartz/quartz/components/Highlighter.tsx",
);
const quartzHighlighterStyles = read(
  "../quartz/quartz/components/styles/highlighter.scss",
);
const quartzAssistant = read("../quartz/quartz/components/BreadboardAI.tsx");
const quartzAssistantInline = read(
  "../quartz/quartz/components/scripts/breadboardAI.inline.ts",
);
const quartzAssistantStyles = read(
  "../quartz/quartz/components/styles/breadboardAI.scss",
);
const quartzMarkdownActions = read(
  "../quartz/quartz/components/MarkdownActions.tsx",
);
const quartzCustomStyles = read("../quartz/quartz/styles/custom.scss");
const quartzLayout = read("../quartz/quartz.layout.ts");

test("Quartz selection requests preserve their page context and answer mode", () => {
  const request = quartzAssistantSelectionRequest({
    type: "second-brain:assistant-ask-here",
    requestId: "request_123",
    highlightId: "highlight_123",
    mode: "inline",
    text: "oscillates, i",
    prefix: "An undamped oscillator moves around equilibrium. The displacement",
    suffix: "changes direction under a restoring force.",
    pageSlug: "physics/simple-harmonic-motion",
  });
  assert.equal(request?.mode, "inline");
  assert.equal(request?.highlightId, "highlight_123");
  const prompt = quartzAssistantSelectionPromptContext(request);
  assert.match(prompt, /undamped oscillator/);
  assert.match(prompt, /"highlightedText":"oscillates, i"/);
  assert.match(prompt, /simple-harmonic-motion/);
});

test("Quartz validates inline stop requests before they reach Garden", () => {
  assert.deepEqual(
    quartzInlineAnswerStopRequest({
      type: "second-brain:assistant-inline-stop",
      requestId: "request_123",
      highlightId: "highlight_123",
      pageSlug: "physics/simple-harmonic-motion",
    }),
    {
      requestId: "request_123",
      highlightId: "highlight_123",
      pageSlug: "physics/simple-harmonic-motion",
    },
  );
  assert.equal(
    quartzInlineAnswerStopRequest({
      type: "second-brain:assistant-inline-stop",
      requestId: "request with spaces",
      highlightId: "highlight_123",
    }),
    null,
  );
});

test("garden routes always render one stable Assistant", () => {
  assert.match(assistantSwitch, /return <GardenAssistant \{\.\.\.props\} \/>/);
  assert.doesNotMatch(
    assistantSwitch,
    /GardenAgentChat|hermes\/health|useState|useEffect/,
  );
});

test("the sole garden launcher and panel use the Assistant identity", () => {
  assert.match(assistant, />Assistant<\/p>/);
  assert.match(assistant, />\s*Assistant\s*<\/button>/);
  assert.doesNotMatch(assistant, />Quartz AI<\/p>/);
  assert.doesNotMatch(assistant, /Ask map|Ask this garden/);
});

test("the garden Assistant opens wide and cannot be resized into its cramped layout", () => {
  assert.match(assistant, /const DEFAULT_PANEL_WIDTH = 520;/);
  assert.match(assistant, /const MIN_PANEL_WIDTH = 480;/);
  assert.match(
    assistant,
    /const storedWidth = window\.localStorage\.getItem\(PANEL_WIDTH_KEY\);[\s\S]*?if \(storedWidth !== null\)/,
  );
  assert.match(
    assistant,
    /Math\.max\(MIN_PANEL_WIDTH, Math\.round\(width\)\)/,
  );
  assert.doesNotMatch(
    assistant,
    /Number\(window\.localStorage\.getItem\(PANEL_WIDTH_KEY\)\)/,
  );
});

test("the page Assistant launcher is absent while its panel is open", () => {
  assert.match(
    quartzAssistantInline,
    /function openPanel\(\)\s*\{[\s\S]*?panel!\.hidden = false[\s\S]*?toggle!\.hidden = true/,
  );
  assert.match(
    quartzAssistantInline,
    /function closePanel\(\)\s*\{[\s\S]*?panel!\.hidden = true[\s\S]*?toggle!\.hidden = false/,
  );
  assert.match(
    quartzAssistantStyles,
    /\.breadboard-ai-toggle[\s\S]*?&\[hidden\]\s*\{\s*display: none;/,
  );
});

test("the Markdown editor is large, sharp-edged, and hides the Assistant launcher", () => {
  assert.match(
    quartzMarkdownActions,
    /width: min\(80rem, calc\(100vw - 3rem\)\)/,
  );
  assert.match(
    quartzMarkdownActions,
    /height: min\(52rem, calc\(100vh - 3rem\)\)/,
  );
  assert.doesNotMatch(quartzMarkdownActions, /backdrop-filter:\s*blur/);
  assert.match(
    quartzMarkdownActions,
    /body:has\(\.markdown-editor-modal:not\(\[hidden\]\)\) \.breadboard-ai-toggle\s*\{\s*display: none;/,
  );
  assert.match(
    quartzCustomStyles,
    /\.markdown-editor-panel\s*\{[\s\S]*?box-shadow: none;/,
  );
});

test("New note mirrors the Edit markdown modal and only Cancel dismisses either dialog", () => {
  assert.match(newNoteButton, /className="markdown-editor-panel"/);
  assert.match(newNoteButton, /className="markdown-editor-title"/);
  assert.match(newNoteButton, /className="markdown-editor-cancel"/);
  assert.doesNotMatch(newNoteButton, /markdown-editor-close/);
  assert.doesNotMatch(
    newNoteButton,
    /target === e\.currentTarget|target === event\.currentTarget/,
  );

  assert.match(dashboardStyles, /width: min\(80rem, calc\(100vw - 3rem\)\)/);
  assert.match(dashboardStyles, /height: min\(52rem, calc\(100vh - 3rem\)\)/);
  assert.match(dashboardStyles, /background: rgba\(0, 0, 0, 0\.58\)/);
  assert.match(
    dashboardStyles,
    /\.markdown-editor-panel\s*\{[\s\S]*?box-shadow: none;/,
  );

  assert.doesNotMatch(quartzMarkdownActions, /markdown-editor-close/);
  assert.doesNotMatch(quartzMarkdownActions, /event\.target === modal/);
  assert.match(
    quartzMarkdownActions,
    /cancel\?\.addEventListener\("click", dismissEditor\)/,
  );
});

test("the dashboard Assistant launcher follows the Quartz editor state", () => {
  assert.match(quartzMarkdownActions, /second-brain:markdown-editor-state/);
  assert.match(
    gardenClient,
    /data\.type === 'second-brain:markdown-editor-state'/,
  );
  assert.match(
    libraryClient,
    /data\.type === 'second-brain:markdown-editor-state'/,
  );
  assert.match(gardenClient, /launcherHidden=\{markdownEditorOpen\}/);
  assert.match(libraryClient, /launcherHidden=\{markdownEditorOpen\}/);
  assert.match(assistant, /!launcherHidden/);
  assert.match(assistant, /garden-assistant-launcher/);
  assert.match(
    dashboardStyles,
    /body:has\(\.markdown-editor-modal\) \.garden-assistant-launcher\s*\{\s*display: none;/,
  );
});

test("Assistant history is separate from Garden Chat history", () => {
  assert.match(assistant, /historySurface=assistant/);
  assert.match(assistant, /historySurface:\s*'assistant'/);
  assert.match(sessionsRoute, /cs\.history_surface = \?/);
  assert.match(sessionsRoute, /history_surface\) VALUES \(\?, \?, \?, \?\)/);
  assert.match(database, /"chat_sessions",\s*\n\s*"history_surface"/);
});

test("chat bubbles do not repeat You and Assistant speaker labels", () => {
  assert.doesNotMatch(
    assistant,
    /message\.role === 'user' \? 'You' : 'Assistant'/,
  );
});

test("Quartz selection actions bridge grounded chat and inline answers through the sole Assistant", () => {
  assert.match(quartzHighlighter, /second-brain:assistant-ask-here/);
  assert.match(quartzHighlighter, /window\.parent\.postMessage/);
  assert.match(quartzHighlighter, /DEFAULT_HIGHLIGHT_COLOR/);
  assert.match(quartzHighlighter, /askSelection\("chat"\)/);
  assert.match(quartzHighlighter, /askSelection\("inline"\)/);
  assert.match(quartzHighlighter, /QUESTION_CONTEXT/);
  assert.match(quartzHighlighter, /second-brain:assistant-inline-answer/);
  assert.match(gardenClient, /quartzAssistantSelectionRequest\(data\)/);
  assert.match(libraryClient, /quartzAssistantSelectionRequest\(data\)/);
  assert.match(assistant, /selectedTextRequest/);
  assert.match(assistant, /'Ask here' : 'Ask in chat'/);
  assert.match(assistant, /inlineSelection/);
  assert.match(assistant, /publishInlineAnswer/);
  assert.match(assistant, /questions\.get\(selection\.requestId\)/);
  assert.match(assistant, /selectedText,/);
  assert.match(gardenAdapter, /quartzAssistantSelectionPromptContext/);
  assert.match(
    gardenAdapter,
    /quartzAssistantSelectionPromptContext\(payload\.selectedText\)/,
  );
});

test("Thought Topology can hand a selected node or connection directly to Bread", () => {
  const topologyRenderer = read(
    "../quartz/quartz/components/scripts/thoughtTopologyRenderer.ts",
  );
  const quartzGraph = read("../quartz/quartz/components/scripts/graph.inline.ts");
  assert.match(topologyRenderer, /Investigate with Bread/);
  assert.match(topologyRenderer, /context\.onInvestigate/);
  assert.match(topologyRenderer, /selected Thought Topology connection/);
  assert.match(quartzGraph, /second-brain:assistant-investigate-topology/);
  assert.match(quartzGraph, /window\.parent\.postMessage/);
  assert.match(quartzAssistantInline, /breadboard:assistant-investigate-topology/);
  assert.match(gardenClient, /quartzTopologyInvestigationRequest\(data\)/);
  assert.match(libraryClient, /quartzTopologyInvestigationRequest\(data\)/);
  assert.match(assistant, /topologyInvestigationRequest\.prompt/);
});

test("Quartz uses Terminal's selection controls and keeps Ask here out of the chat stream", () => {
  assert.match(
    quartzHighlighterComponent,
    /aria-label="Selected text actions"/,
  );
  assert.match(quartzHighlighterComponent, /aria-label="Highlight color"/);
  assert.match(quartzHighlighterComponent, />Ask in chat</);
  assert.match(quartzHighlighterComponent, />Ask here</);
  assert.doesNotMatch(
    quartzHighlighterComponent,
    /CopyIcon|data-highlight-action="copy"/,
  );
  assert.match(quartzHighlighterStyles, /--bb-hl-blue: #8fc3eb/);
  assert.match(quartzHighlighterStyles, /--bb-hl-yellow: #f4e7ad/);
  assert.match(quartzHighlighterStyles, /var\(--neu-q-floating-shadow\)/);
  assert.match(quartzHighlighter, /second-brain:assistant-inline-stop/);
  assert.match(gardenClient, /quartzInlineAnswerStopRequest\(data\)/);
  assert.match(libraryClient, /quartzInlineAnswerStopRequest\(data\)/);
  assert.match(assistant, /function visibleGardenChatMessages/);
  assert.match(
    assistant,
    /message\.role === 'assistant' && pendingInlineAnswers > 0/,
  );
  assert.doesNotMatch(
    assistant,
    /messages\.filter\(\(message\) => !message\.inlineSelection\)/,
  );
  assert.match(
    assistant,
    /isNewest && !streamingInlineSelection\s*\? agentActivity\.activities/,
  );
  assert.match(
    assistant,
    /onStop=\{!streamingInlineSelection \? agentActivity\.abort : undefined\}/,
  );
});

test("published Quartz mounts its page Assistant without duplicating the embedded Garden launcher", () => {
  assert.match(
    quartzLayout,
    /afterBody: \[Component\.Highlighter\(\), Component\.BreadboardAI\(\)\]/,
  );
  assert.match(quartzAssistant, /class="breadboard-ai"\s+hidden/);

  const embeddedGuard = quartzAssistantInline.indexOf(
    "if (window.parent !== window) return",
  );
  const topLevelReveal = quartzAssistantInline.indexOf("root.hidden = false");
  assert.ok(embeddedGuard >= 0 && topLevelReveal > embeddedGuard);
  assert.match(quartzHighlighter, /const hasPageAssistant =/);
  assert.match(
    quartzHighlighter,
    /button\.hidden = window\.parent === window && !hasPageAssistant/,
  );
});
