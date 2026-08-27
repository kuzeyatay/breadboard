import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeRepositoryPath,
  validateProcessSources,
} from "./process-source-validation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const hermesRootModules = new Set([
  "batch_runner.py",
  "cli.py",
  "hermes_bootstrap.py",
  "hermes_constants.py",
  "hermes_logging.py",
  "hermes_state.py",
  "hermes_time.py",
  "mcp_serve.py",
  "model_tools.py",
  "run_agent.py",
  "toolset_distributions.py",
  "toolsets.py",
  "trajectory_compressor.py",
  "utils.py",
]);
const sourceRoots = [
  { path: "dashboard/src", include: () => true },
  { path: "desktop/src", include: () => true },
  {
    path: "dashboard/scripts",
    include: (fileName) =>
      !fileName.startsWith("vendor-") &&
      fileName !== "capture-active-run-states.mjs",
  },
  { path: "scripts", include: (fileName) => !fileName.startsWith("test-") },
  { path: "gbrain/src", include: () => true },
  { path: "chatmock/chatmock", include: () => true },
  { path: "cad-service/breadboard_cad", include: () => true },
  { path: "scriberr", include: (fileName) => !fileName.endsWith("_test.go") },
  {
    path: "hermes-agent",
    recursive: false,
    include: (fileName) => hermesRootModules.has(fileName),
  },
  ...[
    "agent",
    "tools",
    "hermes_cli",
    "gateway",
    "tui_gateway",
    "cron",
    "acp_adapter",
    "plugins",
    "providers",
    "scripts/whatsapp-bridge",
  ].map((directory) => ({
    path: `hermes-agent/${directory}`,
    include: () => true,
  })),
  {
    path: "voicebox/backend",
    include: (fileName) => fileName !== "build_binary.py",
  },
  { path: "comfyui", include: () => true },
  { path: "quartz/quartz", include: () => true },
  { path: "OfficeCLI/sdk", include: () => true },
  { path: "OfficeCLI/npm", include: () => true },
  { path: "native/runtime-core/src", include: () => true },
  { path: "native/runtime-cli/src", include: () => true },
  { path: "native/runtime-supervisor/src", include: () => true },
];
const sourceExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".rs",
  ".go",
]);
// Exact audited data-only sources that intentionally contain process-launch
// spellings as security patterns, not executable launch boundaries.
const ignoredFiles = new Set([
  "hermes-agent/plugins/security-guidance/patterns.py",
]);
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".github",
  ".ci",
  ".runtime",
  ".venv",
  "venv",
  ".pytest_cache",
  ".pytest-cache",
  "pytest-of-unknown",
  "vendor",
  "vendor-overrides",
  "__pycache__",
  "test",
  "tests",
  "__tests__",
  "tests-unit",
  "examples",
  "evals",
  "docs",
  "website",
  "build",
  "coverage",
  "dist",
  "target",
  ".next",
  ".turbo",
]);

function isTestSourceFile(fileName) {
  return (
    /(?:\.test|\.spec)\.[^.]+$/iu.test(fileName) ||
    /_test\.go$/iu.test(fileName) ||
    /^(?:test_.+|.+_test)\.py$/iu.test(fileName)
  );
}

function walk({ path: relativeRoot, include, recursive = true }) {
  const absoluteRoot = path.join(root, relativeRoot);
  const pending = [absoluteRoot];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !ignoredDirectories.has(entry.name)) {
          pending.push(absolute);
        }
        continue;
      }
      if (
        !entry.isFile() ||
        !sourceExtensions.has(path.extname(entry.name)) ||
        isTestSourceFile(entry.name) ||
        ignoredFiles.has(
          normalizeRepositoryPath(path.relative(root, absolute)),
        ) ||
        !include(
          entry.name,
          normalizeRepositoryPath(path.relative(root, absolute)),
        )
      ) {
        continue;
      }
      files.push({
        path: normalizeRepositoryPath(path.relative(root, absolute)),
        source: fs.readFileSync(absolute, "utf8"),
      });
    }
  }
  return files;
}

const inventory = JSON.parse(
  fs.readFileSync(
    path.join(root, "qa", "runtime-v2", "execution-inventory.json"),
    "utf8",
  ),
);
const result = validateProcessSources({
  files: sourceRoots.flatMap(walk),
  inventory,
});
const summaryOnly = process.argv.slice(2).includes("--summary");

if (!result.ok) {
  process.stderr.write(
    `[runtime-v2] process-source validation failed (${result.counts.mappedFiles}/${result.counts.processBoundaryFiles} mapped):\n`,
  );
  if (!summaryOnly) {
    for (const error of result.errors) process.stderr.write(`- ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[runtime-v2] process-source validation passed (${result.counts.processBoundaryFiles} process-boundary files mapped).\n`,
  );
}
