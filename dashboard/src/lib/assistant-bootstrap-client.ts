"use client";

export interface AssistantPreferencesPayload {
  model?: unknown;
  reasoningEffort?: unknown;
  reasoningEffortByModel?: unknown;
  userPreference?: unknown;
  [key: string]: unknown;
}

let preferences: AssistantPreferencesPayload | null = null;
let preferencesRequest: Promise<AssistantPreferencesPayload | null> | null = null;
let health: unknown = null;
let healthExpiresAt = 0;
let healthRequest: Promise<unknown> | null = null;

export async function loadAssistantPreferences(): Promise<AssistantPreferencesPayload | null> {
  if (preferences) return preferences;
  if (preferencesRequest) return preferencesRequest;
  preferencesRequest = fetch("/api/assistant-preferences", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      preferences = await response.json().catch(() => null);
      return preferences;
    })
    .finally(() => {
      preferencesRequest = null;
    });
  return preferencesRequest;
}

export async function patchAssistantPreferences(
  value: Record<string, unknown>,
): Promise<void> {
  const response = await fetch("/api/assistant-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (response.ok) {
    preferences = await response.json().catch(() => ({ ...preferences, ...value }));
  }
}

/** Health is live, but all mounted surfaces can share a result for 15 seconds. */
export async function loadAssistantModelHealth(): Promise<unknown> {
  if (health !== null && healthExpiresAt > Date.now()) return health;
  if (healthRequest) return healthRequest;
  healthRequest = fetch("/api/chatmock/model-health", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      health = await response.json().catch(() => null);
      healthExpiresAt = Date.now() + 15_000;
      return health;
    })
    .finally(() => {
      healthRequest = null;
    });
  return healthRequest;
}
