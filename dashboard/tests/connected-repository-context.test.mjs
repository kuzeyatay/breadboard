// A Garden's connected repository reaches its chat.
//
// Two things are locked here. First, the description a turn is given is read
// from the checkout — git identity, top-level layout, README opening — so the
// same code describes any repository a user connects and nothing about a
// particular repository is written into the source. Second, both chat
// surfaces wire the repository in at the same place (directly after memory),
// select its code-index connection, and the mcp route admits that connection
// by its own rule rather than by a saved MCP row.
//
// Alongside: Garden Chat recovers from a Hermes restart the way the Terminal
// does. Live Hermes sessions are in memory, so the first turn after a restart
// used to end with the gateway's "session not found" as the answer.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const digest = await import("../src/lib/code-index/repository-digest.ts");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function temporaryRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-repo-digest-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["remote", "add", "origin", "https://user:secret-token@example.com/acme/widgets.git"]);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const answer = 42;\n");
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"widgets"}\n');
  fs.writeFileSync(
    path.join(root, "README.md"),
    "# Widgets\n\n![badge](https://img.example/x.svg)\n\nA <b>small</b> library for   widgets.\n\n\n\nMore text.\n",
  );
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "Initial widgets commit"]);
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("the repository description is read from the checkout, not written by hand", () => {
  const repo = temporaryRepository();
  try {
    const described = digest.describeRepository(repo.root, { cache: false });
    assert.ok(described, "a git checkout should be described");
    assert.equal(described.name, path.basename(repo.root));
    assert.equal(described.branch, "main");
    assert.equal(described.head?.subject, "Initial widgets commit");
    assert.match(described.head?.sha ?? "", /^[0-9a-f]{7,}$/);
    assert.match(described.head?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    // Credentials in a remote URL never reach the prompt.
    assert.equal(described.remote, "https://example.com/acme/widgets.git");
    // Directories first with a slash; node_modules and .git are noise.
    assert.deepEqual(described.entries, ["src/", "package.json", "README.md"]);
    assert.equal(described.hiddenEntryCount, 0);
    assert.equal(described.readme?.file, "README.md");
    assert.doesNotMatch(described.readme.excerpt, /<b>|badge\]/);
    assert.match(described.readme.excerpt, /A small library for widgets\./);
  } finally {
    repo.cleanup();
  }
});

