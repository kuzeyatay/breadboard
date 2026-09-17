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
let preferencesVersion = 0;
let health: unknown = null;
let healthExpiresAt = 0;
let healthRequest: Promise<unknown> | null = null;

export async function loadAssistantPreferences(): Promise<AssistantPreferencesPayload | null> {
  if (preferences) return preferences;
  if (preferencesRequest) return preferencesRequest;
  const version = preferencesVersion;
  preferencesRequest = fetch("/api/assistant-preferences", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (version === preferencesVersion) preferences = data;
      return preferences;
    })
    .finally(() => {
      preferencesRequest = null;
    });
  return preferencesRequest;
}

export async function patchAssistantPreferences(
  value: Record<string, unknown>,
): Promise<AssistantPreferencesPayload> {
  const response = await fetch("/api/assistant-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "The assistant preference could not be saved.",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The saved assistant preference could not be read. Please retry.");
  }
  preferencesVersion += 1;
  preferences = data;
  return data;
}

/** A profile change in another tab makes this tab's cached account copy stale. */
export function invalidateAssistantPreferences(): void {
  preferences = null;
  preferencesVersion += 1;
}

/** Test seam: forget the shared preferences between scenarios. */
export function resetAssistantPreferencesForTest(): void {
  preferences = null;
  preferencesRequest = null;
  preferencesVersion = 0;
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
