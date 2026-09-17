"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useWallpaperTone } from "./use-wallpaper-tone";
import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_MODE_CHANGE_EVENT,
  resolveAppTheme,
} from "@/lib/app-theme";
import {
  PAGE_APPEARANCE_CHANGE_EVENT, readPageAppearance, resolveWallpaper,
  advanceRandomBackgrounds, RANDOM_BACKGROUND_MAX_DELAY_MS,
  writePageAppearance, type AppearancePage,
} from "@/lib/page-appearance";

function subscribe(onChange: () => void) {
  const events = ["storage", PAGE_APPEARANCE_CHANGE_EVENT, APP_THEME_CHANGE_EVENT, APP_THEME_MODE_CHANGE_EVENT];
  for (const event of events) window.addEventListener(event, onChange);
  return () => { for (const event of events) window.removeEventListener(event, onChange); };
}

const serverSnapshot = JSON.stringify({ preference: { backgrounds: { light: "none", dark: "none" } }, appTheme: "light", ready: false });

export function usePageAppearance(ownerKey: string, page: AppearancePage) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checking = false;
    const refresh = () => {
      if (checking) return;
      checking = true;
      clearTimeout(timer);
      try {
        if (advanceRandomBackgrounds(window.localStorage, ownerKey, page)) {
          window.dispatchEvent(new Event(PAGE_APPEARANCE_CHANGE_EVENT));
        }
        const { random } = readPageAppearance(window.localStorage, ownerKey, page);
        const deadlines = Object.values(random ?? {}).map((rotation) => rotation.nextChangeAt);
        if (deadlines.length > 0) {
          timer = setTimeout(refresh, Math.max(1, Math.min(
            RANDOM_BACKGROUND_MAX_DELAY_MS, Math.min(...deadlines) - Date.now(),
          )));
        }
      } catch {
        // Keep the current image if storage is temporarily unavailable.
        timer = setTimeout(refresh, 60_000);
      } finally {
        checking = false;
      }
    };
    const events = ["storage", PAGE_APPEARANCE_CHANGE_EVENT, "focus", "pageshow"];
    for (const event of events) window.addEventListener(event, refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ownerKey, page]);

  const read = useCallback(() => {
    try {
      return JSON.stringify({ preference: readPageAppearance(window.localStorage, ownerKey, page), appTheme: resolveAppTheme(window.localStorage).theme, ready: true });
    } catch {
      return serverSnapshot;
    }
  }, [ownerKey, page]);
  const snapshot = useSyncExternalStore(subscribe, read, () => serverSnapshot);
  const { preference, appTheme, ready } = useMemo(() => JSON.parse(snapshot) as {
    preference: ReturnType<typeof readPageAppearance>;
    appTheme: "light" | "dark";
    ready: boolean;
  }, [snapshot]);
  const theme = appTheme;
  const wallpaper = resolveWallpaper(preference.backgrounds[theme], theme);
  const wallpaperTone = useWallpaperTone(wallpaper?.src, wallpaper?.tone ?? theme);
  const save = (patch: Parameters<typeof writePageAppearance>[3]) => {
    writePageAppearance(window.localStorage, ownerKey, page, patch);
    window.dispatchEvent(new Event(PAGE_APPEARANCE_CHANGE_EVENT));
  };
  return { preference, appTheme, theme, wallpaper, wallpaperTone, ready, hasWallpaper: Boolean(wallpaper), save };
}
