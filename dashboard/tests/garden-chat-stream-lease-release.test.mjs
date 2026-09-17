import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

// The Garden pump drives the runtime generator by hand (`events.next()`), not
// with `for await`, so leaving the loop does not close the generator. The
// runtime's `finally` — which releases the Hermes service lease — only runs
// once `return()` is called on it. Eight leaked leases fill Hermes's
// concurrency cap and every new session then fails with
// "The agent runtime is unavailable."
test("hand-iterated generator only releases its lease when return() is called", async () => {
  let released = 0;
  async function* stream() {
    try {
      yield { type: "assistant.delta" };
      yield { type: "session.status", payload: { status: "idle" } };
      return;
    } finally {
      released += 1;
    }
  }

  const events = stream()[Symbol.asyncIterator]();
  for (let next = await events.next(); !next.done; next = await events.next()) {
    if (next.value.type === "session.status") break;
  }
  assert.equal(released, 0, "breaking out of the loop leaves the generator suspended");

  await events.return(undefined);
  assert.equal(released, 1, "return() runs the generator's cleanup");

  await events.return(undefined);
  assert.equal(released, 1, "a second return() on a finished generator is a no-op");
});

test("Garden pump closes the runtime generator in its finally block", () => {
  const adapter = source("src/lib/hermes/garden-chat-adapter.ts");
  const loop = adapter.indexOf("for (\n          let next = await firstEvent;");
  assert.ok(loop > 0, "the pump still iterates the runtime generator by hand");
  const cleanupMatch = /await opened\?\.events\.return(?:\?\.)?\(undefined\)/.exec(adapter.slice(loop));
  const cleanup = cleanupMatch ? loop + cleanupMatch.index : -1;
  assert.ok(cleanup > loop, "the pump returns the generator after the loop");
  const finallyBlock = adapter.lastIndexOf("} finally {", cleanup);
  assert.ok(
    finallyBlock > loop && adapter.slice(finallyBlock, cleanup).includes("clearInterval(heartbeat)"),
    "the generator is returned from the same finally that stops the heartbeat",
  );
});
