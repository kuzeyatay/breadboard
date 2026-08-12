// Model wiring for UI-TARS agents.
//
// ChatMock is Breadboard's local OpenAI-compatible gateway (the same one the
// chat surfaces use), so it is the default provider for browser agents: the
// server already holds its endpoint and credential, and the user never has to
// paste an API key to run a task.
//
// The provider id `chatmock` is passed through to the runtime unchanged.
// Upstream Agent TARS resolves any provider it does not know to its
// `openai-compatible` client, using the baseURL/apiKey we supply — so ChatMock
// works without pretending to be OpenAI, and run telemetry keeps the real name.
//
// Note: upstream only supports vision-grounded browser control ("gui"/"hybrid")
// on volcengine models and silently falls back to "dom" for every other
// provider, ChatMock included.

import { CHATMOCK_PROVIDER, GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import { normalizeChatmockBaseUrl } from "../chatmock-server.ts";
import type { UITarsAgentConfiguration } from "./config.ts";

export { CHATMOCK_PROVIDER };

const DEFAULT_CHATMOCK_BASE_URL = "http://127.0.0.1:8765/v1";
/** ChatMock authenticates the caller locally; the value is a placeholder. */
const DEFAULT_CHATMOCK_API_KEY = "local";

export function isChatmockProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === CHATMOCK_PROVIDER;
}

/** The ChatMock endpoint this dashboard talks to (always loopback-first). */
export function chatmockEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (
    normalizeChatmockBaseUrl(
      env.CHATMOCK_BASE_URL ?? env.OPENAI_LOCAL_BASE_URL ?? env.OPENAI_BASE_URL,
    ) ?? DEFAULT_CHATMOCK_BASE_URL
  );
}

/**
 * The model browser agents run on. Defaults to the global background model
 * chosen in Settings -> Providers, which ChatMock resolves per request.
 */
export function chatmockModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CHATMOCK_MODEL ?? "").trim() || GLOBAL_MODEL_SENTINEL;
}

function chatmockApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CHATMOCK_API_KEY ?? "").trim() || DEFAULT_CHATMOCK_API_KEY;
}

/**
 * Whether the agent is unusable until the user stores a provider key. False for
 * ChatMock, whose credential comes from the server environment.
 */
export function providerRequiresStoredKey(
  configuration: Pick<UITarsAgentConfiguration, "provider">,
): boolean {
  return !isChatmockProvider(configuration.provider);
}

/**
 * Resolve the configuration actually sent to the adapter for a run. ChatMock's
 * desktop port is assigned when the app starts, so a loopback endpoint stored
 * in an agent configuration can become stale after any restart. The dashboard
 * environment is the source of truth for that endpoint on every run. Other
 * providers keep their explicitly configured endpoint unchanged.
 */
export function resolveRunModel(
  configuration: UITarsAgentConfiguration,
  storedApiKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { configuration: UITarsAgentConfiguration; providerApiKey?: string } {
  if (!isChatmockProvider(configuration.provider)) {
    return {
      configuration,
      ...(storedApiKey ? { providerApiKey: storedApiKey } : {}),
    };
  }
  return {
    configuration: {
      ...configuration,
      provider: CHATMOCK_PROVIDER,
      endpoint: chatmockEndpoint(env),
    },
    providerApiKey: storedApiKey || chatmockApiKey(env),
  };
}
