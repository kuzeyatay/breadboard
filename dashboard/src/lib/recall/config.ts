// Server-only configuration for Recall — Breadboard's local screen and audio
// history, captured by the vendored screenpipe engine.
//
// The engine is a native recorder that serves a loopback HTTP API. Breadboard
// never bundles it: the CLI is installed on demand from npm into a Breadboard-
// owned home, pinned to one version so an install is reproducible and an
// upgrade is a deliberate edit here rather than whatever `latest` resolved to
// on the day someone pressed the button.

import os from "os";
import path from "path";

export interface RecallConfig {
  /** Feature switch. Off disables every route, tool, and the settings tab. */
  enabled: boolean;
  /** Loopback base URL of the screenpipe engine's API. */
  baseUrl: string;
  /**
   * Engine API key. The engine authenticates loopback callers with a bearer
   * token; when it is absent the client sends no Authorization header, which
   * the engine still accepts on older builds.
   */
  apiKey: string | null;
  /** npm package + version the installer pins. */
  cliPackage: string;
  cliVersion: string;
  /** Breadboard-owned directory holding the installed CLI and its state. */
  home: string;
  /** Engine data directory — recordings, transcripts, the SQLite index. */
  dataDir: string;
  requestTimeoutMs: number;
  /** Health probes run on every status poll, so they get a short leash. */
  healthTimeoutMs: number;
  /** Install downloads ~130 MB of prebuilt binary; it gets a long one. */
  installTimeoutMs: number;
  /** How long `stop` waits for a graceful exit before killing. */
  shutdownGraceMs: number;
  /** Hard ceiling on results returned to a model in one call. */
  maxResults: number;
  /** Hard ceiling on characters of captured text per result. */
  maxResultChars: number;
}

export type RecallEnv = Record<string, string | undefined>;

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function intFromEnv(
  value: string | undefined,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  let result = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== undefined && result < min) result = fallback;
  if (max !== undefined && result > max) result = fallback;
  return result;
}

function stringFromEnv(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/**
 * Normalize to an absolute loopback URL with no trailing slash. A host without
 * a scheme is treated as http, because the engine only ever serves plain HTTP
 * on the loopback interface.
 */
export function normalizeBaseUrl(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = (value ?? "").trim() || fallback;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    return new URL(candidate).toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

/** The pinned CLI. Bumping this is what an upgrade looks like. */
export const RECALL_CLI_PACKAGE = "screenpipe";
export const RECALL_CLI_VERSION = "0.4.37";

export const RECALL_DEFAULT_BASE_URL = "http://127.0.0.1:3030";

export function loadRecallConfig(env: RecallEnv = process.env): RecallConfig {
  const home =
    stringFromEnv(env.RECALL_HOME) ??
    path.join(os.homedir(), ".breadboard", "recall");

  return {
    enabled: boolFromEnv(env.RECALL_ENABLED, true),
    baseUrl: normalizeBaseUrl(env.RECALL_BASE_URL, RECALL_DEFAULT_BASE_URL),
    apiKey:
      stringFromEnv(env.RECALL_API_KEY) ??
      stringFromEnv(env.SCREENPIPE_LOCAL_API_KEY),
    cliPackage: RECALL_CLI_PACKAGE,
    cliVersion: stringFromEnv(env.RECALL_CLI_VERSION) ?? RECALL_CLI_VERSION,
    home,
    dataDir: stringFromEnv(env.RECALL_DATA_DIR) ?? path.join(home, "data"),
    requestTimeoutMs: intFromEnv(env.RECALL_REQUEST_TIMEOUT_MS, 20_000, {
      min: 1_000,
    }),
    healthTimeoutMs: intFromEnv(env.RECALL_HEALTH_TIMEOUT_MS, 2_500, {
      min: 250,
    }),
    installTimeoutMs: intFromEnv(env.RECALL_INSTALL_TIMEOUT_MS, 1_800_000, {
      min: 60_000,
    }),
    shutdownGraceMs: intFromEnv(env.RECALL_SHUTDOWN_GRACE_MS, 8_000, {
      min: 500,
    }),
    maxResults: intFromEnv(env.RECALL_MAX_RESULTS, 20, { min: 1, max: 50 }),
    maxResultChars: intFromEnv(env.RECALL_MAX_RESULT_CHARS, 1_200, {
      min: 100,
      max: 20_000,
    }),
  };
}

let cachedConfig: RecallConfig | null = null;

export function getRecallConfig(): RecallConfig {
  if (!cachedConfig) cachedConfig = loadRecallConfig();
  return cachedConfig;
}

/** Test hook: drop the cached config so env changes are picked up. */
export function resetRecallConfigCache(): void {
  cachedConfig = null;
}

/** Where the disposable installer puts the pinned CLI. */
export function recallCliRoot(config: RecallConfig): string {
  return path.join(config.home, "cli");
}

/** Heartbeat file the installer writes so the UI can tell slow from dead. */
export function recallInstallStatusPath(config: RecallConfig): string {
  return path.join(config.home, "install-status.json");
}
