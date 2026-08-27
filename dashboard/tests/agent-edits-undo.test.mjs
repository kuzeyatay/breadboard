import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const snapshot = await import("../scripts/runtime-v2-agent-edits-executor.mjs");

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-edits-"));
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true });

after(() => fs.rmSync(repo, { recursive: true, force: true }));

const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};

git("init", "--initial-branch=main");
git("config", "user.email", "test@example.test");
git("config", "user.name", "Test");
write("tracked.ts", "export const kept = 1;\n");
write("deleted-by-agent.ts", "export const gone = 1;\n");
write("tracked-but-ignored.env", "committed configuration\n");
write(".gitignore", "ignored/\ntracked-but-ignored.env\n");
git("add", "-A");
git("add", "--force", "tracked-but-ignored.env");
git("commit", "-m", "initial");

test("a coding agent run is bracketed by snapshots of any repository", () => {
  // Work in progress the run must never disturb.
  write("tracked.ts", "export const kept = 1;\nexport const wip = 2;\n");
  write("untracked-note.md", "my own scratch file\n");
  write("ignored/huge.bin", "x".repeat(1024));
  // `git add --force` attempts to index an ignored nested repository and fails
  // when it has no checked-out commit. Real runtime directories can contain this
  // exact shape while dependencies are being installed or updated.
  git("init", "ignored/broken-runtime");
  write("ignored/broken-runtime/runtime-state.txt", "transient\n");
  git("add", "tracked.ts");
  const stagedBefore = git("diff", "--cached", "--name-only").trim();

  const before = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(snapshot.isAgentEditsSnapshotId(before));
  const capturedPaths = git("ls-tree", "-r", "--name-only", before)
    .split("\n")
    .filter(Boolean);
  assert.equal(capturedPaths.some((file) => file.startsWith("ignored/")), false);
  assert.equal(capturedPaths.includes("tracked-but-ignored.env"), true);

  // Simulate a private index poisoned by a pre-fix Breadboard build. A plain
  // `git add` would keep refreshing this cached path despite its ignore rule.
  const privateIndex = git(
    "rev-parse",
    "--git-path",
    "breadboard-agent-edits-index",
  ).trim();
  const privateIndexPath = path.isAbsolute(privateIndex)
    ? privateIndex
    : path.join(repo, privateIndex);
  execFileSync(
    "git",
    ["-C", repo, "add", "--force", "--", "ignored/huge.bin"],
    {
      env: { ...process.env, GIT_INDEX_FILE: privateIndexPath },
      windowsHide: true,
    },
  );
  const migrated = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(snapshot.isAgentEditsSnapshotId(migrated));
  assert.doesNotMatch(
    git("ls-tree", "-r", "--name-only", migrated),
    /^ignored\//m,
  );
  // The agent edits, adds, and deletes.
  write("tracked.ts", "export const kept = 1;\nexport const wip = 2;\nexport const agent = 3;\n");
  write("src/added-by-agent.ts", "export const added = true;\n");
  fs.rmSync(path.join(repo, "deleted-by-agent.ts"));

  const after = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(snapshot.isAgentEditsSnapshotId(after));
  const ref = { before, after };

  const summary = snapshot.summarizeAgentEdits(repo, ref);
  assert.equal(summary.filesChanged, 3);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 1);
  const byPath = new Map(summary.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("tracked.ts").status, "modified");
  assert.equal(byPath.get("src/added-by-agent.ts").status, "added");
  assert.equal(byPath.get("deleted-by-agent.ts").status, "deleted");
  // The user's own untracked file and the ignored path are not the run's work.
  assert.equal(byPath.has("untracked-note.md"), false);
  assert.equal(byPath.has("ignored/huge.bin"), false);

  const patch = snapshot.agentEditPatch(repo, ref, "tracked.ts");
  assert.match(patch, /\+export const agent = 3;/);

  // Snapshotting must leave the user's index and stash untouched.
  assert.equal(git("diff", "--cached", "--name-only").trim(), stagedBefore);
  assert.equal(git("stash", "list").trim(), "");
});

