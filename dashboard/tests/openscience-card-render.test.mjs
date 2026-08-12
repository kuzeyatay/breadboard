// Renders the OpenScience run card for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what it would produce.
//
// The card has to work in three states, and two of them are easy to get wrong
// in a way no type checks: a saved turn must render its stored answer, and a
// saved turn must NOT open a stream to a run the manager has long forgotten.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-openscience-card-"),
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as InlineOpenscienceRun } from "@/app/components/hermes/inline-openscience-run";\n`,
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
const { InlineOpenscienceRun } = require(bundle);

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
    React.createElement(InlineOpenscienceRun, {
      runId: "run-1",
      task: "measure the decay constant",
      ...props,
    }),
  );
}

test("a saved, completed turn renders its stored answer", () => {
  const html = render({
    persistedOutcome: "completed",
    persistedContent: "The decay constant is **0.0231 per minute**.",
  });
  assert.match(html, /0\.0231 per minute/);
  assert.match(html, /OpenScience/);
  // A finished run offers no Stop button.
  assert.doesNotMatch(html, />Stop</);
});

test("a saved failure renders the reason rather than an empty card", () => {
  const html = render({
    persistedOutcome: "failed",
    persistedContent: "OpenScience produced no answer.",
  });
  assert.match(html, /OpenScience produced no answer\./);
});

test("a live turn shows the stages and a way to stop it", () => {
  const html = render({ persistedOutcome: "running" });
  assert.match(html, /Opening the workspace/);
  assert.match(html, /Researching/);
  assert.match(html, />Stop</);
});

test("the card uses the shared run material, not a second card style", () => {
  const html = render({ persistedOutcome: "running" });
  for (const cls of ["bb-agent-run-card", "bb-agent-run-header", "bb-agent-run-title", "bb-agent-run-led"]) {
    assert.match(html, new RegExp(cls), `missing ${cls}`);
  }
});

test("a deliverable download link is scoped to the run and escapes its path", () => {
  // The path travels as a query parameter, so a nested one must survive
  // round-tripping and a stray character must not break out of the URL.
  const encoded = encodeURIComponent("figures/decay curve.png");
  assert.equal(encoded, "figures%2Fdecay%20curve.png");
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "hermes", "inline-openscience-run.tsx"),
    "utf8",
  );
  assert.match(source, /\/api\/openscience\/runs\/\$\{runId\}/);
  assert.match(source, /deliverables\?path=\$\{encodeURIComponent\(item\.path\)\}/);
});

test.after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});
