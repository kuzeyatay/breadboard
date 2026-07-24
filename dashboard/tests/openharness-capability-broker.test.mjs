import test from "node:test";
import assert from "node:assert/strict";

import { planTask } from "../src/lib/openharness/task-plan.ts";
import {
  brokerCapabilities,
  summarizeGrant,
} from "../src/lib/openharness/capability-broker.ts";

const WORKSPACE = "/runtime/openharness/ws1";

function grantRoot(overrides = {}) {
  return {
    id: overrides.id ?? "1",
    userId: 1,
    canonicalPath: overrides.canonicalPath ?? "/home/me/Downloads",
    displayName: overrides.displayName ?? "Downloads",
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
  };
}

function broker(request, options = {}) {
  const plan = planTask({
    request,
    authenticated: options.isolated ? false : true,
    isolated: options.isolated,
  });
  return brokerCapabilities({
    plan,
    surface: options.surface ?? "dashboard_terminal",
    userId: options.isolated ? null : 1,
    grants: options.grants ?? [],
    workspaceRoot: WORKSPACE,
    isolated: options.isolated,
    confirmedPermissionIds: options.confirmed,
  });
}

const enabledTools = (grant) =>
  Object.entries(grant.allowedTools)
    .filter(([, on]) => on)
    .map(([tool]) => tool);

const allows = (grant, permission, pattern) =>
  grant.permissionRules.some(
    (rule) =>
      rule.permission === permission && rule.action === "allow" && rule.pattern === pattern,
  );

/* ------------------------------------------------------------------ */
/* Tools start off and are activated by capability                     */
/* ------------------------------------------------------------------ */

test("a conversational Terminal turn exposes only audited Terminal and optional artifact tools", () => {
  const grant = broker("What is the difference between AM and FM?");
  const tools = enabledTools(grant);
  assert.ok(tools.includes("terminal_execute_command"));
  assert.ok(tools.includes("artifact_create"));
  assert.ok(!tools.includes("bash"));
  assert.ok(!tools.includes("write"));
  assert.equal(grant.executable, true);
});

test("every broad built-in tool is explicitly denied by default", () => {
  const grant = broker("Hello there.");
  assert.ok(Object.keys(grant.allowedTools).length > 5);
  for (const tool of ["bash", "shell", "read", "write", "edit", "patch", "task", "skill"]) {
    assert.equal(grant.allowedTools[tool], false, tool);
  }
});

test("garden questions activate only garden read tools", () => {
  const grant = broker("What does my garden say about modulation?");
  const tools = enabledTools(grant);
  assert.ok(tools.includes("garden_search"));
  assert.ok(!tools.includes("read"), "no filesystem tool for a garden question");
  assert.ok(!tools.includes("bash"));
});

/* ------------------------------------------------------------------ */
/* Filesystem capability requires a real grant                         */
/* ------------------------------------------------------------------ */

test("without a grant a filesystem request becomes a permission request", () => {
  const grant = broker("Summarize the files in my Documents folder.");
  assert.ok(grant.withheldCapabilities.includes("filesystem_read"));
  assert.equal(grant.pendingPermissions.length >= 1, true);

  const request = grant.pendingPermissions[0];
  assert.equal(request.kind, "filesystem");
  assert.deepEqual(request.operations, ["read"]);
  // The prompt must be concrete, not "technical access is required".
  assert.ok(/read files and filenames/.test(request.message));
  assert.ok(!/technical access/i.test(request.message));
  assert.ok(!enabledTools(grant).includes("read"));
});

test("with a read grant the same request executes", () => {
  const grant = broker("Summarize the files in my Documents folder.", {
    grants: [grantRoot({ displayName: "Documents", canonicalPath: "/home/me/Documents" })],
  });
  assert.ok(grant.grantedCapabilities.includes("filesystem_read"));
  assert.equal(grant.pendingPermissions.length, 0);
  assert.equal(grant.executable, true);
  assert.ok(enabledTools(grant).includes("read"));
  assert.ok(allows(grant, "external_directory", "/home/me/Documents/**"));
  assert.ok(allows(grant, "read", "/home/me/Documents/**"));
});

test("a grant for another folder does not authorize Downloads", () => {
  const grant = broker("whats the biggest file in my Downloads folder?", {
    grants: [
      grantRoot({
        displayName: "Documents",
        canonicalPath: "/home/me/Documents",
      }),
    ],
  });
  assert.ok(grant.withheldCapabilities.includes("filesystem_read"));
  assert.equal(grant.executable, false);
  assert.ok(grant.pendingPermissions.some((item) => item.path?.toLowerCase().includes("downloads")));
});

