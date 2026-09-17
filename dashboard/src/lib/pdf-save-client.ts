import { gardenBusyRetryDelay } from "./pdf-save-retry.ts";

export type PdfSaveSnapshot = {
  state: "saved" | "saving" | "error";
  error: string;
  savedAt: string;
};

type SaveJob = {
  capture: () => Promise<Uint8Array>;
  bytes: Promise<Uint8Array> | null;
};
const queues = new Map<string, PdfSaveQueue>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function subscribePdfSaves(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function pendingPdfSaves() {
  return [...queues.values()].filter(queue => queue.snapshot.state !== "saved");
}

export function pdfSaveQueue(url: string, title = "PDF") {
  let queue = queues.get(url);
  if (!queue) {
    queue = new PdfSaveQueue(url, title);
    queues.set(url, queue);
  }
  return queue;
}

/** Owns uploads and retries for the lifetime of the app, independent of routes. */
export class PdfSaveQueue {
  snapshot: PdfSaveSnapshot = { state: "saved", error: "", savedAt: "" };
  private jobs: SaveJob[] = [];
  private running: Promise<boolean> | null = null;
  private listeners = new Set<(snapshot: PdfSaveSnapshot) => void>();
  private idleListeners = new Set<() => void>();
  readonly url: string;
  readonly title: string;
  private request: typeof fetch;

  constructor(url: string, title: string, request: typeof fetch = (...args) => fetch(...args)) {
    this.url = url;
    this.title = title;
    this.request = request;
  }

  subscribe(listener: (snapshot: PdfSaveSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  private update(snapshot: PdfSaveSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
    notify();
  }

  private capture(job: SaveJob) {
    // PDF.js snapshots annotation storage synchronously here, before teardown.
    try { job.bytes = job.capture(); }
    catch (error) { job.bytes = Promise.reject(error); }
    void job.bytes.catch(() => {});
    return job.bytes;
  }

  enqueue(capture: () => Promise<Uint8Array>) {
    const job: SaveJob = { capture, bytes: null };
    this.capture(job);
    this.jobs.push(job);
    return this.flush();
  }

  /** Reopening a PDF uses its latest queued bytes, even while the server is busy. */
  pendingBytes(): Promise<Uint8Array> | null {
    const job = this.jobs.at(-1);
    if (!job) return null;
    // PDF.js transfers the input buffer to its worker; keep our upload intact.
    return (job.bytes ?? this.capture(job)).then(bytes => bytes.slice());
  }

  whenIdle(): Promise<void> {
    if (!this.jobs.length) return Promise.resolve();
    return new Promise(resolve => { this.idleListeners.add(resolve); });
  }

  flush(): Promise<boolean> {
    if (this.running) return this.running;
    if (!this.jobs.length) return Promise.resolve(true);
    this.running = this.upload().finally(() => { this.running = null; });
    return this.running;
  }

  private async upload(): Promise<boolean> {
    this.update({ ...this.snapshot, state: "saving", error: "" });
    while (this.jobs.length) {
      const job = this.jobs[0];
      try {
        let bytes: Uint8Array;
        try { bytes = await (job.bytes ?? this.capture(job)); }
        catch (error) { job.bytes = null; throw error; }
        const response = await this.request(this.url, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const retryAfterMs = gardenBusyRetryDelay(body, response.status);
          if (retryAfterMs !== null) {
            await new Promise(resolve => setTimeout(resolve, retryAfterMs));
            continue;
          }
          throw new Error(typeof body.error === "string" ? body.error : "Could not save the edited PDF.");
        }
        this.jobs.shift();
      } catch (error) {
        // Retain the bytes and their place in the write order for an explicit retry.
        this.update({ ...this.snapshot, state: "error", error: error instanceof Error ? error.message : "Could not save the edited PDF." });
        return false;
      }
    }
    this.update({ state: "saved", error: "", savedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    for (const resolve of this.idleListeners) resolve();
    this.idleListeners.clear();
    return true;
  }
}

type EditablePdf = {
  annotationStorage: { serializable: { hash: string } };
  saveDocument(): Promise<Uint8Array>;
};

/** A content hash detects edits to an existing annotation as well as new IDs. */
export class PdfSaveSession {
  private hash: string;
  private document: EditablePdf;
  readonly queue: PdfSaveQueue;

  constructor(document: EditablePdf, queue: PdfSaveQueue) {
    this.document = document;
    this.queue = queue;
    this.hash = document.annotationStorage.serializable.hash;
  }

  get dirty() { return this.hash !== this.document.annotationStorage.serializable.hash; }

  save(): Promise<boolean> {
    if (!this.dirty) return this.queue.flush();
    this.hash = this.document.annotationStorage.serializable.hash;
    const document = this.document;
    return this.queue.enqueue(() => document.saveDocument());
  }
}
