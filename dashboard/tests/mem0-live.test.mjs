// Opt-in live check of the real vendored mem0 engine against real ChatMock.
//
//   BREADBOARD_TEST_MEM0_LIVE=1 node --test --experimental-strip-types \
//     tests/mem0-live.test.mjs
//
// Kept out of the default run for the same reason as the live-garden tests: it
// needs ChatMock up with a working embedding backend, and a failure there is a
// statement about the machine, not about this code. What it proves is the part
// the fake cannot — that the built mem0 bundle loads under Node on this
// platform, accepts a ChatMock base URL for embeddings, and round-trips an
// entry through its SQLite vector store.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const live = process.env.BREADBOARD_TEST_MEM0_LIVE === "1";
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-mem0-live-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

after(() => {
  try {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // Windows refuses to unlink a file another handle still holds, and the
    // mem0 engine's better-sqlite3 connections live for the process lifetime
    // (there is no close() on its public surface). Leaving a few megabytes in
    // the OS temp directory is the right trade against failing a passing run.
  }
});

test("the vendored mem0 engine indexes and recalls through ChatMock", { skip: !live }, async () => {
  const { semanticMemoryClient } = await import("../src/lib/mem0/client.ts");
  const client = await semanticMemoryClient();
  assert.ok(client, "no client — is ChatMock up and is mem0/mem0-ts built?");

  const id = await client.index("Kuzey prefers tabs over spaces for indentation", {
    userId: 4242,
  });
  assert.ok(id, "indexing must return a mem0 entry id");

  const hits = await client.search("what indentation does Kuzey want?", { userId: 4242 });
  assert.ok(hits.length > 0, "the semantic search returned nothing");
  assert.ok(
    hits.some((hit) => hit.text.includes("tabs")),
    `expected the tabs memory among: ${hits.map((hit) => hit.text).join(" | ")}`,
  );

  // Scoping is enforced by mem0's own filters, not just by Breadboard's SQL.
  const otherUser = await client.search("indentation", { userId: 9999 });
  assert.equal(otherUser.length, 0, "another user must not see this memory");

  await client.remove(id);
});

test("extraction produces facts from a real exchange", { skip: !live }, async () => {
  const { semanticMemoryClient } = await import("../src/lib/mem0/client.ts");
  const client = await semanticMemoryClient();
  assert.ok(client);
  const facts = await client.extract(
    [
      { role: "user", content: "I always deploy on Friday afternoons, and I only use vim." },
      { role: "assistant", content: "Understood." },
    ],
    { userId: 4243 },
  );
  assert.ok(Array.isArray(facts), "extraction must return an array even when empty");
  for (const fact of facts) await client.remove(fact.mem0Id);
});
