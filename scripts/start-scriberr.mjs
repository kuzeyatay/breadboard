#!/usr/bin/env node
// Start Breadboard's private native Scriberr sidecar. It is prepared from an
// official checksum-pinned Windows release and runs entirely on loopback; no
// Docker daemon or separate Scriberr UI is required.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";
import { prepareScriberrRuntime } from "./prepare-scriberr-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);

const port = /^\d+$/.test(process.env.SCRIBERR_PORT ?? "")
  ? process.env.SCRIBERR_PORT
  : "8091";
const baseUrl = (process.env.SCRIBERR_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const parsedBaseUrl = new URL(baseUrl);
const runtimeDir = path.join(repoRoot, ".runtime", "scriberr");
const dataDir = path.join(runtimeDir, "data");
const binDir = path.join(repoRoot, "desktop", "resources", "bin");

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

function nativeEnvironment() {
  const existingPath = process.env.PATH ?? process.env.Path ?? "";
  return {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: parsedBaseUrl.port || port,
    APP_ENV: "production",
    SCRIBERR_LAZY_MODEL_INIT: "true",
    SECURE_COOKIES: "false",
    ALLOWED_ORIGINS:
      process.env.SCRIBERR_ALLOWED_ORIGINS ||
      process.env.BREADBOARD_DASHBOARD_URL ||
      "http://localhost:3000,http://127.0.0.1:3000",
    DATABASE_PATH: path.join(dataDir, "scriberr.db"),
    JWT_SECRET_FILE: path.join(dataDir, "jwt_secret"),
    UPLOAD_DIR: path.join(dataDir, "uploads"),
    TRANSCRIPTS_DIR: path.join(dataDir, "transcripts"),
    TEMP_DIR: path.join(dataDir, "temp"),
    WHISPERX_ENV: path.join(dataDir, "models"),
    FFMPEG_PATH: path.join(binDir, "ffmpeg.exe"),
    FFPROBE_PATH: path.join(binDir, "ffprobe.exe"),
    YTDLP_PATH: path.join(binDir, "yt-dlp.exe"),
    PATH: [binDir, existingPath].filter(Boolean).join(path.delimiter),
  };
}

async function main() {
  if (await isHealthy()) {
    process.stdout.write(`[scriberr] Already running at ${baseUrl}\n`);
    return;
  }
  if (parsedBaseUrl.hostname !== "127.0.0.1" && parsedBaseUrl.hostname !== "localhost") {
    throw new Error(
      `SCRIBERR_BASE_URL points to ${baseUrl}; Breadboard only auto-starts its native loopback service`,
    );
  }

  await prepareScriberrRuntime({ outputDir: binDir });
  fs.mkdirSync(dataDir, { recursive: true });
  const executable = path.join(binDir, "scriberr.exe");
  process.stdout.write(
    `[scriberr] Starting native transcription service at ${baseUrl}. First-run model setup continues in the background.\n`,
  );
  const child = spawn(executable, [], {
    cwd: dataDir,
    env: nativeEnvironment(),
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });

  child.once("error", (error) => {
    process.stderr.write(`[scriberr] Failed to start: ${error.message}\n`);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.once("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

main().catch((error) => {
  process.stderr.write(`[scriberr] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
