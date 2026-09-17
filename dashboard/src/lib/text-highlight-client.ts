import { highlightEntries, highlightEntryId, TEXT_HIGHLIGHT_PREFIXES, type HighlightEntry, type HighlightMutation } from "./text-highlight-types.ts";

type Listener = (entries: HighlightEntry[], error: string | null) => void;
const stores = new Map<string, TextHighlightClient>();
const migrations = new Set<string>();

export async function retryTextHighlightSaves() {
  await Promise.all([...stores.values()].map(store => store.flush()));
}

/** Back up existing marks even when their particular chat/page is not reopened. */
async function migrateHighlightCaches(endpoint: string) {
  if (migrations.has(endpoint)) return;
  migrations.add(endpoint);
  const keys = new Set<string>();
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const storedKey = localStorage.key(index);
      if (!storedKey) continue;
      const key = storedKey.startsWith("breadboard:highlight-outbox:")
        ? decodeURIComponent(storedKey.slice("breadboard:highlight-outbox:".length).split(":")[0])
        : storedKey;
      if (!TEXT_HIGHLIGHT_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      if (key !== storedKey || (localStorage.getItem(key)?.length ?? 0) > 2) keys.add(key);
    }
  } catch { /* The open document still hydrates from the database. */ }
  // Sequential imports avoid flooding the local server with old documents.
  for (const key of keys) await openTextHighlights(key, endpoint).flush();
}

/** One store per document: writes happen at the action, never in a React save effect. */
export function openTextHighlights(key: string, endpoint = "/api/text-highlights") {
  const identity = `${endpoint}|${key}`;
  let store = stores.get(identity);
  if (!store) {
    store = new TextHighlightClient(key, endpoint, () => stores.delete(identity));
    stores.set(identity, store);
    queueMicrotask(() => void migrateHighlightCaches(endpoint));
  }
  return store;
}

export class TextHighlightClient {
  private entries: HighlightEntry[] = [];
  private pending = new Map<string, HighlightMutation>();
  private listeners = new Set<Listener>();
  private running: Promise<void> | null = null;
  private migration: HighlightEntry[] = [];
  private operationClock = 0;
  private error: string | null = null;
  private hydrated = false;
  private lastSyncedAt = 0;
  private timer: ReturnType<typeof setInterval>;
  private journalPrefix: string;