test("a misspelled Downloads alias still produces a concrete permission target", () => {
  const grant = broker("whats the largest file in my donwloads folder?");
  const request = grant.pendingPermissions.find(
    (item) => item.kind === "filesystem",
  );
  assert.ok(request);
  assert.match(request.path ?? "", /downloads/i);
  assert.match(request.message, /downloads/i);
});

test("weather research enables web tools and their runtime permissions", () => {
  const grant = broker("whats the weather in bodrum?");
  assert.ok(enabledTools(grant).includes("webfetch"));
  assert.ok(enabledTools(grant).includes("websearch"));
  assert.ok(allows(grant, "webfetch", "*"));
  assert.ok(allows(grant, "websearch", "*"));
});

test("a read-only grant does not satisfy an organize request", () => {
  const grant = broker("Organize my Downloads folder by file type.", {
    grants: [grantRoot()],
  });
  assert.ok(grant.grantedCapabilities.includes("filesystem_read"));
  assert.ok(grant.withheldCapabilities.includes("filesystem_write"));
  assert.ok(!enabledTools(grant).includes("write"));
  assert.ok(!allows(grant, "write", "/home/me/Downloads/**"));
});

test("a write grant satisfies organize and opens write rules on that root only", () => {
  const grant = broker("Organize my Downloads folder by file type.", {
    grants: [
      grantRoot({
        permissions: { read: true, create: true, modify: true, move: true },
      }),
    ],
  });
  assert.ok(grant.grantedCapabilities.includes("filesystem_write"));
  assert.ok(allows(grant, "write", "/home/me/Downloads/**"));
  assert.ok(!allows(grant, "write", "*"), "write must never be opened globally");
});

test("deletion requires a delete grant, not merely a write grant", () => {
  const writeOnly = broker("Delete duplicate files after showing me the candidates.", {
    grants: [
      grantRoot({ permissions: { read: true, create: true, modify: true, move: true } }),
    ],
  });
  assert.ok(writeOnly.withheldCapabilities.includes("destructive_filesystem"));
});

/* ------------------------------------------------------------------ */
/* Least privilege                                                     */
/* ------------------------------------------------------------------ */

test("reading code does not enable writers", () => {
  const grant = broker("Explain what src/lib/auth.ts does.", {
    grants: [grantRoot({ canonicalPath: "/repo", displayName: "repo" })],
  });
  const tools = enabledTools(grant);
  assert.ok(tools.includes("read"));
  assert.ok(!tools.includes("write"));
  assert.ok(!tools.includes("edit"));
  assert.equal(grant.plan.requiresCoding, false);
});

test("moving source files does not enable coding tools", () => {
  const grant = broker("Move these .ts files into an archive folder.", {
    grants: [
      grantRoot({
        canonicalPath: "/repo",
        displayName: "repo",
        permissions: { read: true, create: true, modify: true, move: true },
      }),
    ],
  });
  assert.equal(grant.plan.requiresCoding, false);
  assert.ok(!grant.grantedCapabilities.includes("coding"));
});

test("running a command does not enable file writers", () => {
  const grant = broker("Run the existing test suite and explain the failures.", {
    grants: [grantRoot({ canonicalPath: "/repo", displayName: "repo" })],
  });
  const tools = enabledTools(grant);
  assert.ok(tools.includes("terminal_execute_command"));
  assert.ok(!tools.includes("bash"));
  assert.ok(!tools.includes("write"));
  assert.equal(grant.plan.requiresCoding, false);
});

test("a genuine coding task enables scoped file tools but never ambient bash", () => {
  const grant = broker("Fix the failing tests.", {
    grants: [
      grantRoot({
        canonicalPath: "/repo",
        displayName: "repo",
        permissions: { read: true, create: true, modify: true, move: true, execute: true },
      }),
    ],
  });
  assert.equal(grant.plan.requiresCoding, true);
  const tools = enabledTools(grant);
  for (const tool of ["read", "write", "edit", "terminal_execute_command"]) {
    assert.ok(tools.includes(tool), `${tool} should be enabled for a coding task`);
  }
  assert.ok(!tools.includes("bash"));
});

test("the session workspace is always usable without a grant", () => {
  const grant = broker("Summarize the files in my Documents folder.");
  assert.ok(allows(grant, "read", `${WORKSPACE}/**`));
  assert.ok(allows(grant, "write", `${WORKSPACE}/**`));
});

