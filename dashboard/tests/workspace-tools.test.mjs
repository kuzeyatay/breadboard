// The workspace build loop, wired as agent tools.
//
// Two halves, following the office suite. The wiring half guards the failure
// this repo has hit before — a tool wired on the Breadboard side but never
// registered with the runtime, so the model is never offered it. The behaviour
// half exercises containment for real, because containment is the entire reason
// these tools exist instead of Hermes's own `file` toolset: those take absolute
// paths and enforce no root, and one of the things sitting in this exact
// directory is the session's live capability token.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WORKSPACE_TOOLS,
  WORKSPACE_WRITE_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import {
  WorkspaceFileError,
  containedWorkspaceFile,
  listWorkspaceFiles,
  patchWorkspaceFile,
  readWorkspaceFile,
  searchWorkspaceFiles,
  writeWorkspaceFile,
  MAX_WRITE_BYTES,
} from "../src/lib/hermes/workspace-files.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeWorkspace() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workspace-tools-test-")));
}

function denies(run, code) {
  assert.throws(run, (error) => error instanceof WorkspaceFileError && error.code === code);
}

// ── wiring ──────────────────────────────────────────────────────────────────

test("the family exposes exactly the intended tools", () => {
  assert.deepEqual([...WORKSPACE_TOOLS].sort(), [
    "workspace_list",
    "workspace_patch",
    "workspace_read",
    "workspace_search",
    "workspace_write",
  ]);
  assert.deepEqual([...WORKSPACE_WRITE_TOOLS].sort(), ["workspace_patch", "workspace_write"]);
});

test("Quartz AI never receives them; the authenticated surfaces do", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of WORKSPACE_TOOLS) {
    assert.ok(!quartz.includes(tool), `quartz_ai must not receive ${tool}`);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of WORKSPACE_TOOLS) {
      assert.ok(allowed.includes(tool), `${surface} should receive ${tool}`);
    }
  }
});

