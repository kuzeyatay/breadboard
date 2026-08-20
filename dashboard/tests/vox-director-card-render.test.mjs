// Renders the Vox Director run card for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what the JSX would produce.
//
// The three states that matter are the three the card has to survive: a run in
// flight, a run that finished while the tab was closed, and one that failed.
// The saved states are the ones a reload lands on, and a card that renders them
// empty is the failure `docs/ADDING_AN_AGENT.md` §5 exists to prevent.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-vox-card-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as InlineVoxDirectorRun } from "@/app/components/hermes/inline-vox-director-run";\n`,
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
const { InlineVoxDirectorRun } = require(bundle);

/** The reply a finished run saves with its turn. */
const SUMMARY = [
  "**Why Concorde Disappeared** — Concorde disappeared because supersonic speed created costs, route limits, and maintenance burdens that prestige could no longer cover.",
  "",
  "5 beats, 6 shots, about 28s, in the newsprint-editorial look.",
  "",
  "Narrated by Echo and rendered locally into an MP4 you can play and download on the card below.",
].join("\n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(InlineVoxDirectorRun, {
      runId: "voxrun_00000000000000000000000000000000",
      brief: "explain why the Concorde disappeared",
      ...props,
    }),
  );
}

test("a run still in flight lamps every stage and offers a stop", () => {
  const markup = render({});
  assert.match(markup, /Vox Director/);
  assert.match(markup, /producing/);
  assert.match(markup, /Stop/);
  // The six stages a person watches a local render through.
  for (const stage of ["Story", "Style", "Posters", "Motion", "Narration", "Final render"]) {
    assert.ok(markup.includes(stage), `the card never names ${stage}`);
  }
  // Shared run material, not a second card style.
  assert.match(markup, /bb-agent-run-card/);
  assert.match(markup, /bb-agent-run-header/);
  assert.match(markup, /bb-agent-run-led/);
});

test("a finished turn renders what was saved with it, not an empty card", () => {
  const markup = render({
    persistedOutcome: "completed",
    persistedContent: SUMMARY,
    persistedUsage: {
      inputTokens: 38_000,
      outputTokens: 3_600,
      totalTokens: 41_600,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      responseDurationMs: 254_000,
    },
  });
  // The title comes out of the summary's lead, and the rest is the answer.
  assert.match(markup, /Why Concorde Disappeared/);
  assert.match(markup, /newsprint-editorial/);
  assert.match(markup, /Narrated by Echo/);
  // A finished run is over: no stop button, and the stage list has folded away.
  assert.doesNotMatch(markup, />Stop</);
  assert.match(markup, /completed/);
  assert.doesNotMatch(markup, /Final render/);
  // The duration it was told, which a client-side stopwatch could not know.
  assert.match(markup, /4m 14s/);
});

test("a failed turn shows the reason it was given", () => {
  const markup = render({
    persistedOutcome: "failed",
    persistedContent:
      "Beat 2 could not be narrated: the local speech service is not answering.",
  });
  assert.match(markup, /could not be narrated/);
  assert.match(markup, /failed/);
  assert.doesNotMatch(markup, />Stop</);
});

test("an aborted turn reads as stopped rather than broken", () => {
  const markup = render({
    persistedOutcome: "aborted",
    persistedContent: "The Vox Director run was stopped.",
  });
  assert.match(markup, /was stopped/);
  assert.match(markup, /aborted/);
});
