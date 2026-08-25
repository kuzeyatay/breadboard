#!/usr/bin/env node
// Ordered full-stack launcher: providers + local services -> Hermes -> Quartz -> dashboard.

import { spawn } from "node:child_process";
import fsSync, { existsSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDashboardEnv, loadRootEnv } from "./load-root-env.mjs";
import { loadOrCreateScriberrCredentials } from "./prepare-scriberr-runtime.mjs";
import { probeService, WARMING_BUDGET_MS } from "./service-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
// The dashboard's git-ignored .env.local holds server-side service credentials,
// so every runtime child receives the same deployment configuration.
loadDashboardEnv(repoRoot);
const dashboardDir = (...segments) => path.join(repoRoot, "dashboard", ...segments);

const hermesPort = /^\d+$/.test(process.env.HERMES_PORT ?? "") ? process.env.HERMES_PORT : "9129";
const hermesBaseUrl = (process.env.HERMES_BASE_URL || `http://127.0.0.1:${hermesPort}`).replace(/\/+$/, "");
const hermesToken =
  process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim() ||
  crypto.randomBytes(32).toString("hex");
const hermesToolSecret =
  process.env.BREADBOARD_HERMES_TOOL_SECRET?.trim() || hermesToken;
const hermesCapabilitySecret =
  process.env.HERMES_CAPABILITY_SECRET?.trim() ||
  crypto.randomBytes(32).toString("hex");

// GBrain (garden knowledge retrieval). On by default: `preferred` runs but never
// blocks the stack; `required` fails startup if the adapter is not reachable;
// `disabled` must be asked for explicitly and starts nothing. A per-launch
// adapter secret is shared with the dashboard through the environment so the
// browser never sees it.
const gbrainMode = process.env.GBRAIN_MODE?.trim().toLowerCase() || "preferred";
const gbrainEnabled = gbrainMode === "preferred" || gbrainMode === "required";
const gbrainPort = /^\d+$/.test(process.env.GBRAIN_ADAPTER_PORT ?? "") ? process.env.GBRAIN_ADAPTER_PORT : "7717";
const gbrainSecret = process.env.GBRAIN_ADAPTER_SECRET || crypto.randomBytes(24).toString("hex");
const gbrainAdapterUrl = process.env.GBRAIN_ADAPTER_URL || `http://127.0.0.1:${gbrainPort}`;

// Deep Research (iterative web research agent). Optional and never blocking: the
// dashboard reports a specific unavailable/misconfigured state until the service
// is healthy. Its LLM is ChatMock; its search backend is Firecrawl.
const deepResearchMode = process.env.DEEP_RESEARCH_MODE?.trim().toLowerCase() || "optional";
const deepResearchEnabled = deepResearchMode !== "disabled";
const deepResearchPort = /^\d+$/.test(process.env.DEEP_RESEARCH_PORT ?? "")
  ? process.env.DEEP_RESEARCH_PORT
  : "7722";
const deepResearchSecret = process.env.DEEP_RESEARCH_SECRET || crypto.randomBytes(24).toString("hex");
const deepResearchUrl = process.env.DEEP_RESEARCH_URL || `http://127.0.0.1:${deepResearchPort}`;

// Parametric CAD (local CadQuery/OpenCascade service). Optional and never
// blocking: without it the CAD agent reports that the service is not running
// and the rest of Breadboard is unaffected. Its Python environment is
// provisioned separately by `npm run setup:cad`, so a checkout that has not run
// that step simply does not start it.
const cadMode = process.env.CAD_MODE?.trim().toLowerCase() || "optional";
const cadPort = /^\d+$/.test(process.env.BREADBOARD_CAD_PORT ?? "")
  ? process.env.BREADBOARD_CAD_PORT
  : "7731";
