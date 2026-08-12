import assert from "node:assert/strict";
import test from "node:test";

import {
  humanizeProviderError,
  isProviderErrorText,
  providerErrorResponse,
} from "../src/lib/provider-error.ts";
import {
  createHermesEventNormalizationState,
  normalizeHermesEvent,
} from "../src/lib/agent-runtime/hermes-events.ts";

// The exact string Hermes produced for a refused Claude turn, wrappers and all.
const REAL_FAILURE =
  "HTTP 400: cliproxy returned HTTP 400: Third-party apps now draw from your " +
  "extra usage, not your plan limits. Add more at claude.ai/settings/usage and " +
  "keep going.";
const REAL_MESSAGE =
  "Third-party apps now draw from your extra usage, not your plan limits. " +
  "Add more at claude.ai/settings/usage and keep going.";

test("the upstream's own explanation survives every wrapper", () => {
  assert.equal(humanizeProviderError(REAL_FAILURE), REAL_MESSAGE);
  assert.equal(
    humanizeProviderError(
      "❌ Non-retryable error (HTTP 400): " + REAL_FAILURE,
    ),
    REAL_MESSAGE,
  );
  assert.equal(
    humanizeProviderError(
      "API call failed after 3 retries: HTTP 429: The usage limit has been reached",
    ),
    "The usage limit has been reached",
  );
  assert.equal(
    humanizeProviderError(
      `Error code: 503 - {"error": {"message": "cliproxy returned HTTP 503: no auth available"}}`,
    ),
    "no auth available",
  );
});

test("a ChatGPT refusal that only carries `detail` still reads as a sentence", () => {
  // The ChatGPT backend refuses a model or an account with {"detail": "..."}
  // and no `error` key at all. Reading only `error` left the reader with raw
  // JSON, or — once the gateway collapsed it — the words "Upstream error".
  const refusal =
    "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.";
  assert.equal(
    humanizeProviderError(`Error code: 400 - {"detail": "${refusal}"}`),
    refusal,
  );
  assert.equal(
    humanizeProviderError(
      `HTTP 400: chatmock returned HTTP 400: {"detail": "${refusal}"}`,
    ),
    refusal,
  );
});

test("internal routing ids never reach the reader", () => {
  // `cliproxy` is Breadboard's own subscription proxy — naming it describes our
  // plumbing, not anything the user chose or can act on.
  for (const raw of [
    REAL_FAILURE,
    "cliproxy returned HTTP 500",
    "chatmock is unreachable",
    "The request through cliproxy was rejected",
  ]) {
    const message = humanizeProviderError(raw);
    assert.doesNotMatch(message, /cliproxy/i, `leaked in: ${raw}`);
    assert.doesNotMatch(message, /chatmock/i, `leaked in: ${raw}`);
  }
  // A provider the user actually configured is fair to name.
  assert.match(
    humanizeProviderError("Anthropic returned HTTP 529: overloaded"),
    /overloaded/,
  );
});

test("a failure with nothing readable still gets a sentence, not an empty bubble", () => {
  assert.equal(
    providerErrorResponse(""),
    "The model provider could not complete this request.",
  );
  assert.equal(
    providerErrorResponse("HTTP 502:"),
    "The model provider could not complete this request. (HTTP 502)",
  );
  assert.equal(
    providerErrorResponse("cliproxy returned HTTP 400"),
    "The model provider could not complete this request. (HTTP 400)",
  );
});

test("ordinary model answers are left exactly as written", () => {
  const answer = "Here is the HTTP 404 handler you asked for, with tests.";
  assert.equal(isProviderErrorText(answer), false);
  assert.equal(providerErrorResponse(answer), answer);
});

test("a refused turn is delivered as the assistant's answer", () => {
  const state = createHermesEventNormalizationState();
  const events = normalizeHermesEvent(
    {
      type: "message.complete",
      session_id: "live-1",
      payload: { text: REAL_FAILURE, status: "error" },
    },
    "live-1",
    "public-1",
    state,
  );

  const delta = events.find((event) => event.type === "assistant.delta");
  assert.equal(delta.payload.text, REAL_MESSAGE);
  assert.ok(events.some((event) => event.type === "assistant.completed"));
  // Still a failure: the answer explains it, the status records it.
  const status = events.find((event) => event.type === "session.status");
  assert.equal(status.payload.status, "failed");
});

test("a refusal after partial output is appended, not dropped", () => {
  const state = createHermesEventNormalizationState();
  normalizeHermesEvent(
    { type: "message.start", session_id: "live-2", payload: {} },
    "live-2",
    "public-2",
    state,
  );
  normalizeHermesEvent(
    { type: "message.delta", session_id: "live-2", payload: { text: "Working on it." } },
    "live-2",
    "public-2",
    state,
  );
  const events = normalizeHermesEvent(
    {
      type: "message.complete",
      session_id: "live-2",
      payload: { text: REAL_FAILURE, status: "error" },
    },
    "live-2",
    "public-2",
    state,
  );

  const delta = events.find((event) => event.type === "assistant.delta");
  assert.equal(delta.payload.text, `\n\n${REAL_MESSAGE}`);
});

test("a successful completion is untouched", () => {
  const state = createHermesEventNormalizationState();
  const events = normalizeHermesEvent(
    {
      type: "message.complete",
      session_id: "live-3",
      payload: { text: "HTTP 400 means the request was malformed.", status: "complete" },
    },
    "live-3",
    "public-3",
    state,
  );
  assert.equal(
    events.find((event) => event.type === "assistant.delta").payload.text,
    "HTTP 400 means the request was malformed.",
  );
  assert.equal(
    events.find((event) => event.type === "session.status").payload.status,
    "idle",
  );
});

test("the runtime status line is cleaned the same way", () => {
  const state = createHermesEventNormalizationState();
  const [event] = normalizeHermesEvent(
    {
      type: "status.update",
      session_id: "live-4",
      payload: { kind: "lifecycle", text: `❌ Non-retryable error (HTTP 400): ${REAL_FAILURE}` },
    },
    "live-4",
    "public-4",
    state,
  );
  assert.equal(event.payload.label, REAL_MESSAGE);

  // Ordinary progress lines keep their wording.
  const [progress] = normalizeHermesEvent(
    {
      type: "status.update",
      session_id: "live-4",
      payload: { kind: "lifecycle", text: "Reading the garden index" },
    },
    "live-4",
    "public-4",
    state,
  );
  assert.equal(progress.payload.label, "Reading the garden index");
});
