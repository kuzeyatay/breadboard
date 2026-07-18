// Server-only configuration for the OpenHarness integration.
//
// OpenHarness is the interactive agent runtime that backs the three Breadboard
// interactive surfaces (dashboard terminal, garden chat, Quartz page AI). It is
// a separate local process (a renamed OpenCode fork) that Breadboard talks to
// exclusively from the server. None of this may ever reach the browser: the
// base URL, credentials, and workspace roots stay server-side.
//
// Everything is read lazily from `process.env` so the feature flag can be
// toggled without a rebuild, and so importing this module never throws when
// OpenHarness is disabled.

import path from "node:path";

export type OpenHarnessSurface =
  | "dashboard_terminal"
  | "garden_chat"
  | "quartz_ai";

export type OpenHarnessMode = "required" | "preferred" | "legacy";

export const OPENHARNESS_SURFACES: readonly OpenHarnessSurface[] = [
  "dashboard_terminal",
  "garden_chat",
  "quartz_ai",
] as const;

export interface OpenHarnessConfig {
  enabled: boolean;
  mode: OpenHarnessMode;
  baseUrl: string;
  username: string;
  password: string;
  /**
   * Absolute path OpenHarness treats as the root under which per-session
   * workspaces are created. Defaults to `<repo>/.runtime/openharness`.
   */
  root: string;
  agents: {
    terminal: string;
    garden: string;
    quartz: string;
    capabilityScout: string;
  };
  requestTimeoutMs: number;
  /**
   * URL the OpenHarness garden/quartz tool adapter uses to call back into
   * Breadboard's internal tool endpoint. Server-to-server only; never sent to a
   * browser. Defaults to the local dashboard.
   */
  dashboardInternalUrl: string;
}

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envFlag(name: string): boolean {
  const value = process.env[name];
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function modeFromEnvironment(): OpenHarnessMode {
  const configured = process.env.OPENHARNESS_MODE?.trim().toLowerCase();
  if (configured === "required" || configured === "preferred" || configured === "legacy") {
    return configured;
  }
  // OPENHARNESS_ENABLED is retained as a compatibility kill switch. A clean
  // checkout is OpenHarness-first; only an explicit false opts into legacy.
  if (process.env.OPENHARNESS_ENABLED !== undefined && !envFlag("OPENHARNESS_ENABLED")) {
    return "legacy";
  }
  return "required";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://127.0.0.1:4096";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * The default workspace root. We keep runtime workspaces inside the Breadboard
 * repo (but git-ignored) so path canonicalization stays simple and predictable
 * across platforms. Callers can override with OPENHARNESS_ROOT.
 */
function defaultRoot(): string {
  // process.cwd() is the dashboard package dir under `next dev`/`next start`.
  // The runtime dir lives one level up, at the repo root, so all services can
  // share it and it is covered by the repo .gitignore.
  const root = path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
  return path.join(root, ".runtime", "openharness");
}

export function readOpenHarnessConfig(): OpenHarnessConfig {
  const mode = modeFromEnvironment();
  return {
    enabled: mode !== "legacy",
    mode,
    baseUrl: normalizeBaseUrl(envString("OPENHARNESS_BASE_URL", "http://127.0.0.1:4096")),
    username: envString("OPENHARNESS_USERNAME", "breadboard"),
    password: process.env.OPENHARNESS_PASSWORD ?? "breadboard-local-dev",
    root: envString("OPENHARNESS_ROOT", defaultRoot()),
    agents: {
      terminal: envString("OPENHARNESS_TERMINAL_AGENT", "breadboard-workbench"),
      garden: envString("OPENHARNESS_GARDEN_AGENT", "breadboard-workbench"),
      quartz: envString("OPENHARNESS_QUARTZ_AGENT", "breadboard-workbench"),
      capabilityScout: envString(
        "OPENHARNESS_CAPABILITY_SCOUT_AGENT",
        "capability-scout",
      ),
    },
    requestTimeoutMs: Number.parseInt(envString("OPENHARNESS_REQUEST_TIMEOUT_MS", "120000"), 10) || 120000,
    dashboardInternalUrl: normalizeBaseUrl(
      envString("BREADBOARD_INTERNAL_URL", "http://127.0.0.1:3000"),
    ),
  };
}

/**
 * The agent name Breadboard selects for a given surface. Browsers never choose
 * an agent — the surface determines it, and the gateway enforces it.
 */
export function agentForSurface(config: OpenHarnessConfig, surface: OpenHarnessSurface): string {
  if (surface === "garden_chat") return config.agents.garden;
  if (surface === "quartz_ai") return config.agents.quartz;
  return config.agents.terminal;
}

/**
 * Basic-auth header for the OpenHarness server. Returns undefined when no
 * password is configured (local unsecured dev), matching OpenHarness's own
 * behavior where auth is only enforced when a password is set.
 */
export function authHeader(config: OpenHarnessConfig): string | undefined {
  if (!config.password) return undefined;
  const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  return `Basic ${token}`;
}

export function isOpenHarnessEnabled(): boolean {
  return modeFromEnvironment() !== "legacy";
}

export function readOpenHarnessMode(): OpenHarnessMode {
  return modeFromEnvironment();
}