/* ------------------------------------------------------------------ */
/* Confirmation gating                                                 */
/* ------------------------------------------------------------------ */

test("an external action stays withheld until confirmed", () => {
  const grant = broker("Email this report to Alex.");
  assert.ok(grant.withheldCapabilities.includes("application_action"));
  assert.ok(grant.pendingPermissions.some((item) => item.kind === "confirmation"));
});

test("confirming the gating step releases the capability", () => {
  const first = broker("Email this report to Alex.");
  const confirmation = first.pendingPermissions.find((item) => item.kind === "confirmation");
  const second = broker("Email this report to Alex.", {
    confirmed: [confirmation.id],
  });
  assert.ok(second.grantedCapabilities.includes("application_action"));
});

/* ------------------------------------------------------------------ */
/* Isolation                                                           */
/* ------------------------------------------------------------------ */

test("public Quartz never receives private capability even with grants present", () => {
  const grant = broker("Organize my Downloads folder and fix the failing tests.", {
    surface: "quartz_ai",
    isolated: true,
    grants: [
      grantRoot({
        permissions: { read: true, create: true, modify: true, move: true, delete: true },
      }),
    ],
  });
  const tools = enabledTools(grant);
  for (const forbidden of ["read", "write", "edit", "bash", "task", "skill"]) {
    assert.ok(!tools.includes(forbidden), `${forbidden} must stay off for public Quartz`);
  }
  assert.equal(grant.authorizedRoots.length, 0);
  assert.ok(!allows(grant, "bash", "*"));
});

test("an isolated session still answers from public garden context", () => {
  const grant = broker("What does this page say about modulation?", {
    surface: "quartz_ai",
    isolated: true,
  });
  assert.ok(enabledTools(grant).includes("garden_search"));
});

/* ------------------------------------------------------------------ */
/* Surface parity                                                      */
/* ------------------------------------------------------------------ */

test("the same task and grants yield the same capabilities on every authenticated surface", () => {
  const grants = [
    grantRoot({
      canonicalPath: "/home/me/Documents",
      displayName: "Documents",
      permissions: { read: true },
    }),
  ];
  const request = "Summarize the files in my Documents folder.";
  const surfaces = ["dashboard_terminal", "garden_chat", "quartz_ai"];
  const results = surfaces.map((surface) =>
    broker(request, { surface, grants }).grantedCapabilities.sort().join(","),
  );
  assert.equal(new Set(results).size, 1, `capabilities diverged across surfaces: ${results}`);
  assert.ok(results[0].includes("filesystem_read"));
});

/* ------------------------------------------------------------------ */
/* Permission requests are actionable                                  */
/* ------------------------------------------------------------------ */

test("a spoken alias is resolved to a concrete folder the user can approve", () => {
  const grant = broker("Summarize the files in my Documents folder.");
  const request = grant.pendingPermissions.find((item) => item.kind === "filesystem");
  assert.ok(request.path, "the request must name a folder to approve");
  // "Documents" alone cannot be canonicalized by the grant API, so the broker
  // must resolve the alias to an absolute candidate location.
  assert.ok(
    /[\\/]/.test(request.path),
    `expected an absolute candidate path, got ${request.path}`,
  );
  assert.ok(request.path.toLowerCase().includes("documents"));
});

test("an absolute path in the request is offered verbatim", () => {
  const target = process.platform === "win32" ? "C:\\Work\\Reports" : "/work/reports";
  const grant = broker(`Summarize the files in ${target}`);
  const request = grant.pendingPermissions.find((item) => item.kind === "filesystem");
  assert.equal(request.path, target);
});

test("the requested operations match the capability, not the whole plan", () => {
  const readOnly = broker("Summarize the files in my Documents folder.");
  const readRequest = readOnly.pendingPermissions.find((item) => item.kind === "filesystem");
  assert.deepEqual(readRequest.operations, ["read"]);

  const organize = broker("Organize my Downloads folder by file type.");
  const writeRequest = organize.pendingPermissions.find(
    (item) => item.capability === "filesystem_write",
  );
  // Approving an organize task must not confer deletion.
  assert.ok(!writeRequest.operations.includes("delete"));
  assert.ok(writeRequest.operations.includes("move"));
});

test("summarizeGrant reports goal, capabilities, tools and pending items", () => {
  const grant = broker("Summarize the files in my Documents folder.");
  const summary = summarizeGrant(grant);
  assert.ok(summary.includes("goal:"));
  assert.ok(summary.includes("capabilities:"));
  assert.ok(summary.includes("pending:"));
});
