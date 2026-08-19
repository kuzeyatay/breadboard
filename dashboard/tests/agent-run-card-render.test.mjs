// Renders the shared Codex/OpenCode run card for real (esbuild -> CJS ->
// react-dom/server) rather than reasoning about what the JSX would produce.
//
// Three things are worth pinning down. A card that comes back from a reload
// still reports how long the run took, instead of dropping the duration the
// moment its client-side stopwatch resets. A finished run folds its timeline
// away — no wall of tool output under the answer — while keeping the expander
// that opens the whole run again. And a live run shows its most recent steps.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-agent-run-card-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as InlineOpenCodeRun } from "@/app/components/hermes/inline-opencode-run";\n`,
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
const { InlineOpenCodeRun } = require(bundle);

const TIMELINE = [
  { key: 1, kind: "reasoning", text: "Reading the failing test." },
  { key: 2, kind: "tool", tool: "shell", status: "completed", title: "npm test", summary: "1 failing" },
  { key: 3, kind: "tool", tool: "file_change", status: "completed", title: "evidence.ts", summary: "" },
];

function render(props) {
  return renderToStaticMarkup(
    React.createElement(InlineOpenCodeRun, {
      runId: "cxrun_test",
      task: "Fix the failing test",
      agentName: "Codex",
      apiSlug: "codex",
      ...props,
    }),
  );
}

test("a finished run keeps the duration it was told, across a reload", () => {
  const markup = render({
    persistedOutcome: "completed",
    persistedContent: "Fixed the assertion.",
    persistedActivity: TIMELINE,
    persistedUsage: {
      inputTokens: 12_000,
      outputTokens: 800,
      totalTokens: 12_800,
      cachedInputTokens: 0,
      reasoningTokens: 400,
      responseDurationMs: 254_000,
    },
  });
  assert.match(markup, /4m 14s/);
  assert.match(markup, /tokens/);
  assert.match(markup, /Fixed the assertion\./);
});

test("a duration-only usage record reports the time without inventing a token count", () => {
  const markup = render({
    persistedOutcome: "failed",
    persistedContent: "Codex could not complete the task.",
    persistedUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      responseDurationMs: 9_000,
    },
  });
  assert.match(markup, /9s/);
  assert.match(markup, /tokens unavailable/);
  assert.doesNotMatch(markup, /0 tokens/);
});

test("a finished run closes itself but stays openable", () => {
  const markup = render({
    persistedOutcome: "completed",
    persistedContent: "Done.",
    persistedActivity: TIMELINE,
  });
  // Folded away: no wall of tool output under the answer.
  assert.doesNotMatch(markup, /npm test/);
  assert.doesNotMatch(markup, /activity timeline/);
  // Still one click from the whole run, and the answer is the answer.
  assert.match(markup, /Show/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /Done\./);
  assert.match(markup, /completed/);
});

test("a live run shows its recent steps and can be folded away", () => {
  const markup = render({
    persistedOutcome: "running",
    persistedActivity: TIMELINE,
  });
  assert.match(markup, /Hide/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /activity timeline/);
  assert.match(markup, /npm test/);
  assert.match(markup, /Reading the failing test\./);
  assert.match(markup, /2 calls/);
});