test("undo restores the pre-run tree and keeps later edits", () => {
  const before = snapshot.captureAgentEditsSnapshot(repo);
  write("a.ts", "agent wrote this\n");
  write("b.ts", "agent wrote this too\n");
  const after = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(after);
  const ref = { before, after };

  // The user keeps working on one of the files after the run finished.
  write("b.ts", "and then I edited it myself\n");

  const result = snapshot.undoAgentEdits(repo, ref);
  assert.deepEqual(result.restored, ["a.ts"]);
  assert.deepEqual(result.skipped, ["b.ts"]);
  assert.equal(fs.existsSync(path.join(repo, "a.ts")), false);
  assert.equal(
    fs.readFileSync(path.join(repo, "b.ts"), "utf8"),
    "and then I edited it myself\n",
  );

  // Everything the run never touched survives the undo untouched.
  assert.match(fs.readFileSync(path.join(repo, "tracked.ts"), "utf8"), /export const wip = 2;/);
  assert.equal(
    fs.readFileSync(path.join(repo, "untracked-note.md"), "utf8"),
    "my own scratch file\n",
  );
});

test("undo brings back what the agent modified or deleted", () => {
  const before = snapshot.captureAgentEditsSnapshot(repo);
  const original = fs.readFileSync(path.join(repo, "tracked.ts"), "utf8");
  write("tracked.ts", "agent rewrote the whole file\n");
  fs.rmSync(path.join(repo, "untracked-note.md"));
  const after = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(after);
  const ref = { before, after };

  const result = snapshot.undoAgentEdits(repo, ref);
  assert.equal(result.skipped.length, 0);
  assert.equal(fs.readFileSync(path.join(repo, "tracked.ts"), "utf8"), original);
  // A file that was only ever untracked still comes back.
  assert.equal(
    fs.readFileSync(path.join(repo, "untracked-note.md"), "utf8"),
    "my own scratch file\n",
  );
});

