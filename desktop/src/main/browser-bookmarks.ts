import * as fs from "node:fs";
import * as path from "node:path";
import {
  isBrowserBookmarkOwnerKey,
  isBrowserBookmarks,
  type BrowserBookmark,
} from "../shared/ipc-contract";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_BOOKMARKS_STATE_FILE = "browser-bookmarks.json";
export const BROWSER_SHORTCUTS_STATE_FILE = "browser-shortcuts.json";

interface BrowserBookmarksState {
  version: 1;
  owners: Record<string, BrowserBookmark[]>;
}

function emptyState(): BrowserBookmarksState {
  return { version: 1, owners: Object.create(null) as Record<string, BrowserBookmark[]> };
}

function readState(configDir: string, fileName: string): BrowserBookmarksState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(configDir, fileName), "utf8"),
    ) as { owners?: unknown };
    if (!parsed.owners || typeof parsed.owners !== "object" || Array.isArray(parsed.owners)) {
      throw new Error("Invalid saved browser sites file");
    }
    const state = emptyState();
    for (const [ownerKey, bookmarks] of Object.entries(parsed.owners)) {
      if (isBrowserBookmarkOwnerKey(ownerKey) && isBrowserBookmarks(bookmarks)) {
        state.owners[ownerKey] = bookmarks;
      }
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    // An unreadable existing file is not an empty collection. Preserve it and
    // fail the request instead of overwriting it with the next renderer save.
    throw error;
  }
}

/** Bookmarks belong to the signed-in profile but live outside the dashboard origin. */
export function readBrowserBookmarks(
  configDir: string,
  ownerKey: string,
): BrowserBookmark[] | null {
  if (!isBrowserBookmarkOwnerKey(ownerKey)) return null;
  return readState(configDir, BROWSER_BOOKMARKS_STATE_FILE).owners[ownerKey] ?? null;
}

export function writeBrowserBookmarks(
  configDir: string,
  ownerKey: string,
  bookmarks: BrowserBookmark[],
): void {
  writeSavedSites(configDir, BROWSER_BOOKMARKS_STATE_FILE, ownerKey, bookmarks);
}

/** Start-page shortcuts use their own collection, separate from starred pages. */
export function readBrowserShortcuts(configDir: string, ownerKey: string): BrowserBookmark[] | null {
  if (!isBrowserBookmarkOwnerKey(ownerKey)) return null;
  return readState(configDir, BROWSER_SHORTCUTS_STATE_FILE).owners[ownerKey] ?? null;
}

export function writeBrowserShortcuts(configDir: string, ownerKey: string, shortcuts: BrowserBookmark[]): void {
  if (shortcuts.length > 8) throw new Error("Too many browser shortcuts");
  writeSavedSites(configDir, BROWSER_SHORTCUTS_STATE_FILE, ownerKey, shortcuts);
}

function writeSavedSites(configDir: string, fileName: string, ownerKey: string, bookmarks: BrowserBookmark[]): void {
  if (!isBrowserBookmarkOwnerKey(ownerKey) || !isBrowserBookmarks(bookmarks)) {
    throw new Error("Invalid browser bookmarks");
  }
  const state = readState(configDir, fileName);
  state.owners[ownerKey] = bookmarks;
  atomicWriteFile(
    path.join(configDir, fileName),
    JSON.stringify(state, null, 2),
  );
}
