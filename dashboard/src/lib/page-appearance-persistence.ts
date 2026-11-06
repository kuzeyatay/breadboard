import { validBackground, type AppearancePage, type AppearanceTheme, type PageAppearancePreference, type RainMode } from "./page-appearance.ts";

export const MAX_SAVED_BACKGROUND_LENGTH = 400_000;

export interface SavedBackground {
  background: string;
  nextChangeAt: number | null;
  rain?: Exclude<RainMode, "off">;
}

export type SavedPageAppearance = Partial<Record<AppearanceTheme, SavedBackground>>;

export function isAppearancePage(value: unknown): value is AppearancePage {
  return value === "new-tab" || value === "dashboard" || value === "browser";
}

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return value === "light" || value === "dark";
}

export function parseSavedBackground(value: unknown): SavedBackground | null {
  if (!value || typeof value !== "object") return null;
  const { background, nextChangeAt, rain } = value as Partial<SavedBackground>;
  if (!validBackground(background) || background.length > MAX_SAVED_BACKGROUND_LENGTH) return null;
  if (nextChangeAt !== null && (typeof nextChangeAt !== "number" || !Number.isSafeInteger(nextChangeAt) || nextChangeAt < 0)) return null;
  if (rain !== undefined && rain !== "on" && rain !== "weather") return null;
  return { background, nextChangeAt, ...(rain ? { rain } : {}) };
}

export function savedBackground(preference: PageAppearancePreference, theme: AppearanceTheme): SavedBackground {
  const rain = preference.rain?.[theme];
  return { background: preference.backgrounds[theme], nextChangeAt: preference.random?.[theme]?.nextChangeAt ?? null, ...(rain ? { rain } : {}) };
}

export function restoreBackground(preference: PageAppearancePreference, theme: AppearanceTheme, value: SavedBackground): void {
  preference.backgrounds[theme] = value.background;
  if (value.rain) (preference.rain ??= {})[theme] = value.rain;
  else if (preference.rain) {
    delete preference.rain[theme];
    if (!Object.keys(preference.rain).length) delete preference.rain;
  }
  if (value.nextChangeAt !== null) {
    (preference.random ??= {})[theme] = { nextChangeAt: value.nextChangeAt };
  } else if (preference.random) {
    delete preference.random[theme];
    if (!Object.keys(preference.random).length) delete preference.random;
  }
}
