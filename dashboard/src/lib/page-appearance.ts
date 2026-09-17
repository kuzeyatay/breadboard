export type AppearancePage = "new-tab" | "dashboard" | "browser";
export type AppearanceTheme = "light" | "dark";
export type WallpaperCategory = "Astral" | "Places" | "Abstract";

export const APPEARANCE_PAGES: Record<AppearancePage, string> = {
  "new-tab": "New tab",
  dashboard: "Dashboard",
  browser: "Browser",
};
export const PAGE_APPEARANCE_CHANGE_EVENT = "breadboard:page-appearance-change";
export const NO_WALLPAPER_ID = "none";
export const RANDOM_BACKGROUND_MIN_DELAY_MS = 60 * 60 * 1000;
export const RANDOM_BACKGROUND_MAX_DELAY_MS = 24 * RANDOM_BACKGROUND_MIN_DELAY_MS;
export const WALLPAPERS = [
  { id: "alpine-dawn", name: "Alpine dawn", category: "Places", tone: "light", src: "/browser-wallpapers/alpine-dawn.webp", model: "GPT Image" },
  { id: "limestone-courtyard", name: "Quiet courtyard", category: "Places", tone: "light", src: "/browser-wallpapers/limestone-courtyard.webp", model: "GPT Image" },
  { id: "mineral-clouds", name: "Mineral light", category: "Abstract", tone: "light", src: "/browser-wallpapers/mineral-clouds.webp", model: "GPT Image" },
  { id: "aurora-valley", name: "Aurora valley", category: "Astral", tone: "dark", src: "/browser-wallpapers/aurora-valley.webp", model: "GPT Image" },
  { id: "astral-nebula", name: "Astral quiet", category: "Astral", tone: "dark", src: "/browser-wallpapers/astral-nebula.webp", model: "GPT Image" },
  { id: "moonlit-coast", name: "Moonlit coast", category: "Places", tone: "dark", src: "/browser-wallpapers/moonlit-coast.webp", model: "GPT Image" },
] as const;

export interface PageAppearancePreference {
  backgrounds: Record<AppearanceTheme, string>;
  random?: Partial<Record<AppearanceTheme, { nextChangeAt: number }>>;
}

type AppearancePatch =
  | { background: { theme: AppearanceTheme; value: string } }
  | { random: { theme: AppearanceTheme; enabled: boolean } };

function randomBackground(current: string, random: () => number): string {
  const candidates = WALLPAPERS.filter((wallpaper) => wallpaper.id !== current);
  return candidates[Math.floor(random() * candidates.length)].id;
}

function nextRandomChange(now: number, random: () => number): number {
  return now + RANDOM_BACKGROUND_MIN_DELAY_MS + Math.floor(
    random() * (RANDOM_BACKGROUND_MAX_DELAY_MS - RANDOM_BACKGROUND_MIN_DELAY_MS + 1),
  );
}

function stopRandomBackground(preference: PageAppearancePreference, theme: AppearanceTheme) {
  if (!preference.random) return;
  delete preference.random[theme];
  if (Object.keys(preference.random).length === 0) delete preference.random;
}

export function pageAppearanceKey(ownerKey: string, page: AppearancePage): string {
  return `breadboard:page-appearance:${encodeURIComponent(ownerKey.trim().toLowerCase())}:${page}`;
}

export function validBackground(value: unknown): value is string {
  return typeof value === "string" && (
    value === NO_WALLPAPER_ID || /^pixabay:\d{1,12}$/u.test(value) ||
    /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value) ||
    WALLPAPERS.some((wallpaper) => wallpaper.id === value)
  );
}

