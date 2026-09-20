import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import {
  MAX_RESUMES_PER_CAUSE,
  MAX_RESUMES_PER_RUN,
  STALL_WITHOUT_MODEL_CALL_MS,
  classifyLearnFailure,
  emptyLearnAutoResumeLedger,
  learnAutoResumeDecision,
  learnRunHasStalled,
  withRecordedLearnAutoResume,
} from "../src/lib/learn-auto-resume.ts";

const ledger = () => emptyLearnAutoResumeLedger("telecom-1");
const decide = (failureMessage, overrides = {}) =>
  learnAutoResumeDecision({ ledger: ledger(), failureMessage, leaseHeld: false, ...overrides });

describe("what a Learn failure is", () => {
  // Every message here was produced by a real telecom-1 failure on 2026-09-17.
  test("machinery failures are transient", () => {
    const transient = [
      ["Another Learn operation (learn_job_mu5vmxz9_a5jyb4h) is already changing this garden.", "lease-held"],
      ["Model transport stopped without verified recovery (not_retryable)", "model-transport"],
      ["Council receipt attempt does not prove one exact ordinary model call.", "council-receipt-unproven"],
      ["Ordinary Learn Council checkpoint is request_failed; no model request was authorized.", "council-checkpoint-unauthorized"],
      ["Runtime job execution failed.", "runtime-job-failed"],
    ];
    for (const [message, cause] of transient) {
      assert.deepEqual(classifyLearnFailure(message), { kind: "transient", cause }, message);
    }
  });

  test("a page that did not pass is not a transient fault", () => {
    const classification = classifyLearnFailure(
      'Lesson "11.2 Step-Index and Graded-Index Multimode Fiber" failed quality gates after 4 attempts (missing a Question./Answer. pair).',
    );
    assert.deepEqual(classification, { kind: "content", cause: "lesson-quality-gates" });
    assert.equal(decide('failed quality gates after 4 attempts').resume, false);
  });

  test("a full disk and a signed-out model are named, not retried", () => {
    assert.equal(classifyLearnFailure("ENOSPC: no space left on device").kind, "content");
    assert.equal(classifyLearnFailure("ChatGPT is signed out. Sign in to chatgpt.com").kind, "content");
  });

  test("an unrecognised failure is left for a person", () => {
    const decision = decide("Something nobody has seen before happened.");
    assert.equal(decision.kind, "unknown");
    assert.equal(decision.resume, false);
    assert.match(decision.reason, /not recognised/i);
  });

  test("a content cause wins over transient wording in the same message", () => {
    // A run can mention a transport hiccup and still have failed because a
    // page did not pass; the page is the reason.
    const classification = classifyLearnFailure(
      "Model transport stopped without verified recovery; lesson failed quality gates after 4 attempts",
    );
    assert.equal(classification.kind, "content");
  });
});

describe("when a Learn run may be resumed", () => {
  test("a transient failure with a free lease resumes", () => {
    const decision = decide("Runtime job execution failed.");
    assert.equal(decision.resume, true);
    assert.match(decision.reason, /accepted pages/);
  });

  test("a held lease defers rather than racing the previous run's rollback", () => {
    // The resubmit that raced telecom-1's rollback was rejected outright and
    // burned a generation (2026-09-17 20:04).
    const decision = decide("Runtime job execution failed.", { leaseHeld: true });
    assert.equal(decision.resume, false);
    assert.match(decision.reason, /lease/i);
  });

  test("one cause stops being transient once it keeps coming back", () => {
    let state = ledger();
    for (let index = 0; index < MAX_RESUMES_PER_CAUSE; index += 1) {
      const decision = learnAutoResumeDecision({ ledger: state, failureMessage: "Runtime job execution failed.", leaseHeld: false });
      assert.equal(decision.resume, true, `resume ${index + 1} should be allowed`);
      state = withRecordedLearnAutoResume(state, decision.cause);
    }
    const exhausted = learnAutoResumeDecision({ ledger: state, failureMessage: "Runtime job execution failed.", leaseHeld: false });
    assert.equal(exhausted.resume, false);
    assert.match(exhausted.reason, /defect, not a transient/);
  });

  test("a run is bounded in total however varied its causes", () => {
    const state = { ...ledger(), total: MAX_RESUMES_PER_RUN };
    const decision = learnAutoResumeDecision({ ledger: state, failureMessage: "Runtime job execution failed.", leaseHeld: false });
    assert.equal(decision.resume, false);
    assert.match(decision.reason, new RegExp(`${MAX_RESUMES_PER_RUN}`));
  });

  test("the ledger counts each cause separately", () => {
    const state = withRecordedLearnAutoResume(withRecordedLearnAutoResume(ledger(), "lease-held"), "model-transport");
    assert.deepEqual(state.byCause, { "lease-held": 1, "model-transport": 1 });
    assert.equal(state.total, 2);
    assert.ok(state.lastResumeAt);
  });
});

