// The cloned PenEcho canvas server, supervised as one long-lived local service.
//
// PenEcho is the drawing surface behind the whiteboard cards embedded in garden
// pages. The clone is run as-is (`node server.js`) rather than reimplemented:
// the canvas, its handwriting recognition and its AI command language are the
// product, and a card is a frame around them.
//
// Two things are configured for it here that its own CLI would otherwise ask a
// human for.
//
// Its AI provider is ChatMock, reached as an OpenAI-compatible endpoint — the
// same relay every other Breadboard subsystem talks to, so a whiteboard answers
// on the household model without a second key.
//
// Its first-run access screen is answered by us. PenEcho refuses to serve the
// canvas until someone chooses between "open" and a six-digit PIN, and that
// choice resets with the process. A card cannot show that screen usefully, so
// the launcher binds the server to loopback — where the only reachable clients
// are processes already running as this user — and takes the open branch.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL } from "../ai-models.ts";
import { normalizeChatmockBaseUrl } from "../chatmock-server.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { resolveQuartzBaseUrl } from "../quartz-url.ts";

export interface PenechoService {
  /** Where the canvas server listens, e.g. `http://127.0.0.1:8092`. */
  baseUrl: string;
  /** False when Breadboard only points at a server someone else supervises. */
  managed: boolean;
  startedAt: number;
}

interface ServiceState extends PenechoService {
  child: ChildProcess | null;
  /** Everything the running process baked in at boot, as one comparable string. */
  fingerprint: string;
  /** The tail of the process's own output, so a crash can be explained. */
  readonly log: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardPenechoService?: ServiceState | null;
  __breadboardPenechoStarting?: Promise<PenechoService> | null;
};

const DEFAULT_PORT = 8092;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 300;
const HEALTH_TIMEOUT_MS = 4_000;
const STOP_GRACE_MS = 4_000;

/** The clone, or null when it was never cloned next to the dashboard. */
export function resolvePenechoRoot(): string | null {
  const configured = process.env.PENECHO_ROOT?.trim();
  const root = configured ? path.resolve(configured) : path.join(repositoryRoot(), "penecho");
  return fs.existsSync(path.join(root, "server.js")) ? root : null;
}

function port(): number {
  const configured = Number(process.env.PENECHO_PORT?.trim());
  return Number.isInteger(configured) && configured > 0 && configured <= 65535 ? configured : DEFAULT_PORT;
}

/**
 * Where whiteboard cards point their frames.
 *
 * `PENECHO_URL` names a server Breadboard does not own — a shared instance, or
 * one supervised by the desktop shell — and turns this module into a health
 * check. Without it the service is local, and local means loopback.
 */
