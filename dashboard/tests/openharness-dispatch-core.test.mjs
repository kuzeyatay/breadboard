import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  prepareTurn,
  decideFallback,
  buildCompletionReport,
  buildDiagnostics,
  redactPath,
} from "../src/lib/openharness/dispatch-core.ts";

const WORKSPACE = "/runtime/openharness/ws1";

function root(overrides = {}) {
  return {
    id: "1",
    userId: 1,
    canonicalPath: "/home/me/Documents",
    displayName: "Documents",
    permissions: {
      read: true,
      create: false,
      modify: false,
      move: false,
      delete: false,
      execute: false,
      ...(overrides.permissions ?? {}),
    },
    scope: "remembered",
    createdAt: "now",
    revokedAt: null,
    ...overrides,
  };
}

function prepare(request, options = {}) {
  return prepareTurn({
    request,
    surface: options.surface ?? "dashboard_terminal",
    userId: options.userId === undefined ? 1 : options.userId,
    grants: options.grants ?? [],
    workspaceRoot: WORKSPACE,
    isolated: options.isolated,
    confirmedPermissionIds: options.confirmed,
    resolvedResources: options.resolvedResources,
  });
}

/* ------------------------------------------------------------------ */
/* Turn preparation                                                    */
/* ------------------------------------------------------------------ */

test("preparation produces a plan, a grant and a compatible decision", () => {
  const prepared = prepare("Summarize the files in my Documents folder.", {
    grants: [root()],
  });
  assert.ok(prepared.plan.steps.length >= 1);
  assert.ok(prepared.grant.grantedCapabilities.includes("filesystem_read"));
  assert.equal(prepared.blocked, false);
  assert.equal(prepared.decision.mode, "technical_read");
  assert.ok(prepared.decision.allowedTools.includes("read"));
});

test("a turn with no usable grant is blocked and reports what it needs", () => {
  const prepared = prepare("Summarize the files in my Documents folder.");
  assert.equal(prepared.blocked, true);
  assert.equal(prepared.pendingPermissions.length >= 1, true);
  assert.equal(prepared.pendingPermissions[0].kind, "filesystem");
});

test("a verified file follow-up pauses on an actionable parent-folder grant", () => {
  const downloads = path.join(path.parse(WORKSPACE).root, "Users", "me", "Downloads");
  const target = path.join(downloads, "archive.iso");
  const prepared = prepare("please delete that file", {
    grants: [
      root({
        canonicalPath: downloads,
        displayName: "Downloads",
        permissions: { read: true },
      }),
    ],
    resolvedResources: [
      { kind: "path", value: target, absolute: true, resourceType: "file" },
    ],
  });

  assert.equal(prepared.blocked, true);
  const permission = prepared.pendingPermissions.find(
    (item) => item.capability === "destructive_filesystem",
  );
  assert.ok(permission);
  assert.equal(permission.path, downloads);
  assert.equal(permission.targetPath, target);
  assert.deepEqual(permission.targetPaths, [target]);
  assert.deepEqual(permission.operations, ["read", "delete"]);
});

test("a verified file follow-up runs after its delete grant is approved", () => {
  const downloads = path.join(path.parse(WORKSPACE).root, "Users", "me", "Downloads");
  const target = path.join(downloads, "archive.iso");
  const prepared = prepare("please delete that file", {
    grants: [
      root({
        canonicalPath: downloads,
        displayName: "Downloads",
        permissions: { read: true, delete: true },
      }),
    ],
    resolvedResources: [
      { kind: "path", value: target, absolute: true, resourceType: "file" },
    ],
  });

  assert.equal(prepared.blocked, false);
  assert.ok(
    prepared.grant.grantedCapabilities.includes("destructive_filesystem"),
  );
  assert.deepEqual(prepared.decision.authorizedDeleteTargets, [target]);
  assert.equal(prepared.pendingPermissions.length, 0);
});

test("a verified file list produces one parent grant with every exact affected path", () => {
  const downloads = path.join(path.parse(WORKSPACE).root, "Users", "me", "Downloads");
  const targets = ["one.iso", "two.mp4", "three.exe"].map((name) =>
    path.join(downloads, name));
  const prepared = prepare("delete them", {
    grants: [
      root({
        canonicalPath: downloads,
        displayName: "Downloads",
        permissions: { read: true },
      }),
    ],
    resolvedResources: targets.map((value) => ({
      kind: "path",
      value,
      absolute: true,
      resourceType: "file",
    })),
  });

  const permission = prepared.pendingPermissions.find(
    (item) => item.capability === "destructive_filesystem",
  );
  assert.ok(permission);
  assert.equal(permission.path, downloads);
  assert.equal(permission.targetPath, undefined);
  assert.deepEqual(permission.targetPaths, targets);
  assert.match(permission.message, /3 identified files/i);
});

