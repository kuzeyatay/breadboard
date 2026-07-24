// Authoritative (server-side) UI-TARS agent configuration validation +
// redaction. The dashboard is the source of truth; the adapter re-validates
// defensively. Provider API keys are NEVER part of this configuration object —
// they live in a separate server-only table.

export type BrowserStrategy = "gui" | "dom" | "hybrid";
export type ApprovalMode = "every_action" | "sensitive_actions";
export type AgentCapability =
  | "chat"
  | "research"
  | "browser_control"
  | "computer_control"
  | "shell"
  | "mcp";

export interface UITarsAgentConfiguration {
  operator: "browser";
  browserStrategy: BrowserStrategy;
  provider: string;
  model: string;
  endpoint?: string;
  maxSteps: number;
  timeoutMs: number;
  approvalMode: ApprovalMode;
  allowedDomains: string[];
  allowDownloads: boolean;
  allowClipboard: boolean;
  allowFileUpload: boolean;
}

export interface ConfigValidation {
  ok: boolean;
  errors: string[];
  value?: UITarsAgentConfiguration;
}

const STRATEGIES = new Set<BrowserStrategy>(["gui", "dom", "hybrid"]);
const APPROVAL_MODES = new Set<ApprovalMode>(["every_action", "sensitive_actions"]);
const MAX_STEPS_CEIL = 200;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_TIMEOUT_MS = 5 * 1000;
const MAX_ALLOWED_DOMAINS = 100;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateAgentConfiguration(input: unknown): ConfigValidation {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ["configuration_must_be_object"] };

  if (input.operator !== "browser") errors.push("operator_must_be_browser");

  const browserStrategy = input.browserStrategy;
  if (typeof browserStrategy !== "string" || !STRATEGIES.has(browserStrategy as BrowserStrategy)) {
    errors.push("invalid_browser_strategy");
  }
  const provider = input.provider;
  if (typeof provider !== "string" || provider.trim().length === 0 || provider.length > 64) {
    errors.push("invalid_provider");
  }
  const model = input.model;
  // Empty model is a VALID stored config (agent not yet configured / shown
  // "misconfigured"). Model presence is enforced at run-start, not here.
  if (typeof model !== "string" || model.length > 128) {
    errors.push("invalid_model");
  }
  const endpoint = input.endpoint;
  if (endpoint !== undefined && endpoint !== "") {
    if (typeof endpoint !== "string" || !/^https?:\/\//i.test(endpoint) || endpoint.length > 2048) {
      errors.push("invalid_endpoint");
    }
  }
  const maxSteps = input.maxSteps;
  if (typeof maxSteps !== "number" || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS_CEIL) {
    errors.push("invalid_max_steps");
  }
  const timeoutMs = input.timeoutMs;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    errors.push("invalid_timeout_ms");
  }
  const approvalMode = input.approvalMode;
  if (typeof approvalMode !== "string" || !APPROVAL_MODES.has(approvalMode as ApprovalMode)) {
    errors.push("invalid_approval_mode");
  }
  const allowedDomains = input.allowedDomains;
  if (!Array.isArray(allowedDomains) || allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    errors.push("invalid_allowed_domains");
  } else if (allowedDomains.some((d) => typeof d !== "string" || d.length === 0 || d.length > 253)) {
    errors.push("invalid_allowed_domain_entry");
  }
  for (const flag of ["allowDownloads", "allowClipboard", "allowFileUpload"] as const) {
    if (typeof input[flag] !== "boolean") errors.push(`invalid_${flag}`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const hasEndpoint = typeof endpoint === "string" && endpoint.length > 0;
  const value: UITarsAgentConfiguration = {
    operator: "browser",
    browserStrategy: browserStrategy as BrowserStrategy,
    provider: (provider as string).trim(),
    model: (model as string).trim(),
    ...(hasEndpoint ? { endpoint: endpoint as string } : {}),
    maxSteps: maxSteps as number,
    timeoutMs: timeoutMs as number,
    approvalMode: approvalMode as ApprovalMode,
    allowedDomains: (allowedDomains as string[]).map((d) => d.trim().toLowerCase()),
    allowDownloads: input.allowDownloads as boolean,
    allowClipboard: input.allowClipboard as boolean,
    allowFileUpload: input.allowFileUpload as boolean,
  };
  return { ok: true, errors: [], value };
}

export function defaultAgentConfiguration(): UITarsAgentConfiguration {
  return {
    operator: "browser",
    browserStrategy: "dom",
    provider: "openai",
    model: "",
    maxSteps: 25,
    timeoutMs: 5 * 60 * 1000,
    approvalMode: "sensitive_actions",
    allowedDomains: [],
    allowDownloads: false,
    allowClipboard: false,
    allowFileUpload: false,
  };
}

/**
 * Merge a partial update over an existing configuration, then validate. Fields
 * omitted from the patch are preserved. Never touches secrets.
 */
export function applyConfigurationPatch(
  current: UITarsAgentConfiguration,
  patch: unknown,
): ConfigValidation {
  if (!isPlainObject(patch)) return { ok: false, errors: ["patch_must_be_object"] };
  // operator is fixed to browser for the MVP.
  const merged = { ...current, ...patch, operator: "browser" };
  return validateAgentConfiguration(merged);
}
