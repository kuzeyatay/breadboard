/**
 * Controlled self-heal experiments.
 *
 * Each entry is a small, local, reversible defect seeded into production source
 * inside a disposable worktree, together with the deterministic check that the
 * defect breaks and the regression test the repair must add. None of them touch
 * authentication, capability tokens, the Electron sandbox, permission gates,
 * filesystem trust boundaries, installers, migrations, or provider auth; the
 * repair gate re-checks that independently via `assertSeedablePath`.
 *
 * The seeded defect and its repair are thrown away with the worktree. Nothing
 * here is intended to survive the experiment.
 */

export const EXPERIMENTS = [
  {
    id: "seed-hermes-url-route",
    title: "wrong route construction in the Hermes service URL",
    category: "wrong route construction",
    severity: "P1",
    file: "desktop/src/main/service-definitions.ts",
    allowedPaths: ["desktop/src/main", "desktop/tests"],
    seed: {
      find: "  return `http://127.0.0.1:${config.ports.hermes}`;",
      replace: "  return `http://127.0.0.1/${config.ports.hermes}`;",
    },
    repair: {
      find: "  return `http://127.0.0.1/${config.ports.hermes}`;",
      replace: [
        "  const { hermes } = config.ports;",
        "  return `http://127.0.0.1:${hermes}`;",
      ].join("\n"),
    },
    // The port separator becomes a path segment, so every consumer builds a URL
    // that resolves to port 80 with the real port as a path.
    expectedFailure: /healthCheck\.url|http:\/\/127\.0\.0\.1\/4305|4305\/api\/status/,
    prepare: ["desktop-test-build"],
    scenario: {
      label: "desktop service definitions publish the Hermes readiness URL",
      cwd: ".",
      command: ["--test", "desktop/dist-tests/tests/service-definitions.test.js"],
    },
    relevantChecks: [
      {
        label: "desktop service-definition suite",
        cwd: ".",
        command: ["--test", "desktop/dist-tests/tests/service-definitions.test.js"],
      },
    ],
    regressionTest: {
      path: "desktop/tests/qa-regression-hermes-url.test.ts",
      contents: `import { test } from "node:test";
import assert from "node:assert/strict";
import { hermesServiceUrl } from "../src/main/service-definitions";

// Regression: the port must be a port, not a path segment. A URL built with a
// slash resolves to port 80 and silently probes the wrong server.
test("the Hermes service URL puts the port after a colon", () => {
  const config = { ports: { hermes: 4305 } } as never;
  const url = new URL(hermesServiceUrl(config));
  assert.equal(url.port, "4305");
  assert.equal(url.pathname, "/");
  assert.equal(hermesServiceUrl(config), "http://127.0.0.1:4305");
});
`,
      command: ["--test", "desktop/dist-tests/tests/qa-regression-hermes-url.test.js"],
      cwd: ".",
      prepare: ["desktop-test-build"],
    },
  },

  {
    id: "seed-folder-path-chain",
    title: "incorrect pure-data transformation of a folder path chain",
    category: "incorrect pure-data transformation",
    severity: "P2",
    file: "dashboard/src/lib/cluster-folders.ts",
    allowedPaths: ["dashboard/src/lib", "dashboard/tests"],
    seed: {
      // Each entry becomes the bare segment instead of the path so far, so
      // breadcrumbs and ancestor registration silently lose their prefixes.
      find: "    segments.slice(0, index + 1).join(FOLDER_SEPARATOR),",
      replace: "    segments.slice(index, index + 1).join(FOLDER_SEPARATOR),",
    },
    repair: {
      find: "    segments.slice(index, index + 1).join(FOLDER_SEPARATOR),",
      replace:
        "    segments.filter((_, position) => position <= index).join(FOLDER_SEPARATOR),",
    },
    expectedFailure: /folderPathChain|A\/B/,
    scenario: {
      label: "cluster folder nesting invariants",
      cwd: "dashboard",
      command: ["--test", "--experimental-strip-types", "tests/cluster-folder-nesting.test.mjs"],
    },
    relevantChecks: [
      {
        label: "cluster folder nesting suite",
        cwd: "dashboard",
        command: ["--test", "--experimental-strip-types", "tests/cluster-folder-nesting.test.mjs"],
      },
    ],
    regressionTest: {
      path: "dashboard/tests/qa-regression-folder-path-chain.test.mjs",
      contents: `import assert from "node:assert/strict";
import test from "node:test";
import { folderPathChain } from "../src/lib/cluster-folders.ts";

// Regression: breadcrumbs need every ancestor, not just the leaf.
test("a nested folder path expands to each ancestor in order", () => {
  assert.deepEqual(folderPathChain("A/B/C"), ["A", "A/B", "A/B/C"]);
  assert.deepEqual(folderPathChain("A"), ["A"]);
  assert.deepEqual(folderPathChain(""), []);
});
`,
      command: [
        "--test",
        "--experimental-strip-types",
        "tests/qa-regression-folder-path-chain.test.mjs",
      ],
      cwd: "dashboard",
    },
  },

  {
    id: "seed-garden-rename-nesting",
    title: "garden rename nests the folder under itself instead of renaming it",
    category: "garden rename/persistence logic defect",
    severity: "P1",
    file: "dashboard/src/lib/cluster-folders.ts",
    allowedPaths: ["dashboard/src/lib", "dashboard/tests"],
    seed: {
      find: "  const to = joinFolderPath(folderParent(from), newName);",
      replace: "  const to = joinFolderPath(from, newName);",
    },
    repair: {
      find: "  const to = joinFolderPath(from, newName);",
      replace: [
        "  const parent = folderParent(from);",
        "  const to = joinFolderPath(parent, newName);",
      ].join("\n"),
    },
    expectedFailure: /rename|Physics/i,
    scenario: {
      label: "renaming a nested garden keeps it at the same depth",
      cwd: "dashboard",
      command: ["--test", "--experimental-strip-types", "tests/cluster-folder-nesting.test.mjs"],
    },
    relevantChecks: [
      {
        label: "cluster folder nesting suite",
        cwd: "dashboard",
        command: ["--test", "--experimental-strip-types", "tests/cluster-folder-nesting.test.mjs"],
      },
    ],
    regressionTest: {
      path: "dashboard/tests/qa-regression-folder-rename.test.mjs",
      contents: `import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { renameFolder } from "../src/lib/cluster-folders.ts";

const USER = 1;

function makeDb() {
  const db = new Database(":memory:");
  db.exec(\`
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      folder TEXT
    );
    CREATE TABLE cluster_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER,
      UNIQUE(user_id, name)
    );
  \`);
  return db;
}

// Regression: renaming replaces the last segment. Joining the new name onto the
// full old path would move the garden inside itself and bury every child a
// level deeper on each rename.
test("renaming a nested garden keeps it at the same depth", () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO clusters (user_id, name, slug, folder) VALUES (?, ?, ?, ?)",
  ).run(USER, "rlc", "rlc", "Physics/Notes");

  renameFolder(db, USER, "Physics/Notes", "Lectures");

  const folder = db.prepare("SELECT folder FROM clusters WHERE slug = ?").get("rlc").folder;
  assert.equal(folder, "Physics/Lectures");
  assert.notEqual(folder, "Physics/Notes/Lectures");
});
`,
      command: [
        "--test",
        "--experimental-strip-types",
        "tests/qa-regression-folder-rename.test.mjs",
      ],
      cwd: "dashboard",
    },
  },

  {
    id: "seed-dialog-wrong-handler",
    title: "the new-cluster dialog submit is wired to the wrong local handler",
    category: "deterministic UI action wired to the wrong local handler",
    severity: "P2",
    file: "dashboard/src/app/dashboard/dashboard-client.tsx",
    allowedPaths: ["dashboard/src/app/dashboard", "dashboard/tests"],
    seed: {
      find: "<form onSubmit={handleCreateClusterFolder} className=\"space-y-4\">",
      replace: "<form onSubmit={handleRenameClusterFolder} className=\"space-y-4\">",
    },
    repair: {
      find: "<form onSubmit={handleRenameClusterFolder} className=\"space-y-4\">",
      replace: [
        "{/* Submits through the create handler; rename owns its own dialog. */}",
        "            <form onSubmit={handleCreateClusterFolder} className=\"space-y-4\">",
      ].join("\n"),
    },
    expectedFailure: /handleCreateClusterFolder|onSubmit/,
    scenario: {
      label: "the new-cluster dialog submits through its own handler",
      cwd: "dashboard",
      command: ["--test", "--experimental-strip-types", "tests/cluster-folder-dialog.test.mjs"],
    },
    relevantChecks: [
      {
        label: "cluster folder dialog suite",
        cwd: "dashboard",
        command: ["--test", "--experimental-strip-types", "tests/cluster-folder-dialog.test.mjs"],
      },
    ],
    regressionTest: {
      path: "dashboard/tests/qa-regression-cluster-dialog-handler.test.mjs",
      contents: `import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);

// Regression: the create dialog must submit through the create handler. Wiring
// it to the rename handler silently renames whatever is selected instead.
test("the new-cluster dialog form submits with handleCreateClusterFolder", () => {
  const submits = [...source.matchAll(/<form onSubmit=\\{(handle\\w+)\\}/g)].map(
    (match) => match[1],
  );
  assert.ok(
    submits.includes("handleCreateClusterFolder"),
    \`expected a create-cluster form submit handler, saw: \${submits.join(", ")}\`,
  );
  assert.doesNotMatch(
    source,
    /id="new-cluster-title"[\\s\\S]{0,800}?<form onSubmit=\\{handleRenameClusterFolder\\}/,
  );
});
`,
      command: [
        "--test",
        "--experimental-strip-types",
        "tests/qa-regression-cluster-dialog-handler.test.mjs",
      ],
      cwd: "dashboard",
    },
  },

  {
    id: "seed-readiness-predicate",
    title: "service readiness predicate accepts a failing HTTP status",
    category: "service readiness predicate returning the wrong value",
    severity: "P0",
    file: "desktop/src/main/health-checker.ts",
    allowedPaths: ["desktop/src/main", "desktop/tests"],
    seed: {
      find:
        "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 400;",
      replace:
        "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 600;",
    },
    repair: {
      find:
        "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 600;",
      replace:
        "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status <= 399;",
    },
    expectedFailure: /500|health/i,
    prepare: ["desktop-test-build"],
    scenario: {
      label: "a service returning 500 is never reported ready",
      cwd: ".",
      command: ["--test", "desktop/dist-tests/tests/health-checker.test.js"],
    },
    relevantChecks: [
      {
        label: "desktop health-checker suite",
        cwd: ".",
        command: ["--test", "desktop/dist-tests/tests/health-checker.test.js"],
      },
    ],
    regressionTest: {
      path: "desktop/tests/qa-regression-readiness-predicate.test.ts",
      contents: `import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { runHealthCheck } from "../src/main/health-checker";
import { findFreePort } from "../src/main/ports";

async function withStatus(status: number, run: (port: number) => Promise<void>) {
  const server = http.createServer((_request, response) => {
    response.statusCode = status;
    response.end("body");
  });
  const port = await findFreePort();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Regression: readiness must reject server errors. Treating 5xx as ready lets
// the supervisor declare a broken service healthy and start dependents on it.
test("the readiness predicate rejects 5xx and accepts 2xx/3xx", async () => {
  for (const status of [500, 502, 503]) {
    await withStatus(status, async (port) => {
      assert.equal(
        await runHealthCheck({ type: "http", url: \`http://127.0.0.1:\${port}/\`, timeoutMs: 1000 }),
        false,
        \`status \${status} must not be reported ready\`,
      );
    });
  }
  await withStatus(204, async (port) => {
    assert.equal(
      await runHealthCheck({ type: "http", url: \`http://127.0.0.1:\${port}/\`, timeoutMs: 1000 }),
      true,
    );
  });
});
`,
      command: [
        "--test",
        "desktop/dist-tests/tests/qa-regression-readiness-predicate.test.js",
      ],
      cwd: ".",
      prepare: ["desktop-test-build"],
    },
  },
];

export function experimentById(id) {
  const experiment = EXPERIMENTS.find((entry) => entry.id === id);
  if (!experiment) throw new Error(`Unknown seeded-defect experiment: ${id}`);
  return experiment;
}
