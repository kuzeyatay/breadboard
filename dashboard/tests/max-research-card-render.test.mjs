// Renders the Max Research card for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what the JSX would produce.
//
// The card was built before the shared run-card design system and kept its own
// ad-hoc markup, so it sat in a transcript looking like nothing else in it.
// What is pinned here is that it now speaks the same vocabulary as the other
// agent cards, and that the roster — the whole reason a forty-minute run is
// watchable at all — survives every state it can be in.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-max-research-card-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as InlineMaxResearchRun } from "@/app/components/hermes/inline-max-research-run";\n`,
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
const { InlineMaxResearchRun } = require(bundle);

function render(props) {
  return renderToStaticMarkup(
    React.createElement(InlineMaxResearchRun, {
      runId: "mxrun_test",
      query: "What percentage of startups fail within five years?",
      ...props,
    }),
  );
}

test("the card is built from the shared agent run-card vocabulary", () => {
  const markup = render({});
  for (const className of [
    "bb-agent-run-card",
    "bb-agent-run-header",
    "bb-agent-run-title",
    "bb-agent-run-label",
    "bb-agent-run-led",
  ]) {
    assert.ok(
      markup.includes(className),
      `the card should use ${className} like every other agent card`,
    );
  }
  // The ad-hoc shell it used to carry, which is what made it look foreign.
  assert.ok(
    !markup.includes("rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3"),
    "the hand-rolled card shell should be gone",
  );
});

test("a running card names the agent and leaves stopping to the composer", () => {
  const markup = render({});
  assert.match(markup, /Max Research/);
  assert.match(markup, /animate-pulse/, "a live run should show a live indicator");
  // One conversation, one stop control. The composer's already reaches every
  // run in the transcript through `externalAgentAbortUrls`; a second button on
  // the card is a second thing to find and to keep in step with it.
  assert.ok(!/Stop/.test(markup), "the card must not carry its own stop button");
  // The question is the message directly above the card; repeating it in the
  // header is what made this card taller than its siblings.
  assert.ok(
    !markup.includes(">What percentage of startups fail within five years?<"),
    "the query belongs in the title attribute, not printed again in the header",
  );
  assert.match(markup, /title="What percentage of startups fail within five years\?"/);
});

test("a finished run shows its answer and offers the usual actions", () => {
  const markup = render({
    persistedOutcome: "completed",
    persistedContent: "About half of new employer businesses close within five years.",
  });
  assert.match(markup, /About half of new employer businesses/);
  assert.ok(
    !markup.includes("animate-pulse"),
    "a finished run should not keep pulsing",
  );
});

test("a failed run is coloured as a failure rather than as prose", () => {
  const markup = render({
    persistedOutcome: "failed",
    persistedContent: "Every participant was unavailable.",
  });
  assert.match(markup, /Every participant was unavailable\./);
  assert.match(markup, /var\(--danger\)/, "failure should read as failure");
});

test("with no roster yet, the card says what it is doing instead of showing an empty box", () => {
  const markup = render({});
  assert.match(markup, /Commissioning all five/);
});

test("the stage is stated once, in the card, not repeated above it", () => {
  const markup = render({});
  // "Starting" appeared twice: once as the meta row's summary, on its own line
  // between the thinking row and the card, and once in the card header where
  // it belongs next to the clock.
  const occurrences = markup.split(/starting/i).length - 1;
  assert.equal(
    occurrences,
    1,
    "the stage should appear only in the card header, beside the elapsed time",
  );
});
