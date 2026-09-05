import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";

export const TAB_SESSION_FILE = "tab-session.json";

export interface SavedTab {
  kind: "dashboard" | "local" | "browser";
  url: string;
  title: string;
  anchored: boolean;
}

export interface SavedTabWindow {
  tabs: SavedTab[];
  activeIndex: number;
}

export interface TabSession {
  version: 1;
  windows: SavedTabWindow[];
}

function safeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Dashboard paths survive the runtime choosing a different loopback port. */
export function saveTab(
  tab: { url: string; title: string; anchored: boolean; browser?: unknown },
  dashboardUrl: string,
): SavedTab | null {
  if (tab.browser) {
    if (tab.url && !safeWebUrl(tab.url)) return null;
    return { kind: "browser", url: tab.url, title: tab.title, anchored: tab.anchored };
  }
  if (!safeWebUrl(tab.url)) return null;
  const url = new URL(tab.url);
  const dashboard = url.origin === new URL(dashboardUrl).origin;
  // Clicky is an explicitly launched companion, never a startup tab.
  if (dashboard && url.pathname.replace(/\/$/, "") === "/clicky") return null;
  return {
    kind: dashboard ? "dashboard" : "local",
    url: dashboard ? url.pathname + url.search + url.hash : url.toString(),
    title: tab.title,
    anchored: tab.anchored,
  };
}

export function restoredTabUrl(tab: SavedTab, dashboardUrl: string): string | null {
  if (tab.kind !== "dashboard") {
    return ((tab.kind === "browser" && tab.url === "") || safeWebUrl(tab.url)) ? tab.url : null;
  }
  try {
    const origin = new URL(dashboardUrl).origin;
    const target = new URL(tab.url, origin);
    if (target.pathname.replace(/\/$/, "") === "/clicky") return null;
    return tab.url.startsWith("/") && target.origin === origin ? target.toString() : null;
  } catch {
    return null;
  }
}

export function readTabSession(configDir: string): TabSession {
  const empty: TabSession = { version: 1, windows: [] };
  try {
    const value = JSON.parse(fs.readFileSync(path.join(configDir, TAB_SESSION_FILE), "utf8"));
    if (value?.version !== 1 || !Array.isArray(value.windows)) return empty;
    const windows: SavedTabWindow[] = [];
    for (const window of value.windows) {
      if (!window || !Array.isArray(window.tabs)) continue;
      const tabs: SavedTab[] = [];
      let activeIndex = 0;
      for (const [index, tab] of window.tabs.entries()) {
        if (!tab || !["dashboard", "local", "browser"].includes(tab.kind) ||
            typeof tab.url !== "string" || typeof tab.title !== "string" ||
            typeof tab.anchored !== "boolean" ||
            restoredTabUrl(tab, "http://127.0.0.1") === null) continue;
        if (index === window.activeIndex) activeIndex = tabs.length;
        tabs.push({ kind: tab.kind, url: tab.url, title: tab.title, anchored: tab.anchored });
      }
      if (tabs.length) windows.push({ tabs, activeIndex });
    }
    return { version: 1, windows };
  } catch {
    return empty;
  }
}

export function writeTabSession(configDir: string, session: TabSession): void {
  fs.mkdirSync(configDir, { recursive: true });
  atomicWriteFile(path.join(configDir, TAB_SESSION_FILE), JSON.stringify(session));
}
