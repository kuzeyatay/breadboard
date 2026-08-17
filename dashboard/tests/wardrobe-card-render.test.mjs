// Renders the Wardrobe run card for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what it would produce.
//
// The card has to work in three states, and two of them are easy to get wrong in
// a way no type checks: a saved turn must render its stored summary, and a saved
// turn must NOT open a stream to a run the manager has long forgotten.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-wardrobe-card-"),
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as InlineWardrobeRun } from "@/app/components/hermes/inline-wardrobe-run";\n`,
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
const { InlineWardrobeRun } = require(bundle);

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
    React.createElement(InlineWardrobeRun, {
      runId: "wdrun_1",
      task: "3 photos",
      ...props,
    }),
  );
}

test("a saved, completed turn renders its stored summary and no stream", () => {
  const html = render({
    persistedOutcome: "completed",
    persistedContent: "2 pieces added to your wardrobe, 2 with a modeled photo.",
  });
  assert.match(html, /2 pieces added to your wardrobe/);
  assert.match(html, /Wardrobe/);
  // A finished run offers no Stop button, and opens nothing.
  assert.doesNotMatch(html, />Stop</);
  assert.deepEqual(opened, []);
});

test("a saved failure renders the reason rather than an empty card", () => {
  const html = render({
    persistedOutcome: "failed",
    persistedContent: "Wardrobe needs a photo of you before it can import anything.",
  });
  assert.match(html, /Wardrobe needs a photo of you/);
});

test("a live turn shows what it is doing and a way to stop it", () => {
  const html = render({ persistedOutcome: "running" });
  assert.match(html, /Starting the wardrobe/);
  assert.match(html, />Stop</);
  // The label the transcript kept is what identifies the turn.
  assert.match(html, /3 photos/);
});

test("the card uses the shared run material, not a second card style", () => {
  const html = render({ persistedOutcome: "running" });
  for (const cls of [
    "bb-agent-run-card",
    "bb-agent-run-header",
    "bb-agent-run-title",
    "bb-agent-run-led",
  ]) {
    assert.match(html, new RegExp(cls), `missing ${cls}`);
  }
});

test("the card guards its stream, closes on error, and reads its saved content", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "hermes", "inline-wardrobe-run.tsx"),
    "utf8",
  );
  // EventSource reconnects on error forever by default; a replayed turn must
  // never open one, and a live one must close rather than hammer a dead route.
  assert.match(source, /if \(replaying\) return;/);
  assert.match(source, /source\.close\(\)/);
  assert.match(source, /persistedContent/);
  assert.match(source, /\/api\/wardrobe\/runs\/\$\{runId\}/);
  // The gallery is the clone's own app on a local port — a link, never a frame.
  assert.doesNotMatch(source, /<iframe/);
  assert.match(source, /rel="noreferrer"/);
});

test.after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});
