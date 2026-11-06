import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import { isTabGroupId, isInTabGroup, readTabGroups, type TabGroup } from "../shared/tab-groups";
import { normalizeTabGroups } from "./tab-groups";
import { authReturnPath, isAuthenticationUrl } from "../shared/auth-navigation";

export const TAB_SESSION_FILE = "tab-session.json";

export interface SavedTab {
  groupId?: string;
  kind: "dashboard" | "local" | "browser";
  url: string;
  title: string;
  anchored: boolean;
  highlighted?: boolean;
  keepLoaded?: boolean;
}

export interface SavedTabWindow {
  groups?: TabGroup[];
  savedGroups?: SavedTabGroup[];
  tabs: SavedTab[];
  activeIndex: number;
}

export interface SavedTabGroup extends TabGroup { tabs: SavedTab[]; groups?: TabGroup[] }

export interface TabSession {
  version: 1;
  windows: SavedTabWindow[];
}

/** Rebind only the previous dashboard origin, retaining the exact chat/document. */
export function rebaseDashboardUrl(value: string, previous: string, next: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(previous).origin) return value;
    const target = new URL(next);
    url.protocol = target.protocol;
    url.host = target.host;
    return url.toString();
  } catch {
    return value;
  }
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
  tab: { url: string; title: string; anchored: boolean; highlighted?: boolean; keepLoaded?: boolean; browser?: unknown; groupId?: string },
  dashboardUrl: string,
): SavedTab | null {
  if (tab.browser) {
    if (tab.url && !safeWebUrl(tab.url)) return null;
    return { kind: "browser", url: tab.url, title: tab.title, anchored: tab.anchored,
      ...(tab.highlighted === true ? { highlighted: true } : {}),
      ...(tab.keepLoaded === true ? { keepLoaded: true } : {}), ...(tab.groupId ? { groupId: tab.groupId } : {}) };
  }
  if (!safeWebUrl(tab.url)) return null;
  const url = new URL(tab.url);
  const dashboard = url.origin === new URL(dashboardUrl).origin;
  if (dashboard && isAuthenticationUrl(tab.url, dashboardUrl)) return null;
  // Do not restore the retired companion as a startup tab.
  if (dashboard && url.pathname.replace(/\/$/, "") === "/clicky") return null;
  return {
    kind: dashboard ? "dashboard" : "local",
    url: dashboard ? url.pathname + url.search + url.hash : url.toString(),
    title: tab.title,
    anchored: tab.anchored,
    ...(tab.highlighted === true ? { highlighted: true } : {}),
    ...(tab.keepLoaded === true ? { keepLoaded: true } : {}),
    ...(tab.groupId ? { groupId: tab.groupId } : {}),
  };
}

export function restoredTabUrl(tab: SavedTab, dashboardUrl: string): string | null {
  if (tab.kind !== "dashboard") {
    return ((tab.kind === "browser" && tab.url === "") || safeWebUrl(tab.url)) ? tab.url : null;
  }
  try {
    const origin = new URL(dashboardUrl).origin;
    const target = new URL(tab.url, origin);
    if (isAuthenticationUrl(target.href, origin)) {
      return new URL(authReturnPath(target.searchParams.get("callbackUrl"), origin, "/new-tab"), origin).href;
    }
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
        tabs.push({ ...withoutLoginPlaceholder(tab),
          ...(isTabGroupId(tab.groupId) ? { groupId: tab.groupId } : {}) });
      }
      const activeTabIndex = activeIndex;
      const tree = { tabs: tabs.map((tab, id) => ({ ...tab, id })), groups: readTabGroups(window.groups) };
      normalizeTabGroups(tree);
      const groups = tree.groups;
      const orderedTabs = tree.tabs.map(({ id: _id, ...tab }) => tab);
      activeIndex = Math.max(0, tree.tabs.findIndex(tab => tab.id === activeTabIndex));
      const savedGroups = readTabGroups(window.savedGroups).flatMap(group => {
        const source = window.savedGroups.find((entry: SavedTabGroup) => entry.id === group.id);
        const root = { ...group, parentId: undefined };
        const savedTree = readTabGroups([root, ...(Array.isArray(source?.groups) ? source.groups.filter((child: TabGroup) => child?.id !== group.id) : [])]);
        const descendants = savedTree.filter(child => isInTabGroup(savedTree, child.id, group.id));
        const members: SavedTab[] = Array.isArray(source?.tabs) ? source.tabs.filter((tab: SavedTab) =>
          tab && ["dashboard", "local", "browser"].includes(tab.kind) && typeof tab.url === "string" &&
          typeof tab.title === "string" && typeof tab.anchored === "boolean" && restoredTabUrl(tab, "http://127.0.0.1") !== null,
        ).map((tab: SavedTab) => ({ ...withoutLoginPlaceholder(tab), groupId: descendants.some(child => child.id === tab.groupId) ? tab.groupId : group.id })) : [];
        const savedHost = { tabs: members.map((tab, id) => ({ ...tab, id })), groups: descendants };
        normalizeTabGroups(savedHost);
        return members.length ? [{ ...root, tabs: savedHost.tabs.map(({ id: _id, ...tab }) => tab), groups: savedHost.groups.filter(child => child.id !== group.id) }] : [];
      });
      if (tabs.length || savedGroups.length) windows.push({ tabs: orderedTabs, activeIndex,
        ...(groups.length ? { groups } : {}), ...(savedGroups.length ? { savedGroups } : {}) });
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

function withoutLoginPlaceholder(tab: SavedTab): SavedTab {
  const origin = "http://127.0.0.1";
  const login = tab.kind === "dashboard" && isAuthenticationUrl(tab.url, origin);
  const restored = login ? new URL(restoredTabUrl(tab, origin)!) : null;
  return { kind: tab.kind, url: restored ? restored.pathname + restored.search + restored.hash : tab.url,
    title: login ? "" : tab.title, anchored: tab.anchored,
    ...(tab.highlighted === true ? { highlighted: true } : {}),
    ...(tab.keepLoaded === true ? { keepLoaded: true } : {}) };
}

function accountSessionDirectory(configDir: string, userId: string): string {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("Invalid tab session owner");
  return path.join(configDir, "tab-sessions", userId);
}

/** Claim the pre-account workspace once. Other accounts start with their own tabs. */
export function readAccountTabSession(configDir: string, userId: string): TabSession {
  const directory = accountSessionDirectory(configDir, userId);
  if (fs.existsSync(path.join(directory, TAB_SESSION_FILE))) return readTabSession(directory);
  const legacyPath = path.join(configDir, TAB_SESSION_FILE);
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    if (legacy.userId !== undefined && legacy.userId !== userId) return { version: 1, windows: [] };
    atomicWriteFile(legacyPath, JSON.stringify({ ...legacy, userId }));
    const saved = readTabSession(configDir);
    writeTabSession(directory, saved);
    return saved;
  } catch { return { version: 1, windows: [] }; }
}

export function writeAccountTabSession(configDir: string, userId: string, saved: TabSession): void {
  writeTabSession(accountSessionDirectory(configDir, userId), saved);
}
