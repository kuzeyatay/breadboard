import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { outerAgentFailureMessage } from "../src/lib/runtime-v2/outer-agent-failure.ts";

function failedJob(overrides = {}) {
  return {
    state: "failed",
    failureMessage: "Runtime job execution failed.",
    resourceExhaustion: null,
    ...overrides,
  };
}

test("outer agents turn commit denials into an actionable retry message", () => {
  const message = outerAgentFailureMessage(failedJob({
    state: "resource_exhausted",
    resourceExhaustion: {
      resource: "windows_commit",
      requiredHeadroomMb: 7_424,
      availableHeadroomMb: 5_545,
      retryable: false,
    },
  }));

  assert.match(message, /7\.3 GB required/u);
  assert.match(message, /5\.4 GB available/u);
  assert.match(message, /paging file/u);
  assert.doesNotMatch(message, /Runtime job execution failed/u);
});

test("dependency denials remain actionable even when Runtime exposes no private evidence", () => {
  const message = outerAgentFailureMessage(failedJob({ state: "resource_exhausted" }));
  assert.match(message, /memory or execution capacity/u);
  assert.match(message, /local services/u);
  assert.match(message, /retry/u);
});

test("every sanitized outer-agent terminal state gets a useful public explanation", () => {
  for (const state of ["failed", "interrupted", "uncertain"]) {
    const message = outerAgentFailureMessage(failedJob({ state }));
    assert.ok(message.length > 40, state);
    assert.doesNotMatch(message, /Runtime job execution failed/u, state);
  }
  assert.equal(
    outerAgentFailureMessage(failedJob({ failureMessage: "A safe specific failure." })),
    "A safe specific failure.",
  );
});

test("a refused service dependency names the agent's local services, not a worker", () => {
  const job = failedJob({ failureCode: "SERVICE_DEPENDENCY_UNAVAILABLE" });

  const named = outerAgentFailureMessage(job, "max-research");
  assert.match(named, /Deep Research or OpenScience/u);
  assert.match(named, /finish that service's setup/u);
  assert.doesNotMatch(named, /worker stopped/u);
  assert.doesNotMatch(named, /Runtime job execution failed/u);

  assert.match(outerAgentFailureMessage(job, "openscience"), /\(OpenScience\)/u);

  const generic = outerAgentFailureMessage(job);
  assert.match(generic, /A local service this agent needs could not be started/u);
  assert.doesNotMatch(generic, /\(/u);

  // A worker that really ran and died keeps the worker wording.
  assert.match(
    outerAgentFailureMessage(failedJob({ failureCode: "WORKER_FAILED" })),
    /Runtime worker stopped/u,
  );
});

test("the shared outer-agent projection owns terminal failure wording", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/lib/runtime-v2/outer-agent-run.ts"),
    "utf8",
  );
  assert.match(source, /error: outerAgentFailureMessage\(job, adapter\.kind\)/u);
  assert.doesNotMatch(source, /error: job\?\.failureMessage/u);
});
