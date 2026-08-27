import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const launcher = await import("../src/lib/code-index/launcher.ts");
const service = await import("../src/lib/code-index/index-service.ts");
const opencode = await import("../src/lib/opencode/run-manager.ts");
const codex = await import("../src/lib/codex/run-manager.ts");

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

function fakeGraftInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-graft-test-"));
  const entry = path.join(
    root,
    "npm",
    "node_modules",
    "@nanonets",
    "graft",
    "dist",
    "cli.js",
  );
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "// test stub\n", "utf8");
  return { root, entry, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("the graft CLI is found through a global install and run with this Node", () => {
  const install = fakeGraftInstall();
  try {
    const resolved = launcher.resolveGraftLauncher({
      PATH: "",
      APPDATA: path.join(install.root),
    });
    assert.ok(resolved, "an APPDATA npm install should resolve");
    assert.equal(resolved.source, install.entry);
    // Never the .cmd shim: modern Node refuses to spawn it without a shell, and
    // a shell would put the repository path through cmd.exe quoting.
    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [install.entry]);

    // The npm bin directory on PATH keeps its packages in a sibling
    // node_modules, which is what makes every version manager resolvable.
    const viaPath = launcher.resolveGraftLauncher({
      PATH: path.join(install.root, "npm"),
    });
    assert.equal(viaPath?.source, install.entry);

    assert.equal(launcher.resolveGraftLauncher({ PATH: "" }), null);
    assert.equal(launcher.graftAvailability({ PATH: "" }).available, false);
  } finally {
    install.cleanup();
  }
});

test("the graph is kept outside the connected repository", () => {
  const home = path.join(os.tmpdir(), "breadboard-graft-home");
  const repository = path.join(os.tmpdir(), "some-project");
  const graphDirectory = service.graftGraphDirectory(repository, {
    BREADBOARD_GRAFT_HOME: home,
  });

  assert.ok(
    graphDirectory.startsWith(path.resolve(home)),
    "the graph belongs under the configured graft home",
  );
  assert.ok(
    !path.resolve(graphDirectory).startsWith(path.resolve(repository) + path.sep),
    "an in-repo graft/ would also write .gitignore and .ignore into the user's tree, and both would land in the run's undo snapshot",
  );
  assert.ok(
    path.basename(graphDirectory).startsWith("some-project-"),
    "the folder stays recognisable",
  );
  // Two checkouts of the same project must not share one graph.
  assert.notEqual(
    graphDirectory,
    service.graftGraphDirectory(path.join(os.tmpdir(), "elsewhere", "some-project"), {
      BREADBOARD_GRAFT_HOME: home,
    }),
  );
});

test("a repository with no graph yet reports missing rather than serving a stale one", () => {
  const env = {
    PATH: "",
    BREADBOARD_GRAFT_HOME: path.join(os.tmpdir(), "breadboard-graft-home"),
  };
  const repository = path.join(os.tmpdir(), "never-indexed-project");
  assert.equal(service.graftIndexExists(repository, env), false);
  // No CLI installed is its own state, and a read never starts a build.
  assert.equal(service.graftIndexState(repository, env), "unavailable");
  assert.equal(service.graftRunContextFor(repository, env), null);
});

test("the MCP server points at the repository and its external graph", () => {
  const install = fakeGraftInstall();
  try {
    const env = {
      PATH: "",
      APPDATA: install.root,
      BREADBOARD_GRAFT_HOME: path.join(os.tmpdir(), "breadboard-graft-home"),
    };
    const repository = path.join(os.tmpdir(), "some-project");
    const server = service.graftServerFor(repository, env);
    assert.ok(server);
    assert.equal(server.command, process.execPath);
    assert.deepEqual(server.args, [
      install.entry,
      "--dir",
      service.graftGraphDirectory(repository, env),
      "mcp",
      path.resolve(repository),
    ]);
  } finally {
    install.cleanup();
  }
});

test("the instruction names the tools and the --dir the CLI fallback needs", () => {
  const instruction = service.graftInstruction({
    repositoryPath: "C:\\work\\project",
    graphDirectory: "C:\\graphs\\project-abc",
  });
  for (const tool of [
    "graft_find_code",
    "graft_find_all",
    "graft_trace_calls",
    "graft_file_api",
    "graft_repo_map",
  ]) {
    assert.ok(instruction.includes(tool), `${tool} should be named`);
  }
  assert.ok(instruction.includes('"C:\\\\graphs\\\\project-abc"'));
  assert.ok(instruction.includes('"C:\\\\work\\\\project"'));
});

