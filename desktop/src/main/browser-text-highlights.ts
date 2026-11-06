import { createHash, randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { sendTextHighlightRequest } from "./text-highlight-transport";
import { browserTextHighlightsBootstrapScript, browserTextHighlightsUpdateScript } from "./browser-text-highlights-dom";
import { normalizeWebTextHighlight, webHighlightUrl, type BrowserSelection, type WebTextHighlight } from "../shared/web-text-selection";

export type WebHighlightAction = "highlight" | "note" | "remove" | "chat" | "inline";

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
    const anchors = this.entries.map(({ note: _note, conversationId: _conversationId, ...entry }) => entry);
    return this.page.executeJavaScript(browserTextHighlightsUpdateScript(anchors)).then(() => undefined).catch(() => undefined);
  }

  /** Reinstall once per document, restore on SPA route changes, and reject late reads. */
  load(reinstall = true): Promise<void> {
    const url = webHighlightUrl(this.page.getURL());
    if (!reinstall && url === this.url) return this.loading;
    const revision = ++this.revision;
    const saves = this.saving;
    this.url = url; this.entries = []; this.hydrated = false;
    this.loading = (async () => {
      if (reinstall && !this.page.isDestroyed()) await this.page.executeJavaScript(browserTextHighlightsBootstrapScript());
      if (!url) return;
      await saves;
      const entries = this.privateBrowsing ? this.privateEntries.get(url) ?? [] : await this.sync(url);
      if (revision !== this.revision) return;
      this.entries = entries; this.hydrated = true;
      await this.paint(revision);
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
