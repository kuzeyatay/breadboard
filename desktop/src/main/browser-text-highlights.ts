import { createHash, randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { fetchFollowedHighlights, sendTextHighlightRequest, type FollowedHighlight } from "./text-highlight-transport";
import { browserTextHighlightsBootstrapScript, browserTextHighlightsUpdateScript } from "./browser-text-highlights-dom";
import { normalizeWebTextHighlight, webHighlightUrl, type BrowserSelection, type WebTextHighlight } from "../shared/web-text-selection";

export type WebHighlightAction = "highlight" | "note" | "remove" | "chat" | "inline";

/**
 * Colors for people you follow, none of them one you can highlight with
 * (blue, green, pink, purple) or the yellow of an answer. Each person keeps
 * the same color on every page.
 */
export const FOLLOWED_TONES = ["#f8b878", "#82d6cd", "#f2938a", "#cbe17f", "#d9c2a3"] as const;
export function followedTone(did: string): number {
  let hash = 0;
  for (let index = 0; index < did.length; index++) hash = (hash * 31 + did.charCodeAt(index)) >>> 0;
  return hash % FOLLOWED_TONES.length;
}
const shortHandle = (handle: string | null) => handle?.replace(/\.bsky\.social$/, "") ?? "";

/** One authenticated, URL-scoped annotation document per native page. Website
 * scripts cannot choose a storage key, user, endpoint, or conversation. */
export class BrowserTextHighlights {
  private entries: WebTextHighlight[] = [];
  private url: string | null = null;
  private revision = 0;
  private hydrated = false;
  private loading: Promise<void> = Promise.resolve();
  private saving: Promise<unknown> = Promise.resolve();
  private privateEntries = new Map<string, WebTextHighlight[]>();
  /** Passages on this page that people you follow left crumbs on. Never loaded in private browsing. */
  private followed: FollowedHighlight[] = [];

  constructor(private page: WebContents, private chrome: WebContents, private shellUrl: string, private privateBrowsing: boolean) {}

  private async sync(url: string, mutations: Array<{ operationId: string; id: string; value: WebTextHighlight | null }> = []) {
    const result = await sendTextHighlightRequest({ dashboardUrl: this.shellUrl,
      body: JSON.stringify({ key: "breadboard:web-highlights:v1:" + url, mutations }),
      readCookies: target => this.chrome.session.cookies.get({ url: target }),
    });
    if (result.status < 200 || result.status >= 300) throw new Error("Web highlights could not be saved. Try again.");
    const data = JSON.parse(result.body) as { entries?: unknown[] };
    if (!Array.isArray(data.entries)) throw new Error("Invalid highlight response.");
    return data.entries.flatMap(entry => { const value = normalizeWebTextHighlight(entry); return value ? [value] : []; });
  }

  private paint(revision: number) {
    if (revision !== this.revision || this.page.isDestroyed()) return Promise.resolve();
    // The note stays out of the page (its scripts can read what we hand it); a flag draws the dotted underline.
    const anchors = this.entries.map(({ note, conversationId: _conversationId, ...entry }) => note ? { ...entry, noted: true as const } : entry);
    // Followed passages reach the page as an anchor, a short id and a color: never who wrote them.
    const follows = this.followed.map((item, index) => ({ id: `f${index}`, quote: item.target.quote ?? "", prefix: item.target.prefix ?? "", suffix: item.target.suffix ?? "",
      tone: followedTone(item.people[0]!.did) }));
    return this.page.executeJavaScript(browserTextHighlightsUpdateScript(anchors, null, follows)).then(() => undefined).catch(() => undefined);
  }

  /** Reinstall once per document, restore on SPA route changes, and reject late reads. */
  load(reinstall = true): Promise<void> {
    const url = webHighlightUrl(this.page.getURL());
    if (!reinstall && url === this.url) return this.loading;
    const revision = ++this.revision;
    const saves = this.saving;
    this.url = url; this.entries = []; this.hydrated = false; this.followed = [];
    this.loading = (async () => {
      if (reinstall && !this.page.isDestroyed()) await this.page.executeJavaScript(browserTextHighlightsBootstrapScript());
      if (!url) return;
      await saves;
      const entries = this.privateBrowsing ? this.privateEntries.get(url) ?? [] : await this.sync(url);
      if (revision !== this.revision) return;
      this.entries = entries; this.hydrated = true;
      await this.paint(revision);
      if (this.privateBrowsing) return;
      // Your own highlights are painted first; what people you follow left follows when it arrives.
      const pageUrl = this.page.getURL();
      void fetchFollowedHighlights({ dashboardUrl: this.shellUrl, pageUrl, readCookies: target => this.chrome.session.cookies.get({ url: target }) })
        .then(followed => { if (revision === this.revision && followed.length) { this.followed = followed; return this.paint(revision); } })
        .catch(() => { /* Followed crumbs are an extra; the page reads fine without them. */ });
    })().catch(() => { /* The menu reports a failed read before accepting an edit. */ });
    return this.loading;
  }

  selection(entry: WebTextHighlight, mode: "chat" | "inline", title: string): BrowserSelection | null {
    if (!this.url) return null;
    const saved = this.entries.find(item => item.id === entry.id);
    return { text: entry.quote, title, url: this.url, requestId: randomUUID(),
      reference: { id: entry.id, mode, sourceMessageId: "web:" + createHash("sha256").update(this.url).digest("hex").slice(0, 32),
        start: entry.start, end: entry.end, quote: entry.quote, prefix: entry.prefix, suffix: entry.suffix,
        sourceUrl: this.url, sourceTitle: title },
      ...(saved?.conversationId ? { conversationId: saved.conversationId } : {}),
    };
  }
  saved(id: string) { return this.entries.find(entry => entry.id === id); }

  /** A followed passage by the short id the page knows it by. */
  followedPassage(id: string): FollowedHighlight | undefined {
    const match = /^f(\d{1,3})$/.exec(id);
    return match ? this.followed[Number(match[1])] : undefined;
  }

  /** What the hover card says for a painted passage: your note, or who you follow left a crumb on it. */
  hoverContent(id: string, kind: "note" | "follow"): { title?: string; body: string; tone?: string } | null {
    if (kind === "note") {
      const note = this.saved(id)?.note;
      return note ? { body: note } : null;
    }
    const passage = this.followedPassage(id);
    if (!passage) return null;
    const [first, ...others] = passage.people;
    const handle = shortHandle(first!.handle);
    const title = (handle && handle !== first!.name ? `${first!.name} @${handle}` : first!.name)
      + (others.length ? ` and ${others.length === 1 ? others[0]!.name : `${others.length} others`}` : "");
    return { title, body: first!.comment || "Left a crumb here", tone: FOLLOWED_TONES[followedTone(first!.did)] };
  }

  apply(entry: WebTextHighlight, action: WebHighlightAction, value?: string | null): Promise<void> {
    const url = this.url; const revision = this.revision;
    const loading = this.loading;
    const operation = async () => {
      await loading;
      if (!url || url !== webHighlightUrl(this.page.getURL()) || revision !== this.revision) throw new Error("Select the text again on the current page.");
      if (!this.hydrated && !this.privateBrowsing) {
        this.entries = await this.sync(url); this.hydrated = true;
      }
      const existing = this.entries.find(item => item.id === entry.id);
      // Page-supplied conversation ids are never accepted.
      const clean = { ...entry }; delete clean.conversationId;
      let next: WebTextHighlight | null = { ...existing, ...clean };
      if (action === "remove") next = existing?.mode ? { ...existing, color: undefined, note: undefined } : null;
      else if (action === "highlight") next.color = value as WebTextHighlight["color"];
      else if (action === "note") {
        next.note = value?.trim().slice(0, 4000) || undefined;
        if (!next.note && !next.color && !next.mode) next = null;
      } else next.mode = action;
      const mutations = [{ operationId: randomUUID(), id: entry.id, value: next }];
      const entries = this.privateBrowsing
        ? [...this.entries.filter(item => item.id !== entry.id), ...(next ? [next] : [])]
        : await this.sync(url, mutations);
      if (this.privateBrowsing) this.privateEntries.set(url, entries);
      if (revision !== this.revision) return;
      this.entries = entries; await this.paint(revision);
    };
    const result = this.saving.then(operation);
    this.saving = result.catch(() => undefined);
    return result;
  }

  erase(id: string, url: string): Promise<void> {
    const revision = this.revision; const loading = this.loading;
    const operation = async () => {
      await loading;
      if (url !== this.url || revision !== this.revision) throw new Error("Select the text again on the current page.");
      const entries = this.privateBrowsing ? this.entries.filter(item => item.id !== id)
        : await this.sync(url, [{ operationId: randomUUID(), id, value: null }]);
      if (this.privateBrowsing) this.privateEntries.set(url, entries);
      if (revision === this.revision) { this.entries = entries; await this.paint(revision); }
    };
    const result = this.saving.then(operation);
    this.saving = result.catch(() => undefined);
    return result;
  }

  bindConversation(id: string, url: string, conversationId: string): Promise<void> {
    const revision = this.revision;
    const operation = async () => {
      if (url !== this.url || revision !== this.revision || this.privateBrowsing) return;
      const entry = this.entries.find(item => item.id === id);
      if (!entry || entry.conversationId === conversationId) return;
      const entries = await this.sync(url, [{ operationId: randomUUID(), id, value: { ...entry, conversationId } }]);
      if (revision === this.revision) { this.entries = entries; await this.paint(revision); }
    };
    const result = this.saving.then(operation);
    this.saving = result.catch(() => undefined);
    return result;
  }
}
