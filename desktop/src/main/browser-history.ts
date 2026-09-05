import * as fs from "node:fs";
import * as path from "node:path";
import type { WebContents } from "electron";
import type { BrowserHistoryEntry, BrowserHistoryCommand, BrowserHistorySnapshot } from "../shared/ipc-contract";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_HISTORY_FILE = "browser-history.json";

function pageUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

/** History belongs to the persistent browser partition, shared by its windows.
 * Only committed top-level pages enter it; renderer caches never replace it. */
export class BrowserHistory {
  private entries: BrowserHistoryEntry[] | null = null;
  private error: string | null = null;

  constructor(private readonly configDir?: string, private readonly changed = () => {}) {}

  private load(): BrowserHistoryEntry[] {
    if (this.entries) return this.entries;
    let entries: BrowserHistoryEntry[] = [];
    if (this.configDir) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(this.configDir, BROWSER_HISTORY_FILE), "utf8"));
        if (state?.version !== 1 || !Array.isArray(state.entries) || !state.entries.every((entry: BrowserHistoryEntry) =>
          entry && typeof entry.url === "string" && pageUrl(entry.url) === entry.url &&
          typeof entry.title === "string" && Number.isFinite(entry.visitedAt),
        )) throw new Error("Invalid browser history file");
        entries = state.entries;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.entries = entries;
    return entries;
  }

  snapshot(): BrowserHistorySnapshot {
    try {
      const items = this.load();
      return { items: items.map((entry) => ({ ...entry })), error: this.error };
    } catch {
      return { items: [], error: "Couldn’t read browser history. Your saved file has been preserved." };
    }
  }

  private update(edit: (items: BrowserHistoryEntry[]) => BrowserHistoryEntry[]): boolean {
    try {
      const entries = edit(this.load());
      if (this.configDir) {
        atomicWriteFile(path.join(this.configDir, BROWSER_HISTORY_FILE), JSON.stringify({ version: 1, entries }));
      }
      this.entries = entries;
      this.error = null;
      this.changed();
      return true;
    } catch {
      this.error = "Couldn’t save browser history. Try again.";
      this.changed();
      return false;
    }
  }

  visit(input: string, title = ""): void {
    const url = pageUrl(input);
    if (!url) return;
    this.update((items) => [{
      url, title: title.trim().slice(0, 1000) || items.find((entry) => entry.url === url)?.title || new URL(url).hostname,
      visitedAt: Date.now(),
    }, ...items.filter((entry) => entry.url !== url)]);
  }

  private title(input: string, title: string): void {
    const url = pageUrl(input);
    const clean = title.trim().slice(0, 1000);
    // A title event after Clear must never resurrect a removed visit.
    if (!url || !clean || !this.entries?.some((entry) => entry.url === url && entry.title !== clean)) return;
    this.update((items) => items.map((entry) => entry.url === url ? { ...entry, title: clean } : entry));
  }

  command(command: BrowserHistoryCommand): boolean {
    return this.update((items) => command.type === "clear" ? [] : items.filter((entry) => entry.url !== command.url));
  }

  attach(contents: WebContents): void {
    contents.on("did-navigate", (_event, url) => this.visit(url));
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) this.visit(url, contents.getTitle());
    });
    contents.on("page-title-updated", (_event, title) => this.title(contents.getURL(), title));
    contents.on("did-finish-load", () => this.title(contents.getURL(), contents.getTitle()));
  }
}
