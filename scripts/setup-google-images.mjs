#!/usr/bin/env node
// Prepare the vendored mcp-google-images-search clone so Breadboard's
// `image_search` tool can spawn it as an MCP stdio server.
//
// EXTERNAL PROVISIONING BOUNDARY: this developer/build-time command is never
// imported or launched by Electron or Next. Product setup is an authenticated
// Runtime V2 managed-setup job that builds a copied source closure under the
// Runtime data root; it has no direct-process fallback to this file.
//
// The clone is a pnpm project but has no workspace: dependencies, so npm
// installs it fine (pnpm is not a Breadboard dependency — same doctrine as
// openwork). The upstream `build` script pipes through
// `cat`/`chmod`, which does not exist under cmd.exe, so this uses `build:tsc`
// (tsc + tsc-alias), which emits runnable CommonJS beside the sources —
// `src/index.js` is the entry point Breadboard spawns.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloneRoot = path.join(repoRoot, "mcp-google-images-search");

function run(args, label) {
  console.log(`[google-images] ${label}...`);
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: cloneRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} exited with ${result.status}`);
  }
}

function main() {
  if (!fs.existsSync(path.join(cloneRoot, "package.json"))) {
    throw new Error(`The clone is missing: ${cloneRoot}`);
  }
  if (!fs.existsSync(path.join(cloneRoot, "node_modules"))) {
    run(["install", "--no-audit", "--no-fund"], "installing dependencies");
  }
  run(["run", "build:tsc"], "compiling TypeScript");
  const entry = path.join(cloneRoot, "src", "index.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`Build finished but ${entry} was not produced.`);
  }
  console.log(`[google-images] ready: ${entry}`);
}

main();
