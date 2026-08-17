// Translating the Wardrobe agent's stored settings into a run's shape.
//
// Kept separate from the identity module so the vocabulary the settings panel
// uses never leaks into the runtime: what the panel calls "Image quality" is the
// clone's `OPENAI_IMAGE_QUALITY`, and what it calls "Pieces per photo" is a
// slice of the detector's output.

import {
  DEFAULT_MAX_ITEMS_PER_PHOTO,
  DEFAULT_WARDROBE_REQUEST,
  isWardrobeQuality,
  MAX_MAX_ITEMS_PER_PHOTO,
  MIN_MAX_ITEMS_PER_PHOTO,
  type WardrobeQuality,
  type WardrobeRequest,
} from "./identity.ts";

export interface WardrobeSettings {
  maxItemsPerPhoto: number;
  quality: WardrobeQuality;
}

export const DEFAULT_WARDROBE_SETTINGS: WardrobeSettings = {
  maxItemsPerPhoto: DEFAULT_MAX_ITEMS_PER_PHOTO,
  quality: DEFAULT_WARDROBE_REQUEST.quality,
};

function readNumber(value: unknown, low: number, high: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, Math.round(numeric)));
}

/** Read one user's stored values, falling back to the defaults field by field. */
export function wardrobeSettingsFrom(
  values: Record<string, unknown> | null | undefined,
): WardrobeSettings {
  if (!values) return { ...DEFAULT_WARDROBE_SETTINGS };
  return {
    maxItemsPerPhoto: readNumber(
      values.maxItemsPerPhoto,
      MIN_MAX_ITEMS_PER_PHOTO,
      MAX_MAX_ITEMS_PER_PHOTO,
      DEFAULT_WARDROBE_SETTINGS.maxItemsPerPhoto,
    ),
    // An unknown quality falls back rather than reaching the provider, which
    // would fail the whole run over a stale stored string.
    quality: isWardrobeQuality(values.quality)
      ? values.quality
      : DEFAULT_WARDROBE_SETTINGS.quality,
  };
}

/** The defaults `parseWardrobeRequest` starts from, before any inline flag. */
export function requestDefaultsFrom(settings: WardrobeSettings): WardrobeRequest {
  return {
    direction: "",
    maxItemsPerPhoto: settings.maxItemsPerPhoto,
    quality: settings.quality,
  };
}
