import { HermesRuntimeAdapter } from "./adapters/hermes.ts";
import { readAgentRuntimeConfig } from "./config.ts";
import type { AgentRuntime, RuntimeKind } from "./contracts.ts";

let cached:
  | {
      signature: string;
      runtimes: Map<RuntimeKind, AgentRuntime>;
    }
  | null = null;

function runtimeConfigSignature(): string {
  return [
    process.env.HERMES_BASE_URL ?? "",
    process.env.CHATMOCK_BASE_URL ?? "",
    process.env.OPENAI_LOCAL_BASE_URL ?? "",
    process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? "",
    process.env.HERMES_REQUEST_TIMEOUT_MS ?? "",
  ].join("\u0000");
}

function runtimeMap(): Map<RuntimeKind, AgentRuntime> {
  const signature = runtimeConfigSignature();
  if (cached?.signature === signature) return cached.runtimes;
  const config = readAgentRuntimeConfig();
  const runtimes = new Map<RuntimeKind, AgentRuntime>([
    ["hermes", new HermesRuntimeAdapter(config.hermes)],
  ]);
  cached = { signature, runtimes };
  return runtimes;
}

/** The runtime selected for newly created sessions. */
export function getAgentRuntime(): AgentRuntime {
  return getAgentRuntimeByKind(readAgentRuntimeConfig().runtime);
}

/** Resolve the runtime persisted on an existing session. */
export function getAgentRuntimeByKind(kind: RuntimeKind): AgentRuntime {
  const runtime = runtimeMap().get(kind);
  if (!runtime) throw new Error(`Agent runtime is not registered: ${kind}`);
  return runtime;
}

export function getFallbackAgentRuntime(): AgentRuntime | null {
  const fallback = readAgentRuntimeConfig().fallback;
  return fallback ? getAgentRuntimeByKind(fallback) : null;
}

export function resetAgentRuntimes(): void {
  cached = null;
}
