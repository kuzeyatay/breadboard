"use client";

import { useEffect } from "react";
import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_MESSAGE,
  APP_THEME_LOCATION_STORAGE_KEY,
  APP_THEME_MODE_CHANGE_EVENT,
  APP_THEME_MODE_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  appThemeForMoment,
  getStoredAppTheme,
  getStoredAppThemeLocation,
  getStoredAppThemeMode,
  isAppTheme,
  nextAppThemeTransition,
  rememberEffectiveAppTheme,
  type AppTheme,
} from "@/lib/app-theme";

interface DesktopThemeBridge {
  setTheme?: (theme: AppTheme) => Promise<boolean>;
}

function desktopThemeBridge(): DesktopThemeBridge | undefined {
  return (
    window as Window & { breadboardDesktop?: DesktopThemeBridge }
  ).breadboardDesktop;
}

function postThemeToFrame(frame: HTMLIFrameElement, theme: AppTheme): void {
  frame.contentWindow?.postMessage({ type: APP_THEME_MESSAGE, theme }, "*");
}

function synchronizeTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  void desktopThemeBridge()?.setTheme?.(theme).catch(() => false);
  for (const frame of document.querySelectorAll("iframe")) {
    postThemeToFrame(frame, theme);
  }
}

export default function AppThemeRuntime() {
  useEffect(() => {
    let theme = getStoredAppTheme(window.localStorage);
    let transitionTimer: number | null = null;

    const clearTransitionTimer = () => {
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      transitionTimer = null;
    };

    const refreshFromPreference = (announce: boolean) => {
      clearTransitionTimer();
      const mode = getStoredAppThemeMode(window.localStorage);
      const location = getStoredAppThemeLocation(window.localStorage);
      const nextTheme =
        mode === "sun"
          ? appThemeForMoment(new Date(), location)
          : getStoredAppTheme(window.localStorage);
      const changed = nextTheme !== theme;
      theme = nextTheme;
      rememberEffectiveAppTheme(theme);
      synchronizeTheme(theme);
      if (announce && changed) {
        window.dispatchEvent(
          new CustomEvent<AppTheme>(APP_THEME_CHANGE_EVENT, { detail: theme }),
        );
      }
      if (mode === "sun") {
        const transition = nextAppThemeTransition(new Date(), location);
        const delay = Math.max(
          1_000,
          Math.min(2_147_000_000, transition.getTime() - Date.now() + 1_000),
        );
        transitionTimer = window.setTimeout(
          () => refreshFromPreference(true),
          delay,
        );
      }
    };

    refreshFromPreference(false);

    const handleThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<unknown>).detail;
      if (!isAppTheme(nextTheme)) return;
      theme = nextTheme;
      synchronizeTheme(theme);
    };

    const handleModeChange = () => refreshFromPreference(true);

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === APP_THEME_MODE_STORAGE_KEY ||
        event.key === APP_THEME_LOCATION_STORAGE_KEY
      ) {
        refreshFromPreference(true);
        return;
      }
      if (
        event.key === APP_THEME_STORAGE_KEY &&
        getStoredAppThemeMode(window.localStorage) === "manual" &&
        isAppTheme(event.newValue)
      ) {
        theme = event.newValue;
        synchronizeTheme(theme);
      }
    };

    const handleFrameLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement) {
        postThemeToFrame(event.target, theme);
      }
    };

    window.addEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener(APP_THEME_MODE_CHANGE_EVENT, handleModeChange);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("load", handleFrameLoad, true);
    window.addEventListener("focus", handleModeChange);
    document.addEventListener("visibilitychange", handleModeChange);

    return () => {
      clearTransitionTimer();
      window.removeEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener(APP_THEME_MODE_CHANGE_EVENT, handleModeChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("load", handleFrameLoad, true);
      window.removeEventListener("focus", handleModeChange);
      document.removeEventListener("visibilitychange", handleModeChange);
    };
  }, []);

  return null;
}
