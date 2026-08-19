// A `/agents:*` launch is the slowest send in the garden chat: it names the
// chat, probes the agent's health and creates the run before a single row is
// committed. For all of that the screen used to show the question and nothing
// else — no answer bubble, so no Thinking, so a send that read as one that had
// gone nowhere.
//
// Two halves are pinned here. The panel half is rendered for real (esbuild ->
// CJS -> react-dom/server): an answer row that is still empty has to say
// "Thinking", and the same row with no activity behind it has to say "Thought"
// — which is exactly what an unraised launch looked like. The launcher half is
// read from the source, because the workspace client cannot be mounted: the
// shared launcher path has to put an *assistant* row up beside the question and
// raise the activity that fills it.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-pending-turn-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ActivityPanel } from "@/app/components/hermes/activity-panel";\n`,
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
const { ActivityPanel } = require(bundle);

/** The activity a launch raises the moment its turn goes up. */
const THINKING = [
  {
    id: "reasoning",
    kind: "reasoning",
    label: "Thinking",
    status: "running",
    startedAt: new Date(2026, 7, 18, 12, 0, 0).toISOString(),
  },
];

function panel(props) {
  return renderToStaticMarkup(
    React.createElement(ActivityPanel, {
      activities: [],
      connection: "idle",
      pendingPermission: null,
      onPermissionDecision: () => {},
      ...props,
    }),
  );
}

test("the answer row a launch puts up says Thinking while the launch runs", () => {
  const html = panel({ activities: THINKING, connection: "connecting" });
  assert.match(html, />Thinking</);
  // Shimmering, not a dead label: the turn is still happening.
  assert.match(html, /thinking-shimmer/);
  assert.match(html, /data-response-state="active"/);
});

test("without the activity the same empty row reads as already finished", () => {
  // The pre-fix look, kept as the thing the launcher must not fall back to.
  const html = panel({});
  assert.match(html, />Thought</);
  assert.doesNotMatch(html, /thinking-shimmer/);
});

const workspaceClient = fs.readFileSync(
  path.join(dashboardRoot, "src/app/gardens/[clusterSlug]/workspace-client.tsx"),
  "utf8",
);

/** The body of `prepareExternalAgentSession`, the path every launcher takes. */
function prepareBody() {
  const start = workspaceClient.indexOf("async function prepareExternalAgentSession(");
  assert.ok(start > 0, "prepareExternalAgentSession is gone or was renamed");
  const end = workspaceClient.indexOf("\n  async function commitExternalAgentTurn(", start);
  assert.ok(end > start, "commitExternalAgentTurn no longer follows it");
  return workspaceClient.slice(start, end);
}

test("the shared launcher path puts an empty answer up beside the question", () => {
  const body = prepareBody();
  // Both rows, in one place, so no launcher can draw only half a turn.
  assert.match(body, /role: "user"/);
  assert.match(body, /role: "assistant"/);
  assert.match(body, /updateChatMessages\(session\.id, \[/);
});

test("the launcher raises Thinking before it waits on anything", () => {
  const body = prepareBody();
  const raised = body.indexOf("agentActivity.start()");
  const firstAwait = body.indexOf("await ");
  assert.ok(raised > 0, "the launch no longer raises the turn's activity");
  assert.ok(
    raised < firstAwait,
    "Thinking is raised after the first await — the screen sits empty until then",
  );
});

test("no launcher draws the question on its own any more", () => {
  // Each of these used to append a user row and nothing else after prepare.
  for (const slug of ["codex", "opencode", "ruflo"]) {
    assert.doesNotMatch(
      workspaceClient,
      new RegExp(`${slug}-pending-\$\{`),
      `${slug} still appends a user-only row over the prepared turn`,
    );
  }
});

test("the raised activity is put down wherever the real rows land", () => {
  // The commit every launcher ends in, Codex's own direct write, and the
  // backstop for a launch that ends without committing at all.
  const settles = workspaceClient.match(/settleExternalTurnActivity\(\)/g) ?? [];
  assert.ok(
    settles.length >= 4,
    `only ${settles.length} teardown sites — Thinking can be left shimmering`,
  );
  assert.match(
    workspaceClient,
    /if \(launchingExternalAgent !== null\) return;\s*\n\s*settleExternalTurnActivity\(\);/,
    "the backstop for a launch that never commits is gone",
  );
});
