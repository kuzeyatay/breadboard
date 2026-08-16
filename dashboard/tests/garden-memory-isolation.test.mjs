// Garden-only memory has to actually seal, in both directions.
//
// The setting claims two things: what this garden learns is hidden from chats
// elsewhere, and chats here see nothing from elsewhere. Ordinary scope weighting
// cannot deliver either — an unrelated garden's memory still scores 0.10 and a
// global memory still scores 0.25 — so these tests exist to catch the day
// someone "simplifies" the hard filter back into a ranking nudge.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-garden-memory-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BREADBOARD_MEM0 = "off";

const { default: db } = await import("../src/lib/db.ts");
const { memoryVisibleInContext, isolatedGardenScopeIds } = await import(
  "../src/lib/conversations/memory-isolation.ts"
);
const { gardenInstructions, gardenMemoryScope } = await import(
  "../src/lib/garden-settings.ts"
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function makeUser(name) {
  return Number(
    db
      .prepare(`INSERT INTO users (username, email, password_hash) VALUES (?, ?, 'x')`)
      .run(name, `${name}@example.com`).lastInsertRowid,
  );
}

function makeGarden(userId, slug, scope = "default") {
  return Number(
    db
      .prepare(
        `INSERT INTO clusters (user_id, name, slug, description, visibility, memory_scope)
         VALUES (?, ?, ?, '', 'private', ?)`,
      )
      .run(userId, slug, slug, scope).lastInsertRowid,
  );
}

const memory = (scope, scopeId) => ({ scope, scope_id: scopeId });

// ------------------------------------------------------------- the two seals

test("a sealed garden's memory is invisible from outside it", () => {
  const visible = memoryVisibleInContext(memory("garden", "7"), {
    currentGardenScopeId: null,
    isolatedGardenIds: new Set(["7"]),
    currentGardenIsIsolated: false,
  });
  assert.equal(visible, false, "the outward seal must hold in a chat with no garden");

  const fromAnotherGarden = memoryVisibleInContext(memory("garden", "7"), {
    currentGardenScopeId: "9",
    isolatedGardenIds: new Set(["7"]),
    currentGardenIsIsolated: false,
  });
  assert.equal(fromAnotherGarden, false, "and in a different garden");
});

test("a sealed garden still sees its own memory", () => {
  const visible = memoryVisibleInContext(memory("garden", "7"), {
    currentGardenScopeId: "7",
    isolatedGardenIds: new Set(["7"]),
    currentGardenIsIsolated: true,
  });
  assert.equal(visible, true);
});

test("inside a sealed garden, outside memory is invisible", () => {
  const context = {
    currentGardenScopeId: "7",
    isolatedGardenIds: new Set(["7"]),
    currentGardenIsIsolated: true,
  };
  assert.equal(memoryVisibleInContext(memory("global", null), context), false);
  assert.equal(memoryVisibleInContext(memory("project", "breadboard"), context), false);
  assert.equal(memoryVisibleInContext(memory("garden", "9"), context), false);
});

test("an ordinary garden is unchanged in both directions", () => {
  const context = {
    currentGardenScopeId: "9",
    isolatedGardenIds: new Set(),
    currentGardenIsIsolated: false,
  };
  assert.equal(memoryVisibleInContext(memory("global", null), context), true);
  assert.equal(memoryVisibleInContext(memory("project", "breadboard"), context), true);
  assert.equal(memoryVisibleInContext(memory("garden", "9"), context), true);
  // Another ordinary garden still shows through weakly, as it always did.
  assert.equal(memoryVisibleInContext(memory("garden", "7"), context), true);
});

// -------------------------------------------------------- the database reads

test("only gardens set to garden_only are reported as sealed", () => {
  const userId = makeUser("seal-user");
  const open = makeGarden(userId, "open-garden", "default");
  const sealed = makeGarden(userId, "sealed-garden", "garden_only");

  const isolated = isolatedGardenScopeIds(userId);
  assert.equal(isolated.has(String(sealed)), true);
  assert.equal(isolated.has(String(open)), false);
});

test("scope ids are strings, matching how scope_id is stored", () => {
  const userId = makeUser("string-user");
  const sealed = makeGarden(userId, "string-garden", "garden_only");
  for (const value of isolatedGardenScopeIds(userId)) {
    assert.equal(typeof value, "string", "a number here would silently never match");
  }
  assert.equal(isolatedGardenScopeIds(userId).has(String(sealed)), true);
});

test("one user's sealed garden does not affect another user", () => {
  const mine = makeUser("mine-user");
  const theirs = makeUser("theirs-user");
  makeGarden(theirs, "their-sealed", "garden_only");
  assert.equal(isolatedGardenScopeIds(mine).size, 0);
});

test("memory scope reads back, and defaults when unset", () => {
  const userId = makeUser("scope-user");
  const normal = makeGarden(userId, "normal-garden");
  const sealed = makeGarden(userId, "sealed-two", "garden_only");
  assert.equal(gardenMemoryScope(normal), "default");
  assert.equal(gardenMemoryScope(sealed), "garden_only");
  assert.equal(gardenMemoryScope(null), "default", "a chat outside any garden");
  assert.equal(gardenMemoryScope(999_999), "default", "a garden that no longer exists");
});

// -------------------------------------------------------------- instructions

test("garden instructions round-trip and default to empty", () => {
  const userId = makeUser("instructions-user");
  const clusterId = makeGarden(userId, "instructed-garden");
  assert.equal(gardenInstructions(clusterId), "", "a new garden has none");

  db.prepare("UPDATE clusters SET instructions = ? WHERE id = ?").run(
    "Always show the derivation before the result.",
    clusterId,
  );
  assert.match(gardenInstructions(clusterId), /derivation before the result/);
  assert.equal(gardenInstructions(null), "", "a chat outside any garden");
});

test("the garden chat prompt carries the instructions", () => {
  // A source assertion rather than a live turn: composing one would need the
  // whole Hermes runtime. What matters is that the composed prompt reads the
  // column at all, which is the wire that would silently go missing.
  const adapter = fs.readFileSync(
    path.join(import.meta.dirname, "../src/lib/hermes/garden-chat-adapter.ts"),
    "utf8",
  );
  assert.match(adapter, /gardenInstructionsContext\(session\.row\.cluster_id\)/);
  assert.match(adapter, /import \{ gardenInstructions \}/);
});
