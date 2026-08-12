// Server-side resolution of "the model the user has currently selected".
//
// The Intelligence picker writes the choice to the signed-in user's Hermes
// settings (`default_model`), and every chat surface already follows it. The
// document ingestion pipeline and the Learn panel used to hardcode a model
// instead, so changing the picker had no effect on either. They resolve
// through here now, so one choice governs every AI call Breadboard makes on
// the user's behalf.
//
// A provider model that the runtime cannot name by id is stored as the
// `default` sentinel, which ChatMock expands to the configured background
// model — so passing the stored value straight through is correct in both
// cases.

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
