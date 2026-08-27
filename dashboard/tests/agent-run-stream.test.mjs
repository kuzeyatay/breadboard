import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  closeAgentRunStream,
  resolveAgentRunStreamError,
} from "../src/lib/agent-run-stream.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(dashboardRoot, "src", "app", "components", "hermes");
const cardFiles = fs
  .readdirSync(cardsDir)
  .filter((name) => name.startsWith("inline-") && name.endsWith(".tsx"));

function fakeSource() {
  return { closed: false, close() { this.closed = true; } };
}

/** One turn of the microtask queue per await inside the helper, plus slack. */
async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test("a finished run's stream is closed rather than reconnected forever", async () => {
  // `EventSource` retries on its own whenever a connection ends, and a run's
  // route ends the connection deliberately once the run is over. Without the
  // probe below, that orderly close reads as a dropped connection and the card
  // reopens a dead stream every few seconds for as long as the chat is open.
  const source = fakeSource();
  const replayed = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      events: [
        { sequenceNumber: 1, type: "run.started", payload: {}, at: "" },
        { sequenceNumber: 2, type: "run.completed", payload: { summary: "done" }, at: "" },
      ],
    }),
  });
  try {
    resolveAgentRunStreamError({
      source,
      base: "/api/open-gym/runs/r1",
      replayEnding: (event) => replayed.push(event.type),
      onUnavailable: () => assert.fail("a run that still exists is not unavailable"),
    });
    await settle();
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(source.closed, true);
  // Only the ending is replayed. Cards that append to a list would double every
  // row if the probe handed back the whole history.
  assert.deepEqual(replayed, ["run.completed"]);
});

test("a run still working keeps its stream so a dropped connection recovers", async () => {
  const source = fakeSource();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      events: [{ sequenceNumber: 1, type: "run.started", payload: {}, at: "" }],
    }),
  });
  try {
    resolveAgentRunStreamError({
      source,
      base: "/api/open-gym/runs/r2",
      onUnavailable: () => assert.fail("a live run is not unavailable"),
    });
    await settle();
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(source.closed, false);
});

test("repeated stream errors share one terminal-state probe", async () => {
  const source = fakeSource();
  const replayed = [];
  let fetchCount = 0;
  let resolveFetch;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };
  try {
    const input = {
      source,
      base: "/api/open-gym/runs/r-concurrent",
      replayEnding: (event) => replayed.push(event.type),
      onUnavailable: () => assert.fail("the completed run still exists"),
    };
    resolveAgentRunStreamError(input);
    resolveAgentRunStreamError(input);
    assert.equal(fetchCount, 1, "one EventSource must own at most one active probe");
    resolveFetch({
      ok: true,
      json: async () => ({
        events: [
          {
            sequenceNumber: 2,
            type: "run.completed",
            payload: { summary: "done" },
            at: "",
          },
        ],
      }),
    });
    await settle();
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(source.closed, true);
  assert.deepEqual(replayed, ["run.completed"]);
});

test("a stuck terminal-state probe is aborted and can be retried", async () => {
  const source = fakeSource();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];
  let fetchCount = 0;
  globalThis.setTimeout = (callback, delay) => {
    scheduled.push(delay);
    queueMicrotask(callback);
    return 41 + scheduled.length;
  };
  globalThis.clearTimeout = (handle) => {
    cleared.push(handle);
  };
  globalThis.fetch = (_url, init) => {
    fetchCount += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  };
  const input = {
    source,
    base: "/api/open-gym/runs/r-stuck",
    onUnavailable: () => assert.fail("a timeout lets EventSource reconnect"),
  };
  try {
    resolveAgentRunStreamError(input);
    await settle();
    resolveAgentRunStreamError(input);
    await settle();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.deepEqual(scheduled, [5_000, 5_000]);
  assert.deepEqual(cleared, [42, 43]);
  assert.equal(fetchCount, 2, "the timed-out probe must release its single-flight slot");
  assert.equal(source.closed, false);
});

test("repeated failed probes exhaust a bounded budget and release ownership", async () => {
  const source = fakeSource();
  const reasons = [];
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];
  const signals = [];
  let fetchCount = 0;
  globalThis.setTimeout = (_callback, delay) => {
    scheduled.push(delay);
    return 100 + scheduled.length;
  };
  globalThis.clearTimeout = (handle) => cleared.push(handle);
  globalThis.fetch = (_url, init) => {
    fetchCount += 1;
    signals.push(init.signal);
    return Promise.reject(new TypeError("temporary network failure"));
  };
  const input = {
    source,
    base: "/api/open-gym/runs/r-failing",
    onUnavailable: (reason) => reasons.push(reason),
  };
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      resolveAgentRunStreamError(input);
      await settle();
    }
    // A browser should not dispatch another error after close, but guarding a
    // closed owner also proves no fresh controller/timer can be allocated.
    resolveAgentRunStreamError(input);
    await settle();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.equal(fetchCount, 3);
  assert.deepEqual(scheduled, [5_000, 5_000, 5_000]);
  assert.deepEqual(cleared, [101, 102, 103]);
  assert.equal(signals.at(-1).aborted, true, "closing must abort the owned controller");
  assert.equal(source.closed, true);
  assert.deepEqual(reasons, ["stream_unavailable"]);
});

