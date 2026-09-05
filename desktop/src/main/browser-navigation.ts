import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_NAVIGATION_STATE_FILE = "browser-navigation.json";

/**
 * Whether windows carry browser-style tabs along their caption strip.
 *
 * This is a property of the shell, not of an account: the tabs are native
 * views the main process owns, the shortcuts that drive them are intercepted
 * before any page sees the keys, and a window that has not signed in yet still
 * has to know whether Ctrl+T means anything. It sits beside the startup sound
 * and the window theme for the same reason they do.
 *
 * Anything unreadable, missing, or malformed leaves navigation on. Only an
 * explicit `false` is somebody's decision.
 */
export function readBrowserNavigationEnabled(configDir: string): boolean {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, BROWSER_NAVIGATION_STATE_FILE), "utf8"),
    ) as { enabled?: unknown };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

export function writeBrowserNavigationEnabled(configDir: string, enabled: boolean): void {
  fs.mkdirSync(configDir, { recursive: true });
  atomicWriteFile(
    path.join(configDir, BROWSER_NAVIGATION_STATE_FILE),
    JSON.stringify({ enabled }, null, 2),
  );
}