test("every tool is brokered, so none can be inherited by default", () => {
  for (const tool of WORKSPACE_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} must be in BROKERED_TOOLS`);
  }
});

test("every tool is registered with the runtime, in all three places", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const manifestEntries = manifest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  for (const tool of WORKSPACE_TOOLS) {
    assert.ok(manifestEntries.includes(tool), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
  }

  assert.ok(
    plugin.includes('"/api/hermes/tools/workspace"'),
    "workspace has no route in the plugin",
  );
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "workspace", "route.ts"),
    ),
    "the route the plugin posts to must exist",
  );

  // An unrecognized route_kind falls through to a premortem-shaped payload the
  // route does not understand, which would fail only at call time.
  assert.match(
    plugin,
    /route_kind in \{[^}]*"workspace"[^}]*\}/,
    "workspace must produce the {tool, args} payload its route reads",
  );
});

test("Hermes's own unbounded file toolset stays out of the session", () => {
  // The reason this family exists. If `file` is ever added to enabled_toolsets,
  // the model gets read_file/write_file/patch with absolute paths and no root,
  // which is a different product decision than the one this code implements.
  const adapter = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "agent-runtime", "adapters", "hermes.ts"),
    "utf8",
  );
  const declared = /enabled_toolsets:\s*\[([^\]]*)\]/.exec(adapter);
  assert.ok(declared, "the Hermes adapter must declare enabled_toolsets");
  assert.ok(
    !/["']file["']/.test(declared[1]),
    "Hermes's `file` toolset is unbounded by path; workspace_* stands in for it",
  );
});

// ── behaviour: containment ──────────────────────────────────────────────────

test("paths cannot escape the workspace, by traversal or absolutely", () => {
  const workspace = makeWorkspace();
  for (const value of ["../evil.txt", "a/../../evil.txt", "~/evil.txt", "\\\\server\\share\\x"]) {
    denies(() => containedWorkspaceFile(workspace, value), "workspace_path_denied");
  }
  denies(
    () => containedWorkspaceFile(workspace, path.join(os.tmpdir(), "evil.txt")),
    "workspace_path_denied",
  );
});

test("Breadboard's reserved metadata directory is unreachable, not merely hidden", () => {
  // A legacy-looking capability file planted here remains unreachable even
  // though live capability tokens are now minted only from server state.
  const workspace = makeWorkspace();
  fs.mkdirSync(path.join(workspace, ".breadboard"));
  fs.writeFileSync(path.join(workspace, ".breadboard", "capability.json"), '{"token":"secret"}');
  denies(
    () => readWorkspaceFile(workspace, { path: ".breadboard/capability.json" }),
    "workspace_path_denied",
  );
  denies(
    () => writeWorkspaceFile(workspace, { path: ".breadboard/capability.json", content: "x" }),
    "workspace_path_denied",
  );
  const listed = listWorkspaceFiles(workspace, {});
  assert.deepEqual(listed.files, [], "the reserved directory must not be walked");
  const found = searchWorkspaceFiles(workspace, { query: "secret" });
  assert.deepEqual(found.matches, [], "the reserved directory must not be searched");
});

test("a symlink planted inside the workspace cannot be followed out of it", (t) => {
  const workspace = makeWorkspace();
  const outside = makeWorkspace();
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
  // A directory symlink needs developer mode or elevation on Windows; a
  // junction does not, and realpath resolves both, so the escape this guards
  // against gets tested on this platform too.
  const linked = ["dir", "junction"].some((type) => {
    try {
      fs.symlinkSync(outside, path.join(workspace, "link"), type);
      return true;
    } catch {
      return false;
    }
  });
  if (!linked) {
    t.skip("neither symlinks nor junctions are creatable in this environment");
    return;
  }
  denies(() => readWorkspaceFile(workspace, { path: "link/secret.txt" }), "workspace_path_denied");
  assert.deepEqual(listWorkspaceFiles(workspace, {}).files, [], "linked trees are not walked");
});

test("the workspace itself is a directory argument, never a file argument", () => {
  const workspace = makeWorkspace();
  denies(() => readWorkspaceFile(workspace, { path: "." }), "workspace_path_required");
  denies(() => writeWorkspaceFile(workspace, { path: "", content: "x" }), "workspace_argument_missing");
  assert.equal(listWorkspaceFiles(workspace, {}).path, ".");
});

// ── behaviour: the loop ─────────────────────────────────────────────────────

test("write creates parent directories and reports what it did", () => {
  const workspace = makeWorkspace();
  const created = writeWorkspaceFile(workspace, {
    path: "src/main.py",
    content: "print('one')\n",
  });
  assert.equal(created.created, true);
  assert.equal(created.path, "src/main.py");
  assert.equal(fs.readFileSync(path.join(workspace, "src", "main.py"), "utf8"), "print('one')\n");
  const again = writeWorkspaceFile(workspace, { path: "src/main.py", content: "print('two')\n" });
  assert.equal(again.created, false);
});

test("read returns a bounded slice and says how much is left", () => {
  const workspace = makeWorkspace();
  const lines = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`);
  writeWorkspaceFile(workspace, { path: "notes.txt", content: lines.join("\n") });
  const head = readWorkspaceFile(workspace, { path: "notes.txt", limit: 10 });
  assert.equal(head.firstLine, 1);
  assert.equal(head.lines.length, 10);
  assert.equal(head.totalLines, 50);
  assert.equal(head.truncated, true);
  const tail = readWorkspaceFile(workspace, { path: "notes.txt", offset: 45, limit: 10 });
  assert.deepEqual(tail.lines, lines.slice(44));
  assert.equal(tail.truncated, false);
});

test("patch is exact and refuses an ambiguous find rather than guessing", () => {
  const workspace = makeWorkspace();
  writeWorkspaceFile(workspace, { path: "a.py", content: "x = 1\ny = 1\nz = 1\n" });
  denies(() => patchWorkspaceFile(workspace, { path: "a.py", find: "= 1", replace: "= 2" }), "workspace_patch_ambiguous");
  denies(() => patchWorkspaceFile(workspace, { path: "a.py", find: "q = 9", replace: "" }), "workspace_patch_no_match");

  const one = patchWorkspaceFile(workspace, { path: "a.py", find: "y = 1", replace: "y = 42" });
  assert.equal(one.replacements, 1);
  assert.equal(fs.readFileSync(path.join(workspace, "a.py"), "utf8"), "x = 1\ny = 42\nz = 1\n");

  const all = patchWorkspaceFile(workspace, {
    path: "a.py",
    find: "= 1",
    replace: "= 3",
    replaceAll: true,
  });
  assert.equal(all.replacements, 2);
  assert.equal(fs.readFileSync(path.join(workspace, "a.py"), "utf8"), "x = 3\ny = 42\nz = 3\n");
});

