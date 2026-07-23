import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

// The executor resolves gardens through the real db singleton, so we seed two
// isolated gardens owned by two different users, exercise the trust boundary, and
// clean up. QUARTZ_CONTENT_PATH is required for source-mapping resolution.
process.env.QUARTZ_CONTENT_PATH = process.env.QUARTZ_CONTENT_PATH || path.join(os.tmpdir(), "gbrain-test-content");

const dbMod = await import("../src/lib/db.ts");
const db = dbMod.default;
const { issueCapabilityToken } = await import("../src/lib/openharness/capability-token.ts");
const { executeGBrainTool, GBRAIN_TOOLS } = await import("../src/lib/openharness/gbrain-tools.ts");

const SUFFIX = Math.random().toString(36).slice(2, 8);
const slugA = `gbrain-test-alice-${SUFFIX}`;
const slugB = `gbrain-test-bob-${SUFFIX}`;

const userA = Number(
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(`alice-${SUFFIX}`, `a-${SUFFIX}@x.com`, "h").lastInsertRowid,
);
const userB = Number(
  db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(`bob-${SUFFIX}`, `b-${SUFFIX}@x.com`, "h").lastInsertRowid,
);
const clusterA = Number(
  db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(userA, "Alice Garden", slugA).lastInsertRowid,
);
const clusterB = Number(
  db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(userB, "Bob Garden", slugB).lastInsertRowid,
);

test.after(() => {
  db.prepare("DELETE FROM clusters WHERE id IN (?, ?)").run(clusterA, clusterB);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userA, userB);
});

function tokenFor(userId, clusterId, tools = GBRAIN_TOOLS) {
  return issueCapabilityToken({
    userId,
    surface: "garden_chat",
    openHarnessSessionId: `oh-${SUFFIX}`,
    allowedGardenIds: [clusterId],
    activeGardenId: clusterId,
    allowedTools: [...tools],
  });
}

test("rejects an invalid capability token", async () => {
  const res = await executeGBrainTool({ rawToken: "garbage", tool: "gbrain_search", args: {} });
  assert.equal(res.ok, false);
  assert.match(res.error, /token/i);
});

test("a token whose allowlist lacks the GBrain tool cannot call it (skill token cannot widen)", async () => {
  const token = tokenFor(userA, clusterA, ["gbrain_status"]); // only status allowed
  const res = await executeGBrainTool({ rawToken: token, tool: "gbrain_search", args: { gardenId: slugA, query: "x" } });
  assert.equal(res.ok, false);
  assert.match(res.error, /not permitted/i);
});

test("gbrain_status reports disabled when GBRAIN_MODE is unset", async () => {
  const prev = process.env.GBRAIN_MODE;
  delete process.env.GBRAIN_MODE;
  try {
    const token = tokenFor(userA, clusterA);
    const res = await executeGBrainTool({ rawToken: token, tool: "gbrain_status", args: {} });
    assert.equal(res.ok, true);
    assert.equal(res.data.state, "disabled");
  } finally {
    if (prev !== undefined) process.env.GBRAIN_MODE = prev;
  }
});

test("search is refused when GBrain is disabled (no silent fallback)", async () => {
  const prev = process.env.GBRAIN_MODE;
  delete process.env.GBRAIN_MODE;
  try {
    const token = tokenFor(userA, clusterA);
    const res = await executeGBrainTool({ rawToken: token, tool: "gbrain_search", args: { gardenId: slugA, query: "x" } });
    assert.equal(res.ok, false);
    assert.match(res.error, /disabled/i);
  } finally {
    if (prev !== undefined) process.env.GBRAIN_MODE = prev;
  }
});

test("a conversation authorized for garden A cannot query garden B", async () => {
  const prev = process.env.GBRAIN_MODE;
  process.env.GBRAIN_MODE = "required";
  try {
    const token = tokenFor(userA, clusterA); // authorized only for A
    const res = await executeGBrainTool({
      rawToken: token,
      tool: "gbrain_search",
      args: { gardenId: slugB, query: "x" }, // asks for B
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /outside the authorized set/i);
  } finally {
    if (prev !== undefined) process.env.GBRAIN_MODE = prev;
    else delete process.env.GBRAIN_MODE;
  }
});

test("a token referencing only non-existent gardens gets no scope", async () => {
  const prev = process.env.GBRAIN_MODE;
  process.env.GBRAIN_MODE = "required";
  try {
    const token = issueCapabilityToken({
      userId: userA,
      surface: "garden_chat",
      openHarnessSessionId: `oh-${SUFFIX}`,
      allowedGardenIds: [99999999],
      allowedTools: [...GBRAIN_TOOLS],
    });
    const res = await executeGBrainTool({ rawToken: token, tool: "gbrain_search", args: { query: "x" } });
    assert.equal(res.ok, false);
    assert.match(res.error, /no authorized gardens/i);
  } finally {
    if (prev !== undefined) process.env.GBRAIN_MODE = prev;
    else delete process.env.GBRAIN_MODE;
  }
});

test("GBrain tool results never carry capability/permission-granting fields", async () => {
  const token = tokenFor(userA, clusterA);
  const res = await executeGBrainTool({ rawToken: token, tool: "gbrain_status", args: {} });
  const serialized = JSON.stringify(res);
  for (const forbidden of ["scoped_implementation", "grantFilesystem", "allowShell", "capabilityToken", "widenScope"]) {
    assert.ok(!serialized.includes(forbidden), `result must not include ${forbidden}`);
  }
});
