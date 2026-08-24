import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveAgentRunStreamError } from "../src/lib/agent-run-stream.ts";

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
  for (const name of cardFiles) {
    const text = fs.readFileSync(path.join(cardsDir, name), "utf8");
    if (!text.includes("source.onerror")) continue;
    if (/if \(response\.ok\) return;/.test(text)) offenders.push(name);
    const handler = text.match(/source\.onerror = \(\) => \{[\s\S]*?\n {4}\};/);
    if (!handler) continue;
    const resolved =
      handler[0].includes("resolveAgentRunStreamError") ||
      // Closing outright is the other correct answer, and predates the helper.
      /source\.onerror = \(\) => source\.close\(\);/.test(text) ||
      handler[0].includes("source.close()");
    if (!resolved) unrouted.push(name);
  }
  assert.deepEqual(offenders, [], "these cards reconnect to a finished run forever");
  assert.deepEqual(unrouted, [], "these cards never close their stream on error");
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
