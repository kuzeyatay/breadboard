import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { outerAgentTerminalResult } from "../src/lib/runtime-v2/outer-agent-conversation.ts";

const ev = (type, payload = {}) => ({ sequenceNumber: 1, type, payload, at: "now" });

test("a finished run seals the report its card would have sealed", () => {
  assert.deepEqual(
    outerAgentTerminalResult([ev("run.started"), ev("run.result", { result: "# Report" }), ev("run.completed")], "completed"),
    { outcome: "completed", content: "# Report" },
  );
  assert.deepEqual(
    outerAgentTerminalResult([ev("run.failed", { message: "Search quota exhausted." })], "failed"),
    { outcome: "failed", content: "Search quota exhausted." },
  );
  // A synthesized terminal with no events still settles from the status.
  assert.equal(outerAgentTerminalResult([], "aborted").outcome, "aborted");
});

test("chat loads reconcile outer-agent turns, not only Max Research", () => {
  for (const route of ["app/api/chat-sessions/route.ts", "app/api/hermes/sessions/[sessionId]/route.ts"]) {
    const source = readFileSync(new URL(`../src/${route}`, import.meta.url), "utf8");
    assert.match(source, /settleDelegatedWork\(/, route);
  }
});