const cadServiceUrl = process.env.CAD_SERVICE_URL || `http://127.0.0.1:${cadPort}`;
const cadPythonBinary = path.join(
  repoRoot,
  ".runtime",
  "cad-venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const cadEnabled = cadMode !== "disabled" && existsSync(cadPythonBinary);
// Resolved the same way the dashboard and the service launcher resolve it (a
// file under the CAD home), so a probe can tell our running service from a
// stranger on the port.
const cadSecret = cadEnabled
  ? (
      await import(
        pathToFileURL(path.join(repoRoot, "dashboard", "src", "lib", "cad", "config.ts")).href
      )
    ).cadServiceSecret(process.env)
  : null;
if (cadMode !== "disabled" && !cadEnabled) {
  process.stdout.write(
    "[stack] CAD service not provisioned (run `npm run setup:cad`); the Parametric CAD agent will report it as unavailable.\n",
  );
}

// ColPali (visual page retrieval over attached documents). Optional and never
// blocking: without it an attached document is inlined whole, which is what
// Breadboard did before the service existed. Its Python environment carries
// PyTorch and is provisioned separately by `npm run setup:colpali`, so a
// checkout that has not run that step simply does not start it.
const colpaliMode = process.env.COLPALI_MODE?.trim().toLowerCase() || "auto";
const colpaliPort = /^\d+$/.test(process.env.BREADBOARD_COLPALI_PORT ?? "")
  ? process.env.BREADBOARD_COLPALI_PORT
  : "7733";
const colpaliServiceUrl = process.env.COLPALI_SERVICE_URL || `http://127.0.0.1:${colpaliPort}`;
const colpaliPythonBinary = path.join(
  repoRoot,
  ".runtime",
  "colpali-venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const colpaliEnabled = colpaliMode !== "disabled" && existsSync(colpaliPythonBinary);
const colpaliSecret = colpaliEnabled
  ? (
      await import(
        pathToFileURL(path.join(repoRoot, "dashboard", "src", "lib", "colpali", "config.ts")).href
      )
    ).colpaliServiceSecret(process.env)
  : null;
if (colpaliMode !== "disabled" && !colpaliEnabled) {
  process.stdout.write(
    "[stack] ColPali not provisioned (run `npm run setup:colpali`); attached documents will be inlined whole.\n",
  );
}

// Local text humanizer ("Rewrite naturally" and the /humanize skill). Optional
// and never blocking: without it the action and the skill both report that the
// rewriter is unavailable, and nothing else changes. Its Python environment
// carries PyTorch and is provisioned separately by `npm run setup:humanizer`,
// so a checkout that has not run that step simply does not start it.
const humanizerMode = process.env.HUMANIZER_MODE?.trim().toLowerCase() || "local";
const humanizerPort = /^\d+$/.test(process.env.BREADBOARD_HUMANIZER_PORT ?? "")
  ? process.env.BREADBOARD_HUMANIZER_PORT
  : "7735";
const humanizerServiceUrl =
  process.env.HUMANIZER_SERVICE_URL || `http://127.0.0.1:${humanizerPort}`;
const humanizerPythonBinary = path.join(
  repoRoot,
  ".runtime",
  "humanizer-venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const humanizerProvisioned =
  humanizerMode !== "disabled" && existsSync(humanizerPythonBinary);
const humanizerSecret = humanizerProvisioned
  ? (
      await import(
        pathToFileURL(
          path.join(repoRoot, "dashboard", "src", "lib", "humanizer", "config.ts"),
        ).href
      )
    ).humanizerServiceSecret(process.env)
  : null;
const humanizerEnabled = humanizerProvisioned && humanizerSecret !== null;
if (humanizerMode !== "disabled" && !humanizerEnabled) {
  process.stdout.write(
    humanizerProvisioned
      ? '[stack] Humanizer cannot create its local service secret; "Rewrite naturally" and /humanize will report it as unavailable.\n'
      : '[stack] Humanizer not provisioned (run `npm run setup:humanizer`); "Rewrite naturally" and /humanize will report it as unavailable.\n',
  );
}

// CLIProxyAPI (subscription OAuth: Claude, Gemini, Kimi, Grok). Required by
// default — it is how Breadboard reaches subscription models, so starting the
// stack without it would silently drop every model the user actually pays for.
// `optional` starts it without blocking; `disabled` skips it. Its loopback
// bearer is shared with ChatMock through the environment so the `cliproxy`
// provider works the moment both are up; the key itself is generated per
// install and lives under CLIPROXY_HOME.
const cliproxyMode = process.env.CLIPROXY_MODE?.trim().toLowerCase() || "required";
const cliproxyEnabled = cliproxyMode !== "disabled";
const cliproxyPortValue = /^\d+$/.test(process.env.CLIPROXY_PORT ?? "")
  ? process.env.CLIPROXY_PORT
  : "8317";
const cliproxyBaseUrlValue =
  process.env.CLIPROXY_BASE_URL || `http://127.0.0.1:${cliproxyPortValue}/v1`;
let cliproxyApiKeyValue = process.env.CLIPROXY_API_KEY || "";
if (cliproxyEnabled && !cliproxyApiKeyValue) {
  try {
    const { cliproxyApiKey } = await import(
      pathToFileURL(
        path.join(repoRoot, "dashboard", "src", "lib", "cliproxy", "config.ts"),
      ).href
    );
    cliproxyApiKeyValue = cliproxyApiKey();
  } catch {
    // The service will mint one on first launch; ChatMock picks it up after a
    // restart, and the settings panel can sync it in the meantime.
  }
}

// Video transcription is native and enabled by default. Credentials are
// stable across dev restarts so the private Scriberr account can be registered
// automatically once and reused without exposing a setup UI.
const storedScriberrCredentials = loadOrCreateScriberrCredentials();
const scriberrPort = /^\d+$/.test(process.env.SCRIBERR_PORT ?? "")
  ? process.env.SCRIBERR_PORT
  : "8091";
const scriberrBaseUrl = (process.env.SCRIBERR_BASE_URL || `http://127.0.0.1:${scriberrPort}`).replace(/\/+$/, "");
const scriberrUsername = process.env.SCRIBERR_USERNAME || storedScriberrCredentials.username;
const scriberrPassword = process.env.SCRIBERR_PASSWORD || storedScriberrCredentials.password;
const transcriptionBinDir = path.join(repoRoot, "desktop", "resources", "bin");
const voiceboxPort = /^\d+$/.test(process.env.VOICEBOX_PORT ?? "")
  ? process.env.VOICEBOX_PORT
  : "17493";
const voiceboxBaseUrl = (process.env.VOICEBOX_BASE_URL || `http://127.0.0.1:${voiceboxPort}`).replace(/\/+$/, "");

const runtimeEnv = {
  ...process.env,
  CHATMOCK_BASE_URL: process.env.CHATMOCK_BASE_URL || "http://127.0.0.1:8765/v1",
  CHATMOCK_API_KEY: process.env.CHATMOCK_API_KEY || process.env.OPENAI_API_KEY || "local",
  CHATMOCK_MODEL: process.env.CHATMOCK_MODEL || "default",
  OPENCODE_ENABLE_EXA: process.env.OPENCODE_ENABLE_EXA || "1",
  OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS:
    process.env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS || "true",
  BREADBOARD_DASHBOARD_URL: process.env.BREADBOARD_DASHBOARD_URL || "http://localhost:3000",
  // Hermes loopback wiring. The browser never sees
  // any of this; only the dashboard server and the Hermes child use it.
  HERMES_ENABLED: "true",
  HERMES_MODE: "required",
  HERMES_PORT: hermesPort,
  HERMES_BASE_URL: hermesBaseUrl,
  HERMES_DASHBOARD_SESSION_TOKEN: hermesToken,
  BREADBOARD_HERMES_TOOL_SECRET: hermesToolSecret,
  HERMES_CAPABILITY_SECRET: hermesCapabilitySecret,
  HERMES_ROOT: process.env.HERMES_ROOT || path.join(repoRoot, ".runtime", "hermes-workspaces"),
  HERMES_SKILLS_QUARANTINE:
    process.env.HERMES_SKILLS_QUARANTINE || path.join(repoRoot, ".agents", "skills-quarantine"),
  HERMES_SKILLS_APPROVED:
    process.env.HERMES_SKILLS_APPROVED || path.join(repoRoot, ".agents", "skills"),
  HERMES_SKILLS_CONDITIONAL:
    process.env.HERMES_SKILLS_CONDITIONAL || path.join(repoRoot, ".agents", "skills-conditional"),
  HERMES_FIRST_PARTY_SKILLS_ROOT:
    process.env.HERMES_FIRST_PARTY_SKILLS_ROOT || path.join(repoRoot, "hermes-skills", "prebuilt"),
  // GBrain: mode + the shared per-launch secret + adapter URL flow to both the
  // adapter process and the dashboard so they agree without the browser ever
  // seeing the secret.
  GBRAIN_MODE: gbrainMode,
  GBRAIN_ADAPTER_PORT: gbrainPort,
  GBRAIN_ADAPTER_SECRET: gbrainSecret,
  GBRAIN_ADAPTER_URL: gbrainAdapterUrl,
  // Deep Research: the same per-launch secret reaches the service and the
  // dashboard so they agree without the browser ever seeing it.
  DEEP_RESEARCH_MODE: deepResearchMode,
  DEEP_RESEARCH_PORT: deepResearchPort,
  DEEP_RESEARCH_SECRET: deepResearchSecret,
  DEEP_RESEARCH_URL: deepResearchUrl,
  // Parametric CAD: the loopback address and the per-launch secret reach the
  // service and the dashboard together, so they agree without the browser ever
  // seeing either.
  // No secret here: dashboard/src/lib/cad/config.ts resolves a file-backed one
  // that the service launcher reads too, so a hand-started dashboard finds the
  // service just as this one does.
  BREADBOARD_CAD_PORT: cadPort,
  CAD_SERVICE_URL: cadServiceUrl,
  // ColPali page retrieval. Reported as `disabled` when the environment was
  // never provisioned, so the dashboard stops calling a service that cannot
  // answer instead of waiting for a connection refusal once per question.
  // No secret here either: dashboard/src/lib/colpali/config.ts resolves the
  // same file-backed one the service launcher reads.
  COLPALI_MODE: colpaliEnabled ? "auto" : "disabled",
  BREADBOARD_COLPALI_PORT: colpaliPort,
  COLPALI_SERVICE_URL: colpaliServiceUrl,
  // Local rewriting. `disabled` when the environment was never provisioned, so
  // the status route answers immediately instead of waiting on a connection
  // refusal. No secret here either: dashboard/src/lib/humanizer/config.ts
  // resolves the same file-backed one the service launcher reads.
  HUMANIZER_MODE: humanizerEnabled ? "local" : "disabled",
  BREADBOARD_HUMANIZER_PORT: humanizerPort,
  HUMANIZER_SERVICE_URL: humanizerServiceUrl,
  // Subscription proxy. ChatMock reads CLIPROXY_* as the `cliproxy` provider's
  // endpoint and bearer, so subscription models are reachable as cliproxy/<model>.
  CLIPROXY_MODE: cliproxyMode,
  CLIPROXY_PORT: cliproxyPortValue,
  CLIPROXY_BASE_URL: cliproxyBaseUrlValue,
  ...(cliproxyApiKeyValue ? { CLIPROXY_API_KEY: cliproxyApiKeyValue } : {}),
  // Native video transcription. Binary dependencies are staged locally by
  // start-scriberr.mjs; the dashboard uses these exact paths for probing and
  // YouTube ingestion as well.
  VIDEO_TRANSCRIPTION_ENABLED: process.env.VIDEO_TRANSCRIPTION_ENABLED || "true",
  SCRIBERR_BASE_URL: scriberrBaseUrl,
  SCRIBERR_PORT: scriberrPort,
  SCRIBERR_USERNAME: scriberrUsername,
  SCRIBERR_PASSWORD: scriberrPassword,
  FFMPEG_PATH: process.env.FFMPEG_PATH || path.join(transcriptionBinDir, "ffmpeg.exe"),
  FFPROBE_PATH: process.env.FFPROBE_PATH || path.join(transcriptionBinDir, "ffprobe.exe"),
  YTDLP_PATH: process.env.YTDLP_PATH || path.join(transcriptionBinDir, "yt-dlp.exe"),
  // Voicebox owns local TTS profiles and Whisper dictation. Only the dashboard
  // server receives this URL; browsers use authenticated /api/speech routes.
  VOICEBOX_PORT: voiceboxPort,
  VOICEBOX_BASE_URL: voiceboxBaseUrl,
  VOICEBOX_AUTOINSTALL: process.env.VOICEBOX_AUTOINSTALL || "true",
  VOICEBOX_DATA_DIR:
    process.env.VOICEBOX_DATA_DIR || path.join(repoRoot, ".runtime", "voicebox"),
  VOICEBOX_STATUS_PATH:
    process.env.VOICEBOX_STATUS_PATH ||
    path.join(repoRoot, ".runtime", "voicebox", "startup-status.json"),
};
const children = [];

function prefix(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
  }
}

/**
 * Statuses that mean a gated endpoint accepted our secret: not a 401. A route
 * that does not exist (404), a body it refuses (400), or a method it does not
 * take (405) all prove the request got past the gate.
 */
const AUTHENTICATED = [200, 204, 400, 404, 405];

function startService(name, command, args, options = {}) {
  const child = spawn(command, args, { cwd: repoRoot, env: runtimeEnv, ...options });
  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
  child.on("error", (error) => prefix(name, `failed to start: ${error.message}`));
  children.push(child);
  return child;
}

/**
 * Start a service unless an instance we can use is already answering.
 *
 * The stack is often started on top of itself — a desktop app already running,
 * a previous `npm run dev` that outlived its terminal, a sidecar launched by
 * hand. Spawning the second copy either loses the race for the port or runs a
 * duplicate against the same data, so the probe comes first.
 *
 * Only an instance that answers *our* credentials is reused: the secrets these
 * services share with the dashboard are per-launch unless the environment pins
 * them, and adopting an instance holding a different one would look healthy
 * here and 401 on the first real request. Anything else starts exactly as it
 * did before.
 */
async function startUnlessRunning(name, probe, command, args, options = {}) {
  const target = new URL(probe.url).origin;
  // A service that is up but still compiling answers nothing for a while; the
  // budget waits that out rather than reading the silence as an empty port.
  const state = await probeService(probe, WARMING_BUDGET_MS[name] ?? 0);
  if (state === "running") {
    process.stdout.write(`[stack] ${name} is already running at ${target} — reusing it.
`);
    return null;
  }
  if (state === "foreign") {
    process.stdout.write(
      `[stack] ${target} is held by a process that does not answer as ${name}; starting ours anyway.
`,
    );
  }
  return startService(name, command, args, options);
}

async function waitFor(url, options = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
/**
 * Warn when a desktop stack is already supervising this same checkout.
 *
 * Both launchers run `next dev` plus the same sidecars against the
 * same `dashboard/db`. The desktop supervisor now refuses to adopt an
 * uncontained dashboard, but this early warning remains useful because the
 * existing stack has to be stopped before desktop startup can continue.
 * Advisory only: parallel runs are sometimes deliberate. Shares the record
 * format written by desktop/src/main/dev-instance-lock.ts.
 */
const DEV_INSTANCE_LOCK = path.join(repoRoot, ".runtime", "dev-stack.lock.json");

function claimDevInstanceLock() {
  let existing = null;
  try {
    const parsed = JSON.parse(fsSync.readFileSync(DEV_INSTANCE_LOCK, "utf8"));
    if (parsed && typeof parsed.pid === "number" && typeof parsed.checkout === "string") {
      existing = parsed;
    }
  } catch {
    // Missing or unreadable: no lock.
  }
  const sameCheckout =
    existing !== null && path.resolve(existing.checkout) === path.resolve(repoRoot);
  let alive = false;
  if (sameCheckout && existing.pid !== process.pid) {
    try {
      process.kill(existing.pid, 0);
      alive = true;
    } catch {
      alive = false; // Stale record from a crashed stack; take it over.
    }
  }
  if (alive) {
    process.stdout.write(
      `[stack] WARNING: another Breadboard development stack is already running for this ` +
        `checkout (owner=${existing.owner}, pid=${existing.pid}, started=${existing.startedAt}). ` +
        `Two stacks run two "next dev" servers against the same dashboard/db, and each can grow ` +
        `to several gigabytes. Stop the other stack unless this is deliberate.\n`,
    );
    return;
  }
  try {
    const record = {
      owner: "stack",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      checkout: path.resolve(repoRoot),
    };
    fsSync.mkdirSync(path.dirname(DEV_INSTANCE_LOCK), { recursive: true });
    fsSync.writeFileSync(
      DEV_INSTANCE_LOCK,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  } catch {
    // Advisory only; an unwritable .runtime must not stop the stack.
  }
}

function releaseDevInstanceLock() {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(DEV_INSTANCE_LOCK, "utf8"));
    if (parsed?.pid === process.pid) fsSync.rmSync(DEV_INSTANCE_LOCK, { force: true });
  } catch {
    // Nothing to release.
  }
}

async function main() {
  claimDevInstanceLock();
  // Semantic memory. The vendored mem0 engine is a build, not a service: the
  // clone gitignores its own dist/, so a checkout that has never run the setup
  // step recalls memories by wording alone and only the Settings panel ever
  // says so. Provisioning it here makes it part of starting Breadboard.
  // `--if-needed` returns immediately once it is built, so this costs nothing
  // on every launch after the first, and it is never waited on — the layer
  // degrades truthfully while it builds and picks itself up when it lands.
  const mem0Autosetup = !/^(0|false|no|off)$/i.test(process.env.MEM0_AUTOSETUP?.trim() ?? "");
  if (mem0Autosetup && existsSync(path.join(repoRoot, "mem0", "mem0-ts"))) {
    startService("mem0", process.execPath, [
      path.join(repoRoot, "scripts", "setup-mem0.mjs"),
      "--if-needed",
    ]);
  }

  await startUnlessRunning(
    "chatmock",
    { url: "http://127.0.0.1:8765/health" },
    process.execPath,
    [path.join(repoRoot, "scripts", "start-chatmock.mjs")],
  );
  await waitFor("http://127.0.0.1:8765/health");
  process.stdout.write("[stack] ChatMock healthy\n");

  const voiceboxAutostart = !/^(0|false|no|off)$/i.test(
    process.env.VOICEBOX_AUTOSTART?.trim() ?? "",
  );
  if (voiceboxAutostart) {
    await startUnlessRunning(
      "voicebox",
      { url: `${voiceboxBaseUrl}/health` },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-voicebox.mjs")],
    );
    process.stdout.write(
      `[stack] Voicebox starting on ${voiceboxBaseUrl}; Speech settings reports model readiness.\n`,
    );
  }

  // The CAD service starts alongside the other sidecars. It is never waited on:
  // its first request imports OpenCascade, which takes several seconds, and a
  // readiness gate here would delay the whole stack for a capability most turns
  // never use. The dashboard's /api/cad/health reports the real state.
  if (cadEnabled) {
    await startUnlessRunning(
      "cad",
      {
        url: `${cadServiceUrl}/health`,
        ...(cadSecret ? { headers: { Authorization: `Bearer ${cadSecret}` } } : {}),
      },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-cad.mjs")],
    );
  }

  // ColPali starts alongside the other sidecars and is never waited on. It
  // binds its port immediately but imports nothing heavy until the first
  // request, so a readiness gate here would be a gate on `import torch` —
  // seconds of startup for a capability the first turn may not use. The
  // dashboard's /api/colpali/health reports the real state.
  if (colpaliEnabled) {
    await startUnlessRunning(
      "colpali",
      {
        url: `${colpaliServiceUrl}/health`,
        ...(colpaliSecret ? { headers: { Authorization: `Bearer ${colpaliSecret}` } } : {}),
      },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-colpali.mjs")],
    );
  }

  // The humanizer preloads an installed checkpoint before opening its socket.
  // Waiting for that socket makes model warming part of the stack startup
  // sequence. Missing weights remain an optional health state and do not stop
  // Breadboard from starting.
  if (humanizerEnabled) {
    await startUnlessRunning(
      "humanizer",
      {
        url: `${humanizerServiceUrl}/health`,
        headers: { Authorization: `Bearer ${humanizerSecret}` },
      },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-humanizer.mjs")],
    );
    try {
      await waitFor(
        `${humanizerServiceUrl}/health`,
        { headers: { Authorization: `Bearer ${humanizerSecret}` } },
        180_000,
      );
      process.stdout.write("[stack] Humanizer startup preload complete\n");
    } catch (error) {
      process.stderr.write(
        `[stack] Humanizer did not finish startup; rewriting stays unavailable while the rest of Breadboard starts: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  // GBrain adapter starts before Hermes so knowledge tools are ready when a
  // session opens. In `preferred` a failure is surfaced but non-fatal; in
  // `required` it aborts the stack.
  if (gbrainEnabled) {
    // /health is unauthenticated, so it cannot tell our adapter from one
    // holding a different secret. Every other route is a POST behind the
    // bearer: an empty body reaches the handler only once the secret matched.
    await startUnlessRunning(
      "gbrain",
      {
        url: `${gbrainAdapterUrl}/search`,
        method: "POST",
        body: "{}",
        headers: {
          Authorization: `Bearer ${gbrainSecret}`,
          "Content-Type": "application/json",
        },
        acceptStatuses: AUTHENTICATED,
      },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-gbrain.mjs")],
    );
    try {
      await waitFor(`${gbrainAdapterUrl}/health`, {}, 30_000);
      process.stdout.write("[stack] GBrain adapter healthy\n");
    } catch (error) {
      if (gbrainMode === "required") throw error;
      process.stderr.write(
        `[stack] GBrain adapter unavailable in preferred mode; the dashboard reports a degraded/unavailable knowledge state: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  // Hermes is never a hard dependency of the stack: an unhealthy runtime makes
  // agent routes return the sanitized unavailable error while Gardens and every
  // unrelated feature stay usable (mirrors the desktop supervisor).
  // Hermes's /api/status is a public liveness probe and answers any caller, so
  // it cannot tell our runtime from a desktop app's. Every other /api/ path is
  // gated on the session token before routing: a wrong token is 401, ours falls
  // through to a 404 for this deliberately non-existent path.
  await startUnlessRunning(
    "hermes",
    {
      url: `${hermesBaseUrl}/api/__breadboard_adoption_probe`,
      headers: { Authorization: `Bearer ${hermesToken}` },
      acceptStatuses: AUTHENTICATED,
    },
    process.execPath,
    [path.join(repoRoot, "scripts", "start-hermes.mjs")],
  );
  try {
    await waitFor(`${hermesBaseUrl}/api/status`, {
      headers: { Authorization: `Bearer ${hermesToken}` },
    }, 120_000);
    process.stdout.write(`[stack] Hermes healthy on ${hermesBaseUrl}\n`);
  } catch (error) {
    process.stderr.write(
      `[stack] Hermes unavailable; agent routes report the sanitized runtime-unavailable error until it is up: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  // Scriberr (video transcription) is optional: start it when enabled, but
  // never block the rest of the stack on it — the dashboard reports a specific
  // "Scriberr unavailable" state until it becomes healthy.
  const scriberrAutostart = !/^(0|false|no|off)$/i.test(process.env.SCRIBERR_AUTOSTART?.trim() ?? "");
  if (scriberrAutostart) {
    await startUnlessRunning(
      "scriberr",
      { url: `${scriberrBaseUrl}/health` },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-scriberr.mjs")],
    );
    try {
      await waitFor(`${scriberrBaseUrl}/health`, {}, 30_000);
      process.stdout.write("[stack] Scriberr healthy\n");
    } catch {
      process.stderr.write(
        "[stack] Scriberr not reachable yet; video transcription stays unavailable until it is up.\n",
      );
    }
  }

  // Subscription proxy. The first launch downloads the binary, so allow a
  // generous window before deciding it failed.
  if (cliproxyEnabled) {
    await startUnlessRunning(
      "cliproxy",
      {
        url: `${cliproxyBaseUrlValue}/models`,
        ...(cliproxyApiKeyValue
          ? { headers: { Authorization: `Bearer ${cliproxyApiKeyValue}` } }
          : {}),
      },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-cliproxy.mjs")],
    );
    try {
      // The OpenAI surface is bearer-protected, so the probe must authenticate
      // or it would read a healthy proxy's 401 as "still starting".
      await waitFor(
        `${cliproxyBaseUrlValue}/models`,
        { headers: { Authorization: `Bearer ${cliproxyApiKeyValue}` } },
        90_000,
      );
      process.stdout.write("[stack] subscription proxy healthy\n");
    } catch (error) {
      if (cliproxyMode === "required") throw error;
      process.stderr.write(
        "[stack] subscription proxy not reachable yet; subscription models stay unavailable until it is up.\n",
      );
    }
  }

  // Deep Research is optional in the same sense as Scriberr: start it, but never
  // block the stack — the Agents tab reports why it is not usable until it is up.
  if (deepResearchEnabled) {
    await startUnlessRunning(
      "deep-research",
      { url: `${deepResearchUrl}/health`, expectBodyIncludes: '"engine":"open-deep-research"' },
      process.execPath,
      [path.join(repoRoot, "scripts", "start-deep-research.mjs")],
    );
    try {
      await waitFor(`${deepResearchUrl}/health`, {}, 30_000);
      process.stdout.write("[stack] Deep Research service healthy\n");
    } catch {
      process.stderr.write(
        "[stack] Deep Research not reachable yet; the agent stays unavailable until it is up.\n",
      );
    }
  }

  await startUnlessRunning(
    "quartz",
    { url: "http://127.0.0.1:8081/" },
    process.execPath,
    [path.join(repoRoot, "scripts", "start-quartz.mjs")],
  );
  // Next is launched through Node directly rather than `npm.cmd`: Windows Node
  // (>=20.12) refuses to spawn a .cmd shim without a shell, which threw a
  // synchronous EINVAL and tore the whole stack down. This mirrors how the
  // desktop supervisor starts the same dev server.
  await startUnlessRunning(
    "dashboard",
    { url: "http://127.0.0.1:3000/api/health", expectBodyIncludes: '"status":"ok"' },
    process.execPath,
    [dashboardDir("node_modules", "next", "dist", "bin", "next"), "dev"],
    { cwd: dashboardDir() },
  );
  process.stdout.write("[stack] Agent runtime: Hermes\n");
}

function shutdown() {
  releaseDevInstanceLock();
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((error) => {
  process.stderr.write(`[stack] ${error instanceof Error ? error.message : String(error)}\n`);
  shutdown();
});
