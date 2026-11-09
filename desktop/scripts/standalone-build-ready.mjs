import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// build-dashboard.mjs writes this manifest last: Next emits server.js first,
// then the static and public assets are copied beside it. A server started in
// between answers 404 for every /_next/static asset, so server.js alone does
// not mean the build is servable.
export function standaloneBuildManifest(server) {
  const buildRoot = path.dirname(path.dirname(server));
  return path.basename(buildRoot) === ".next-desktop"
    ? path.join(buildRoot, "breadboard-build-manifest.json")
    : null;
}

export async function waitForCompleteStandaloneBuild(
  server,
  { timeoutMs = 240_000, pollMs = 500, log = () => {} } = {},
) {
  const manifest = standaloneBuildManifest(server);
  if (!manifest) return;
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  while (!fs.existsSync(manifest)) {
    if (Date.now() >= deadline) {
      throw new Error(`standalone dashboard build is still incomplete after ${timeoutMs} ms (no ${manifest})`);
    }
    if (!announced) {
      log(`waiting for the standalone dashboard build to finish (${manifest})`);
      announced = true;
    }
    await sleep(pollMs);
  }
}
