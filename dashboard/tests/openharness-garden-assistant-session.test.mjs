import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const assistant = read("dashboard/src/app/garden/garden-assistant.tsx");
const adapter = read("dashboard/src/lib/openharness/garden-chat-adapter.ts");

/* ------------------------------------------------------------------ */
/* Session identity                                                    */
/* ------------------------------------------------------------------ */

// The component used to mint `id: Date.now()` into localStorage and POST it as
// `chatSessionId`. The OpenHarness garden adapter authorizes that id against
// chat_sessions(id, user_id, cluster_id), so a timestamp could never match a
// row: every turn failed with `chat_session_not_found` before reaching the
// runtime. Session ids must be server-issued.
test("chat sessions are created server-side, not from a timestamp", () => {
  const createBlock = assistant.slice(
    assistant.indexOf("async function createChatSession"),
    assistant.indexOf("async function persistChatSession"),
  );
  assert.ok(createBlock.length > 0, "createChatSession should still exist");
  assert.doesNotMatch(
    createBlock,
    /id:\s*Date\.now\(\)/,
    "a timestamp must never be used as an authoritative chat session id",
  );
  assert.match(createBlock, /fetch\('\/api\/chat-sessions'/);
  assert.match(createBlock, /method:\s*'POST'/);
});

test("no authoritative timestamp session id remains anywhere in the component", () => {
  // `Date.now()` is still legitimate for prompt ids and elapsed timing; what
  // must not exist is a chat/session id derived from it.
  assert.doesNotMatch(assistant, /id:\s*Date\.now\(\),\s*\n\s*title/);
});

test("locally cached sessions are reconciled against the server", () => {
  assert.match(assistant, /\/api\/chat-sessions\?clusterSlug=/);
  assert.match(assistant, /serverIds/);
  // A cached id the server no longer knows about must not stay selected.
  assert.match(assistant, /serverIds\.has\(current\)/);
});

/* ------------------------------------------------------------------ */
/* Permission request and resumption                                   */
/* ------------------------------------------------------------------ */

test("a blocked turn surfaces an approval prompt instead of a refusal", () => {
  assert.match(assistant, /event\.type === 'permission'/);
  assert.match(assistant, /event\.type === 'blocked'/);
  assert.match(assistant, /setPermissionRequest/);
  assert.match(assistant, /Allow and remember/);
  assert.match(assistant, /Allow once/);
});

test("approving resumes the original task without the user restating it", () => {
  const approveBlock = assistant.slice(
    assistant.indexOf("async function approvePermission"),
    assistant.indexOf("async function handleAttachmentInput"),
  );
  assert.ok(approveBlock.length > 0);
  assert.match(approveBlock, /\/api\/openharness\/filesystem-grants/);
  // The stored request text is re-dispatched, not the composer's current value.
  assert.match(approveBlock, /sendMessage\(request\.originalText, request\.history\)/);
});

test("approval requests only the operations the paused turn needed", () => {
  const approveBlock = assistant.slice(
    assistant.indexOf("async function approvePermission"),
    assistant.indexOf("async function handleAttachmentInput"),
  );
  // Permissions are built from request.operations, so approving a read task
  // cannot silently confer write or delete.
  assert.match(approveBlock, /request\.operations\.map\(\(operation\) => \[operation, true\]\)/);
  assert.doesNotMatch(approveBlock, /delete:\s*true/);
});

test("one-time and remembered scopes are both offered", () => {
  assert.match(assistant, /'remembered'/);
  assert.match(assistant, /'one_time'/);
});

/* ------------------------------------------------------------------ */
/* Server side of the same contract                                    */
/* ------------------------------------------------------------------ */

test("the adapter plans the turn instead of using the legacy surface gate", () => {
  assert.match(adapter, /prepareTurn/);
  assert.doesNotMatch(
    adapter,
    /decideCapabilityMode/,
    "garden chat must no longer use the surface-gated capability policy",
  );
  assert.match(adapter, /listFilesystemGrants/);
});

test("a blocked turn never prompts the model", () => {
  const streamBlock = adapter.slice(adapter.indexOf("if (prepared.blocked)"));
  assert.ok(streamBlock.length > 0, "the adapter should short-circuit a blocked turn");
  // The DONE sentinel is emitted and the stream closed before sendMessage runs,
  // so a turn that cannot act cannot produce prose that sounds like it acted.
  const shortCircuit = streamBlock.slice(0, streamBlock.indexOf("try {"));
  assert.match(shortCircuit, /output\.close\(\)/);
  assert.match(shortCircuit, /return;/);
});

/* ------------------------------------------------------------------ */
/* Surface parity in the wiring, not just in the broker's unit tests    */
/* ------------------------------------------------------------------ */

const terminalRoute = read(
  "dashboard/src/app/api/openharness/sessions/[sessionId]/messages/route.ts",
);
const turnService = read("dashboard/src/lib/conversations/turn-service.ts");

test("the terminal route delegates to the canonical turn planner", () => {
  assert.match(terminalRoute, /startConversationTurn/);
  assert.match(turnService, /prepareTurn/);
  assert.match(turnService, /listFilesystemGrants/);
  assert.doesNotMatch(
    terminalRoute,
    /decideCapabilityMode/,
    "the terminal must no longer use the surface-gated capability policy",
  );
});

const quartzRoute = read("dashboard/src/app/api/quartz-ai/chat/route.ts");

test("the quartz route uses the same planner as the other surfaces", () => {
  assert.match(quartzRoute, /prepareTurn/);
  assert.match(quartzRoute, /startConversationTurn/);
  assert.doesNotMatch(quartzRoute, /decideCapabilityMode/);
  // Both branches (existing session and freshly created session) converted.
  assert.equal((quartzRoute.match(/prepareTurn\(\{/g) ?? []).length, 2);
});

test("quartz isolation keys off authentication, not the surface", () => {
  // An anonymous reader is isolated and contributes no grants; an
  // authenticated reader gets the same capability as any other surface.
  assert.equal((quartzRoute.match(/isolated: userId === null/g) ?? []).length, 2);
  assert.equal(
    (quartzRoute.match(/grants: userId === null \? \[\] : listFilesystemGrants\(userId\)/g) ?? [])
      .length,
    2,
  );
});

test("an anonymous quartz turn cannot reach private capability", async () => {
  const { prepareTurn } = await import("../src/lib/openharness/dispatch-core.ts");
  const prepared = prepareTurn({
    request: "Organize my Downloads folder and fix the failing tests.",
    surface: "quartz_ai",
    userId: null,
    grants: [],
    workspaceRoot: "/ws",
    isolated: true,
  });
  const enabled = Object.entries(prepared.grant.allowedTools)
    .filter(([, on]) => on)
    .map(([tool]) => tool);
  for (const forbidden of ["read", "write", "edit", "bash", "task", "skill"]) {
    assert.ok(!enabled.includes(forbidden), `${forbidden} must stay off for anonymous quartz`);
  }
  assert.equal(prepared.plan.requiresCoding, false);
  assert.equal(prepared.decision.mode, "knowledge");
});

test("an authenticated quartz turn reaches the same capability as the terminal", async () => {
  const { prepareTurn } = await import("../src/lib/openharness/dispatch-core.ts");
  const grants = [
    {
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
      },
      scope: "remembered",
      createdAt: "now",
      revokedAt: null,
    },
  ];
  const forSurface = (surface) =>
    prepareTurn({
      request: "Summarize the files in my Documents folder.",
      surface,
      userId: 1,
      grants,
      workspaceRoot: "/ws",
    }).grant.grantedCapabilities.sort().join(",");

  const quartz = forSurface("quartz_ai");
  assert.equal(quartz, forSurface("dashboard_terminal"));
  assert.equal(quartz, forSurface("garden_chat"));
  assert.ok(quartz.includes("filesystem_read"));
});

test("no surface still imports the legacy capability policy", () => {
  for (const [name, source] of [
    ["garden chat adapter", adapter],
    ["canonical turn service", turnService],
    ["quartz chat route", quartzRoute],
  ]) {
    assert.doesNotMatch(
      source,
      /from "[^"]*capability-policy\.ts"/,
      `${name} should not import capability-policy`,
    );
  }
});

test("both surfaces short-circuit a blocked turn and preserve it for retry", () => {
  assert.match(turnService, /if \(prepared\.blocked\)/);
  assert.match(adapter, /if \(prepared\.blocked\)/);
  // The terminal returns the request so approval can resume it.
  assert.match(turnService, /pendingPermissions: prepared\.pendingPermissions/);
  assert.match(turnService, /request: input\.text/);
});

test("both surfaces apply the brokered tool map through one shared helper", () => {
  for (const source of [adapter, turnService]) {
    assert.match(source, /mergeSelectedTools\(prepared\.grant\.allowedTools/);
    assert.match(source, /from "[^"]*dispatch-core\.ts"/);
  }
  // Exactly one implementation exists, in the shared core.
  const core = read("dashboard/src/lib/openharness/dispatch-core.ts");
  assert.match(core, /export function mergeSelectedTools/);
  assert.doesNotMatch(adapter, /function mergeSelectedTools/);
  assert.doesNotMatch(turnService, /function mergeSelectedTools/);
});

test("the brokered tool map is authoritative over selected tools", async () => {
  const { mergeSelectedTools } = await import(
    "../src/lib/openharness/dispatch-core.ts"
  );
  // A brokered `false` is final: a slash-selected skill or MCP connection can
  // never switch a tool the broker withheld back on.
  const brokered = { read: true, write: false, bash: false };
  const widened = mergeSelectedTools(brokered, { write: true, bash: true });
  assert.equal(widened.write, false);
  assert.equal(widened.bash, false);

  // A selector may narrow.
  const narrowed = mergeSelectedTools(brokered, { read: false });
  assert.equal(narrowed.read, false);

  // A tool the broker does not govern (an MCP server's own namespaced tool)
  // may still be selected.
  const mcp = mergeSelectedTools(brokered, { "github_list_issues": true });
  assert.equal(mcp.github_list_issues, true);
});
