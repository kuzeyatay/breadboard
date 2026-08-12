// Build the vendored mem0 OSS engine so the dashboard can import `mem0ai/oss`.
//
// The clone gitignores its own dist/, so a fresh checkout has the sources but
// no bundle, and the semantic memory layer silently stays off (lib/mem0's
// dynamic import fails and every caller degrades to lexical retrieval). This
// script is what turns it on.
//
//   node scripts/setup-mem0.mjs        (or: npm run setup:mem0)
//   node scripts/setup-mem0.mjs --if-needed
//
// `--if-needed` is what the stack launcher runs on every start: it returns
// immediately when the engine is already there, so provisioning can be part of
// starting Breadboard rather than a step a user has to know about. Without it
// the build is unconditional, which is what you want when repairing one.
//
// Two non-obvious steps, both explained where they happen below.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "mem0", "mem0-ts");
const bundle = path.join(packageDir, "dist", "oss", "index.js");
const dashboardDir = path.join(repoRoot, "dashboard");
const onlyIfNeeded = process.argv.includes("--if-needed");

/**
 * Both halves have to hold: the clone must be built, and the dashboard must be
 * able to resolve it. They fail independently — a rebuilt clone with no link,
 * or a link to a clone whose dist/ was cleaned — so asking the dashboard's own
 * resolver is the only answer that matches what the running server will see.
 */
function engineReady() {
  if (!fs.existsSync(bundle)) return false;
  try {
    const resolve = createRequire(path.join(dashboardDir, "package.json"));
    return fs.existsSync(resolve.resolve("mem0ai/oss"));
  } catch {
    return false;
  }
}

if (onlyIfNeeded && engineReady()) {
  console.log("mem0 engine already built; nothing to do.");
  process.exit(0);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}.`);
  }
}

if (!fs.existsSync(packageDir)) {
  const message =
    `The mem0 clone is missing. Expected it at ${packageDir}.\n` +
    "Clone it with: git clone https://github.com/mem0ai/mem0 mem0";
  // On a launch this is a checkout without the vendor clone, not a failure to
  // report: the dashboard stays on lexical recall and says so.
  if (onlyIfNeeded) {
    console.log(`${message}\nSemantic recall stays off until then.`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

console.log("Installing mem0-ts dependencies…");
run("npm", ["install", "--no-fund", "--no-audit"], packageDir);

// tsup emits declarations for every provider in the package, and each provider
// statically imports its SDK's types. Bedrock is the only one whose SDK is not
// already pulled in transitively, so its absence alone fails the .d.ts pass —
// even though nothing here will ever call Bedrock. Installing it unsaved is
// cheaper than patching the clone's build config.
console.log("Adding the type-only dependency the declaration build needs…");
run(
  "npm",
  ["install", "--no-save", "--no-fund", "--no-audit", "@aws-sdk/client-bedrock-runtime"],
  packageDir,
);

console.log("Building mem0-ts…");
run("npx", ["tsup"], packageDir);

if (!fs.existsSync(bundle)) {
  console.error(`The build finished but ${bundle} is missing.`);
  process.exit(1);
}

// The dashboard depends on it as `file:../mem0/mem0-ts`, so npm links the
// directory rather than copying it — a rebuild is picked up without
// reinstalling, but the first install still has to happen.
console.log("Linking mem0ai into the dashboard…");
run("npm", ["install", "--no-fund", "--no-audit", "file:../mem0/mem0-ts"], path.join(repoRoot, "dashboard"));

console.log(
  "\nmem0 is ready. Semantic recall is on by default; enable fact extraction\n" +
    "with BREADBOARD_MEM0_EXTRACTION=on. See docs/MEM0_INTEGRATION.md.",
);
