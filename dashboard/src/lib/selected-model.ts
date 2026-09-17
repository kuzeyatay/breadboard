// Server-side resolution of the profile default. Chat and Learn requests can
// supply explicit overrides without writing this account preference. Background
// tasks and requests without a local selection use this fallback.

import { DEFAULT_MODEL, normalizeAssistantModelId } from "./ai-models.ts";
import { getHermesUserSettings } from "./hermes/runtime-store.ts";

/**
 * The model this user picked, or the product default when they have not picked
 * one (or when the settings row cannot be read — an ingest should never fail
 * because of a preference lookup).
 */
export function selectedModelForUser(userId: number | null | undefined): string {
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    return DEFAULT_MODEL;
  }

  try {
    const settings = getHermesUserSettings(userId);
    return normalizeAssistantModelId(settings.defaultModel) ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}