test("a file-list deletion without grants produces one combined approval, not an approval loop", () => {
  const downloads = path.join(path.parse(WORKSPACE).root, "Users", "me", "Downloads");
  const targets = ["one.iso", "two.mp4", "three.pdf"].map((name) =>
    path.join(downloads, name));
  const prepared = prepare("delete the listed files except Demo_Team14.mp4", {
    grants: [],
    resolvedResources: targets.map((value) => ({
      kind: "path",
      value,
      absolute: true,
      resourceType: "file",
    })),
  });

  assert.deepEqual(
    prepared.plan.requiredCapabilities.filter((capability) =>
      capability !== "conversation"),
    ["filesystem_read", "destructive_filesystem"],
  );
  assert.equal(prepared.pendingPermissions.length, 1);
  assert.equal(prepared.pendingPermissions[0].path, downloads);
  assert.deepEqual(prepared.pendingPermissions[0].operations, ["read", "delete"]);
  assert.deepEqual(prepared.pendingPermissions[0].targetPaths, targets);

  const resumed = prepare("delete the listed files except Demo_Team14.mp4", {
    grants: [
      root({
        canonicalPath: downloads,
        displayName: "Downloads",
        permissions: { read: true, delete: true },
        scope: "one_time",
      }),
    ],
    resolvedResources: targets.map((value) => ({
      kind: "path",
      value,
      absolute: true,
      resourceType: "file",
    })),
  });
  assert.equal(resumed.blocked, false);
  assert.equal(resumed.pendingPermissions.length, 0);
  assert.deepEqual(resumed.decision.authorizedDeleteTargets, targets);
});

test("a coding turn projects onto the scoped implementation decision", () => {
  const prepared = prepare("Fix the failing tests.", {
    grants: [
      root({
        canonicalPath: "/repo",
        displayName: "repo",
        permissions: { read: true, create: true, modify: true, move: true, execute: true },
      }),
    ],
  });
  assert.equal(prepared.decision.mode, "scoped_implementation");
  assert.equal(prepared.decision.implementationRequired, true);
  assert.deepEqual(prepared.decision.allowedCommandPatterns, []);
  assert.ok(prepared.decision.allowedTools.includes("terminal_execute_command"));
  assert.ok(!prepared.decision.allowedTools.includes("bash"));
});

test("a conversational turn projects onto the knowledge decision", () => {
  const prepared = prepare("What is amplitude modulation?");
  assert.equal(prepared.decision.mode, "knowledge");
  assert.ok(prepared.decision.allowedTools.includes("terminal_execute_command"));
  assert.ok(prepared.decision.allowedTools.includes("artifact_create"));
  assert.ok(!prepared.decision.allowedTools.includes("bash"));
});

// Found by live validation against the running runtime: an organize task
// (filesystem_write, no coding) was projecting to `technical_read`, which
// understated it in audit records and could let a mode-gated consumer treat a
// mutating turn as read-only.
test("a mutating non-coding turn is not projected as read-only", () => {
  const prepared = prepare("Organize my Downloads folder by file type.", {
    grants: [
      root({
        canonicalPath: "/home/me/Downloads",
        displayName: "Downloads",
        permissions: { read: true, create: true, modify: true, move: true },
      }),
    ],
  });
  assert.ok(prepared.grant.grantedCapabilities.includes("filesystem_write"));
  assert.notEqual(prepared.decision.mode, "technical_read");
  assert.equal(prepared.decision.mode, "scoped_implementation");
  // ...but it is still honestly reported as not a coding task.
  assert.equal(prepared.decision.implementationRequired, false);
  assert.equal(prepared.plan.requiresCoding, false);
});

test("a read-only turn still projects as technical_read", () => {
  const prepared = prepare("Summarize the files in my Documents folder.", {
    grants: [root()],
  });
  assert.equal(prepared.decision.mode, "technical_read");
});

test("the decision never widens beyond the brokered grant", () => {
  const prepared = prepare("Organize my Downloads folder.", {
    grants: [root({ displayName: "Documents" })],
  });
  // Read-only grant: no write pattern may appear in the projected decision.
  assert.ok(!prepared.decision.allowedTools.includes("write"));
});

/* ------------------------------------------------------------------ */
/* Fallback policy                                                     */
/* ------------------------------------------------------------------ */

test("required mode never falls back", () => {
  const decision = decideFallback("required", "event_stream", null);
  assert.equal(decision.allowed, false);
  assert.equal(decision.stage, "event_stream");
  assert.ok(/required/.test(decision.reason));
});

test("preferred mode allows a visible fallback that names lost capabilities", () => {
  const prepared = prepare("Organize my Downloads folder.", {
    grants: [root({ permissions: { read: true, create: true, modify: true, move: true } })],
  });
  const decision = decideFallback("preferred", "send_message", prepared.plan);
  assert.equal(decision.allowed, true);
  assert.equal(decision.visible, true);
  assert.ok(decision.unavailableCapabilities.includes("filesystem_write"));
  assert.ok(!decision.unavailableCapabilities.includes("conversation"));
});

/* ------------------------------------------------------------------ */
/* Honest completion reporting                                         */
/* ------------------------------------------------------------------ */

