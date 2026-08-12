import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { shouldGroundTerminalInGardens } from "../src/lib/hermes/terminal-garden-grounding.ts";

function shouldGround(request, options = {}) {
  return shouldGroundTerminalInGardens({
    request,
    plan: planTask({ request, authenticated: true }),
    ...options,
  });
}

test("academic Terminal synthesis automatically consults authorized Gardens", () => {
  assert.equal(
    shouldGround(
      "Can you create a PDF explaining why SNNs can be the future in an academic style?",
    ),
    true,
  );
  assert.equal(
    shouldGround("Explain the limitations and future outlook of neuromorphic computing."),
    true,
  );
});

test("operational, attachment-grounded, and opted-out requests do not mix in Garden context", () => {
  assert.equal(shouldGround("Fix the bug in this React component."), false);
  assert.equal(
    shouldGround("Summarize this academic report.", { hasAttachments: true }),
    false,
  );
  assert.equal(
    shouldGround("Explain SNNs without using my Garden."),
    false,
  );
});

test("retrieved Garden pages are injected and persisted as response evidence", () => {
  const turnService = readFileSync(
    new URL("../src/lib/conversations/turn-service.ts", import.meta.url),
    "utf8",
  );
  const eventStream = readFileSync(
    new URL("../src/lib/hermes/event-stream.ts", import.meta.url),
    "utf8",
  );

  assert.match(turnService, /retrieveTerminalGardenGrounding/);
  assert.match(turnService, /gardenGrounding\.context/);
  assert.match(turnService, /gardenGrounding:\s*\{/);
  assert.match(eventStream, /kind: "garden"/);
  assert.match(eventStream, /Garden source: \$\{source\.title\}/);
  assert.match(eventStream, /sources\.push\(label\)/);
});