test("a repository without git degrades to no undo instead of failing", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-edits-plain-"));
  try {
    assert.equal(snapshot.captureAgentEditsSnapshot(plain), null);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test("every coding agent brackets its disposable Runtime run and offers the same undo card", () => {
  const source = (relativePath) =>
    fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

  // Next only submits; the disposable worker snapshots before it starts the
  // coding toolchain and withholds terminal delivery until the after snapshot.
  for (const route of ["codex", "opencode", "ruflo"]) {
    const launch = source(`../src/app/api/${route}/runs/route.ts`);
    assert.doesNotMatch(launch, /agent-edits\/snapshot|captureSnapshot|node:child_process/);
    assert.match(launch, /await startRun\(/);
  }
  const adapters = source("../scripts/runtime-v2-outer-agent-adapters.mjs");
  assert.match(adapters, /captureAgentEditsSnapshot\(request\.repositoryPath\)/);
  assert.match(adapters, /withSnapshotReceipt/);
  assert.match(adapters, /terminalIndex >= 0/);
  assert.match(
    source("../src/app/api/codex/runs/route.ts"),
    /edits: agentEditsFromRunEvents\(runEvents\)/,
  );

  // Both coding cards close the bracket and render the shared card. The render
  // falls back to the bracket stored with the turn, so a card whose own
  // finalize call failed (or that mounted before history arrived) still shows
  // the edits.
  for (const card of ["inline-opencode-run", "inline-ruflo-run"]) {
    const widget = source(`../src/app/components/hermes/${card}.tsx`);
    assert.match(widget, /action: "finalize"/);
    assert.match(widget, /agentKind:/);
    assert.match(widget, /edits \?\? persistedEdits/);
    assert.match(widget, /<AgentEditsCard/);
  }

  for (const agent of ["codex", "opencode", "ruflo"]) {
    assert.doesNotMatch(
      source(`../src/lib/${agent}/run-manager.ts`),
      /agent-edits\/snapshot|finalizeRunSnapshot/,
    );
  }

  // The card is repository-agnostic: it only ever names a Garden.
  const editsCard = source("../src/app/components/hermes/agent-edits-card.tsx");
  assert.match(editsCard, /gardenSlug: string;/);
  assert.doesNotMatch(editsCard, /breadboard/i);
  assert.match(editsCard, /action: "undo"/);
  assert.match(editsCard, /Show \{countLabel\(hidden\)\} more/);

  // The endpoint authenticates and submits; only the fixed Runtime worker can
  // import the Git executor or recompute/undo from snapshot refs.
  const api = source("../src/app/api/agent-edits/route.ts");
  assert.match(api, /resolveConnectedRepository\(userId, gardenSlug\.trim\(\)\)\.path/);
  assert.match(api, /runAgentEditsOperation/);
  assert.match(api, /streamAgentEditsArtifact/);
  assert.doesNotMatch(api, /node:child_process|summarizeAgentEdits|undoAgentEdits/);
  assert.match(api, /isSnapshotId\(before\) \|\| !isSnapshotId\(after\)/);
  assert.match(
    source("../scripts/runtime-v2-agent-edits-worker.mjs"),
    /name: "runtime-v2-agent-edits-worker"/,
  );
});

test("every coding agent closes its bracket when the run ends, tab or no tab", () => {
  const source = (relativePath) =>
    fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

  const adapters = source("../scripts/runtime-v2-outer-agent-adapters.mjs");
  for (const agent of ["opencode", "ruflo", "codex"]) {
    const manager = source(`../src/lib/${agent}/run-manager.ts`);
    assert.doesNotMatch(manager, /finalizeRunSnapshot/);
    assert.match(manager, /emit\(run, "run\.aborted"/);
  }
  assert.match(adapters, /const snapshots = codingRunSnapshot/);
  assert.match(adapters, /payload: \{ \.\.\.event\.payload, edits \}/);
  assert.match(adapters, /status: "aborted", edits: snapshots\.finish\(\)/);
});

test("a finished run's bracket is closed once, at the moment it finished", () => {
  const before = snapshot.captureAgentEditsSnapshot(repo);
  write("agent-output.ts", "what the agent wrote\n");

  // The disposable worker takes the after snapshot before publishing terminal.
  const after = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(after);
  const atRunEnd = { before, after };

  // ...so work done afterwards can never be attributed to the run, even when a
  // browser reconnects much later and asks for the same bracket.
  write("my-own-work.ts", "written by me, after the run\n");
  const summary = snapshot.summarizeAgentEdits(repo, atRunEnd);
  assert.deepEqual(
    summary.files.map((file) => file.path),
    ["agent-output.ts"],
  );

  fs.rmSync(path.join(repo, "my-own-work.ts"));
  snapshot.undoAgentEdits(repo, atRunEnd);
});

test("a live database cluster is never part of a run's bracket", () => {
  // A data directory committed to the repository is tracked at HEAD, so no
  // ignore rule can keep it out of a snapshot — and the engine rewrites it on
  // its own schedule while the agent works.
  write("data/pg/PG_VERSION", "17\n");
  write("data/pg/base/1/PG_VERSION", "17\n");
  write("data/pg/.engine-lock/lock", '{"refreshed_at":1}\n');
  write("data/pg/base/1/2608", "a page\n");
  git("add", "-A");
  git("commit", "-m", "commit a live cluster");

  const before = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(snapshot.isAgentEditsSnapshotId(before));
  assert.doesNotMatch(git("ls-tree", "-r", "--name-only", before), /^data\/pg\//m);

  // A heartbeat and a checkpoint land mid-run. Neither is the agent's work.
  write("data/pg/.engine-lock/lock", '{"refreshed_at":2}\n');
  write("data/pg/base/1/2608", "a checkpointed page\n");
  write("real-agent-edit.ts", "what the agent actually wrote\n");

  const after = snapshot.captureAgentEditsSnapshot(repo);
  assert.ok(after);
  const ref = { before, after };
  assert.deepEqual(
    snapshot.summarizeAgentEdits(repo, ref).files.map((file) => file.path),
    ["real-agent-edit.ts"],
  );

  // Undo is therefore structurally unable to write a stale page back under a
  // running engine, which is how a cluster gets corrupted.
  assert.deepEqual(snapshot.undoAgentEdits(repo, ref).restored, ["real-agent-edit.ts"]);
  assert.equal(
    fs.readFileSync(path.join(repo, "data/pg/base/1/2608"), "utf8"),
    "a checkpointed page\n",
  );
});
