// Adapter server configuration + pure agent-configuration validation.
//
// The adapter binds ONLY to loopback and authenticates every non-health request
// with a per-launch secret. Configuration comes from the environment (never
// argv, so secrets are not exposed in process listings).

import type {
  ApprovalMode,
  BrowserStrategy,
  DesktopCoordinateSpace,
  OperatorType,
  UITarsAgentConfiguration,
} from "./types.ts";

export type RuntimeKind = "fake" | "agent-tars";

export interface AdapterConfig {
  host: string;
  port: number;
  secret: string;
  dataDir: string;
  runtime: RuntimeKind;
  /** Global ceiling regardless of per-agent config. */
  maxConcurrentRuns: number;
  /** Screenshot retention in ms (0 = keep until run retention sweeps). */
  screenshotRetentionMs: number;
  version: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig {
  const host = env["UI_TARS_ADAPTER_HOST"] ?? "127.0.0.1";
  // Hard loopback enforcement: refuse any non-loopback bind host.
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("adapter_host_must_be_loopback");
  }
  const runtime: RuntimeKind = env["UI_TARS_RUNTIME"] === "agent-tars" ? "agent-tars" : "fake";
  return {
    host: host === "localhost" ? "127.0.0.1" : host,
    port: Number(env["UI_TARS_ADAPTER_PORT"] ?? 0) || 0,
    secret: env["UI_TARS_ADAPTER_SECRET"] ?? "",
    dataDir: env["UI_TARS_DATA_DIR"] ?? "",
    runtime,
    maxConcurrentRuns: Math.max(1, Number(env["UI_TARS_MAX_CONCURRENT_RUNS"] ?? 3) || 3),
    screenshotRetentionMs: Math.max(0, Number(env["UI_TARS_SCREENSHOT_RETENTION_MS"] ?? 0) || 0),
    version: env["UI_TARS_ADAPTER_VERSION"] ?? "0.1.0",
  };
}

export function assertSecret(config: AdapterConfig): void {
  if (!config.secret || config.secret.length < 16) {
    throw new Error("adapter_secret_missing_or_weak");
  }
}

// --------------------------------------------------------------------------
// Pure agent-configuration validation (server-authoritative; mirrored by the
// dashboard's own validator — the dashboard remains the source of truth).
// --------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: UITarsAgentConfiguration;
}

const STRATEGIES: ReadonlySet<BrowserStrategy> = new Set(["gui", "dom", "hybrid"]);
const APPROVAL_MODES: ReadonlySet<ApprovalMode> = new Set(["every_action", "sensitive_actions"]);
const OPERATORS: ReadonlySet<OperatorType> = new Set(["browser", "computer"]);
const DESKTOP_COORDINATE_SPACES: ReadonlySet<DesktopCoordinateSpace> = new Set([
  "screen_pixels",
  "normalized_1000",
]);

const MAX_STEPS_CEIL = 200;
const MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 min hard ceiling
const MIN_TIMEOUT_MS = 5 * 1000;
const MAX_ALLOWED_DOMAINS = 100;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate untrusted input into a UITarsAgentConfiguration. Never throws. */
export function validateAgentConfiguration(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["configuration_must_be_object"] };
  }

  const operator = input["operator"];
  if (typeof operator !== "string" || !OPERATORS.has(operator as OperatorType)) {
    errors.push("invalid_operator");
  }

  const browserStrategy = input["browserStrategy"];
  if (typeof browserStrategy !== "string" || !STRATEGIES.has(browserStrategy as BrowserStrategy)) {
    errors.push("invalid_browser_strategy");
  }

  // Backward-compatible default for agents saved before coordinate protocols
  // became explicit. General vision models (including Breadboard's local
  // gateway) report screenshot pixels.
  const desktopCoordinateSpace = input["desktopCoordinateSpace"] ?? "screen_pixels";
  if (
    typeof desktopCoordinateSpace !== "string" ||
    !DESKTOP_COORDINATE_SPACES.has(desktopCoordinateSpace as DesktopCoordinateSpace)
  ) {
    errors.push("invalid_desktop_coordinate_space");
  }

  const provider = input["provider"];
  if (typeof provider !== "string" || provider.trim().length === 0 || provider.length > 64) {
    errors.push("invalid_provider");
  }

  const model = input["model"];
  // Empty model is a valid stored config; presence is enforced at run-start.
  if (typeof model !== "string" || model.length > 128) {
    errors.push("invalid_model");
  }

  const endpoint = input["endpoint"];
  if (endpoint !== undefined) {
    if (typeof endpoint !== "string" || !/^https?:\/\//i.test(endpoint) || endpoint.length > 2048) {
      errors.push("invalid_endpoint");
    }
  }

  const maxSteps = input["maxSteps"];
  if (typeof maxSteps !== "number" || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS_CEIL) {
    errors.push("invalid_max_steps");
  }

  const timeoutMs = input["timeoutMs"];
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    errors.push("invalid_timeout_ms");
  }

  const approvalMode = input["approvalMode"];
  if (typeof approvalMode !== "string" || !APPROVAL_MODES.has(approvalMode as ApprovalMode)) {
    errors.push("invalid_approval_mode");
  }

  const allowedDomains = input["allowedDomains"];
  if (!Array.isArray(allowedDomains) || allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    errors.push("invalid_allowed_domains");
  } else if (allowedDomains.some((d) => typeof d !== "string" || d.length === 0 || d.length > 253)) {
    errors.push("invalid_allowed_domain_entry");
  }

  for (const flag of ["allowDownloads", "allowClipboard", "allowFileUpload"]) {
    if (typeof input[flag] !== "boolean") errors.push(`invalid_${flag}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: UITarsAgentConfiguration = {
    operator: operator as OperatorType,
    browserStrategy: browserStrategy as BrowserStrategy,
    desktopCoordinateSpace: desktopCoordinateSpace as DesktopCoordinateSpace,
    provider: (provider as string).trim(),
    model: (model as string).trim(),
    ...(typeof endpoint === "string" ? { endpoint } : {}),
    maxSteps: maxSteps as number,
    timeoutMs: timeoutMs as number,
    approvalMode: approvalMode as ApprovalMode,
    allowedDomains: (allowedDomains as string[]).map((d) => d.trim().toLowerCase()),
    allowDownloads: input["allowDownloads"] as boolean,
    allowClipboard: input["allowClipboard"] as boolean,
    allowFileUpload: input["allowFileUpload"] as boolean,
  };
  return { ok: true, errors: [], value };
}

/** Default configuration for the first-party "UI-TARS Browser Operator" agent. */
export function defaultAgentConfiguration(): UITarsAgentConfiguration {
  return {
    operator: "browser",
    browserStrategy: "dom", // safe bring-up strategy; no vision model required
    desktopCoordinateSpace: "screen_pixels",
    provider: "openai",
    model: "",
    maxSteps: 25,
    timeoutMs: 5 * 60 * 1000,
    approvalMode: "sensitive_actions",
    allowedDomains: [],
    allowDownloads: true,
    allowClipboard: false,
    allowFileUpload: false,
  };
}
