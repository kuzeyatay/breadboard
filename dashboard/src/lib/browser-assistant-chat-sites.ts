/**
 * Which website each browser-assistant chat was asked on, so its history can
 * read "This website" and "Other websites" like the Quartz Assistant's
 * "This page". Kept on this device only: the site is a view hint, never part
 * of the conversation itself.
 */
export interface BrowserAssistantChatSite {
  /** Hostname without "www.", the grouping key. */
  site: string;
  /** Last address the chat was used on. */
  url: string;
  /** Page title at that time, for the history row. */
  title: string;
}

const STORAGE_KEY = "breadboard:browser-assistant:chat-sites";
const MAX_ENTRIES = 500;

export function browserAssistantSiteKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./iu, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function readBrowserAssistantChatSites(): Record<string, BrowserAssistantChatSite> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, BrowserAssistantChatSite> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<BrowserAssistantChatSite> | null;
      if (entry && typeof entry.site === "string" && typeof entry.url === "string") {
        result[id] = { site: entry.site, url: entry.url, title: typeof entry.title === "string" ? entry.title : entry.site };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Remember the site a chat was just used on; returns the updated map. */
export function recordBrowserAssistantChatSite(
  chatId: string,
  url: string,
  title: string,
): Record<string, BrowserAssistantChatSite> {
  const current = readBrowserAssistantChatSites();
  const site = browserAssistantSiteKey(url);
  if (!site) return current;
  // Re-inserting moves the chat to the end, so trimming drops the oldest.
  delete current[chatId];
  current[chatId] = { site, url, title };
  const ids = Object.keys(current);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) delete current[id];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* Grouping is a convenience; a full or blocked store only loses it. */
  }
  return current;
}
