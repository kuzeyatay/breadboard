import { websiteIconUrl } from "./browser-site-icon";

export interface BrowserBookmark { url: string; title: string; iconUrl: string }
export const MAX_BOOKMARKS = 40;
export const bookmarksKey = (owner: string) => `breadboard:browser-bookmarks:${owner}`;
export function safeBookmarkIcon(value: unknown, pageUrl: string): string {
  if (typeof value === "string" && value.length <= 2_048) {
    if (/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/iu.test(value)) {
      return value;
    }
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      // The site favicon fallback below is safer than retaining an invalid URL.
    }
  }
  return websiteIconUrl(pageUrl);
}

export function bookmarkFromUnknown(value: unknown): BrowserBookmark | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.title !== "string") return null;
  try {
    const url = new URL(record.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const title = record.title.trim().slice(0, 100);
    if (!title) return null;
    return {
      url: url.toString(),
      title,
      iconUrl: safeBookmarkIcon(record.iconUrl, url.toString()),
    };
  } catch {
    return null;
  }
}

export function normalizeBookmarks(value: unknown): BrowserBookmark[] {
  return (Array.isArray(value) ? value : [])
    .map(bookmarkFromUnknown)
    .filter((bookmark): bookmark is BrowserBookmark => Boolean(bookmark))
    .filter((bookmark, index, values) =>
      values.findIndex((candidate) => candidate.url === bookmark.url) === index,
    )
    .slice(0, MAX_BOOKMARKS);
}
