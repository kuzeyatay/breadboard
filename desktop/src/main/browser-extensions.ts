import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_EXTENSIONS_STATE_FILE = "browser-extensions.json";
const MAX_BROWSER_EXTENSIONS = 64;

interface BrowserExtensionsState {
  version: 1;
  paths: string[];
}

export function normalizeBrowserExtensionPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const candidate of value.slice(0, MAX_BROWSER_EXTENSIONS)) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 4_096) {
      continue;
    }
    const resolved = path.resolve(candidate);
    if (!path.isAbsolute(resolved)) continue;
    unique.add(resolved);
  }
  return [...unique];
}

export function readBrowserExtensionPaths(configDir: string): string[] {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, BROWSER_EXTENSIONS_STATE_FILE), "utf8"),
    ) as { paths?: unknown };
    return normalizeBrowserExtensionPaths(parsed.paths);
  } catch {
    return [];
  }
}

export function writeBrowserExtensionPaths(configDir: string, extensionPaths: string[]): void {
  const normalized = normalizeBrowserExtensionPaths(extensionPaths);
  const state: BrowserExtensionsState = { version: 1, paths: normalized };
  atomicWriteFile(
    path.join(configDir, BROWSER_EXTENSIONS_STATE_FILE),
    JSON.stringify(state, null, 2),
  );
}
