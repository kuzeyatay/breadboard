#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const server = servers[0];
process.chdir(path.dirname(server));
await import(pathToFileURL(server).href);
