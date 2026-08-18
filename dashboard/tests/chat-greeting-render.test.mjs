// Renders the blank chat's empty state for real (esbuild -> CJS ->
// react-dom/server) rather than reasoning about what the markup would be.
//
// The thing worth pinning down is the greeting itself: it has to address the
// reader by name, in a colour of its own, on whichever line the hourly rotation
// happened to land on — and the four openers have to be four buttons, not four
// links that fire a message.

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
  const screen = screenAt(14);
  assert.ok(screen.html.includes(screen.greeting.lead));
  assert.ok(screen.html.includes(screen.greeting.question));
  // The name is there, and it is drawn in its own muted colour rather than
  // running into the greeting.
  assert.ok(screen.html.includes(`<span class="text-gray-500">, Grey</span>`));
  assert.doesNotMatch(screen.html, />, Grey<\/p>/);
});

test("every hour of the day still says the reader's name", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    const screen = screenAt(hour);
    assert.ok(
      screen.html.includes(`<span class="text-gray-500">, Grey</span>`),
      `${screen.greeting.leadId} at ${hour}:00 rendered without the name`,
    );
  }
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
  assert.equal((screen.html.match(/bb-terminal-suggestion/g) ?? []).length, 4);
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
