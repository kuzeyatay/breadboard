// The Max Research worker validates its sealed request at startup and aborts
// on the first mismatch, which Runtime reports only as a worker that exited
// without a terminal event. Two things made that the common case: the worker
// refused reasoning effort "max" (a canonical assistant effort, and this
// account's default), and its question ceiling sat one paragraph above the
// size of an `agent_launch` brief. The dashboard now refuses, with a reason,
// anything the worker would refuse.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  validateRuntimeV2GetDocRequest,
  validateRuntimeV2MaxResearchRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { ASSISTANT_REASONING_EFFORTS } from "../src/lib/assistant-reasoning.ts";
import { maxResearchLiteratureQuery } from "../src/lib/max-research/participants.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

function request(overrides = {}) {
  return {
    question: "muscle hypertrophy: how it is triggered and how to maximise it",
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
    baseUrl: "http://127.0.0.1:58072/v1",
    conversationContext: "",
    openscienceEnabled: false,
    praxistTaskPath: null,
    ...overrides,
  };
}

test("the worker accepts every canonical assistant effort, including max", () => {
  for (const reasoningEffort of ASSISTANT_REASONING_EFFORTS) {
    assert.doesNotThrow(
      () => validateRuntimeV2MaxResearchRequest(request({ reasoningEffort })),
      reasoningEffort,
    );
  }
  assert.throws(() => validateRuntimeV2MaxResearchRequest(request({ reasoningEffort: "ultra" })));
});

test("an agent_launch brief fits the worker's question ceiling", () => {
  const brief = `Conduct max research and produce a rigorous, source-audited report. ${"Answer four connected questions. ".repeat(140)}`;
  assert.ok(brief.length > 4_000 && brief.length <= 8_000, `brief is ${brief.length} chars`);
  assert.doesNotThrow(() => validateRuntimeV2MaxResearchRequest(request({ question: brief })));
  assert.throws(() => validateRuntimeV2MaxResearchRequest(request({ question: "x".repeat(8_001) })));
});

test("a long max-effort launch becomes a valid literature query", () => {
  const brief = [
    "Conduct max research on skeletal-muscle hypertrophy in healthy adults. Give practical, evidence-audited guidance.",
    "Training scope and evidence standards:\n" + "Compare controlled trials and systematic reviews. ".repeat(120),
  ].join("\n\n");
  assert.ok(brief.length > 4_000 && brief.length <= 8_000, `brief is ${brief.length} chars`);

  const query = maxResearchLiteratureQuery(brief);
  assert.equal(
    query,
    "skeletal-muscle hypertrophy in healthy adults. Give practical, evidence-audited guidance.",
  );
  assert.ok(Buffer.byteLength(query, "utf8") <= 4_000);
  assert.doesNotThrow(() =>
    validateRuntimeV2GetDocRequest({
      request: {
        query,
        limit: 10,
        openAccessOnly: false,
        yearFrom: null,
        yearTo: null,
        sources: null,
      },
      model: "gpt-5.6-sol",
      reasoningEffort: "max",
      baseUrl: "http://127.0.0.1:58072/v1",
      conversationContext: "Prefer primary literature.",
    }),
  );
});

test("the dashboard refuses what the worker would refuse, before submitting", () => {
  const manager = source("../src/lib/max-research/runtime-run-manager.ts");
  assert.match(manager, /export const MAX_RESEARCH_QUESTION_MAX_CHARS = 8_000;/);
  assert.match(manager, /ASSISTANT_REASONING_EFFORTS as readonly string\[\]\)\.includes\(input\.reasoningEffort\)/);
  assert.match(manager, /MAX_RESEARCH_QUESTION_MAX_CHARS\) \{\s*throw new Error/);
  const route = source("../src/app/api/max-research/runs/route.ts");
  assert.match(route, /question\.slice\(0, MAX_RESEARCH_QUESTION_MAX_CHARS\)/);
  assert.match(route, /invalid_reasoning_effort/);
  // The route's ceiling and the worker's are the same number.
  const adapters = source("../scripts/runtime-v2-outer-agent-adapters.mjs");
  assert.match(adapters, /value\.question\.length > 8_000/);
});

test("OpenScience admission is optional and sealed into the Max Research request", () => {
  assert.doesNotThrow(() => validateRuntimeV2MaxResearchRequest(request()));
  assert.doesNotThrow(() =>
    validateRuntimeV2MaxResearchRequest(request({ openscienceEnabled: true })),
  );
  assert.throws(() =>
    validateRuntimeV2MaxResearchRequest(request({ openscienceEnabled: "true" })),
  );

  const manager = source("../src/lib/max-research/runtime-run-manager.ts");
  assert.match(manager, /const openscienceEnabled = openscienceRuntimeAvailability\(\)\.available/);
  assert.match(manager, /if \(openscienceEnabled\) \{\s*\/\/ Prepare its private provider profile/);
  assert.match(manager, /conversationContext: input\.conversationContext \?\? "",\s*openscienceEnabled,\s*praxistTaskPath/);

  const manifest = source("../../desktop/runtime-v2/manifests/workers.json");
  assert.match(
    manifest,
    /"serviceId": "openscience",\s*"condition": "max-research-openscience-enabled"/,
  );
});
