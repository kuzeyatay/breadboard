import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import type { BreadboardWindowTheme } from "./window-options";

export const WINDOW_THEME_STATE_FILE = "window-theme.json";

function isWindowTheme(value: unknown): value is BreadboardWindowTheme {
  return value === "light" || value === "dark";
}

export function readLastWindowTheme(configDir: string): BreadboardWindowTheme {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, WINDOW_THEME_STATE_FILE), "utf8"),
    ) as { theme?: unknown };
    return isWindowTheme(parsed.theme) ? parsed.theme : "light";
  } catch {
    return "light";
  }
}

export function writeLastWindowTheme(
  configDir: string,
  theme: BreadboardWindowTheme,
): void {
  fs.mkdirSync(configDir, { recursive: true });
  atomicWriteFile(
    path.join(configDir, WINDOW_THEME_STATE_FILE),
    JSON.stringify({ theme }, null, 2),
  );
}
