#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sourceRepairRelease } from "./source-repair-release.mjs";

// Keep one manifest entrypoint relative to appRoot in both supported layouts:
//   dev:      <repo>/dashboard/scripts/this-file
//   packaged: <resources>/app-services/dashboard/scripts/this-file
// The selected server is always the already-built standalone dashboard. This
// launcher never falls back to Next dev or starts a compiler.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(scriptDirectory, "..", ".next-desktop", "standalone", "server.js"),
  path.resolve(
    scriptDirectory,
    "..",
    "..",
    "dashboard-standalone",
    "dashboard",
    "server.js",
  ),
];
const servers = candidates.filter((candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
});
if (servers.length !== 1) {
  process.stderr.write(
    `[runtime-v2-dashboard] expected exactly one staged standalone server; found ${servers.length}\n`,
  );
  process.exit(78);
}

const release = await sourceRepairRelease();
const server = release ? path.join(release.root, "dashboard", ".next-desktop", "standalone", "server.js") : servers[0];
process.env.BREADBOARD_SOURCE_RELEASE_ID = release?.id ?? "";
if (release) {
  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = path.join(release.root, "dashboard");
  process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = path.join(release.root, "dashboard");
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(release.root, "dashboard", "src");
}
// Rust's canonical paths include the Windows namespace; Node's realpath omits
// it. Keep dashboard data paths in Node's spelling, including in existing
// standalone builds whose artifact guards compare canonical paths directly.
for (const name of ["BREADBOARD_DATA_DIR", "BREADBOARD_REPO_ROOT"]) {
  const configured = process.env[name]?.trim();
  if (configured && process.platform === "win32") {
    process.env[name] = fs.realpathSync.native(configured);
  }
}
process.chdir(path.dirname(server));
await import(pathToFileURL(server).href);
