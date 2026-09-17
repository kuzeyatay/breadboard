"use client";

import { useSyncExternalStore } from "react";
import { APP_THEME_CHANGE_EVENT, type AppTheme } from "@/lib/app-theme";

/**
 * The theme the surface is actually painted in.
 *
 * The effect libraries used on the chat surfaces each ship their own `auto`
 * mode, and each resolves it differently: `metal-fx` and `border-beam` read
 * `prefers-color-scheme` only. Breadboard's theme is not the OS theme — it is
 * a stored preference that can also follow the sun (see `lib/app-theme.ts`),
 * and it is published as `data-theme` on the document element. Left on `auto`
 * those effects would be tuned for dark while the app is showing paper.
 *
 * So resolve it here, from the same source the rest of the app uses, and pass
 * the answer down explicitly.
 */
function currentTheme(): AppTheme {
  const explicit = document.documentElement.dataset["theme"];
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(APP_THEME_CHANGE_EVENT, onChange);
  // The theme runtime writes `data-theme` directly on a restore from the
  // shell, which does not always come with the change event.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    window.removeEventListener(APP_THEME_CHANGE_EVENT, onChange);
    observer.disconnect();
  };
}

/**
 * `null` on the server and for the first client render, so nothing paints a
 * guessed theme before the real one is known.
 */
export function useSurfaceTheme(): AppTheme | null {
  return useSyncExternalStore(subscribe, currentTheme, () => null);
}
