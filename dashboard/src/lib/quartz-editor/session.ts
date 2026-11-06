export interface Draft { body: string; title: string; tags: string[] }
export interface SavedDocument extends Draft { revision: string; accountId: string; canEdit: boolean }
export class EditorRequestError extends Error {
  constructor(public result: Record<string, any>) { super(result.error || "The request failed."); }
}

export class EditorTransport {
  readonly sessionId = crypto.randomUUID();
  private disposed = false;
  private pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timer: number }>();
  constructor(readonly slug: string, readonly origin: string) { window.addEventListener("message", this.receive); }
  private receive = (event: MessageEvent) => {
    const data = event.data;
    if (event.source !== window.parent || event.origin !== this.origin || data?.type !== "second-brain:document-editor-result" ||
        data.slug !== this.slug || data.sessionId !== this.sessionId) return;
    const request = this.pending.get(data.requestId); if (!request) return;
    clearTimeout(request.timer); this.pending.delete(data.requestId);
    if (data.ok) request.resolve(data); else request.reject(new EditorRequestError(data));
  };
  request(action: string, payload?: unknown): Promise<any> {
    if (this.disposed) return Promise.reject(new Error("Editor closed"));
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => { this.pending.delete(requestId); reject(new Error(action === "get"
        ? "Could not load the page for editing. Click Edit to retry."
        : "The request timed out. Your draft is retained.")); }, action === "video" ? 300_000 : 45_000);
      this.pending.set(requestId, { resolve, reject, timer });
      window.parent.postMessage({ type: "second-brain:document-editor", slug: this.slug, sessionId: this.sessionId, requestId, action, payload }, this.origin);
    });
  }
  destroy() { this.disposed = true; window.removeEventListener("message", this.receive); for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Editor closed")); } this.pending.clear(); }
}

export interface RecoveryRecord { draft: Draft; base: SavedDocument; updatedAt: number }
export class DraftRecovery {
  private db: Promise<IDBDatabase>;
  constructor(readonly key: string) {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open("breadboard-document-drafts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
  }
  async read(): Promise<RecoveryRecord | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => { const request = db.transaction("drafts").objectStore("drafts").get(this.key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async write(value: RecoveryRecord | null, backup = false) {
    const db = await this.db;
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite"), store = transaction.objectStore("drafts");
      if (value) store.put(value, this.key + (backup ? `:backup:${Date.now()}:${crypto.randomUUID()}` : "")); else store.delete(this.key);
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Draft recovery was interrupted."));
    });
  }
  destroy() { void this.db.then(db => db.close(), () => {}); }
}

export const sameDraft = (a: Draft, b: Draft) => a.body === b.body && a.title === b.title && JSON.stringify(a.tags) === JSON.stringify(b.tags);

/** One serialized save stream. An acknowledgement only commits the sent snapshot. */
export class SaveSession {
  draft: Draft;
  base: SavedDocument;
  conflict: SavedDocument | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private maximum: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private generation = 0;
  private disposed = false;
  constructor(base: SavedDocument, private send: (patch: object) => Promise<any>, private recovery: Pick<DraftRecovery, "write">,
    private status: (message: string, error?: Error) => void, private saved: (revision: string) => void) {
    this.base = base; this.draft = { body: base.body, title: base.title, tags: [...base.tags] };
  }
  get dirty() { return !sameDraft(this.draft, this.base); }
  update(draft: Draft) {
    if (this.disposed) return;
    if (!sameDraft(draft, this.draft)) {
      this.draft = draft; ++this.generation;
      void this.recovery.write(this.dirty ? { draft, base: this.base, updatedAt: Date.now() } : null).catch(error => this.status("Draft recovery unavailable", error));
    }
    if (this.conflict) return;
    this.status(this.dirty ? "Unsaved changes" : "Saved");
    clearTimeout(this.idle);
    if (!this.dirty) { clearTimeout(this.maximum); this.maximum = undefined; return; }
    this.idle = setTimeout(() => void this.flush().catch(() => {}), 750);
    this.maximum ??= setTimeout(() => void this.flush().catch(() => {}), 5000);
  }
  async flush(): Promise<void> {
    clearTimeout(this.idle); clearTimeout(this.maximum); this.maximum = undefined;
    if (this.running) { await this.running; if (this.dirty) return this.flush(); return; }
    if (this.conflict) throw new Error("Choose which version to keep before saving.");
    if (!this.dirty || this.disposed) return;
    if (!this.draft.title.trim()) { this.status("Enter a page title to save."); throw new Error("Enter a page title to save."); }
    const snapshot = { ...this.draft, tags: [...this.draft.tags] }, generation = this.generation;
    const patch: Record<string, unknown> = { baseRevision: this.base.revision };
    if (snapshot.body !== this.base.body) patch.body = snapshot.body;
    if (snapshot.title !== this.base.title) patch.title = snapshot.title;
    if (JSON.stringify(snapshot.tags) !== JSON.stringify(this.base.tags)) patch.tags = snapshot.tags;
    this.status("Saving…");
    this.running = (async () => {
      try {
        const result = await this.send(patch);
        if (typeof result.revision !== "string") throw new Error("The server did not confirm the saved revision.");
        this.base = { ...this.base, ...snapshot, title: result.title ?? snapshot.title, tags: result.tags ?? snapshot.tags, revision: result.revision };
        if (generation === this.generation) this.draft = { ...this.base };
        this.saved(this.base.revision); this.status(this.dirty ? "Unsaved changes" : "Saved");
        await this.recovery.write(this.dirty ? { draft: this.draft, base: this.base, updatedAt: Date.now() } : null)
          .catch(error => this.status("Saved. Local draft recovery is unavailable.", error));
      } catch (error) {
        if (error instanceof EditorRequestError && error.result.status === 409) this.conflict = { ...this.base, ...error.result };
        this.status(this.conflict ? "This page changed elsewhere. Review both versions." : "Could not save. Retry", error as Error);
        throw error;
      } finally { this.running = null; }
    })();
    await this.running;
    if (this.dirty && !this.disposed) return this.flush();
  }
  async resolve(useMine: boolean) {
    if (!this.conflict) return;
    await this.recovery.write({ draft: useMine ? this.conflict : this.draft, base: this.base, updatedAt: Date.now() }, true);
    this.base = this.conflict; this.conflict = null;
    if (!useMine) this.draft = { ...this.base };
    this.update(this.draft);
    await this.flush();
  }
  destroy() { this.disposed = true; clearTimeout(this.idle); clearTimeout(this.maximum); }
}