export function penechoBaseUrl(): string {
  const configured = (process.env.PENECHO_URL ?? process.env.NEXT_PUBLIC_PENECHO_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${port()}`;
}

function isManaged(): boolean {
  return !(process.env.PENECHO_URL ?? process.env.NEXT_PUBLIC_PENECHO_URL ?? "").trim();
}

/**
 * The origins a whiteboard card can be served from: the garden, where the cards
 * live, and the dashboard. Used both as PenEcho's `frame-ancestors` allowlist —
 * it ships `frame-ancestors 'none'`, so without one a card is a blank frame —
 * and as the CORS allowlist of the route that starts the server.
 */
export function embedOrigins(): string[] {
  const candidates = [
    resolveQuartzBaseUrl(),
    process.env.NEXT_PUBLIC_DASHBOARD_URL,
    process.env.DASHBOARD_URL,
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const parsed = candidates.flatMap((value) => {
    if (!value?.trim()) return [];
    try {
      return [new URL(value.trim()).origin];
    } catch {
      return [];
    }
  });
  return [...new Set(parsed)];
}

function frameAncestors(): string {
  return embedOrigins().join(" ");
}

/**
 * WebP is PenEcho's default encoding for the canvas images it sends the model,
 * and it needs Sharp. The clone runs without installing anything, so when Sharp
 * is absent the server would refuse every AI request; PNG costs bandwidth on a
 * loopback hop and nothing else.
 */
function imageFormat(root: string): "webp" | "png" {
  return fs.existsSync(path.join(root, "node_modules", "sharp")) ? "webp" : "png";
}

function chatmockBaseUrl(): string {
  return (
    normalizeChatmockBaseUrl(process.env.OPENAI_LOCAL_BASE_URL ?? process.env.OPENAI_BASE_URL) ??
    "http://127.0.0.1:8765/v1"
  );
}

function model(): string {
  return process.env.PENECHO_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Canvases, logs and any private plugins the user writes. Breadboard's own
 * runtime directory rather than `~/.penecho`, which a separate install of
 * upstream PenEcho would share, or the checkout, which would leave the user's
 * `git status` dirty after the first stroke.
 */
function stateDirectory(): string {
  const configured = process.env.PENECHO_STATE_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(repositoryRoot(), ".runtime", "penecho");
}

function environment(root: string): Record<string, string> {
  return {
    HOST: "127.0.0.1",
    PORT: String(port()),
    AI_PROVIDER: "api",
    AI_API_FORMAT: "openai",
    AI_API_URL: chatmockBaseUrl(),
    // ChatMock authorizes by account, not by key, but PenEcho refuses to start
    // an API provider without one.
    AI_API_KEY: process.env.OPENAI_API_KEY?.trim() || "chatmock",
    AI_API_MODEL: model(),
    PENECHO_AI_IMAGE_FORMAT: imageFormat(root),
    PENECHO_FRAME_ANCESTORS: frameAncestors(),
    PENECHO_STATE_DIR: stateDirectory(),
  };
}

function fingerprintOf(root: string): string {
  return Object.entries(environment(root))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

async function reachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/config", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Answer PenEcho's first-run access question so a card never has to. Safe to
 * repeat: once the server has an answer it rejects further attempts, and the
 * canvas is already being served by then.
 */
async function unlock(baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  try {
    await fetch(new URL("/api/local-access/open", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ acknowledgeRisk: true }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch {
    // A server that cannot be unlocked still serves its access page, which says
    // more about what to do next than anything this module could report.
  }
}

async function waitForReady(child: ChildProcess, baseUrl: string, readLog: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The PenEcho canvas server exited before it was ready (code ${child.exitCode ?? child.signalCode}). ${lastLines(readLog())}`.trim(),
      );
    }
    if (await reachable(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The PenEcho canvas server did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s. ${lastLines(readLog())}`.trim(),
  );
}

function lastLines(text: string, lines = 6): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

function kill(child: ChildProcess | null): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }, STOP_GRACE_MS);
  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
}

async function start(): Promise<ServiceState> {
  const baseUrl = penechoBaseUrl();

  if (!isManaged()) {
    if (!(await reachable(baseUrl))) {
      throw new Error(`No PenEcho canvas server is answering at ${baseUrl}.`);
    }
    await unlock(baseUrl);
    return {
      baseUrl,
      managed: false,
      startedAt: Date.now(),
      child: null,
      fingerprint: baseUrl,
      log: "",
    };
  }

  const root = resolvePenechoRoot();
  if (!root) throw new Error("The PenEcho clone was not found next to the dashboard.");

  // A server left over from an earlier dashboard process (a dev-server reload,
  // say) already holds the port and is perfectly usable.
  if (await reachable(baseUrl)) {
    await unlock(baseUrl);
    return {
      baseUrl,
      managed: true,
      startedAt: Date.now(),
      child: null,
      fingerprint: fingerprintOf(root),
      log: "",
    };
  }

  fs.mkdirSync(stateDirectory(), { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment(root) },
  });

  let log = "";
  const append = (chunk: Buffer | string) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  try {
    await waitForReady(child, baseUrl, () => log);
  } catch (error) {
    kill(child);
    throw error;
  }
  await unlock(baseUrl);

  const state: ServiceState = {
    baseUrl,
    managed: true,
    startedAt: Date.now(),
    child,
    fingerprint: fingerprintOf(root),
    get log() {
      return log;
    },
  };
  // A process that dies later must not leave a service record the next card
  // trusts. The health check would catch it, but clearing here means the next
  // open starts clean instead of paying a failed probe first.
  child.once("exit", () => {
    if (runtimeGlobal.__breadboardPenechoService === state) {
      runtimeGlobal.__breadboardPenechoService = null;
    }
  });
  return state;
}

/**
 * The running canvas server, started if necessary. Restarts when the process
 * died or when anything it baked in at boot — the model, the allowed framing
 * origins — has changed since.
 */
export async function ensurePenechoService(): Promise<PenechoService> {
  const existing = runtimeGlobal.__breadboardPenechoService;
  const root = resolvePenechoRoot();
  const wanted = isManaged() && root ? fingerprintOf(root) : penechoBaseUrl();
  if (existing) {
    if (
      existing.fingerprint === wanted &&
      (existing.child === null || existing.child.exitCode === null) &&
      (await reachable(existing.baseUrl))
    ) {
      return existing;
    }
    // Only a process this module started is ours to stop.
    if (existing.fingerprint !== wanted) kill(existing.child);
    runtimeGlobal.__breadboardPenechoService = null;
  }

  // Several cards opening at once must not each spawn a server.
  const starting = runtimeGlobal.__breadboardPenechoStarting;
  if (starting) return starting;

  const attempt = start()
    .then((state) => {
      runtimeGlobal.__breadboardPenechoService = state;
      return state;
    })
    .finally(() => {
      runtimeGlobal.__breadboardPenechoStarting = null;
    });
  runtimeGlobal.__breadboardPenechoStarting = attempt;
  return attempt;
}

/**
 * CORS for the whiteboard-card route. Cards are served from the garden origin,
 * so the browser treats every call to the dashboard as cross-origin; the
 * allowlist is the same set of pages that are allowed to frame a board.
 */
export function penechoCorsHeaders(origin: string | null): Record<string, string> {
  const allowlist = embedOrigins();
  const allowed = origin && allowlist.includes(origin) ? origin : allowlist[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/** Whether the canvas server is answering right now, without starting one. */
export async function penechoServiceStatus(): Promise<{
  running: boolean;
  baseUrl: string;
  available: boolean;
}> {
  const baseUrl = penechoBaseUrl();
  return {
    running: await reachable(baseUrl),
    baseUrl,
    available: !isManaged() || resolvePenechoRoot() !== null,
  };
}
