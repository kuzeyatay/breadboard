// Renders the goal card for real (esbuild -> CJS -> react-dom/server) rather
// than reasoning about what the markup would be.
//
// The card's whole job is to say, at a glance, what state the goal is in and
// what the person can do about it — so what is pinned here is the five status
// readings and which control each one offers. A stalled goal that shows a pause
// button, or a complete one that still offers to keep working, would be worse
// than no card at all.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-goal-card-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as GoalCard } from "@/app/components/hermes/goal-card";\n`,
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
const { GoalCard } = require(bundle);

const GOAL = {
  goalId: "goal-1",
  objective: "Get every dashboard test passing under npm test",
  status: "active",
  turnBudget: null,
  turnsUsed: 4,
  remainingTurns: null,
  tokensUsed: 0,
  timeUsedSeconds: 91,
  createdAt: "2026-08-20T07:20:54.000Z",
  updatedAt: "2026-08-22T11:59:00.000Z",
};

/**
 * Server rendering runs the first pass only, so the card's own fetch never
 * resolves. Seeding React's state hook is what lets a static render show a
 * goal at all — the alternative is a browser, for markup that is decided
 * entirely by the goal it is handed.
 */
function render(goal, props = {}) {
  const original = React.useState;
  let seeded = false;
  React.useState = function stateHook(initial) {
    if (seeded) return original(initial);
    seeded = true;
    return original(goal);
  };
  try {
    return renderToStaticMarkup(
      React.createElement(GoalCard, { sessionId: "session-1", ...props }),
    );
  } finally {
    React.useState = original;
  }
}

test("an idle goal remains visibly pursued and offers to keep going", () => {
  const html = render(GOAL, { running: false, onContinue: () => {} });
  assert.match(html, /Pursuing goal/);
  assert.match(html, /Get every dashboard test passing/);
  assert.match(html, /aria-label="Keep working on this goal"/);
  assert.match(html, /aria-label="Abandon this goal"/);
  assert.match(html, /aria-label="Show goal detail"/);
  // The clock is wall time since the objective was set, in the compact form
  // the composer has room for.
  assert.match(html, /\d+d \d+h \d+m \d+s/);
});

test("a goal with a turn in flight stays pursued and offers to hold it", () => {
  const html = render(GOAL, { running: true });
  assert.match(html, /Pursuing goal/);
  assert.match(html, /aria-label="Pause this goal"/);
  assert.doesNotMatch(html, /Keep working on this goal/);
});

test("a paused goal offers to resume, and never claims to be running", () => {
  const html = render({ ...GOAL, status: "paused" }, { running: true });
  assert.match(html, /Goal paused/);
  assert.match(html, /aria-label="Resume this goal"/);
});

test("a goal out of turns asks for more rather than pretending to continue", () => {
  const html = render({ ...GOAL, status: "budget_limited", turnBudget: 4 });
  assert.match(html, /Goal out of turns/);
  assert.match(html, /aria-label="Give this goal more turns"/);
  assert.doesNotMatch(html, /4\/4 turns/);
});

test("a complete goal offers nothing but the record of it", () => {
  const html = render({ ...GOAL, status: "complete" });
  assert.match(html, /Goal complete/);
  assert.doesNotMatch(html, /Keep working on this goal/);
  assert.doesNotMatch(html, /Pause this goal/);
  assert.doesNotMatch(html, /Resume this goal/);
  // Abandoning a finished goal is still the person's call — it is how the card
  // leaves the composer.
  assert.match(html, /aria-label="Abandon this goal"/);
});

test("a conversation with no goal renders nothing at all", () => {
  assert.equal(render(null), "");
});

test("continuing is held back while a draft is waiting", () => {
  const html = render(GOAL, { onContinue: () => {}, continueBlocked: true });
  assert.match(html, /Send or clear your draft first/);
  assert.match(html, /disabled=""/);
});

test("the default goal treatment is a single minimal composer strip", () => {
  const html = render(GOAL, { running: true });
  assert.match(html, /border-b/);
  assert.doesNotMatch(html, /neu-surface-subtle/);
  assert.doesNotMatch(html, /rounded-2xl/);
  assert.doesNotMatch(html, /animate-pulse/);
});
