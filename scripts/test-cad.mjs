#!/usr/bin/env node
// Run the CAD service's Python test suite on its own pinned interpreter.
//
//   npm run test:cad            every test
//   npm run test:cad -- fast    guard + validation only (no geometry builds)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cadPythonPath } from "./setup-cad.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = cadPythonPath(repoRoot);
if (!fs.existsSync(python)) {
  process.stderr.write(
    `[cad] no CAD Python environment at ${python}.\n[cad] Run \`npm run setup:cad\` first.\n`,
  );
  process.exit(1);
}

// The execution tests build real solids through OpenCascade and take minutes;
// `fast` is for the tight loop, the default is what CI and a release check run.
const fast = process.argv.slice(2).includes("fast");
const targets = fast
  ? ["tests.test_guard", "tests.test_validation"]
  : ["discover", "-s", "tests", "-t", "."];

const result = spawnSync(python, ["-m", "unittest", ...targets, "-v"], {
  cwd: path.join(repoRoot, "cad-service"),
  stdio: "inherit",
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
});
process.exit(result.status ?? 1);
