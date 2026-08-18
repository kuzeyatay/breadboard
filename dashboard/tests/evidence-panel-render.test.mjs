// Renders the evidence panel for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what it would produce.
//
// Two things are worth pinning down. A tool that failed before the runtime
// wrote a summary must not show its registry name ("web_search") where a
// sentence belongs. And a turn that handed work to a runtime agent has to say
// so, while a summary written before that was recorded stays silent rather
// than claiming no agent was called.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-evidence-panel-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as EvidencePanel } from "@/app/components/hermes/evidence-panel";\n`,
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
const { EvidencePanel } = require(bundle);

function render(verification) {
  return renderToStaticMarkup(
    React.createElement(EvidencePanel, { verification, onClose: () => {} }),
  );
}

function evidence(overrides = {}) {
  return {
    id: "evidence-1",
    kind: "web_search",
    title: "Searching the web",
    success: false,
    timestamp: new Date(0).toISOString(),
    details: { toolName: "web_search" },
    ...overrides,
  };
}

function summary(overrides = {}) {
  return {
    state: "partially_verified",
    evidence: [],
    unsupportedClaims: [],
    assumptions: [],
    ...overrides,
  };
}

test("a failed lookup names the action, not the tool", () => {
  const markup = render(summary({ evidence: [evidence()] }));
  assert.match(markup, /Searching the web/);
  assert.match(markup, /failed/);
  assert.doesNotMatch(markup, /web_search/);
});

test("delegated runtime agents appear in the ledger", () => {
  const markup = render(
    summary({
      externalAgents: [
        {
          agentId: "money-printer",
          agentName: "Money Printer",
          command: "/agents:money-printer",
          reason: "Video production is its work.",
          requiresApproval: true,
          requestedAt: new Date(0).toISOString(),
        },
      ],
    }),
  );
  assert.match(markup, /External agents/);
  assert.match(markup, /Money Printer/);
  assert.match(markup, /\/agents:money-printer/);
  assert.match(markup, /needs approval/);
});

function coverage(overrides = {}) {
  return {
    entities: 4,
    fields: 5,
    settled: 14,
    total: 20,
    verified: 12,
    conflicting: 2,
    exhausted: 2,
    open: 4,
    searches: 31,
    stopReason: "coverage_sufficient",
    openRows: ["Gamma Aero: memberCount=open foundedAt=exhausted"],
    openRowsTruncated: 3,
    ...overrides,
  };
}

test("research coverage is shown as counts, not as the whole matrix", () => {
  const markup = render(summary({ researchCoverage: coverage() }));
  assert.match(markup, /Research coverage/);
  assert.match(markup, /14 of 20 requested details settled across 4 entities/);
  assert.match(markup, /after 31 searches/);
  assert.match(markup, /12 verified/);
  assert.match(markup, /2 left with sources in conflict/);
  // The distinction the pipeline exists to protect, made visible to the reader.
  assert.match(markup, /2 searched out — not publicly available/);
  assert.match(markup, /4 still unresolved — not established, rather than absent/);
  assert.match(markup, /Gamma Aero: memberCount=open/);
  assert.match(markup, /and 3 more incomplete/);
  assert.match(markup, /the requested details were covered/);
});

test("a run that ran out of budget says so rather than implying completeness", () => {
  const spent = render(
    summary({ researchCoverage: coverage({ stopReason: "budget_exhausted" }) }),
  );
  assert.match(spent, /the research budget ran out/);
  assert.match(spent, /not searched to exhaustion/);

  const unfinished = render(
    summary({ researchCoverage: coverage({ stopReason: null }) }),
  );
  assert.match(unfinished, /did not reach a stopping point/);

  // Every other turn is untouched: no section at all.
  assert.doesNotMatch(render(summary()), /Research coverage/);
});

test("an assessed turn with no delegation says so; an older one stays silent", () => {
  assert.match(
    render(summary({ externalAgents: [] })),
    /No external agent was called\./,
  );
  // Written before external agents were recorded: the panel cannot know.
  assert.doesNotMatch(render(summary()), /external agent/i);
});
