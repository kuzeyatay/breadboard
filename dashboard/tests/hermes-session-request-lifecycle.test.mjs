import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateHermesSessionSummaries,
  loadHermesSessionSummaries,
} from "../src/lib/hermes/session-client.ts";

function abortAssertion(error) {
  assert.equal(error?.name, "AbortError");
  return true;
}

test("one cancelled history consumer does not abort a shared request", async () => {
  const originalFetch = globalThis.fetch;
  const surface = "renderer_lifecycle_shared";
  invalidateHermesSessionSummaries(surface);

  let fetchCount = 0;
  let resolveFetch;
  let requestSignal;
  globalThis.fetch = (_url, init) => {
    fetchCount += 1;
    requestSignal = init.signal;
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };

  try {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = loadHermesSessionSummaries(surface, {
      force: true,
      signal: firstController.signal,
    });
    const second = loadHermesSessionSummaries(surface, {
      force: true,
      signal: secondController.signal,
    });
    const firstRejected = assert.rejects(first, abortAssertion);

    assert.equal(fetchCount, 1, "concurrent consumers must share one fetch");
    firstController.abort();
    await firstRejected;
    assert.equal(requestSignal.aborted, false);

    resolveFetch(
      new Response(JSON.stringify({ sessions: [{ id: "conv_shared" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    assert.deepEqual(await second, [{ id: "conv_shared" }]);
  } finally {
    invalidateHermesSessionSummaries(surface);
    globalThis.fetch = originalFetch;
  }
});

test("the final cancelled history consumer aborts and releases the shared fetch", async () => {
  const originalFetch = globalThis.fetch;
  const surface = "renderer_lifecycle_orphan";
  invalidateHermesSessionSummaries(surface);

  let fetchCount = 0;
  let firstRequestSignal;
  globalThis.fetch = (_url, init) => {
    fetchCount += 1;
    if (!firstRequestSignal) firstRequestSignal = init.signal;
    return new Promise((resolve, reject) => {
      if (init.signal.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  };

  try {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = loadHermesSessionSummaries(surface, {
      force: true,
      signal: firstController.signal,
    });
    const second = loadHermesSessionSummaries(surface, {
      force: true,
      signal: secondController.signal,
    });
    const firstRejected = assert.rejects(first, abortAssertion);
    const secondRejected = assert.rejects(second, abortAssertion);

    firstController.abort();
    assert.equal(firstRequestSignal.aborted, false);
    secondController.abort();
    await Promise.all([firstRejected, secondRejected]);
    assert.equal(firstRequestSignal.aborted, true);

    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    };
    await loadHermesSessionSummaries(surface, { force: true });
    assert.equal(fetchCount, 2, "an orphaned request must not poison the next load");
  } finally {
    invalidateHermesSessionSummaries(surface);
    globalThis.fetch = originalFetch;
  }
});