test("a successful live-run probe resets the transient failure budget", async () => {
  const source = fakeSource();
  const reasons = [];
  const original = globalThis.fetch;
  let mode = "fail";
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (mode === "fail") throw new TypeError("temporary network failure");
    return {
      ok: true,
      json: async () => ({
        events: [{ sequenceNumber: 1, type: "run.started", payload: {}, at: "" }],
      }),
    };
  };
  const input = {
    source,
    base: "/api/open-gym/runs/r-recovers",
    onUnavailable: (reason) => reasons.push(reason),
  };
  try {
    resolveAgentRunStreamError(input);
    await settle();
    mode = "live";
    resolveAgentRunStreamError(input);
    await settle();
    mode = "fail";
    resolveAgentRunStreamError(input);
    await settle();
    resolveAgentRunStreamError(input);
    await settle();
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(fetchCount, 4);
  assert.equal(source.closed, false, "two failures after recovery remain transient");
  assert.deepEqual(reasons, []);
});

test("malformed or duplicate terminal history can finish at most once", async () => {
  const source = fakeSource();
  const replayed = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [
        { sequenceNumber: 9, type: "run.failed", payload: { error: "older" }, at: "" },
        { sequenceNumber: "bad", type: "run.completed", payload: {}, at: "" },
        { sequenceNumber: 12, type: "run.completed", payload: { summary: "latest" }, at: "" },
        { sequenceNumber: 10, type: "run.aborted", payload: {}, at: "" },
      ],
    }),
  });
  try {
    resolveAgentRunStreamError({
      source,
      base: "/api/open-gym/runs/r-duplicate-ending",
      replayEnding: (event) => replayed.push([event.sequenceNumber, event.type]),
      onUnavailable: () => assert.fail("one valid ending is available"),
    });
    await settle();
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(source.closed, true);
  assert.deepEqual(replayed, [[12, "run.completed"]]);
});

test("route cleanup aborts an active terminal-state probe immediately", async () => {
  const source = fakeSource();
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(init.signal.reason);
        },
        { once: true },
      );
    });
  try {
    resolveAgentRunStreamError({
      source,
      base: "/api/open-gym/runs/route-change",
      onUnavailable: () => assert.fail("route cleanup is not an unavailable run"),
    });
    closeAgentRunStream(source);
    await settle();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(source.closed, true);
  assert.equal(aborted, true);
});

test("a forgotten run closes its stream and says which failure it was", async () => {
  for (const [body, status, expected] of [
    [{ ok: false, error: "run_not_found" }, 404, "run_not_found"],
    [{ ok: false, error: "internal_error" }, 500, "stream_unavailable"],
  ]) {
    const source = fakeSource();
    const reasons = [];
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status, json: async () => body });
    try {
      resolveAgentRunStreamError({
        source,
        base: "/api/open-gym/runs/r3",
        onUnavailable: (reason) => reasons.push(reason),
      });
      await settle();
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(source.closed, true);
    assert.deepEqual(reasons, [expected]);
  }
});

test("every inline run card resolves stream errors through the one helper", () => {
  // The hole this closes was identical in fifteen cards: `if (response.ok)
  // return` left the socket open, so the browser reconnected to a finished run
  // until the chat was closed. Keeping the check here means the next card
  // copied from a neighbour cannot reintroduce it.
  const offenders = [];
  const unrouted = [];
  const unownedProbes = [];
  for (const name of cardFiles) {
    const text = fs.readFileSync(path.join(cardsDir, name), "utf8");
    if (!text.includes("new EventSource")) continue;
    if (/if\s*\(response\.ok\)\s*return;/.test(text)) offenders.push(name);
    const resolved =
      text.includes("resolveAgentRunStreamError") ||
      // Closing outright is the other correct answer, and predates the helper.
      /\.onerror\s*=\s*\(\)\s*=>\s*\w+\.close\(\)/.test(text) ||
      /\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,800}?(?:\w+\.close\(\)|closeStream\(\))/.test(text);
    if (!resolved) unrouted.push(name);
    if (
      text.includes("resolveAgentRunStreamError") &&
      !text.includes("closeAgentRunStream")
    ) {
      unownedProbes.push(name);
    }
  }
  assert.deepEqual(offenders, [], "these cards reconnect to a finished run forever");
  assert.deepEqual(unrouted, [], "these cards never close their stream on error");
  assert.deepEqual(
    unownedProbes,
    [],
    "these cards leave an in-flight error probe alive after route teardown",
  );
});

test("named EventSource owners cannot escape the shared single-flight probe", () => {
  for (const name of [
    "inline-deep-research-run.tsx",
    "inline-get-doc-run.tsx",
  ]) {
    const text = fs.readFileSync(path.join(cardsDir, name), "utf8");
    assert.match(text, /resolveAgentRunStreamError\(\{/u, name);
    assert.doesNotMatch(
      text,
      /\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,1500}?for \(const event of data\?\.events/u,
      `${name} must not replay its complete journal after every stream error`,
    );
  }
});

test("openGym keeps a saved answer when its run has aged out of the manager", () => {
  // The run manager forgets a run half an hour after it ends, so every openGym
  // turn older than that reaches the unavailable branch on load. In the quiet
  // presentation the guidance and animation are the whole message: replacing
  // them with "its saved result remains below" left nothing below.
  const card = fs.readFileSync(path.join(cardsDir, "inline-open-gym-run.tsx"), "utf8");
  const handler = card.match(/onUnavailable: \(reason\) => \{[\s\S]*?\n {8}\},/);
  assert.ok(handler, "the openGym card must handle an unavailable stream");
  assert.match(
    handler[0],
    /if \(persistedOutcome && persistedOutcome !== "running"\) return;/,
  );
});
