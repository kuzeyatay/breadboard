import * as fs from "node:fs";
import * as path from "node:path";
import { isBrowserBookmarkOwnerKey, isBrowserRecentSearches } from "../shared/ipc-contract";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_RECENT_SEARCHES_STATE_FILE = "browser-recent-searches.json";

interface RecentSearchesState {
  version: 1;
  owners: Record<string, string[]>;
}

function readState(configDir: string): RecentSearchesState {
  const state: RecentSearchesState = { version: 1, owners: Object.create(null) };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, BROWSER_RECENT_SEARCHES_STATE_FILE), "utf8"));
    if (!parsed?.owners || typeof parsed.owners !== "object" || Array.isArray(parsed.owners)) {
      throw new Error("Invalid browser recent searches file");
    }
    for (const [owner, searches] of Object.entries(parsed.owners)) {
      if (!isBrowserBookmarkOwnerKey(owner) || !isBrowserRecentSearches(searches)) {
        throw new Error("Invalid browser recent searches record");
      }
      state.owners[owner] = searches;
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return state;
    // An unreadable collection must not be replaced by an empty startup cache.
    throw error;
  }
}

/** Like bookmarks, searches live in the persistent config directory per profile. */
export function readBrowserRecentSearches(configDir: string, ownerKey: string): string[] | null {
  if (!isBrowserBookmarkOwnerKey(ownerKey)) return null;
  return readState(configDir).owners[ownerKey] ?? null;
}

export function writeBrowserRecentSearches(configDir: string, ownerKey: string, searches: string[]): void {
  if (!isBrowserBookmarkOwnerKey(ownerKey) || !isBrowserRecentSearches(searches)) {
    throw new Error("Invalid browser recent searches");
  }
  const state = readState(configDir);
  state.owners[ownerKey] = searches;
  atomicWriteFile(path.join(configDir, BROWSER_RECENT_SEARCHES_STATE_FILE), JSON.stringify(state, null, 2));
}
