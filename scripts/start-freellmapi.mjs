#!/usr/bin/env node
// Launcher for FreeLLMAPI (tashfeenahmed/freellmapi, MIT), vendored at
// freellmapi/. It pools providers' free tiers behind one OpenAI-compatible
// endpoint; ChatMock registers it as the `freellmapi` provider.
//
// FREELLMAPI_MODE: `optional` (default) starts it and never blocks the stack,
// `disabled` skips it. Loopback only. The bearer ChatMock uses is file-backed
// under FREELLMAPI_HOME, so every launcher on this machine agrees on it.
//
// Provider keys are the user's own: they are added on FreeLLMAPI's Keys page
// (http://127.0.0.1:<port>). Providers that need no account are enabled here.

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";
import { exitIfAlreadyRunning } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);

export const FREELLMAPI_DEFAULT_PORT = "3417";
// Providers FreeLLMAPI serves without any account (`keyless` upstream).
const KEYLESS_PLATFORMS = ["kilo", "ovh", "aihorde"];

export function freellmapiHome() {
  return process.env.FREELLMAPI_HOME?.trim() || path.join(repoRoot, ".runtime", "freellmapi");
}

export function freellmapiPort() {
  return /^\d+$/.test(process.env.FREELLMAPI_PORT ?? "")
    ? process.env.FREELLMAPI_PORT
    : FREELLMAPI_DEFAULT_PORT;
}

/** The loopback bearer; minted once per install. */
export function freellmapiApiKey() {
  if (process.env.FREELLMAPI_API_KEY?.trim()) return process.env.FREELLMAPI_API_KEY.trim();
  const file = path.join(freellmapiHome(), "api-key");
  try {
    const stored = fs.readFileSync(file, "utf8").trim();
    if (stored) return stored;
  } catch {
    // first run
  }
  const key = `freellmapi-${crypto.randomBytes(24).toString("hex")}`;
  fs.mkdirSync(freellmapiHome(), { recursive: true });
  fs.writeFileSync(file, key, { encoding: "utf8", mode: 0o600 });
  return key;
}

const log = (message) => process.stdout.write(`[freellmapi] ${message}\n`);

function npm(args, cwd) {
  // shell: npm is npm.cmd on Windows. Arguments here are fixed strings.
  const result = spawnSync("npm", args, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed`);
}

async function main() {
  if ((process.env.FREELLMAPI_MODE?.trim().toLowerCase() || "optional") === "disabled") {
    log("FREELLMAPI_MODE=disabled; service not started.");
    return;
  }
  const home = freellmapiHome();
  const port = freellmapiPort();
  const key = freellmapiApiKey();
  const origin = `http://127.0.0.1:${port}`;
  const probe = { url: `${origin}/v1/models`, headers: { Authorization: `Bearer ${key}` } };
  await exitIfAlreadyRunning("freellmapi", probe);

  const source = path.join(repoRoot, "freellmapi");
  if (!fs.existsSync(path.join(source, "node_modules"))) {
    log("installing dependencies (first run)");
    npm(["ci", "--no-audit", "--no-fund"], source);
  }
  if (!fs.existsSync(path.join(source, "server", "dist", "index.js"))) {
    log("building server");
    npm(["run", "build", "-w", "server"], source);
  }
  // The dashboard is where provider keys are managed.
  if (!fs.existsSync(path.join(source, "client", "dist", "index.html"))) {
    log("building key manager");
    npm(["run", "build", "-w", "client"], source);
  }

  const dbPath = path.join(home, "freellmapi.db");
  const child = spawn(process.execPath, [path.join(source, "server", "dist", "index.js")], {
    cwd: path.join(source, "server"),
    env: {
      ...process.env,
      PORT: port,
      HOST: "127.0.0.1",
      FREEAPI_DB_PATH: dbPath,
      FREEAPI_CONFIG_JSON: JSON.stringify({
        keys: KEYLESS_PLATFORMS.map((platform) => ({ platform, label: "Breadboard" })),
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) log(line);
    });
  }
  child.on("exit", (code) => {
    log(`exited with code ${code}`);
    process.exit(code ?? 0);
  });
  const shutdown = () => child.killed || child.kill();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", shutdown);

  // FreeLLMAPI mints its own bearer in its database and reads it per request;
  // replace it with ours so ChatMock never has to be told a new secret.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      // Any answer (a 401 included) means the listener and its database are up.
      await fetch(`${origin}/v1/models`, { signal: AbortSignal.timeout(2_000) });
      break;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run(key);
  db.close();
  log(`ready on ${origin} (keys: ${origin})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[freellmapi] ${error instanceof Error ? error.message : error}\n`);
    process.exit(0); // optional service: never fail the stack
  });
}
