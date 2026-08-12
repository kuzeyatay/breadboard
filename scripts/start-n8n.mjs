#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStatusWriter } from "./voicebox-status.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const n8nRoot = path.resolve(process.env.N8N_SOURCE_DIR?.trim() || path.join(repoRoot, "n8n"));
const runtimeEntry = process.env.N8N_RUNTIME_ENTRY?.trim()
  ? path.resolve(process.env.N8N_RUNTIME_ENTRY.trim())
  : null;
const sourceEntry = path.join(n8nRoot, "packages", "cli", "bin", "n8n");
const serviceEntry = runtimeEntry || sourceEntry;
const serviceRoot = runtimeEntry ? path.resolve(path.dirname(runtimeEntry), "..") : n8nRoot;
const dataDir = path.resolve(process.env.N8N_DATA_DIR?.trim() || path.join(repoRoot, ".runtime", "n8n"));
const statusPath = path.resolve(process.env.N8N_STATUS_PATH?.trim() || path.join(dataDir, "startup-status.json"));
const credentialsPath = path.resolve(process.env.N8N_CREDENTIALS_PATH?.trim() || path.join(dataDir, "breadboard-auth.json"));
const setupLog = path.join(dataDir, "setup.log");
const serviceLogPath = path.join(dataDir, "service.log");
const installMarker = path.join(dataDir, "dependencies-ready");
const corepackBin = path.join(dataDir, "corepack-bin");
const port = /^\d+$/.test(process.env.N8N_PORT ?? "") ? process.env.N8N_PORT : "5678";
const baseUrl = `http://127.0.0.1:${port}`;
const dashboardUrl = process.env.N8N_DASHBOARD_URL?.trim() || "http://127.0.0.1:3000";
const desktopPid = /^\d+$/.test(process.env.BREADBOARD_DESKTOP_PID ?? "")
  ? Number(process.env.BREADBOARD_DESKTOP_PID)
  : null;
const status = createStatusWriter(statusPath, { service: "n8n" });

