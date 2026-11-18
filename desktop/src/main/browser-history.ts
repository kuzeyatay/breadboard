import * as fs from "node:fs";
import * as path from "node:path";
import type { WebContents } from "electron";
import type { BrowserHistoryEntry, BrowserHistoryCommand, BrowserHistorySnapshot } from "../shared/ipc-contract";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_HISTORY_FILE = "browser-history.json";
type Visit = { title: string; visitedAt: number; days: string[] };
type StoredEntry = BrowserHistoryEntry & { visitsByUser?: Record<string, Visit> };

function pageUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

/** History belongs to the persistent browser partition, shared by its windows.
 * Only committed top-level pages enter it; renderer caches never replace it. */
export class BrowserHistory {
  private entries: StoredEntry[] | null = null;
  private error: string | null = null;
  private legacyOwner: string | null = null;
  private legacyChecked = false;

  constructor(private readonly configDir?: string, private readonly changed = () => {},
    private readonly owner: () => string | null = () => null) {}

  private load(): StoredEntry[] {
    if (this.entries) return this.entries;
    let entries: StoredEntry[] = [];
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
      return { items: items.map(({ url, title, visitedAt }) => ({ url, title, visitedAt })), error: this.error };
    } catch {
      return { items: [], error: "Couldn’t read browser history. Your saved file has been preserved." };
    }
  }

  private update(edit: (items: StoredEntry[]) => StoredEntry[]): boolean {
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
    this.update(items => {
      const previous = items.find(entry => entry.url === url);
      const visitedAt = Date.now();
      const owner = this.owner();
      const visitsByUser = { ...previous?.visitsByUser };
      const oldVisit = owner ? visitsByUser[owner] : undefined;
      const clean = title.trim().slice(0, 1000) || (owner ? oldVisit?.title : previous?.title) || new URL(url).hostname;
      if (owner) {
        const day = new Date(visitedAt).toISOString().slice(0, 10);
        visitsByUser[owner] = { title: clean, visitedAt, days: [...new Set([day, ...(oldVisit?.days ?? [])])].slice(0, 8) };
      }
      return [{ url, title: clean, visitedAt, visitsByUser }, ...items.filter(entry => entry.url !== url)];
    });
  }

  private title(input: string, title: string, owner: string | null): void {
    const url = pageUrl(input);
    const clean = title.trim().slice(0, 1000);
    // A title event after Clear must never resurrect a removed visit.
    if (owner !== this.owner() || !url || !clean || !this.entries?.some(entry => entry.url === url &&
      (entry.title !== clean || (owner && entry.visitsByUser?.[owner] && entry.visitsByUser[owner].title !== clean)))) return;
    this.update(items => items.map(entry => {
      if (entry.url !== url) return entry;
      const visit = owner && owner === this.owner() ? entry.visitsByUser?.[owner] : null;
      return { ...entry, title: clean, ...(owner && visit ? { visitsByUser: { ...entry.visitsByUser, [owner]: { ...visit, title: clean } } } : {}) };
    }));
  }

  /** Run after the dashboard has identified the account and before tabs restore. */
  restorePersonalHistory(): boolean {
    const owner = this.owner();
    if (!owner) return false;
    if (this.legacyChecked) return true;
    // Reserve a failed migration for its authenticated owner if accounts switch.
    this.legacyOwner ??= owner;
    if (this.legacyOwner !== owner) return false;
    try {
      // An empty map marks a signed-out visit. Pre-account versions omitted the field.
      if (this.load().some(entry => entry.visitsByUser === undefined)) {
        const saved = this.update(items => items.map(entry => {
          if (entry.visitsByUser !== undefined) return entry;
          const day = new Date(entry.visitedAt).toISOString().slice(0, 10);
          return { ...entry, visitsByUser: { [owner]: { title: entry.title, visitedAt: entry.visitedAt, days: [day] } } };
        }));
        if (!saved) return false;
      }
      this.legacyChecked = true;
      return true;
    } catch {
      this.error = "Couldn’t read browser history. Your saved file has been preserved.";
      return false;
    }
  }

  command(command: BrowserHistoryCommand): boolean {
    if (command.type === "remove") return this.update(items => items.filter(entry => entry.url !== command.url));
    if (command.type === "clear") return this.update(() => []);
    return command.type === "import-personal" && this.restorePersonalHistory();
  }

  attach(contents: WebContents): void {
    let visitOwner: string | null = null;
    contents.on("did-navigate", (_event, url) => { visitOwner = this.owner(); this.visit(url); });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) { visitOwner = this.owner(); this.visit(url, contents.getTitle()); }
    });
    contents.on("page-title-updated", (_event, title) => this.title(contents.getURL(), title, visitOwner));
    contents.on("did-finish-load", () => this.title(contents.getURL(), contents.getTitle(), visitOwner));
  }
}
