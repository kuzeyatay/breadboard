import assert from "node:assert/strict";
import test from "node:test";

const { autoHumanizeMessage } = await import(
  "../src/app/components/humanizer/auto-humanize.ts"
);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runWithFetch(rewriteBody, versionsBody) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? json(rewriteBody) : json(versionsBody);
  };
  try {
    const outcome = await autoHumanizeMessage({
      conversationId: "conv_test",
      messageId: "client-message-123",
      content: "Original response.",
    });
    return { calls, outcome };
  } finally {
    globalThis.fetch = previous;
  }
}

test("a tied standing rewrite reports its score and keeps the original", async () => {
  const { calls, outcome } = await runWithFetch({
    rewrittenText: "Changed response.",
    unchanged: false,
    scores: {
      original: { score: 0 },
      rewrite: { score: 0 },
      delta: 0,
      tied: true,
      worsened: false,
    },
    integrity: { passed: true, issues: [] },
  });
  assert.deepEqual(calls, ["/api/humanizer/rewrite"]);
  assert.equal(outcome.adopted, false);
  assert.equal(outcome.content, "Original response.");
  assert.equal(outcome.review.disposition, "kept_tied");
  assert.equal(outcome.review.rewrite, 0);
});

test("a structurally damaged standing rewrite is never stored", async () => {
  const { calls, outcome } = await runWithFetch({
    rewrittenText: "roken response.",
    unchanged: false,
    scores: {
      original: { score: 20 },
      rewrite: { score: 5 },
      delta: -15,
      tied: false,
      worsened: false,
    },
    integrity: { passed: false, issues: ["A paragraph appears truncated."] },
  });
  assert.deepEqual(calls, ["/api/humanizer/rewrite"]);
  assert.equal(outcome.adopted, false);
  assert.equal(outcome.review.disposition, "kept_integrity");
  assert.deepEqual(outcome.review.integrityIssues, ["A paragraph appears truncated."]);
});

test("an improved intact rewrite is stored and reports its score", async () => {
  const { calls, outcome } = await runWithFetch(
    {
      rewrittenText: "Changed response.",
      unchanged: false,
      scores: {
        original: { score: 20 },
        rewrite: { score: 5 },
        delta: -15,
        tied: false,
        worsened: false,
      },
      integrity: { passed: true, issues: [] },
    },
    {
      content: "Changed response.",
      versions: {
        total: 2,
        activeIndex: 1,
        derived: true,
        origins: ["original", "humanizer"],
        review: {
          original: 20,
          rewrite: 5,
          delta: -15,
          tied: false,
          worsened: false,
        },
      },
    },
  );
  assert.deepEqual(calls, ["/api/humanizer/rewrite", "/api/humanizer/versions"]);
  assert.equal(outcome.adopted, true);
  assert.equal(outcome.content, "Changed response.");
  assert.equal(outcome.review.disposition, "adopted");
  assert.equal(outcome.versions.review.rewrite, 5);
});
