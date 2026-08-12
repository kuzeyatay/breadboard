// Authoritative (server-side) configuration for the agent-browser runtime agent.
// agent-browser is a native CLI whose `chat` command drives a real browser using
// an OpenAI-compatible model endpoint. ChatMock is the default provider: its
// endpoint + local credential come from the server environment, so a user never
// pastes an API key. Provider API keys are NEVER part of this object.

import { CHATMOCK_PROVIDER, chatmockEndpoint, chatmockModel } from "../ui-tars/model-provider.ts";

export type ApprovalMode = "sensitive_actions" | "every_action" | "none";

export interface AgentBrowserConfiguration {
  provider: string;
  model: string;
  /** OpenAI-compatible base URL WITHOUT the trailing /v1 (agent-browser appends it). */
  endpoint?: string;
  maxSteps: number;
  timeoutMs: number;
  approvalMode: ApprovalMode;
  allowedDomains: string[];
  /** Browser engine passed to agent-browser (default chrome, i.e. Chromium/Edge). */
  engine: "chrome" | "lightpanda";
}

export interface ConfigValidation {
  ok: boolean;
  errors: string[];
  value?: AgentBrowserConfiguration;
}

const APPROVAL_MODES = new Set<ApprovalMode>(["sensitive_actions", "every_action", "none"]);
const ENGINES = new Set(["chrome", "lightpanda"]);
const MAX_STEPS_CEIL = 200;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_TIMEOUT_MS = 5 * 1000;
const MAX_ALLOWED_DOMAINS = 100;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The AI-gateway base URL agent-browser should call. It appends `/v1/chat/...`,
 * so we hand it the ChatMock base with any trailing `/v1` removed.
 */
export function chatmockGatewayBase(env: NodeJS.ProcessEnv = process.env): string {
  return chatmockEndpoint(env).replace(/\/v1\/?$/, "");
}

export function validateAgentConfiguration(input: unknown): ConfigValidation {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ["configuration_must_be_object"] };

  const provider = input.provider;
  if (typeof provider !== "string" || provider.trim().length === 0 || provider.length > 64) {
    errors.push("invalid_provider");
  }
  const model = input.model;
  if (typeof model !== "string" || model.length > 128) errors.push("invalid_model");
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
  const engine = input.engine;
  if (typeof engine !== "string" || !ENGINES.has(engine)) errors.push("invalid_engine");
  const allowedDomains = input.allowedDomains;
  if (!Array.isArray(allowedDomains) || allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    errors.push("invalid_allowed_domains");
  } else if (allowedDomains.some((d) => typeof d !== "string" || d.length === 0 || d.length > 253)) {
    errors.push("invalid_allowed_domain_entry");
  }
  if (errors.length > 0) return { ok: false, errors };

  const hasEndpoint = typeof endpoint === "string" && endpoint.length > 0;
  const value: AgentBrowserConfiguration = {
    provider: (provider as string).trim(),
    model: (model as string).trim(),
    ...(hasEndpoint ? { endpoint: endpoint as string } : {}),
    maxSteps: maxSteps as number,
    timeoutMs: timeoutMs as number,
    approvalMode: approvalMode as ApprovalMode,
    allowedDomains: (allowedDomains as string[]).map((d) => d.trim().toLowerCase()),
    engine: engine as "chrome" | "lightpanda",
  };
  return { ok: true, errors: [], value };
}

/** Defaults for a new agent: ChatMock via the server's local gateway. */
export function defaultAgentConfiguration(env: NodeJS.ProcessEnv = process.env): AgentBrowserConfiguration {
  return {
    provider: CHATMOCK_PROVIDER,
    model: chatmockModel(env),
    endpoint: chatmockGatewayBase(env),
    maxSteps: 25,
    timeoutMs: 5 * 60 * 1000,
    approvalMode: "sensitive_actions",
    allowedDomains: [],
    engine: "chrome",
  };
}

export function applyConfigurationPatch(current: AgentBrowserConfiguration, patch: unknown): ConfigValidation {
  if (!isPlainObject(patch)) return { ok: false, errors: ["patch_must_be_object"] };
  return validateAgentConfiguration({ ...current, ...patch });
}
