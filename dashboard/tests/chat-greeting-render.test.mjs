// Renders the blank chat's empty state for real (esbuild -> CJS ->
// react-dom/server) rather than reasoning about what the markup would be.
//
// The thing worth pinning down is the greeting itself: when it addresses the
// reader by name, that name is in a colour of its own — and the four openers
// have to be four buttons, not four links that fire a message.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  EMPTY_CHAT_GREETING_SIGNALS,
  resolveChatGreeting,
  resolveChatSuggestions,
} from "../src/lib/hermes/chat-greeting.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-chat-greeting-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ChatGreetingEmptyState } from "@/app/components/hermes/chat-greeting-empty-state";\n`,
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
const { ChatGreetingEmptyState } = require(bundle);

const SIGNALS = {
  ...EMPTY_CHAT_GREETING_SIGNALS,
  name: "Grey",
  gardenCount: 3,
  recentGardens: [{ name: "Thermodynamics", slug: "thermodynamics" }],
  promptsToday: 2,
  minutesSinceLastPrompt: 300,
  daysSinceJoined: 90,
};

function screenAt(hour, overrides = {}) {
  const now = new Date(2026, 7, 19, hour, 0, 0, 0);
  const input = {
    signals: { ...SIGNALS, ...overrides.signals },
    scope: overrides.scope ?? "mine",
    temporary: overrides.temporary ?? false,
    now,
  };
  const greeting = resolveChatGreeting(input);
  const suggestions = resolveChatSuggestions(input);
  const html = renderToStaticMarkup(
    React.createElement(ChatGreetingEmptyState, {
      greeting,
      suggestions,
      onSelectSuggestion: () => {},
    }),
  );
  return { greeting, suggestions, html };
}

test("the greeting renders as two lines with the name set apart", () => {
  // Find an hour that still uses the vocative, so this pins the markup rather
  // than whichever splash the rotation happened to land on.
  let screen = null;
  for (let hour = 0; hour < 24; hour += 1) {
    const candidate = screenAt(hour);
    if (candidate.greeting.name) {
      screen = candidate;
      break;
    }
  }
  assert.ok(screen, "a whole day of greetings never used the name");
  assert.ok(screen.html.includes(screen.greeting.lead));
  assert.ok(screen.html.includes(screen.greeting.question));
  // The name is there, and it is drawn in its own muted colour rather than
  // running into the greeting.
  assert.ok(screen.html.includes(`<span class="text-gray-500">, Grey</span>`));
  assert.doesNotMatch(screen.html, />, Grey<\/p>/);
});

test("a splash line does not grow a dangling comma", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatGreetingEmptyState, {
      greeting: {
        lead: "Hello, world",
        name: null,
        question: "What's on your mind?",
        leadId: "hello-world",
        questionId: "on-your-mind",
      },
      suggestions: [
        "Explain something I am trying to learn, from scratch.",
        "Help me think through a decision.",
        "Settle an argument I am having with myself.",
        "What should I focus on today?",
      ],
      onSelectSuggestion: () => {},
    }),
  );
  assert.ok(html.includes("Hello, world"));
  assert.doesNotMatch(html, /, <\/span>|,\s*<\/p>/);
  assert.ok(!html.includes("text-gray-500"));
});

test("an account with no name renders the greeting alone, not a dangling comma", () => {
  const screen = screenAt(14, { signals: { name: null } });
  assert.ok(screen.html.includes(screen.greeting.lead));
  assert.doesNotMatch(screen.html, /, <\/span>|,\s*<\/p>/);
  assert.ok(!screen.html.includes("text-gray-500"));
});

test("the four openers are buttons carrying their own text", () => {
  const screen = screenAt(14);
  const buttons = screen.html.match(/<button[^>]*type="button"/g) ?? [];
  assert.equal(buttons.length, 4);
  for (const prompt of screen.suggestions) {
    // React escapes the apostrophes and quotes it writes into text nodes.
    const escaped = prompt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    assert.ok(screen.html.includes(escaped), `missing opener: ${prompt}`);
  }
  // Every card is the dashed-outline surface the temporary mode restyles.
  // The lookahead matters: the travelling line's class starts with the card's.
  assert.equal((screen.html.match(/bb-terminal-suggestion(?!-)/g) ?? []).length, 4);
});

test("each card's outline sketches itself, and no two draw in unison", () => {
  const screen = screenAt(14);
  const beams = screen.html.match(/bb-terminal-suggestion-beam/g) ?? [];
  assert.equal(beams.length, 4, "one sketch pass per card");

  // Two layers per card, the voice ring's own structure: a settled line that
  // is always there, and the pass that draws along it. Both are hand-drawn
  // paths generated from the card's measured size, so on the server — which
  // knows no sizes — the svg is empty, and it fills in after mount. That also
  // means a card stretched taller by its grid row is re-measured and re-drawn,
  // instead of keeping an outline at its old height.
  assert.equal((screen.html.match(/<svg /g) ?? []).length, 4);
  assert.doesNotMatch(screen.html, /<rect/);
  assert.doesNotMatch(screen.html, /<path/);

  const component = fs.readFileSync(
    new URL("../src/app/components/hermes/chat-greeting-empty-state.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /new ResizeObserver\(measure\)/);
  assert.match(component, /sketchRectOutlines\(box, index\)/);
  assert.match(component, /viewBox=\{surface \? `0 0 \$\{surface\.width\} \$\{surface\.height\}` : undefined\}/);

  // Negative delays, a quarter of the 8460ms cycle apart: all four are already
  // at different points of the pass on the first frame rather than drawing in
  // unison.
  const delays = [...screen.html.matchAll(/--bb-beam-delay:\s*(-?\d+)ms/g)].map((m) => Number(m[1]));
  assert.deepEqual(delays, [0, -2115, -4230, -6345]);

  // Decorative, so it is out of the accessibility tree and out of the way of
  // the pointer; the button's name is still just its prompt.
  assert.equal((screen.html.match(/aria-hidden/g) ?? []).length, 4);

  // The card's radius has one source. It was a Tailwind class and is now the
  // custom property the drawn outline's own radius is derived from, and a
  // second source is how the line stops following the corner it draws.
  assert.doesNotMatch(screen.html, /rounded-lg/);
});

test("nothing is drawn until the clock and the signals have landed", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatGreetingEmptyState, {
      greeting: null,
      suggestions: [],
      onSelectSuggestion: () => {},
    }),
  );
  // Held at zero opacity rather than unmounted, so the block that is about to
  // arrive has already taken its space and the transcript does not jump.
  assert.match(html, /opacity-0/);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /min-h-\[16rem\]/);
});