function resolveCorepackCli() {
  const configured = process.env.COREPACK_CLI?.trim();
  const nodeDirectory = path.dirname(process.execPath);
  const candidates = [
    configured ? path.resolve(configured) : null,
    path.join(nodeDirectory, "node_modules", "corepack", "dist", "corepack.js"),
    path.resolve(nodeDirectory, "..", "lib", "node_modules", "corepack", "dist", "corepack.js"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

if (!fs.existsSync(serviceEntry)) {
  status.write("error", runtimeEntry ? "The bundled n8n runtime was not found." : "The cloned n8n repository was not found.");
  process.stderr.write(runtimeEntry
    ? `[n8n] Expected the bundled n8n entry at ${runtimeEntry}.\n`
    : "[n8n] Expected the cloned n8n checkout at ./n8n.\n");
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(setupLog, `[n8n] Setup started ${new Date().toISOString()}\n`, "utf8");

function loadOrCreateCredentials() {
  try {
    const existing = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    if (existing?.email && existing?.password && existing?.encryptionKey) return existing;
  } catch {
    // Create a new private account below.
  }
  const credentials = {
    version: 1,
    email: "bread@breadboard.local",
    firstName: "Bread",
    lastName: "Board",
    password: `Bread-${crypto.randomBytes(20).toString("base64url")}-7A`,
    encryptionKey: crypto.randomBytes(32).toString("base64url"),
  };
  const temporary = `${credentialsPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(credentials), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, credentialsPath);
  try { fs.chmodSync(credentialsPath, 0o600); } catch { /* Windows ACLs are inherited. */ }
  return credentials;
}

function command(commandName, args, phase, message, extraEnv = {}, displayName = commandName) {
  return new Promise((resolve, reject) => {
    status.write(phase, message);
    const log = fs.openSync(setupLog, "a");
    const child = spawn(commandName, args, {
      cwd: n8nRoot,
      env: {
        ...process.env,
        PATH: [corepackBin, process.env.PATH || process.env.Path || ""].filter(Boolean).join(path.delimiter),
        COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
        ...extraEnv,
      },
      stdio: ["ignore", log, log],
      windowsHide: true,
      shell: false,
    });
    let finished = false;
    const closeLog = () => {
      if (finished) return false;
      finished = true;
      fs.closeSync(log);
      return true;
    };
    child.once("error", (error) => {
      if (!closeLog()) return;
      reject(error);
    });
    child.once("exit", (code) => {
      if (!closeLog()) return;
      if (code === 0) resolve();
      else reject(new Error(`${displayName} exited with code ${code ?? "unknown"}. See ${setupLog}`));
    });
  });
}

function corepack(args, phase, message, extraEnv = {}) {
  const corepackCli = resolveCorepackCli();
  if (!corepackCli) {
    throw new Error(
      "Corepack is unavailable in this Node.js installation. Install Node.js with Corepack or set COREPACK_CLI to corepack.js.",
    );
  }
  return command(
    process.execPath,
    [corepackCli, ...args],
    phase,
    message,
    extraEnv,
    "corepack",
  );
}

function needsBuild() {
  const output = path.join(n8nRoot, "packages", "cli", "dist", "server.js");
  const editor = path.join(n8nRoot, "packages", "frontend", "editor-ui", "dist", "index.html");
  if (!fs.existsSync(output) || !fs.existsSync(editor)) return true;
  const source = path.join(n8nRoot, "packages", "cli", "src", "server.ts");
  return fs.statSync(source).mtimeMs > fs.statSync(output).mtimeMs;
}

function needsInstall() {
  const lockfile = path.join(n8nRoot, "pnpm-lock.yaml");
  if (!fs.existsSync(path.join(n8nRoot, "node_modules", ".pnpm"))) return true;
  if (!fs.existsSync(installMarker)) return true;
  return fs.existsSync(lockfile) && fs.statSync(lockfile).mtimeMs > fs.statSync(installMarker).mtimeMs;
}

const credentials = loadOrCreateCredentials();
try {
  if (!runtimeEntry && !fs.existsSync(path.join(corepackBin, process.platform === "win32" ? "pnpm.CMD" : "pnpm"))) {
    fs.mkdirSync(corepackBin, { recursive: true });
    await corepack(
      ["enable", "--install-directory", corepackBin],
      "preparing",
      "Preparing n8n's pinned package manager.",
    );
  }
  if (!runtimeEntry && needsInstall()) {
    await corepack(
      ["pnpm", "install", "--frozen-lockfile", "--reporter=append-only"],
      "installing",
      "Installing n8n for its first use. This can take several minutes.",
      // The upstream prepare hook installs git hooks by invoking a bare `pnpm`
      // binary, which is intentionally absent when Breadboard uses Corepack.
      // CI is n8n's supported switch for skipping that dev-only hook.
      { CI: "true" },
    );
    fs.writeFileSync(installMarker, new Date().toISOString(), "utf8");
  }
  if (!runtimeEntry && needsBuild()) {
    await corepack(
      ["pnpm", "--filter", "n8n...", "build"],
      "building",
      "Building the local n8n workflow editor for its first use.",
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  status.write(
    "error",
    message.startsWith("Corepack is unavailable")
      ? message
      : "The local workflow service could not finish its first-time setup. Restart Breadboard to try again.",
  );
  process.stderr.write(`[n8n] ${message}\n`);
  process.exit(1);
}

const dashboardOrigins = new Set([dashboardUrl]);
try {
  const parsed = new URL(dashboardUrl);
  if (parsed.hostname === "127.0.0.1") {
    parsed.hostname = "localhost";
    dashboardOrigins.add(parsed.origin);
  } else if (parsed.hostname === "localhost") {
    parsed.hostname = "127.0.0.1";
    dashboardOrigins.add(parsed.origin);
  }
} catch {
  // The dashboard already validates its own URL; keep the single supplied value.
}

status.write("starting", "Starting your private n8n workflow workspace.");
const serviceLog = fs.openSync(serviceLogPath, "a");
const child = spawn(process.execPath, [serviceEntry, "start"], {
  cwd: serviceRoot,
  windowsHide: true,
  stdio: ["ignore", serviceLog, serviceLog],
  env: {
    ...process.env,
    N8N_PORT: port,
    N8N_LISTEN_ADDRESS: "127.0.0.1",
    N8N_HOST: "127.0.0.1",
    N8N_PROTOCOL: "http",
    N8N_EDITOR_BASE_URL: baseUrl,
    N8N_WEBHOOK_URL: `${baseUrl}/`,
    N8N_USER_FOLDER: dataDir,
    N8N_ENCRYPTION_KEY: credentials.encryptionKey,
    N8N_SECURE_COOKIE: "false",
    N8N_SAMESITE_COOKIE: "lax",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_PERSONALIZATION_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_TEMPLATES_ENABLED: "true",
    N8N_UNVERIFIED_PACKAGES_ENABLED: "false",
    N8N_PUSH_BACKEND: "websocket",
    BREADBOARD_EMBEDDED: "true",
    N8N_CONTENT_SECURITY_POLICY: JSON.stringify({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'", "ws:", "wss:", "https:"],
      "worker-src": ["'self'", "blob:"],
      "frame-src": ["'self'", "https:"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-ancestors": [...dashboardOrigins],
    }),
    N8N_POSTMESSAGE_ALLOWED_ORIGINS: [...dashboardOrigins].join(","),
  },
});

let stopped = false;
const desktopWatcher = desktopPid
  ? setInterval(() => {
      try {
        process.kill(desktopPid, 0);
      } catch {
        child.kill("SIGTERM");
      }
    }, 500)
  : null;
desktopWatcher?.unref();

async function watchReadiness() {
  while (!stopped) {
    try {
      const response = await fetch(`${baseUrl}/healthz/readiness`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        status.write("ready", "Your private n8n workflow workspace is ready.");
        return;
      }
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
void watchReadiness();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  stopped = true;
  if (desktopWatcher) clearInterval(desktopWatcher);
  fs.closeSync(serviceLog);
  status.write("error", `n8n failed to start. ${error.message}`);
});
child.once("exit", (code, signal) => {
  stopped = true;
  if (desktopWatcher) clearInterval(desktopWatcher);
  try { fs.closeSync(serviceLog); } catch { /* Closed by the error handler. */ }
  const expected = code === 0 || Boolean(signal);
  status.write(expected ? "stopped" : "error", expected ? "n8n stopped." : `n8n exited with code ${code ?? "unknown"}.`);
  process.exit(code ?? (expected ? 0 : 1));
});