test("list filters by glob and search reports path and line", () => {
  const workspace = makeWorkspace();
  writeWorkspaceFile(workspace, { path: "src/a.ts", content: "export const alpha = 1;\n" });
  writeWorkspaceFile(workspace, { path: "src/b.ts", content: "const beta = 2;\n" });
  writeWorkspaceFile(workspace, { path: "readme.md", content: "alpha lives in a.ts\n" });

  assert.deepEqual(
    listWorkspaceFiles(workspace, { glob: "src/**/*.ts" }).files.map((file) => file.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.deepEqual(
    listWorkspaceFiles(workspace, { path: "src" }).files.map((file) => file.path),
    ["src/a.ts", "src/b.ts"],
  );

  const hits = searchWorkspaceFiles(workspace, { query: "alpha" });
  assert.deepEqual(
    hits.matches.map((match) => `${match.path}:${match.line}`).sort(),
    ["readme.md:1", "src/a.ts:1"],
  );
  const scoped = searchWorkspaceFiles(workspace, { query: "alpha", glob: "*.md" });
  assert.deepEqual(scoped.matches.map((match) => match.path), ["readme.md"]);
  denies(() => searchWorkspaceFiles(workspace, { query: "([" }), "workspace_search_invalid");
});

test("binary files are refused rather than mangled, and skipped by search", () => {
  const workspace = makeWorkspace();
  fs.writeFileSync(path.join(workspace, "blob.bin"), Buffer.from([0x68, 0x00, 0x69]));
  denies(() => readWorkspaceFile(workspace, { path: "blob.bin" }), "workspace_file_binary");
  assert.deepEqual(searchWorkspaceFiles(workspace, { query: "h" }).matches, []);
});

test("oversized content is refused before it reaches the plugin's body limit", () => {
  const workspace = makeWorkspace();
  denies(
    () => writeWorkspaceFile(workspace, { path: "big.txt", content: "x".repeat(MAX_WRITE_BYTES + 1) }),
    "workspace_content_too_large",
  );
});

test("a missing file is a 404 the model can act on", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => readWorkspaceFile(workspace, { path: "nope.txt" }),
    (error) => error instanceof WorkspaceFileError && error.status === 404,
  );
});

test("a missing directory is a 404, not a confidently empty listing", () => {
  const workspace = makeWorkspace();
  denies(() => listWorkspaceFiles(workspace, { path: "nope" }), "workspace_directory_not_found");
  denies(
    () => searchWorkspaceFiles(workspace, { path: "nope", query: "x" }),
    "workspace_directory_not_found",
  );
});

test("a file too big for one response is still readable in slices", () => {
  // The write ceiling bounds what the model may send; it must not bound what
  // the model may read, or a file it built in pieces becomes unreadable.
  const workspace = makeWorkspace();
  const line = `${"x".repeat(200)}\n`;
  const big = line.repeat(3_000); // ~600 KB, past MAX_WRITE_BYTES
  fs.writeFileSync(path.join(workspace, "big.txt"), big);

  const head = readWorkspaceFile(workspace, { path: "big.txt", limit: 50 });
  assert.equal(head.lines.length, 50);
  assert.equal(head.totalLines, 3_001);
  assert.equal(head.truncated, true);

  const deep = readWorkspaceFile(workspace, { path: "big.txt", offset: 2_900, limit: 20 });
  assert.equal(deep.firstLine, 2_900);
  assert.equal(deep.lines.length, 20);
});

test("one read cannot exceed the response budget, however many lines are asked for", () => {
  const workspace = makeWorkspace();
  const line = `${"y".repeat(1_000)}\n`;
  fs.writeFileSync(path.join(workspace, "wide.txt"), line.repeat(1_000));
  const read = readWorkspaceFile(workspace, { path: "wide.txt", limit: 1_000 });
  const characters = read.lines.reduce((total, value) => total + value.length, 0);
  assert.ok(characters <= 192 * 1024, `returned ${characters} characters`);
  assert.ok(read.lines.length < 1_000, "the slice must stop short of the requested line count");
  assert.equal(read.truncated, true);
});

test("patching a file larger than the request ceiling is allowed", () => {
  const workspace = makeWorkspace();
  const big = `${"z".repeat(200)}\n`.repeat(3_000);
  fs.writeFileSync(path.join(workspace, "big.txt"), `NEEDLE\n${big}`);
  const patched = patchWorkspaceFile(workspace, {
    path: "big.txt",
    find: "NEEDLE",
    replace: "FOUND",
  });
  assert.equal(patched.replacements, 1);
  assert.ok(patched.bytes > MAX_WRITE_BYTES, "the fixture must exceed the request ceiling");
  assert.match(fs.readFileSync(path.join(workspace, "big.txt"), "utf8"), /^FOUND\n/);
});
