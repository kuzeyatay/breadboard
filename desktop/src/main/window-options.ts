import type { BrowserWindowConstructorOptions } from "electron";

export const BREADBOARD_TITLE_BAR = {
  color: "#faf7ef",
  symbolColor: "#13201b",
  height: 32,
} as const;

export const BREADBOARD_DARK_TITLE_BAR = {
  color: "#171916",
  symbolColor: "#ccd2c9",
  height: 32,
} as const;

/** Voice mode paints the whole window terracotta, chrome included. */
export const BREADBOARD_VOICE_TITLE_BAR = {
  color: "#c1543c",
  symbolColor: "#fdeade",
  height: 32,
} as const;

export type BreadboardWindowTheme = "light" | "dark";

/**
 * What the window is showing. Usually that is just the theme — but a surface
 * that takes the entire window owns its chrome too, and a cream caption strip
 * across the top of voice mode reads as a bug rather than as the app frame.
 */
export type BreadboardWindowSurface = BreadboardWindowTheme | "voice";

export function isWindowSurface(value: unknown): value is BreadboardWindowSurface {
  return value === "light" || value === "dark" || value === "voice";
}

export function titleBarForSurface(surface: BreadboardWindowSurface) {
  if (surface === "voice") return BREADBOARD_VOICE_TITLE_BAR;
  return surface === "dark" ? BREADBOARD_DARK_TITLE_BAR : BREADBOARD_TITLE_BAR;
}

export function backgroundColorForSurface(surface: BreadboardWindowSurface): string {
  if (surface === "voice") return "#c1543c";
  return surface === "dark" ? "#0b0c0a" : "#faf7ef";
}

export function titleBarForTheme(theme: BreadboardWindowTheme) {
  return titleBarForSurface(theme);
}

/**
 * The sheet a window shows before its page has painted anything.
 *
 * Chromium paints the window's own background colour for the gap between "this
 * window exists" and "the renderer has a frame to show", and `revealWhenReady`
 * puts a ceiling on how long it will wait — so a page whose server half takes
 * longer than that ceiling is revealed as a flat sheet of this colour, with no
 * markup in it at all. A route's own `loading.tsx` cannot help: there is no
 * document yet for it to be part of.
 *
 * Breadboard's pages are paper, so paper is the right sheet for them. Keeping
 * the native sheet and title-bar paper identical also prevents a green flash
 * while the renderer is still preparing its first frame.
 */
export function popupBackgroundColor(
  targetUrl: string,
  theme: BreadboardWindowTheme,
): string {
  let pathname = "";
  try {
    pathname = new URL(targetUrl).pathname;
  } catch {
    // Not a URL this can read; the theme's own background stands.
  }
  if (pathname === "/buzz" || pathname.startsWith("/buzz/")) {
    // Buzz's gradient starts here — `--buzz-gradient-light-top` and its dark
    // twin, the same two colours `buzz-host.css` gives the caption strip.
    return theme === "dark" ? "#4a4616" : "#e6e6b6";
  }
  return backgroundColorForTheme(theme);
}

export function backgroundColorForTheme(theme: BreadboardWindowTheme): string {
  return backgroundColorForSurface(theme);
}

export function mainWindowOptions(
  preloadPath: string,
  iconPath?: string,
  platform: NodeJS.Platform = process.platform,
  theme: BreadboardWindowTheme = "light",
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: backgroundColorForTheme(theme),
    title: "Breadboard",
    ...(iconPath ? { icon: iconPath } : {}),
    ...(platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: titleBarForTheme(theme),
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: preloadPath,
      spellcheck: false,
      // Chromium parks timers and animation frames in windows that are hidden
      // or occluded. Breadboard leans on both while out of sight: the dashboard
      // is rendered in a hidden window behind the welcome screen, and popped-out
      // surfaces (the Work timer) have to keep counting when they lose focus.
      // Throttled, that hidden render never finishes and the swap lands on a
      // half-painted page.
      backgroundThrottling: false,
    },
  };
}