describe("a run that is alive but no longer working", () => {
  const now = 1_800_000_000_000;

  test("no dispatch for the stall window with nothing in flight is a stall", () => {
    assert.equal(
      learnRunHasStalled({
        status: "generating_learning_pages",
        startedCalls: 1752,
        lastCallStartedAt: now - STALL_WITHOUT_MODEL_CALL_MS,
        inFlightCalls: 0,
        now,
      }),
      true,
    );
  });

  test("a call still in flight is never a stall, however long it runs", () => {
    // A max-effort lesson write legitimately takes 25 minutes.
    assert.equal(
      learnRunHasStalled({
        status: "generating_learning_pages",
        startedCalls: 1752,
        lastCallStartedAt: now - STALL_WITHOUT_MODEL_CALL_MS * 4,
        inFlightCalls: 1,
        now,
      }),
      false,
    );
  });

  test("a recent dispatch is not a stall", () => {
    assert.equal(
      learnRunHasStalled({
        status: "generating_learning_pages",
        startedCalls: 1752,
        lastCallStartedAt: now - 60_000,
        inFlightCalls: 0,
        now,
      }),
      false,
    );
  });

  test("only a generating run can stall", () => {
    assert.equal(
      learnRunHasStalled({
        status: "planning",
        startedCalls: 3,
        lastCallStartedAt: now - STALL_WITHOUT_MODEL_CALL_MS * 2,
        inFlightCalls: 0,
        now,
      }),
      false,
    );
  });
});

// A cancellation the worker never acknowledged must not hold a garden forever.
// telecom-1 lost three consecutive generations to one such row (2026-09-17):
// the worker died mid-cancel, nothing cleared the step, and every resubmit was
// rejected with "must finish, be cancelled, or recover".
describe("a cancellation whose worker never came back", () => {
  const source = readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");

  test("the guard stops blocking once the row is past the abandonment cutoff", () => {
    assert.match(source, /function stalledLearnCancellation\(/);
    assert.match(source, /if \(stalledLearnCancellation\(job, nowMs\)\) return false;/);
  });

  test("it is decided from the row's own age, not from a live-worker probe", () => {
    // A probe would have to reach a worker that is by definition gone.
    assert.match(source, /nowMs - updatedAt >= LEARN_JOB_ABANDONED_AFTER_MS/);
    assert.match(source, /SELECT id, status, current_step, updated_at/);
  });

  test("a fresh cancellation still blocks, so a live stop is respected", () => {
    assert.match(source, /if \(!Number\.isFinite\(updatedAt\)\) return false;/);
  });
});

// The 502 retry loop was unbounded. When the ChatGPT session dropped mid-run,
// telecom-1 sat at 96% for four hours reporting "automatically retrying" and
// fired roughly a thousand doomed calls without ever saying what was wrong
// (2026-09-18).
describe("a 502 retry loop that knows when to give up", () => {
  const source = readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");

  test("a signed-out provider fails at once rather than retrying", () => {
    assert.match(source, /function providerSessionIsMissing\(/);
    assert.match(source, /if \(providerSessionIsMissing\(error\)\) \{/);
    // The message must tell the reader what to actually do.
    assert.match(source, /Sign in to chatgpt\.com in Breadboard's browser, then resume this Learn run/);
  });

  test("consecutive 502s are bounded, so no run retries forever", () => {
    assert.match(source, /LEARN_HTTP_502_MAX_AUTO_RETRIES = envPositiveInt\("LEARN_HTTP_502_MAX_AUTO_RETRIES", 12\)/);
    assert.match(source, /if \(retryNumber > LEARN_HTTP_502_MAX_AUTO_RETRIES\) \{/);
    assert.match(source, /stopped instead of retrying indefinitely/);
  });

  test("the classifier matches what the provider actually says when signed out", () => {
    // Both real strings seen on 2026-09-18: the provider's unavailableReason
    // and the council's own empty-answer message.
    const match = source.match(/const PROVIDER_SIGNED_OUT_PATTERN =\s*([\s\S]*?);/);
    assert.ok(match, "the pattern must be a named constant");
    const pattern = new RegExp(match[1].trim().replace(/^\//, "").replace(/\/i$/, ""), "i");
    assert.ok(pattern.test("OpenAI (web) is not available: not signed in to chatgpt.com"));
    assert.ok(pattern.test("The council could not produce an answer because ChatGPT is signed out."));
    assert.ok(!pattern.test("HTTP 502 Bad Gateway from the model transport"));
  });
});

describe("a worker reaped mid-stage leaves a row that claims to be active", () => {
  // telecom-1 learn_job_mu7974wc, 2026-09-18: killed with
  // WORKER_RESOURCE_EXHAUSTED while "building_navigation", never given a
  // terminal status, and it then rejected every later generation while four
  // recovery attempts in a row stalled without settling it.
  const source = readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");

  test("an active-status row past the abandonment cutoff stops blocking", () => {
    assert.match(source, /function stalledActiveLearnJob\(/);
    assert.match(source, /if \(stalledActiveLearnJob\(job, nowMs\)\) return false;/);
    assert.match(source, /if \(!recoverableLearnStatus\(job\.status\)\) return false;/);
  });

  test("a person's pending confirmation is never treated as stalled", () => {
    // awaiting_confirmation is not a recoverableLearnStatus, so the age rule
    // cannot reach it; pin that the predicate goes through that gate.
    assert.match(source, /function recoverableLearnStatus\(status: LearnStatus\): boolean \{\s*return status === "idle" \|\| activeStatus\(status\);/);
  });
});