  constructor(private key: string, private endpoint: string, private evict: () => void) {
    this.journalPrefix = `breadboard:highlight-outbox:${encodeURIComponent(key)}:`;
    try { this.entries = highlightEntries(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { /* Database hydration follows. */ }
    this.migration = [...this.entries];
    this.readPending();
    this.entries = this.overlay(this.entries);
    this.timer = setInterval(() => {
      // Retry writes promptly. Idle documents must not fill Chromium's shared
      // connection pool with a POST per store in every open desktop tab.
      const refresh = this.listeners.size > 0 && document.hasFocus() && Date.now() - this.lastSyncedAt >= 60_000;
      void this.flush(refresh);
    }, 10_000);
    window.addEventListener("online", this.refresh);
    window.addEventListener("focus", this.refresh);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("storage", this.onStorage);
  }

  getSnapshot() { return this.entries; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.entries, this.error);
    void this.flush(true);
    return () => {
      this.listeners.delete(listener);
      if (this.pending.size) void this.flush();
      this.release();
    };
  }

  private refresh = () => { void this.flush(true); };
  private onPageHide = () => {
    if (!this.running) { void this.flush(); return; }
    if (!this.pending.size) return;
    // Do not let a slow initial read hold a new mark in browser storage when
    // the app closes. The operation receipts make this independent flush safe.
    const body = JSON.stringify({ key: this.key, mutations: [...this.pending.values()] });
    if (new TextEncoder().encode(body).length >= 60_000) return;
    void fetch(this.endpoint, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body, keepalive: true,
    }).catch(() => { /* The journal retries on the next open. */ });
  };
  private onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(this.journalPrefix)) void this.flush();
    // A different tab can commit after this one has already read its journal.
    if (event.key === this.key && event.newValue !== JSON.stringify(this.entries)) void this.flush(true);
  };

  private release() {
    if (this.listeners.size || this.pending.size || this.migration.length || this.running) return;
    clearInterval(this.timer);
    window.removeEventListener("online", this.refresh);
    window.removeEventListener("focus", this.refresh);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("storage", this.onStorage);
    this.evict();
  }

  private emit() { for (const listener of this.listeners) listener(this.entries, this.error); }

  private readPending() {
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(this.journalPrefix)) continue;
        try {
          const op = JSON.parse(localStorage.getItem(key) ?? "null") as HighlightMutation | null;
          if (op && typeof op.operationId === "string" && typeof op.id === "string" &&
              (op.value === null || highlightEntryId(op.value) === op.id)) {
            this.pending.set(op.operationId, op);
            this.operationClock = Math.max(this.operationClock, Number(op.operationId.split("-")[0]) || 0);
          }
        } catch { /* One corrupt record must not hide the remaining marks. */ }
      }
    } catch { /* Network persistence still works when browser storage is blocked. */ }
  }

  private overlay(entries: HighlightEntry[]) {
    const current = new Map(entries.map(entry => [highlightEntryId(entry)!, entry]));
    for (const op of [...this.pending.values()].sort((a, b) => a.operationId.localeCompare(b.operationId))) {
      if (op.value === null) current.delete(op.id);
      else current.set(op.id, op.value);
    }
    return [...current.values()];
  }

  update(next: unknown) {
    const entries = highlightEntries(next);
    if (JSON.stringify(entries) === JSON.stringify(this.entries)) return;
    const before = new Map(this.entries.map(entry => [highlightEntryId(entry)!, entry]));
    const after = new Map(entries.map(entry => [highlightEntryId(entry)!, entry]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (JSON.stringify(before.get(id)) === JSON.stringify(after.get(id))) continue;
      const op = {
        operationId: `${(this.operationClock = Math.max(Date.now(), this.operationClock + 1)).toString().padStart(16, "0")}-${crypto.randomUUID()}`,
        id, value: after.get(id) ?? null,
      };
      this.pending.set(op.operationId, op);
      // Independent journal records stop two tabs from overwriting each other's unsent edits.
      try {
        localStorage.setItem(this.journalPrefix + op.operationId, JSON.stringify(op));
        // Streams amend the same answer repeatedly. Keep the latest durable
        // intent instead of accumulating a full answer copy for every token.
        for (const prior of this.pending.values()) {
          if (prior.id === id && prior.operationId !== op.operationId) {
            localStorage.removeItem(this.journalPrefix + prior.operationId);
            this.pending.delete(prior.operationId);
          }
        }
      }
      catch { this.error = "Highlights are waiting to be saved. Keep this page open until saving finishes."; }
    }
    this.entries = entries;
    this.cache();
    this.emit();
    void this.flush();
  }

  private cache() {
    try { localStorage.setItem(this.key, JSON.stringify(this.entries)); } catch { /* The journal and database are independent backups. */ }
  }

  flush(refresh = false): Promise<void> {
    // A retry joins an in-flight save and waits for every queued batch. It must
    // not report completion while an earlier request still holds the edits.
    if (this.running) return this.running;
    this.readPending();
    if (!refresh && this.hydrated && !this.pending.size && !this.migration.length) return Promise.resolve();
    this.running = this.sync().finally(() => {
      this.running = null;
      this.release();
    });
    return this.running;
  }

  private async sync(): Promise<void> {
    do {
      this.readPending();
      // Bound requests even when migrating years of annotations or long answers.
      const entries: HighlightEntry[] = [];
      const mutations: HighlightMutation[] = [];
      let bytes = 0;
      for (const entry of this.migration) {
        const size = new TextEncoder().encode(JSON.stringify(entry)).length;
        if (bytes && bytes + size > 512_000) break;
        entries.push(entry); bytes += size;
      }
      for (const op of [...this.pending.values()].sort((a, b) => a.operationId.localeCompare(b.operationId))) {
        const size = new TextEncoder().encode(JSON.stringify(op)).length;
        if (bytes && bytes + size > 512_000) break;
        mutations.push(op); bytes += size;
      }
      try {
        const body = JSON.stringify({ key: this.key, entries, mutations });
        const response = await fetch(this.endpoint, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body,
          priority: mutations.length || entries.length ? "high" : "low",
          // Keep ordinary edits alive when the user navigates away immediately.
          keepalive: new TextEncoder().encode(body).length < 60_000,
          signal: AbortSignal.timeout(15_000),
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.entries) || !Array.isArray(data.acknowledged)) throw new Error("Highlight sync failed");
        for (const id of data.acknowledged as string[]) {
          this.pending.delete(id);
          try { localStorage.removeItem(this.journalPrefix + id); } catch { /* Retrying is idempotent. */ }
        }
        const imported = new Set(entries.map(highlightEntryId));
        this.migration = this.migration.filter(entry => !imported.has(highlightEntryId(entry)));
        const merged = new Map([...this.migration, ...highlightEntries(data.entries)].map(entry => [highlightEntryId(entry)!, entry]));
        const next = this.overlay([...merged.values()]);
        const changed = JSON.stringify(next) !== JSON.stringify(this.entries) || this.error !== null;
        this.entries = next;
        this.hydrated = true;
        this.lastSyncedAt = Date.now();
        this.error = null;
        this.cache();
        if (changed) this.emit();
      } catch {
        // A failed refresh cannot turn acknowledged, durable highlights into
        // unsaved work. Only uncommitted edits/imports need a save warning.
        const error = this.migration.length || this.pending.size
          ? "Highlights could not be saved to Breadboard. Saving will retry automatically."
          : null;
        if (error !== this.error) { this.error = error; this.emit(); }
        return;
      }
    } while (this.pending.size || this.migration.length);
  }
}
