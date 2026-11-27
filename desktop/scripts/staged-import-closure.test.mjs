import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closeStagedImports } from "./staged-import-closure.mjs";

function tree(root, files) {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
}

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "staged-import-closure-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { repoRoot: path.join(base, "repo"), stagingRoot: path.join(base, "app-services") };
}

test("a staged worker's missing imports are staged from the checkout, transitively", (t) => {
  const { repoRoot, stagingRoot } = fixture(t);
  // 0.1.15: the managed-setup executor imported host-path.mjs, never staged.
  tree(repoRoot, {
    "dashboard/scripts/host-path.mjs": `import { x } from "../src/lib/external-runtime-path.ts"; export const y = x;`,
    "dashboard/src/lib/external-runtime-path.ts": `export const x = 1;`,
  });
  tree(stagingRoot, {
    "dashboard/scripts/runtime-v2-managed-setup-executor.mjs": `import { y } from "./host-path.mjs";\n// import "./commented-out.mjs";\nexport default y;`,
  });
  const result = closeStagedImports({ repoRoot, stagingRoot, entryDirectories: ["dashboard/scripts"] });
  assert.deepEqual(result.added, ["dashboard/scripts/host-path.mjs", "dashboard/src/lib/external-runtime-path.ts"]);
  assert.ok(fs.existsSync(path.join(stagingRoot, "dashboard/src/lib/external-runtime-path.ts")));
  assert.deepEqual(result.unresolvedBare, []);
});

test("an import missing from the checkout too is reported, not invented", (t) => {
  const { repoRoot, stagingRoot } = fixture(t);
  fs.mkdirSync(repoRoot, { recursive: true });
  tree(stagingRoot, { "scripts/a.mjs": `import "./gone.mjs";` });
  const result = closeStagedImports({ repoRoot, stagingRoot, entryDirectories: ["scripts"] });
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.missingEverywhere, ["./gone.mjs <- scripts/a.mjs"]);
});

test("mirrored trees copy into themselves and path-spawned workers are followed", (t) => {
  const { repoRoot, stagingRoot } = fixture(t);
  // worker-src is the checkout's dashboard/src; it spawns ../../../scripts/x.
  tree(repoRoot, {
    "dashboard/scripts/runtime-v2-anydoc-pdf-worker.mjs": `import { convert } from "../src/lib/anydoc/convert.ts"; convert();`,
    "dashboard/src/lib/anydoc/convert.ts": `import "@firecrawl/anydoc"; export const convert = () => 0;`,
  });
  tree(stagingRoot, {
    "dashboard-standalone/dashboard/worker-src/lib/runtime-v2/ingest-executor.ts":
      `const worker = new URL("../../../scripts/runtime-v2-anydoc-pdf-worker.mjs", import.meta.url);`,
    "dashboard-standalone/dashboard/node_modules/@firecrawl/anydoc/package.json": `{"name":"@firecrawl/anydoc"}`,
  });
  const result = closeStagedImports({
    repoRoot,
    stagingRoot,
    entryDirectories: ["dashboard-standalone/dashboard/worker-src/**"],
    mirrors: [
      ["dashboard-standalone/dashboard/worker-src", "dashboard/src"],
      ["dashboard-standalone/dashboard", "dashboard"],
    ],
  });
  assert.deepEqual(result.added, [
    "dashboard-standalone/dashboard/scripts/runtime-v2-anydoc-pdf-worker.mjs",
    "dashboard-standalone/dashboard/src/lib/anydoc/convert.ts",
  ]);
  // The package resolves from the standalone tree it was staged into.
  assert.deepEqual(result.unresolvedBare, []);
});

test("imports inside generated-source template strings and comments are not dependencies", (t) => {
  const { repoRoot, stagingRoot } = fixture(t);
  fs.mkdirSync(repoRoot, { recursive: true });
  tree(stagingRoot, {
    "dashboard/src/lib/remotion/service.ts":
      "/* import \"./a\"; */\n// import \"./b\";\nexport const entry = () => `import Video from \"./Video\";\\nimport x from \"remotion\";`;\nconst re = /[\"']/u;\n",
  });
  const result = closeStagedImports({ repoRoot, stagingRoot, entryDirectories: ["dashboard/src/lib/remotion"] });
  assert.deepEqual(result, { added: [], unresolvedBare: [], missingEverywhere: [] });
});

test("dashboard aliases resolve against the nearest source root", (t) => {
  const { repoRoot, stagingRoot } = fixture(t);
  tree(repoRoot, { "dashboard/src/lib/b.ts": "export const b = 1;" });
  tree(stagingRoot, {
    "dashboard-standalone/dashboard/worker-src/lib/a.ts": `import "server-only"; import { b } from "@/lib/b";`,
  });
  const result = closeStagedImports({
    repoRoot,
    stagingRoot,
    entryDirectories: ["dashboard-standalone/dashboard/worker-src/**"],
    mirrors: [["dashboard-standalone/dashboard/worker-src", "dashboard/src"]],
  });
  assert.deepEqual(result.added, ["dashboard-standalone/dashboard/worker-src/lib/b.ts"]);
});

test("a package import that will not resolve where it is installed is reported", (t) => {
  const { repoRoot, stagingRoot } = fixture(t);
  fs.mkdirSync(repoRoot, { recursive: true });
  tree(stagingRoot, {
    "dashboard/scripts/a.mjs": `import fs from "node:fs"; import path from "path"; import { z } from "zod"; import x from "missing-pkg/sub";`,
    "dashboard/node_modules/zod/package.json": `{"name":"zod"}`,
  });
  const result = closeStagedImports({ repoRoot, stagingRoot, entryDirectories: ["dashboard/scripts"] });
  assert.deepEqual(result.unresolvedBare, ["missing-pkg <- dashboard/scripts/a.mjs"]);
});
