import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ContextFact } from "./rank.ts";

type Row = {
  url?: string;
  title?: string;
  kind?: string;
  groupId?: string;
  visitedAt?: number;
  visitsByUser?: Record<string, { title: string; visitedAt: number; days: string[] }>;
};
type BrowserState = {
  version?: number;
  entries?: Row[];
  owners?: Record<string, Row[]>;
  windows?: Array<{ tabs?: Row[] }>;
};

// Check the atomic file's revision on every read, including after a history clear.
const cache = new Map<string, { revision: string; state: BrowserState }>();
async function readState(file: string): Promise<BrowserState> {
  try {
    const info = await stat(file, { bigint: true });
    if (Number(info.size) > 48_000_000) return {};
    const revision = [info.ino, info.mtimeNs, info.size].join("/");
    const cached = cache.get(file);
    if (cached?.revision === revision) return cached.state;
    const state = JSON.parse(await readFile(file, "utf8")) as BrowserState;
    if (state?.version !== 1) return {};
    if (cache.size >= 20) cache.delete(cache.keys().next().value!);
    cache.set(file, { revision, state });
    return state;
  } catch {
    cache.delete(file);
    return {};
  }
}

export function publicPage(input: unknown): string | null {
  try {
    if (typeof input !== "string" || input.length > 3000) return null;
    const url = new URL(input);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      /(?:^|[./_-])(oauth2?|sso|auth|login|logout|password|reset|token|magic-link|verify|signin|callback)(?:$|[./_-])/i.test(
        url.hostname + url.pathname,
      )
    )
      return null;
    if (url.pathname.split("/").some((part) => part.length > 64 || /%40|@/i.test(part))) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

export async function browserVisitFacts(root: string, userId: number, accept?: (url: string) => boolean, limit = Infinity): Promise<ContextFact[]> {
  if (!Number.isSafeInteger(userId) || userId < 1) return [];
  const history = await readState(path.join(root, "config", "browser-history.json"));
  const results: ContextFact[] = [];
  for (const row of history.entries ?? []) {
    const visit = row.visitsByUser?.[String(userId)];
    if (!visit || typeof visit.title !== "string" || !row.url || (accept && !accept(row.url))) continue;
    const at = new Date(visit.visitedAt).getTime();
    if (!Number.isFinite(at)) continue;
    const ref = publicPage(row.url);
    if (ref) results.push({ source: "history", ref, title: visit.title.slice(0, 180), at,
      days: Array.isArray(visit.days) ? Math.min(8, new Set(visit.days).size) : 1 });
    if (results.length >= limit) break;
  }
  return results;
}

export async function browserFacts(root: string, userId: number, email: string): Promise<ContextFact[]> {
  if (!Number.isSafeInteger(userId) || userId < 1) return [];
  const dir = path.join(root, "config");
  const [results, bookmarks, tabs] = await Promise.all([
    browserVisitFacts(root, userId),
    readState(path.join(dir, "browser-bookmarks.json")),
    readState(path.join(dir, "tab-sessions", String(userId), "tab-session.json")),
  ]);
  function add(row: Row, source: ContextFact["source"], observed?: number, days = 1) {
    const href = publicPage(row.url);
    if (!href || typeof row.title !== "string") return;
    results.push({ source, ref: href, title: row.title.slice(0, 180), at: observed || 0, days });
  }
  for (const row of bookmarks.owners?.[email.trim().toLowerCase() || String(userId)] ?? [])
    add(row, "bookmark");
  for (const window of tabs.windows ?? [])
    for (const tab of window.tabs ?? []) {
      if (tab.kind === "browser" && tab.groupId !== "breadboard-ai") add(tab, "tab");
    }
  return results;
}
