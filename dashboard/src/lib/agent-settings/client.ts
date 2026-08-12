// Reading agent settings from the browser.
//
// Most agents parse their prompt on the server, where the store is one call
// away. Deep Research does not: its chat hosts parse the message and post a
// finished request, so the settings have to reach the browser before the run
// starts. This is that path — one fetch per agent, cached for the life of the
// page, invalidated when the settings page saves.
//
// A failed or slow lookup is never allowed to block a run: callers fall back to
// the shipped defaults, which is what the parsers already use.

import { agentSettingDefaults, findConfigurableAgent, type AgentSettingValues } from "./catalog.ts";

export const AGENT_SETTINGS_CHANGED_EVENT = "breadboard:agent-settings-changed";

const cache = new Map<string, Promise<AgentSettingValues>>();

function fallback(agentId: string): AgentSettingValues {
  const agent = findConfigurableAgent(agentId);
  return agent ? agentSettingDefaults(agent) : {};
}

async function fetchSettings(agentId: string): Promise<AgentSettingValues> {
  const response = await fetch(`/api/agent-settings/${encodeURIComponent(agentId)}`, {
    cache: "no-store",
    // A launch waits on this call, so it gets a deadline. Two seconds is far
    // beyond a local database read and far below what anyone would sit through
    // before their message appears.
    signal: AbortSignal.timeout(2_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    settings?: { values?: unknown };
  };
  if (!response.ok || payload.ok === false) throw new Error("agent_settings_unavailable");
  const values = payload.settings?.values;
  return values && typeof values === "object" && !Array.isArray(values)
    ? (values as AgentSettingValues)
    : fallback(agentId);
}

/**
 * The stored values for one agent. Resolves to the shipped defaults if the
 * lookup fails, so `await` at a launch site is always safe.
 */
export function loadAgentSettings(agentId: string): Promise<AgentSettingValues> {
  const cached = cache.get(agentId);
  if (cached) return cached;
  const pending = fetchSettings(agentId).catch(() => {
    // Do not remember a failure — the next launch should try again.
    cache.delete(agentId);
    return fallback(agentId);
  });
  cache.set(agentId, pending);
  return pending;
}

/** Drop the cache so the next launch reads what was just saved. */
export function forgetAgentSettings(agentId?: string): void {
  if (agentId) cache.delete(agentId);
  else cache.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(AGENT_SETTINGS_CHANGED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ agentId?: string }>).detail;
    forgetAgentSettings(detail?.agentId);
  });
}

export function announceAgentSettingsChanged(agentId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_SETTINGS_CHANGED_EVENT, { detail: { agentId } }));
}
