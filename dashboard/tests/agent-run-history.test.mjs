import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RETAINED_AGENT_RUN_EVENTS,
  appendBoundedAgentRunEvent,
} from "../src/lib/agent-run-history.ts";

test("renderer run history stays ordered, deduplicated, and bounded", () => {
  let events = [];
  for (let sequenceNumber = 1; sequenceNumber <= MAX_RETAINED_AGENT_RUN_EVENTS + 40; sequenceNumber += 1) {
    events = appendBoundedAgentRunEvent(events, {
      sequenceNumber,
      type: sequenceNumber % 2 ? "run.status" : "observation.screenshot",
    });
  }

  assert.equal(events.length, MAX_RETAINED_AGENT_RUN_EVENTS);
  assert.equal(events[0].sequenceNumber, 41);
  assert.equal(events.at(-1).sequenceNumber, MAX_RETAINED_AGENT_RUN_EVENTS + 40);

  const unchanged = appendBoundedAgentRunEvent(events, {
    sequenceNumber: events.at(-1).sequenceNumber,
    type: "duplicate replay",
  });
  assert.equal(unchanged, events, "a replay must not allocate or duplicate a row");

  const outOfOrder = appendBoundedAgentRunEvent(events, {
    sequenceNumber: MAX_RETAINED_AGENT_RUN_EVENTS + 39.5,
    type: "late frame",
  });
  assert.equal(outOfOrder.length, MAX_RETAINED_AGENT_RUN_EVENTS);
  assert.deepEqual(
    outOfOrder.map((event) => event.sequenceNumber),
    [...outOfOrder].map((event) => event.sequenceNumber).sort((left, right) => left - right),
  );
});