test("OpenCode registers graft as a local MCP server alongside its own", () => {
  const base = {
    agent: {
      breadboard: {
        prompt: "You are OpenCode. Call codebase_memory_list_projects once.",
      },
    },
    mcp: {
      codebase_memory: { type: "local", command: ["npx", "codebase-memory-mcp"] },
    },
  };
  const { config, changed } = opencode.withGraftServer(base, {
    command: "node",
    args: ["cli.js", "--dir", "graphs", "mcp", "repo"],
  });
  assert.equal(changed, true);
  assert.deepEqual(config.mcp.graft, {
    type: "local",
    command: ["node", "cli.js", "--dir", "graphs", "mcp", "repo"],
    enabled: true,
    timeout: 120_000,
  });
  assert.ok(config.mcp.codebase_memory, "the existing server survives");
  // The agent's own prompt opens with codebase memory; graft has to be named
  // there too or the habit outlives the new server.
  assert.match(config.agent.breadboard.prompt, /graft tools first/);
  assert.match(
    config.agent.breadboard.prompt,
    /^You are OpenCode\. Call codebase_memory_list_projects once\./,
  );
  assert.equal(
    base.agent.breadboard.prompt,
    "You are OpenCode. Call codebase_memory_list_projects once.",
    "the shared config on disk is never mutated",
  );

  const untouched = opencode.withGraftServer(base, null);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.config, base);
});

test("Codex carries graft as TOML overrides, since it ignores user config", () => {
  const overrides = codex.graftConfigOverrides({
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\npm\\cli.js", "--dir", "C:\\graphs\\p", "mcp", "C:\\work\\p"],
  });
  assert.deepEqual(overrides, [
    "-c",
    'mcp_servers.graft.command="C:\\\\Program Files\\\\nodejs\\\\node.exe"',
    "-c",
    'mcp_servers.graft.args=["C:\\\\npm\\\\cli.js", "--dir", "C:\\\\graphs\\\\p", "mcp", "C:\\\\work\\\\p"]',
    "-c",
    "mcp_servers.graft.startup_timeout_sec=60",
  ]);
  assert.deepEqual(codex.graftConfigOverrides(null), []);
});

test("every coding agent that resolves a connected repository is wired to graft", () => {
  for (const [route, seam] of [
    ["src/app/api/codex/runs/route.ts", "graftEnabled,"],
    ["src/app/api/opencode/runs/route.ts", "graftEnabled,"],
    ["src/app/api/ruflo/runs/route.ts", "graftEnabled,"],
  ]) {
    const text = source(route);
    assert.ok(
      text.includes("resolveConnectedRepository"),
      `${route} should be a connected-repository agent`,
    );
    assert.ok(
      text.includes(seam),
      `${route} should hand its run the garden's graft setting or context`,
    );
  }
  const adapters = source("scripts/runtime-v2-outer-agent-adapters.mjs");
  assert.match(adapters, /graftIndexExists\(request\.repositoryPath\)/);
  assert.match(adapters, /graftServerFor\(request\.repositoryPath\)/);

  const indexService = source("src/lib/code-index/index-service.ts");
  assert.doesNotMatch(indexService, /node:child_process|\bspawn\s*\(/);
  const runtimeBuild = source("src/lib/code-index/runtime-build.ts");
  assert.match(runtimeBuild, /jobType: "graft-index-build"/);
  assert.match(runtimeBuild, /workerKind !== "graft-index-node"/);
  for (const route of [
    "src/app/api/codex/runs/route.ts",
    "src/app/api/opencode/runs/route.ts",
    "src/app/api/ruflo/runs/route.ts",
  ]) {
    assert.match(source(route), /await prepareGraftIndex\(userId, repository\.path\)/);
  }
});

test("the per-garden setting is on by default and survives an older row", () => {
  const clusters = source("src/app/actions/clusters.ts");
  assert.ok(
    clusters.includes("graft_enabled: graftEnabled !== 0"),
    "a null column on a garden created before the migration reads as on",
  );
  const db = source("src/lib/db.ts");
  assert.ok(
    db.includes('"graft_enabled INTEGER NOT NULL DEFAULT 1"'),
    "the column defaults to on for every garden",
  );
  const garden = source("src/lib/code-index/garden.ts");
  assert.ok(
    garden.includes("return row ? row.graft_enabled !== 0 : true"),
    "a missing row reads as the default, not as off",
  );
});
