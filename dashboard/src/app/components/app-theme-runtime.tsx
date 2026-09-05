"use client";

import { useEffect } from "react";
import { hydrateComposerSwitches } from "@/app/components/composer-switch-preferences";
import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_MESSAGE,
  APP_THEME_LOCATION_STORAGE_KEY,
  APP_THEME_MODE_CHANGE_EVENT,
  APP_THEME_MODE_STORAGE_KEY,
  APP_THEME_OVERRIDE_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  appThemeScheduleForShell,
  clearAppThemeOverride,
  getStoredAppTheme,
  getStoredAppThemeLocation,
  getStoredAppThemeOverrideUntil,
  isAppTheme,
  nextAppThemeTransition,
  rememberEffectiveAppTheme,
  resolveAppTheme,
  type AppTheme,
  type AppThemeSchedule,
} from "@/lib/app-theme";

interface DesktopThemeBridge {
  setTheme?: (
    theme: AppTheme,
    schedule?: AppThemeSchedule,
  ) => Promise<boolean>;
}

function desktopThemeBridge(): DesktopThemeBridge | undefined {
  return (
    window as Window & { breadboardDesktop?: DesktopThemeBridge }
  ).breadboardDesktop;
}

function postThemeToFrame(frame: HTMLIFrameElement, theme: AppTheme): void {
  frame.contentWindow?.postMessage({ type: APP_THEME_MESSAGE, theme }, "*");
}

/** Keep the shell-provided launch hint from becoming stale if this exact page
 * is refreshed or recovered after an in-page theme change. Internal routes
 * without a launch hint continue to rely on this origin's localStorage. */
function updateLaunchThemeHint(theme: AppTheme): void {
  const current = new URL(window.location.href);
  if (!current.searchParams.has("theme")) return;
  if (current.searchParams.get("theme") === theme) return;
  current.searchParams.set("theme", theme);
  window.history.replaceState(window.history.state, "", current);
}

function synchronizeTheme(theme: AppTheme): void {
  rememberEffectiveAppTheme(theme);
  updateLaunchThemeHint(theme);
  // The shell paints the next launch's loading scene from what it is told
  // here, so it hears how the theme was chosen, not only which one it is.
  void desktopThemeBridge()
    ?.setTheme?.(theme, appThemeScheduleForShell(window.localStorage))
    .catch(() => false);
  for (const frame of document.querySelectorAll("iframe")) {
    postThemeToFrame(frame, theme);
  }
}

/**
 * How far ahead the automatic-theme timer is ever allowed to be set.
 *
 * A single timer armed for the exact sunrise instant is a monotonic-clock
 * deadline, and on Windows that clock does not advance while the machine is
 * asleep. A laptop closed at midnight wakes at nine with most of the night
 * still left to run on a timer that was due at dawn, so the page sits dark in
 * full daylight. Re-arming at most a minute out means every tick re-reads the
 * wall clock instead of trusting one long countdown, which also covers a
 * throttled background renderer and a clock the user (or NTP) moved.
 */
const THEME_RECHECK_INTERVAL_MS = 60_000;

export default function AppThemeRuntime() {
  useEffect(() => {
    let theme = getStoredAppTheme(window.localStorage);
    let transitionTimer: number | null = null;

    const clearTransitionTimer = () => {
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      transitionTimer = null;
    };

    // `reapply` writes the theme out even when it has not changed, for the
    // moments that genuinely need it: the first paint, and a window coming
    // back to the foreground with iframes that may have missed a change. The
    // minute tick leaves it off, so a quiet day costs nothing but the check.
    const refreshFromPreference = (announce: boolean, reapply = false) => {
      clearTransitionTimer();
      const now = new Date();
      // A manual pick made while following the sun stands until the next
      // sunrise or sunset; this tick must not put the sun's answer back early.
      const resolved = resolveAppTheme(window.localStorage, now);
      const { mode } = resolved;
      const nextTheme = resolved.theme;
      if (
        mode === "sun" &&
        !resolved.overridden &&
        getStoredAppThemeOverrideUntil(window.localStorage) !== null
      ) {
        clearAppThemeOverride();
      }
      const location = getStoredAppThemeLocation(window.localStorage);
      const changed = nextTheme !== theme;
      theme = nextTheme;
      if (changed || reapply) {
        rememberEffectiveAppTheme(theme, { animate: changed });
        synchronizeTheme(theme);
      }
      if (announce && changed) {
        window.dispatchEvent(
          new CustomEvent<AppTheme>(APP_THEME_CHANGE_EVENT, { detail: theme }),
        );
      }
      if (mode === "sun") {
        const transition = nextAppThemeTransition(now, location);
        const delay = Math.max(
          1_000,
          Math.min(
            THEME_RECHECK_INTERVAL_MS,
            transition.getTime() - Date.now() + 1_000,
          ),
        );
        transitionTimer = window.setTimeout(
          () => refreshFromPreference(true),
          delay,
        );
      }
    };

    refreshFromPreference(false, true);
    // The "Sunrise to sunset" switch lives on the account (see
    // lib/app-theme.ts). This runtime is in the root layout, so every page
    // brings it back, not only the ones with a composer. The request is shared
    // with the composer's own hydration when both are mounted.
    void hydrateComposerSwitches();

    const handleThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<unknown>).detail;
      if (!isAppTheme(nextTheme)) return;
      theme = nextTheme;
      synchronizeTheme(theme);
    };

    const handleModeChange = () => refreshFromPreference(true, true);

    // Another tab of this origin changed the preference. Every key goes back
    // through the resolver: a pick made there under the sun switch arrives as
    // an override write and a theme write, and only the resolver knows which
    // of the two the sun still outranks.
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === APP_THEME_MODE_STORAGE_KEY ||
        event.key === APP_THEME_LOCATION_STORAGE_KEY ||
        event.key === APP_THEME_OVERRIDE_STORAGE_KEY ||
        event.key === APP_THEME_STORAGE_KEY
      ) {
        refreshFromPreference(true, true);
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
