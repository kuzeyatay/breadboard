import { RUNTIME_KINDS, type RuntimeKind } from "./contracts.ts";

export interface AgentRuntimeConfig {
  runtime: RuntimeKind;
  fallback: RuntimeKind | null;
  hermes: {
    baseUrl: string;
    chatmockBaseUrl: string;
    sessionToken: string;
    requestTimeoutMs: number;
  };
}

export class AgentRuntimeConfigError extends Error {
  readonly code = "invalid_agent_runtime_config";
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
  return {
    runtime: RUNTIME_KINDS[0],
    fallback: null,
    hermes: {
      baseUrl: loopbackUrl(
        process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:9119",
      ),
      chatmockBaseUrl: loopbackUrl(
        process.env.CHATMOCK_BASE_URL?.trim() ||
          process.env.OPENAI_LOCAL_BASE_URL?.trim() ||
          "http://127.0.0.1:8765/v1",
      ),
      sessionToken: process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? "",
      requestTimeoutMs:
        Number.parseInt(process.env.HERMES_REQUEST_TIMEOUT_MS ?? "", 10) ||
        120_000,
    },
  };
}
