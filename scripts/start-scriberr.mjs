#!/usr/bin/env node
// Cross-platform launcher for the local Scriberr transcription service.
//
// Scriberr lives in ./scriberr and runs through Docker locally (its native
// binaries are not built for Windows). This launcher:
//   1. exits quietly when Scriberr is already healthy at SCRIBERR_BASE_URL;
//   2. otherwise starts it via `docker compose`, remapping the container port
//      to SCRIBERR_PORT (default 8091 — port 8080 is taken by Reader locally)
//      using a generated override file so the vendored scriberr/ checkout is
//      never modified;
//   3. prints actionable guidance when Docker is unavailable instead of
//      failing the rest of the stack.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);

const scriberrDir = path.join(repoRoot, "scriberr");
const port = /^\d+$/.test(process.env.SCRIBERR_PORT ?? "")
  ? process.env.SCRIBERR_PORT
  : "8091";
const baseUrl = (process.env.SCRIBERR_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");

if (!existsSync(scriberrDir)) {
  console.error(`Scriberr directory not found at ${scriberrDir}`);
  console.error("Clone/restore the vendored scriberr/ checkout at the repo root.");
  process.exit(1);
}

async function isHealthy() {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return result.status === 0;
}

async function main() {
  if (await isHealthy()) {
    console.log(`[scriberr] Already running at ${baseUrl}`);
    return;
  }

  if (!dockerAvailable()) {
    console.error("[scriberr] Docker is not available (is Docker Desktop running?).");
    console.error(`[scriberr] Start Scriberr manually, then verify ${baseUrl}/health.`);
    console.error("[scriberr] Video transcription in Breadboard will report 'Scriberr unavailable' until it is up.");
    process.exit(1);
  }

  // Override the compose port mapping without touching scriberr/'s own files.
  const runtimeDir = path.join(repoRoot, ".runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const overridePath = path.join(runtimeDir, "scriberr-compose.override.yml");
  writeFileSync(
    overridePath,
    `services:\n  scriberr:\n    ports: !override\n      - "${port}:8080"\n`,
    "utf8",
  );

  const args = [
    "compose",
    "-f",
    path.join(scriberrDir, "docker-compose.yml"),
    "-f",
    overridePath,
    "up",
  ];
  console.log(`[scriberr] Starting via docker ${args.join(" ")}`);
  const child = spawn("docker", args, {
    cwd: scriberrDir,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });

  child.on("error", (error) => {
    console.error(`[scriberr] Failed to start: ${error.message}`);
    process.exit(1);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(`[scriberr] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