export function readPageAppearance(
  storage: Pick<Storage, "getItem">,
  ownerKey: string,
  page: AppearancePage,
): PageAppearancePreference {
  const fallback: PageAppearancePreference = { backgrounds: { light: "none", dark: "none" } };
  try {
    const raw = storage.getItem(pageAppearanceKey(ownerKey, page));
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PageAppearancePreference> | null;
      // Older records may contain a page theme. Keep their backgrounds while
      // leaving Light/Dark to the single app-wide preference.
      const preference: PageAppearancePreference = {
        backgrounds: {
          light: validBackground(parsed?.backgrounds?.light) ? parsed.backgrounds.light : "none",
          dark: validBackground(parsed?.backgrounds?.dark) ? parsed.backgrounds.dark : "none",
        },
      };
      for (const theme of ["light", "dark"] as const) {
        const nextChangeAt = parsed?.random?.[theme]?.nextChangeAt;
        if (typeof nextChangeAt === "number" && Number.isSafeInteger(nextChangeAt) && nextChangeAt >= 0) {
          (preference.random ??= {})[theme] = { nextChangeAt };
        }
      }
      return preference;
    }
    // Preserve each old choice until this page is customized independently.
    for (const theme of ["light", "dark"] as const) {
      const legacy = page === "browser"
        ? storage.getItem(`breadboard:browser-wallpaper:${ownerKey}:${theme}`)
        : storage.getItem("dashboard:bg-image");
      if (validBackground(legacy)) fallback.backgrounds[theme] = legacy;
    }
  } catch {
    // Invalid or unavailable storage must never stop a page from opening.
  }
  return fallback;
}

export function writePageAppearance(
  storage: Pick<Storage, "getItem" | "setItem">,
  ownerKey: string,
  page: AppearancePage,
  patch: AppearancePatch,
  { now = Date.now(), random = Math.random }: { now?: number; random?: () => number } = {},
): void {
  const next = readPageAppearance(storage, ownerKey, page);
  if ("background" in patch && validBackground(patch.background.value)) {
    next.backgrounds[patch.background.theme] = patch.background.value;
    stopRandomBackground(next, patch.background.theme);
  } else if ("random" in patch) {
    const { theme, enabled } = patch.random;
    if (enabled && !next.random?.[theme]) {
      next.backgrounds[theme] = randomBackground(next.backgrounds[theme], random);
      (next.random ??= {})[theme] = { nextChangeAt: nextRandomChange(now, random) };
    } else if (!enabled) {
      stopRandomBackground(next, theme);
    }
  }
  // Read immediately before writing so another customizer's picks are retained.
  // Let quota failures reach the UI instead of claiming the image was saved.
  storage.setItem(pageAppearanceKey(ownerKey, page), JSON.stringify(next));
}

/** Re-read saved deadlines so multiple mounted consumers do not rotate twice. */
export function advanceRandomBackgrounds(
  storage: Pick<Storage, "getItem" | "setItem">,
  ownerKey: string,
  page: AppearancePage,
  { now = Date.now(), random = Math.random }: { now?: number; random?: () => number } = {},
): boolean {
  const next = readPageAppearance(storage, ownerKey, page);
  let changed = false;
  for (const theme of ["light", "dark"] as const) {
    const rotation = next.random?.[theme];
    if (!rotation) continue;
    // Also recover if the system clock moved backward or a deadline is invalid.
    if (rotation.nextChangeAt > now && rotation.nextChangeAt <= now + RANDOM_BACKGROUND_MAX_DELAY_MS) continue;
    next.backgrounds[theme] = randomBackground(next.backgrounds[theme], random);
    rotation.nextChangeAt = nextRandomChange(now, random);
    changed = true;
  }
  if (changed) storage.setItem(pageAppearanceKey(ownerKey, page), JSON.stringify(next));
  return changed;
}

export function resolveWallpaper(value: string, theme: AppearanceTheme) {
  if (value === "none") return null;
  const preset = WALLPAPERS.find((wallpaper) => wallpaper.id === value);
  if (preset) return preset;
  const pixabayId = value.match(/^pixabay:(\d{1,12})$/u)?.[1];
  if (pixabayId) return { src: `/api/browser-wallpapers/pixabay?id=${pixabayId}&image=1`, tone: theme };
  return validBackground(value) && value.startsWith("data:image/") ? { src: value, tone: theme } : null;
}
