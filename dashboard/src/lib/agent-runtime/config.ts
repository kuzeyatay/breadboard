import { RUNTIME_KINDS, type RuntimeKind } from "./contracts.ts";

export interface AgentRuntimeConfig {
  runtime: RuntimeKind;
  fallback: RuntimeKind | null;
  hermes: {
    baseUrl: string;
    sessionToken: string;
    requestTimeoutMs: number;
  };
}

export class AgentRuntimeConfigError extends Error {
  readonly code = "invalid_agent_runtime_config";
}

function runtimeKind(
  value: string | undefined,
  fallback: RuntimeKind,
): RuntimeKind {
  const normalized = value?.trim().toLowerCase() || fallback;
  if ((RUNTIME_KINDS as readonly string[]).includes(normalized)) {
    return normalized as RuntimeKind;
  }
  throw new AgentRuntimeConfigError(
    `Unsupported AGENT_RUNTIME value "${normalized}".`,
  );
}

function optionalRuntimeKind(value: string | undefined): RuntimeKind | null {
  if (!value?.trim() || value.trim().toLowerCase() === "none") return null;
  return runtimeKind(value, "openharness");
}

function loopbackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(value) ? value : `http://${value}`,
    );
  } catch {
    throw new AgentRuntimeConfigError("HERMES_BASE_URL is invalid.");
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
    throw new AgentRuntimeConfigError(
      "HERMES_BASE_URL must use a loopback host.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentRuntimeConfigError(
      "HERMES_BASE_URL must use HTTP or HTTPS.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function readAgentRuntimeConfig(): AgentRuntimeConfig {
  const runtime = runtimeKind(process.env.AGENT_RUNTIME, "openharness");
  const fallback = optionalRuntimeKind(process.env.AGENT_RUNTIME_FALLBACK);
  if (fallback === runtime) {
    throw new AgentRuntimeConfigError(
      "AGENT_RUNTIME_FALLBACK must differ from AGENT_RUNTIME.",
    );
  }
  return {
    runtime,
    fallback,
    hermes: {
      baseUrl: loopbackUrl(
        process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:9119",
      ),
      sessionToken: process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? "",
      requestTimeoutMs:
        Number.parseInt(process.env.HERMES_REQUEST_TIMEOUT_MS ?? "", 10) ||
        120_000,
    },
  };
}

