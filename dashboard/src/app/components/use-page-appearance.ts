"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useWallpaperTone } from "./use-wallpaper-tone";
import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_MODE_CHANGE_EVENT,
  resolveAppTheme,
} from "@/lib/app-theme";
import {
  PAGE_APPEARANCE_CHANGE_EVENT, readPageAppearance, resolveWallpaper,
  writePageAppearance, type AppearancePage,
} from "@/lib/page-appearance";

function subscribe(onChange: () => void) {
  const events = ["storage", PAGE_APPEARANCE_CHANGE_EVENT, APP_THEME_CHANGE_EVENT, APP_THEME_MODE_CHANGE_EVENT];
  for (const event of events) window.addEventListener(event, onChange);
  return () => { for (const event of events) window.removeEventListener(event, onChange); };
}

const serverSnapshot = JSON.stringify({ preference: { backgrounds: { light: "none", dark: "none" } }, appTheme: "light", ready: false });

export function usePageAppearance(ownerKey: string, page: AppearancePage) {
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
