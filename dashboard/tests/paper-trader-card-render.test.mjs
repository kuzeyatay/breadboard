// Renders the Paper Trader card for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what it would produce.
//
// This card is the odd one out among the run cards, and the two things that make
// it odd are exactly what has to be checked by rendering it. Its live half is a
// poll rather than a stream, so a *finished* turn must still show a desk — the
// desk outlived the turn — while a finished turn must still not open a stream to
// a run the manager forgot hours ago. And it has to render at all before the
// first poll answers, because that is what a person sees for the first second.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-paper-trader-card-"),
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as InlinePaperTraderRun } from "@/app/components/hermes/inline-paper-trader-run";\n`,
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
const { InlinePaperTraderRun } = require(bundle);

/** Server rendering must not reach for EventSource; record it if it tries. */
const opened = [];
globalThis.EventSource = class {
  constructor(url) {
    opened.push(url);
  }
  addEventListener() {}
  close() {}
};

function render(props) {
  opened.length = 0;
  return renderToStaticMarkup(
    React.createElement(InlinePaperTraderRun, {
      runId: "ptrun-1",
      task: "",
      ...props,
    }),
  );
}

test("the first frame is a desk, not an empty box", () => {
  // Rendered before any poll has answered, which is what a person sees first.
  const html = render({ persistedOutcome: "running" });
  assert.match(html, /Paper Trader/);
  assert.match(html, /decided by TradingAgents/);
  assert.match(html, /Balance/);
  assert.match(html, /Return/);
  assert.match(html, /AI Decisions/);
  assert.match(html, /5 Minutes/);
  // With no data yet, the chart says so rather than drawing a flat line at zero.
  assert.match(html, /equity curve appears once the desk has been running/);
});

test("a finished turn still shows a desk, because the desk outlived it", () => {
  const html = render({
    persistedOutcome: "completed",
    persistedContent: "The trading desk is running while Breadboard is open. It keeps trading after this conversation is closed.",
  });
  assert.match(html, /keeps trading after this conversation is closed/);
  // The live half is a poll, so the tables and the start control are still there
  // on a turn from last week.
  assert.match(html, /AI Decisions/);
  assert.match(html, />Start</);
  // And nothing streams: the run manager forgot this run long ago.
  assert.deepEqual(opened, []);
});

test("a saved failure renders the reason rather than an empty card", () => {
  const html = render({
    persistedOutcome: "failed",
    persistedContent: "The open-alpha-arena clone was not found next to the dashboard.",
  });
  assert.match(html, /was not found next to the dashboard/);
});

test("a stop instruction says so while it is being carried out", () => {
  const html = render({ task: "stop", persistedOutcome: "running" });
  assert.match(html, /Stopping the desk…/);
});

test("the card uses the shared run material, not a second card style", () => {
  const html = render({ persistedOutcome: "running" });
  for (const cls of [
    "bb-agent-run-card",
    "bb-agent-run-header",
    "bb-agent-run-title",
    "bb-agent-run-led",
    "bb-agent-run-row",
    "bb-agent-run-label",
    "bb-agent-run-action",
  ]) {
    assert.match(html, new RegExp(cls), `missing ${cls}`);
  }
});

test.after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});