test("an action claimed without verification is not reported as completed", () => {
  const report = buildCompletionReport([
    { description: "Created report.pdf", status: "completed" },
  ]);
  assert.equal(report.completed.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.ok(/not verified/.test(report.skipped[0].description));
  assert.equal(report.outcome, "failed");
});

test("a verified action is reported as completed", () => {
  const report = buildCompletionReport([
    {
      description: "Created report.pdf",
      status: "completed",
      verification: "stat report.pdf -> 24kB",
    },
  ]);
  assert.equal(report.completed.length, 1);
  assert.equal(report.outcome, "completed");
});

test("mixed results are reported as partial, not as success", () => {
  const report = buildCompletionReport([
    { description: "Moved 8 files", status: "completed", verification: "8/8 at destination" },
    { description: "Moved locked.docx", status: "failed" },
  ]);
  assert.equal(report.outcome, "partial");
  assert.equal(report.completed.length, 1);
  assert.equal(report.failed.length, 1);
});

test("irreversible completed changes are surfaced separately", () => {
  const report = buildCompletionReport([
    {
      description: "Deleted 3 duplicates",
      status: "completed",
      verification: "3 paths absent",
      irreversible: true,
    },
  ]);
  assert.deepEqual(report.irreversibleChanges, ["Deleted 3 duplicates"]);
});

test("a pending approval blocks rather than fails when nothing ran", () => {
  const report = buildCompletionReport([
    { description: "Awaiting Documents approval", status: "pending_approval" },
  ]);
  assert.equal(report.outcome, "blocked");
  assert.equal(report.pendingApprovals.length, 1);
});

test("a runtime failure preserves the request for retry", () => {
  const report = buildCompletionReport([], {
    retryable: { stage: "send_message", request: "Organize my Downloads folder." },
  });
  assert.equal(report.outcome, "failed");
  assert.equal(report.retryable.stage, "send_message");
  assert.equal(report.retryable.request, "Organize my Downloads folder.");
});

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

test("diagnostics answer the questions the status interface must answer", () => {
  const prepared = prepare("Summarize the files in my Documents folder.", {
    grants: [root()],
  });
  const diagnostics = buildDiagnostics(prepared, {
    userId: 1,
    surface: "garden_chat",
    gardenId: "physics",
    runtimeSessionId: 42,
    openHarnessSessionId: "oh-1",
    eventStreamConnected: true,
  });
  assert.equal(diagnostics.backend, "openharness");
  assert.equal(diagnostics.eventStreamConnected, true);
  assert.equal(diagnostics.runtimeSessionId, 42);
  assert.ok(diagnostics.intendedOutcome.length > 0);
  assert.ok(diagnostics.enabledTools.includes("read"));
  assert.ok(diagnostics.grantedCapabilities.includes("filesystem_read"));
});

test("diagnostics mark the backend as legacy when fallback was used", () => {
  const prepared = prepare("Hello.");
  const diagnostics = buildDiagnostics(prepared, {
    userId: 1,
    surface: "garden_chat",
    fallbackUsed: true,
  });
  assert.equal(diagnostics.backend, "legacy_chatmock");
  assert.equal(diagnostics.fallbackUsed, true);
});

test("home directories are redacted from diagnostics", () => {
  // The separator style of the incoming path is preserved.
  assert.equal(redactPath("C:\\Users\\20252082\\Documents"), "C:\\Users\\<user>\\Documents");
  assert.equal(redactPath("/home/kuzey/notes"), "/home/<user>/notes");
  assert.equal(redactPath("/Users/kuzey/notes"), "/Users/<user>/notes");

  const prepared = prepare("Summarize the files in my Documents folder.", {
    grants: [root({ canonicalPath: "/home/kuzey/Documents" })],
  });
  const diagnostics = buildDiagnostics(prepared, { userId: 1, surface: "dashboard_terminal" });
  assert.ok(diagnostics.approvedRoots.every((value) => !value.includes("kuzey")));
});

/* ------------------------------------------------------------------ */
/* Least-privilege reset                                               */
/* ------------------------------------------------------------------ */

test("the reset baseline grants nothing at all", async () => {
  const { leastPrivilegeDecision } = await import(
    "../src/lib/openharness/dispatch-core.ts"
  );
  const baseline = leastPrivilegeDecision("/ws");
  assert.equal(baseline.mode, "knowledge");
  assert.equal(baseline.implementationRequired, false);
  assert.deepEqual(baseline.allowedTools, []);
  assert.deepEqual(baseline.authorizedPathPatterns, []);
  assert.deepEqual(baseline.allowedCommandPatterns, []);
  assert.deepEqual(baseline.selectedConditionalSkills, []);
  assert.deepEqual(baseline.selectedConnections, []);
  // Only the session's own workspace remains addressable.
  assert.deepEqual(baseline.authorizedRoots, ["/ws"]);
  assert.equal(baseline.expiresAt, null);
});
