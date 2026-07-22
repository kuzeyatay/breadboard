import type { BrowserWindowConstructorOptions } from "electron";

export const BREADBOARD_TITLE_BAR = {
  color: "#faf7ef",
  symbolColor: "#13201b",
  height: 40,
} as const;

export function mainWindowOptions(
  preloadPath: string,
  iconPath?: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#e6f0e6",
    title: "Breadboard",
    ...(iconPath ? { icon: iconPath } : {}),
    ...(platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: BREADBOARD_TITLE_BAR,
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: preloadPath,
      spellcheck: false,
    },
  };
}
