// The Deep Research run's own pages, in the evidence panel, under its name.
//
// A hand-back turn calls no tools, so its evidence rows are empty and the panel
// could only say "no sources" about an answer built entirely out of pages a
// worker read. The run id that unlocks them lives on the external-agent turn's
// stored metadata — and the first version of this read the client-facing field
// name instead of the stored one, so it found nothing on every turn and the
// section silently never rendered. No error, no symptom, just an absence.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  latestDeepResearchRunId,
  withDelegatedResearchSources,
} from "../src/lib/conversations/delegated-research-sources.ts";
import { DEEP_RESEARCH_AGENT_ID } from "../src/lib/deep-research/identity.ts";

const source = (relative) =>
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", relative),
    "utf8",
  );

/**
 * A stored assistant row, shaped the way `recordExternalAgentTurn` writes it.
 *
 * A deep-research run carries `query` and `output`, not `task` — the parser is
 * strict about it, which is what makes reading a real row the only honest way
 * to test this. A hand-written shape passes a test and fails in production.
 */
const externalAgentRow = (runId, kind = "deep_research") => ({
  role: "assistant",
  metadata: JSON.stringify({
    externalAgent: true,
    externalAgentRun:
      kind === "deep_research"
        ? { kind, runId, query: "relationship survival rates", output: "report" }
        : { kind, runId, task: "render the clip" },
    externalAgentOutcome: "completed",
  }),
});

const deepResearchCall = {
  agentId: DEEP_RESEARCH_AGENT_ID,
  agentName: "Deep Research",
  command: "/agents:deep-research",
  requiresApproval: false,
  requestedAt: "2026-08-21T00:00:00.000Z",
  carried: true,
};

const pages = [
  { url: "https://ifstudies.org/blog/wolfinger", title: "Wolfinger", domain: "ifstudies.org" },
  { url: "https://www.cdc.gov/nchs/data/nhsr/nhsr049.pdf", domain: "cdc.gov" },
];

test("the run id is read from the key the turn writer actually stores", () => {
  assert.equal(latestDeepResearchRunId([externalAgentRow("run_abc")]), "run_abc");
});

test("the newest run wins when a conversation holds several", () => {
  assert.equal(
    latestDeepResearchRunId([
      externalAgentRow("run_old"),
      externalAgentRow("run_new"),
    ]),
    "run_new",
  );
});

test("another agent's run is not mistaken for a research run", () => {
  assert.equal(latestDeepResearchRunId([externalAgentRow("run_x", "vimax")]), null);
});

test("unparseable or absent metadata is skipped rather than thrown on", () => {
  assert.equal(
    latestDeepResearchRunId([
      { role: "assistant", metadata: "{not json" },
      { role: "assistant" },
      { role: "user", metadata: JSON.stringify({ externalAgentRun: {} }) },
    ]),
    null,
  );
});

test("the run's pages land on the agent's evidence entry", async () => {
  const result = await withDelegatedResearchSources([deepResearchCall], {
    userId: 1,
    messages: [externalAgentRow("run_abc")],
    fetchWebsites: async (userId, runId) => {
      assert.equal(userId, 1);
      assert.equal(runId, "run_abc");
      return pages;
    },
  });
  assert.equal(result[0].websites.length, 2);
  assert.equal(result[0].websites[0].title, "Wolfinger");
});

test("a service that is down costs the turn nothing", async () => {
  // The answer is already written by this point. Provenance is worth waiting
  // for only so long, and never worth failing the turn over.
  const result = await withDelegatedResearchSources([deepResearchCall], {
    userId: 1,
    messages: [externalAgentRow("run_abc")],
    fetchWebsites: async () => {
      throw new Error("service_unavailable");
    },
  });
  assert.deepEqual(result, [deepResearchCall]);
});

test("no research delegation means no lookup at all", async () => {
  const vimax = [{ ...deepResearchCall, agentId: "vimax", agentName: "Vimax" }];
  const result = await withDelegatedResearchSources(vimax, {
    userId: 1,
    messages: [externalAgentRow("run_abc")],
    fetchWebsites: async () => {
      throw new Error("must not be called");
    },
  });
  assert.deepEqual(result, vimax);
});

test("the stored key is pinned, because reading the wrong one fails silently", () => {
  const module = source("src/lib/conversations/delegated-research-sources.ts");
  assert.match(module, /metadata\.externalAgentRun/);
  assert.doesNotMatch(module, /metadata\.deepResearchRun/);
  assert.doesNotMatch(
    source("src/lib/conversations/turn-service.ts"),
    /deepResearchRun/,
  );
});
