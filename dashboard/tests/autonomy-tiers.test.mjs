// Autonomy tiers crossed with tool risk classes.
//
// The property under test is the one the old on/off switch could not express:
// at the middle tier the agent gets on with reversible work and still stops
// before anything destructive, from a single switch position. Everything else
// here guards the edges of that claim — an unknown capability is treated as
// dangerous, a delete is destructive whatever asked for it, and the top tier
// still behaves exactly as the old switch did so nobody loses what they had.

import assert from "node:assert/strict";
import test from "node:test";

const {
  AUTONOMY_TIERS,
  DEFAULT_AUTONOMY_TIER,
  decideAutonomy,
  normalizeAutonomyTier,
  riskClassForCapability,
  riskClassForPermission,
  tierAllows,
} = await import("../src/lib/hermes/autonomy.ts");

function permission(overrides = {}) {
  return {
    kind: "filesystem",
    id: overrides.id ?? "p1",
    message: "needs a folder",
    capability: "filesystem_read",
    ...overrides,
  };
}

// ── classification ────────────────────────────────────────────────────

test("capabilities land in the class a person would put them in", () => {
  assert.equal(riskClassForCapability("garden_read"), "read");
  assert.equal(riskClassForCapability("filesystem_write"), "write");
  assert.equal(riskClassForCapability("web_research"), "network");
  assert.equal(riskClassForCapability("command_execution"), "install");
  assert.equal(riskClassForCapability("destructive_filesystem"), "destructive");
  assert.equal(riskClassForCapability("destructive_system_action"), "destructive");
});

test("an unknown capability is treated as destructive", () => {
  assert.equal(riskClassForCapability("something_invented_later"), "destructive");
});

test("a delete is destructive whichever capability carried it", () => {
  const risk = riskClassForPermission(
    permission({ capability: "filesystem_read", operations: ["read", "delete"] }),
  );
  assert.equal(risk, "destructive");
});

test("a move is destructive too — it is not undoable from inside the turn", () => {
  assert.equal(
    riskClassForPermission(permission({ capability: "filesystem_write", operations: ["move"] })),
    "destructive",
  );
});

test("execute outranks write", () => {
  assert.equal(
    riskClassForPermission(permission({ capability: "filesystem_write", operations: ["execute"] })),
    "install",
  );
});

test("a write operation lifts a read capability to write", () => {
  assert.equal(
    riskClassForPermission(
      permission({ capability: "filesystem_read", operations: ["read", "modify"] }),
    ),
    "write",
  );
});

test("a connection request is at least network", () => {
  assert.equal(
    riskClassForPermission(permission({ kind: "connection", capability: "conversation" })),
    "network",
  );
});

// ── the tiers ─────────────────────────────────────────────────────────

test("supervised approves nothing automatically", () => {
  for (const risk of ["read", "write", "network", "install", "destructive"]) {
    assert.equal(tierAllows("supervised", risk), false, risk);
  }
});

test("semi-autonomous acts up to network and stops above it", () => {
  assert.equal(tierAllows("semi_autonomous", "read"), true);
  assert.equal(tierAllows("semi_autonomous", "write"), true);
  assert.equal(tierAllows("semi_autonomous", "network"), true);
  assert.equal(tierAllows("semi_autonomous", "install"), false);
  assert.equal(tierAllows("semi_autonomous", "destructive"), false);
});

test("autonomous is the old switch, unchanged", () => {
  for (const risk of ["read", "write", "network", "install", "destructive"]) {
    assert.equal(tierAllows("autonomous", risk), true, risk);
  }
});

test("the default is what the switch has always done", () => {
  // The tiers are an opt-in. Upgrading must not quietly narrow what an
  // existing switch position means for someone who never asked for that.
  assert.equal(DEFAULT_AUTONOMY_TIER, "autonomous");
  assert.ok(AUTONOMY_TIERS.includes(DEFAULT_AUTONOMY_TIER));
});

test("the default tier approves everything, exactly as before", () => {
  const decision = decideAutonomy({
    tier: DEFAULT_AUTONOMY_TIER,
    pendingPermissions: [
      permission({ id: "read", capability: "filesystem_read", operations: ["read"] }),
      permission({ id: "write", capability: "filesystem_write", operations: ["create"] }),
      permission({ id: "run", capability: "command_execution" }),
      permission({ id: "wipe", capability: "destructive_filesystem", operations: ["delete"] }),
    ],
  });
  assert.equal(decision.withheld.length, 0);
  assert.equal(decision.autoApprove.length, 4);
  assert.equal(decision.clearsEverything, true);
});

test("an unrecognised stored value falls back to the default", () => {
  assert.equal(normalizeAutonomyTier("nonsense"), DEFAULT_AUTONOMY_TIER);
  assert.equal(normalizeAutonomyTier(undefined), DEFAULT_AUTONOMY_TIER);
  assert.equal(normalizeAutonomyTier("supervised"), "supervised");
});

// ── the decision ──────────────────────────────────────────────────────

test("the middle tier gets the safe work done and holds the rest", () => {
  const decision = decideAutonomy({
    tier: "semi_autonomous",
    pendingPermissions: [
      permission({ id: "read", capability: "filesystem_read", operations: ["read"] }),
      permission({ id: "write", capability: "filesystem_write", operations: ["create"] }),
      permission({ id: "wipe", capability: "destructive_filesystem", operations: ["delete"] }),
    ],
  });

  assert.deepEqual(
    decision.autoApprove.map((entry) => entry.id).sort(),
    ["read", "write"],
  );
  assert.deepEqual(
    decision.withheld.map((entry) => entry.permission.id),
    ["wipe"],
  );
  assert.equal(decision.clearsEverything, false);
  assert.match(decision.summary, /destructive/);
});

test("the same turn clears entirely at the top tier", () => {
  const pendingPermissions = [
    permission({ id: "read", capability: "filesystem_read", operations: ["read"] }),
    permission({ id: "wipe", capability: "destructive_filesystem", operations: ["delete"] }),
  ];
  const decision = decideAutonomy({ tier: "autonomous", pendingPermissions });
  assert.equal(decision.withheld.length, 0);
  assert.equal(decision.clearsEverything, true);
  assert.equal(decision.autoApprove.length, 2);
});

test("and nothing clears at the bottom tier", () => {
  const decision = decideAutonomy({
    tier: "supervised",
    pendingPermissions: [
      permission({ id: "read", capability: "filesystem_read", operations: ["read"] }),
    ],
  });
  assert.equal(decision.autoApprove.length, 0);
  assert.equal(decision.withheld.length, 1);
});

test("a turn that needs nothing clears at every tier", () => {
  for (const tier of AUTONOMY_TIERS) {
    const decision = decideAutonomy({ tier, pendingPermissions: [] });
    assert.equal(decision.clearsEverything, true, tier);
    assert.match(decision.summary, /Nothing needed approval/);
  }
});