test("a folder that is not a git checkout is absent, not an empty repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-not-a-repo-"));
  try {
    assert.equal(digest.describeRepository(root, { cache: false }), null);
    assert.equal(digest.describeRepository(path.join(root, "missing"), { cache: false }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the description is cached briefly and re-read after the window", () => {
  const repo = temporaryRepository();
  try {
    let now = 1_000_000;
    const first = digest.describeRepository(repo.root, { now: () => now });
    git(repo.root, ["commit", "-q", "--allow-empty", "-m", "Second commit"]);
    now += 10_000;
    assert.equal(digest.describeRepository(repo.root, { now: () => now }).head?.subject, first.head?.subject);
    now += 60_000;
    assert.equal(digest.describeRepository(repo.root, { now: () => now }).head?.subject, "Second commit");
  } finally {
    repo.cleanup();
  }
});

const sampleDigest = {
  name: "widgets",
  path: "C:\\code\\widgets",
  branch: "main",
  head: { sha: "abc1234", date: "2026-08-29", subject: "Initial widgets commit" },
  remote: "https://example.com/acme/widgets.git",
  entries: ["src/", "README.md"],
  hiddenEntryCount: 3,
  readme: { file: "README.md", excerpt: "A small library for widgets." },
};
const garden = { slug: "widgets-garden", name: "Widgets" };
const tools = [
  { name: "graft_find_code", description: "Query the repo context graph in plain words." },
  { name: "graft_find_all", description: "Regex search over the graph's indexed files." },
];

test("a ready code index is offered through mcp_call under the repository's own connection", () => {
  const connection = digest.codeIndexConnectionSlug(sampleDigest.path);
  assert.ok(digest.isCodeIndexConnectionSlug(connection));
  assert.ok(!digest.isCodeIndexConnectionSlug("code-index"));
  assert.ok(!digest.isCodeIndexConnectionSlug("code-index-zzzzzzzz"));
  // Different checkouts get different connections, so one session's slug
  // cannot name another repository's index.
  assert.notEqual(connection, digest.codeIndexConnectionSlug("C:\\code\\other"));

  const context = digest.renderConnectedRepositoryContext({
    garden,
    digest: sampleDigest,
    codeIndex: { state: "ready", connection, tools },
  });
  assert.match(context, /^# connected_repository\n/);
  assert.match(context, /"Widgets" \(widgets-garden\) is connected to the local Git repository "widgets" at C:\\code\\widgets/);
  assert.match(context, /Branch: main · HEAD abc1234 \(2026-08-29\) "Initial widgets commit" · origin: https:\/\/example\.com\/acme\/widgets\.git/);
  assert.match(context, /Top level: src\/, README\.md \(\+3 more\)/);
  assert.match(context, /A small library for widgets\./);
  assert.match(context, new RegExp(`connection="${connection}"`));
  assert.match(context, /- graft_find_code — Query the repo context graph/);
  assert.match(context, /Never invent files, symbols or history/);

  const map = digest.codeIndexToolMap(connection, tools);
  assert.deepEqual(map, {
    [`${connection}_graft_find_code`]: true,
    [`${connection}_graft_find_all`]: true,
    mcp_call: true,
  });
  assert.deepEqual(digest.codeIndexToolMap(connection, []), {});
});

test("an index that is not ready is described honestly and offers no tools", () => {
  for (const state of ["building", "missing", "unavailable"]) {
    const context = digest.renderConnectedRepositoryContext({
      garden,
      digest: sampleDigest,
      codeIndex: { state, connection: null, tools: [] },
    });
    assert.doesNotMatch(context, /mcp_call/, `${state} must not offer mcp_call`);
    assert.match(context, /summary above/);
    if (state === "building") assert.match(context, /still being built/);
  }
});

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

const adapter = read("dashboard/src/lib/hermes/garden-chat-adapter.ts");
const turnService = read("dashboard/src/lib/conversations/turn-service.ts");
const mcpRoute = read("dashboard/src/app/api/hermes/tools/mcp/route.ts");
const chatTurn = read("dashboard/src/lib/code-index/chat-turn.ts");

test("both chat surfaces load the connected repository and place it directly after memory", () => {
  for (const [name, source] of [["Garden Chat", adapter], ["Terminal", turnService]]) {
    assert.match(source, /connectedRepositoryForTurn\(\{/, `${name} must load the repository`);
    const memoryAt = source.indexOf("composeMemoryContext(");
    const repositoryAt = source.indexOf("repository?.systemContext");
    assert.ok(memoryAt > 0 && repositoryAt > memoryAt, `${name} must place the repository after memory`);
    assert.match(source, /\.\.\.\(repository\?\.tools \?\? \{\}\)/, `${name} must merge the code-index tools`);
    assert.match(
      source,
      /\.\.\.\(repository\?\.connection \? \[repository\.connection\] : \[\]\)/,
      `${name} must select the code-index connection for the turn`,
    );
  }
  // Nothing about a specific repository is written into the wiring.
  assert.doesNotMatch(chatTurn, /breadboard[\\/]|hermes-agent|dashboard\//i);
});

test("chat answers from the graph as it is and refreshes it in the background", async () => {
  // graft refreshes before answering; on a large drifted repository that is
  // minutes, which is longer than the Hermes plugin waits for a tool (45 s).
  assert.match(chatTurn, /GRAFT_NO_REFRESH: "1"/);
  assert.match(chatTurn, /const CODE_INDEX_CALL_TIMEOUT_MS = 40_000;/);
  assert.match(chatTurn, /refreshGraphInBackground\(connected\.path, env\);/);
  // The stdio transport keeps the SDK's default environment under the switch.
  const proxy = read("dashboard/src/lib/agent-runtime/mcp-proxy.ts");
  assert.match(proxy, /env: \{ \.\.\.getDefaultEnvironment\(\), \.\.\.\(server\.env \?\? \{\}\) \}/);
  // A failed index call tells the model to stop rather than retry.
  assert.match(mcpRoute, /Do not call the code index again this turn/);

  const { refreshGraphInBackground } = await import("../src/lib/code-index/graph-refresh.ts");
  const launched = [];
  let now = 5_000_000;
  const env = { PATH: "", APPDATA: path.join(os.tmpdir(), "no-graft-here") };
  const run = async (command, args, cwd) => {
    launched.push({ command, args, cwd });
  };
  // No graft installed: nothing to launch.
  assert.equal(refreshGraphInBackground("C:\\repo\\a", env, { now: () => now, run }), false);
  const install = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-graft-refresh-"));
  const entry = path.join(install, "npm", "node_modules", "@nanonets", "graft", "dist", "cli.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "// stub\n");
  try {
    const withGraft = { PATH: "", APPDATA: install };
    assert.equal(refreshGraphInBackground("C:\\repo\\a", withGraft, { now: () => now, run }), true);
    assert.equal(launched.length, 1);
    assert.equal(launched[0].command, process.execPath);
    assert.deepEqual(launched[0].args.slice(0, 1), [entry]);
    assert.equal(launched[0].args[1], "--dir");
    assert.deepEqual(launched[0].args.slice(3), ["map", path.resolve("C:\\repo\\a")]);
    // At most one per interval, and never two at once. The stub resolves at
    // once; let the completion chain settle before asking again.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(refreshGraphInBackground("C:\\repo\\a", withGraft, { now: () => now + 60_000, run }), false);
    assert.equal(refreshGraphInBackground("C:\\repo\\a", withGraft, { now: () => now + 11 * 60_000, run }), true);
    assert.equal(launched.length, 2);
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
  }
});

test("the mcp route admits the code index by its own rule, checked against the session's Garden", () => {
  assert.match(mcpRoute, /isCodeIndexConnectionSlug\(slug\)/);
  assert.match(mcpRoute, /codeIndexConnectionForSession\(\{[\s\S]*?gardenSlug: session\.garden_id/);
  // The Breadboard-owned branch runs before the saved-row lookup, which would
  // otherwise refuse it as unavailable.
  assert.ok(
    mcpRoute.indexOf("isCodeIndexConnectionSlug(slug)") <
      mcpRoute.indexOf("listMcpConnections(session.user_id, true).find"),
  );
  // The slug the model used has to be the one derived from the repository the
  // session's Garden is connected to.
  assert.match(chatTurn, /if \(codeIndexConnectionSlug\(connected\.path\) !== input\.slug\) return null;/);
});

test("Garden Chat re-dispatches onto a recreated runtime session when the first dispatch fails", () => {
  assert.match(adapter, /recoverSession: \(\) => Promise<AuthorizedRuntimeSession>/);
  assert.match(adapter, /forceRecreate: true/);
  // The recreated session carries this turn's capability decision before the
  // prompt is re-sent, exactly as startConversationTurn does.
  const recovery = adapter.slice(adapter.indexOf("forceRecreate: true"));
  assert.match(recovery.slice(0, 600), /applyCapabilityDecision\(\{/);
  assert.match(adapter, /conversation\.turn_redispatched/);
  // The retry must address the replacement, never a cached identity.
  assert.match(adapter, /let session = initialSession;/);
  assert.match(adapter, /session = replacement;/);
  // The abandoned first subscription is released before the retry opens its own.
  assert.match(adapter, /attempt\.abort\(\);/);
  // The original failure is what surfaces if recovery itself fails.
  assert.match(adapter, /\} catch \{\s*throw firstError;/);
});
