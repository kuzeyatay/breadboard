import type { PublicVideoTranscriptionJob } from "./scriberr/types.ts";
import { mediaKindForFilename } from "./video-transcription-ui.ts";

export interface MediaUploadEntry {
  id: string;
  job: PublicVideoTranscriptionJob;
}

interface MediaUploadInput {
  clusterSlug: string;
  files?: File[];
  youtubeUrl?: string;
  analyzeVisuals: boolean;
  keepMedia: boolean;
}

interface PendingUpload {
  file: File | null;
  retryAt: number;
}

// Like document uploads, the queue belongs to the browser session, not a
// mounted garden. Only one file is transferred at a time; accepted jobs then
// belong to the server's durable transcription queue. Release their File
// references immediately, but retain failed files for an explicit retry.
export function createGardenMediaUploadQueue({
  request = (...args) => fetch(...args),
  retryDelayMs = 10_000,
}: {
  request?: typeof fetch;
  retryDelayMs?: number;
} = {}) {
  let entries: readonly MediaUploadEntry[] = [];
  const listeners = new Set<() => void>();
  const pending = new Map<string, PendingUpload>();
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const notify = () => { for (const listener of listeners) listener(); };
  const update = (id: string, patch: Partial<PublicVideoTranscriptionJob>) => {
    entries = entries.map(entry => entry.id === id
      ? { ...entry, job: { ...entry.job, ...patch, updatedAt: new Date().toISOString() } }
      : entry);
    notify();
  };

  async function drain() {
    if (running) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    running = true;
    try {
      for (;;) {
        const entry = entries.find(item => item.job.status === "queued" &&
          pending.has(item.id) && pending.get(item.id)!.retryAt <= Date.now());
        if (!entry) break;
        const input = pending.get(entry.id)!;
        const { job } = entry;
        update(entry.id, {
          status: "uploading",
          currentStage: input.file ? "Uploading media" : "Checking YouTube URL",
          errorMessage: null,
          completedAt: null,
        });
        try {
          let init: RequestInit;
          if (input.file) {
            const form = new FormData();
            form.append("media", input.file, input.file.name);
            form.append("analysis", job.analysis ?? "transcript");
            form.append("retainMedia", job.retainMedia ? "true" : "false");
            init = { method: "POST", body: form };
          } else {
            init = {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ youtubeUrl: job.originalUrl, analysis: job.analysis, retainMedia: job.retainMedia }),
            };
          }
          const response = await request(`/api/gardens/${encodeURIComponent(job.gardenId)}/video-transcriptions`, init);
          const data = await response.json().catch(() => ({})) as {
            job?: PublicVideoTranscriptionJob;
            duplicate?: boolean;
            source?: { title?: string; sourceRelPath?: string; sourceSlug?: string };
            error?: string;
            errorCode?: string;
          };
          if (response.status === 429 && data.errorCode === "queue_full") {
            input.retryAt = Date.now() + retryDelayMs;
            update(entry.id, { status: "queued", currentStage: "Waiting for a transcription slot" });
            continue;
          }
          if (!response.ok) throw new Error(data.error ?? "Failed to start transcription.");
          if (data.job) {
            pending.delete(entry.id);
            update(entry.id, data.job);
          } else if (data.duplicate && data.source) {
            pending.delete(entry.id);
            update(entry.id, {
              status: "completed", progressPercent: 100, currentStage: "Source already available",
              sourceTitle: data.source.title ?? null,
              outputRelativePath: data.source.sourceRelPath ?? null,
              sourceSlug: data.source.sourceSlug ?? null,
              completedAt: new Date().toISOString(),
            });
          } else {
            throw new Error("The upload was accepted but no transcription job was created.");
          }
        } catch (error) {
          update(entry.id, {
            status: "failed", currentStage: "Upload failed",
            errorMessage: error instanceof Error ? error.message : "Failed to start transcription.",
            completedAt: new Date().toISOString(),
          });
        }
      }
    } finally {
      running = false;
      const nextTimes = entries.filter(entry => entry.job.status === "queued" && pending.has(entry.id))
        .map(entry => pending.get(entry.id)!.retryAt);
      if (nextTimes.length) timer = setTimeout(() => { void drain(); }, Math.max(0, Math.min(...nextTimes) - Date.now()));
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => entries,
    reconcile(jobs: PublicVideoTranscriptionJob[]) {
      const byId = new Map(jobs.map(job => [job.id, job]));
      let changed = false;
      const next = entries.map(entry => {
        const job = byId.get(entry.job.id);
        if (!job || pending.has(entry.id) || JSON.stringify(job) === JSON.stringify(entry.job)) return entry;
        changed = true;
        return { ...entry, job };
      });
      if (changed) { entries = next; notify(); }
    },
    enqueue(input: MediaUploadInput): string[] {
      const files: (File | null)[] = input.files?.length ? input.files : input.youtubeUrl?.trim() ? [null] : [];
      const createdAt = new Date().toISOString();
      const added = files.map(file => {
        const id = `client-${crypto.randomUUID()}`;
        pending.set(id, { file, retryAt: 0 });
        const job: PublicVideoTranscriptionJob = {
          id, gardenId: input.clusterSlug, inputKind: file ? "upload" : "youtube",
          analysis: input.analyzeVisuals && (!file || mediaKindForFilename(file.name) === "video") ? "watch" : "transcript",
          retainMedia: input.keepMedia, status: "queued", progressPercent: null, currentStage: "Waiting to upload",
          originalFilename: file?.name ?? null, originalUrl: file ? null : input.youtubeUrl!.trim(),
          canonicalUrl: null, youtubeVideoId: null, sourceTitle: null, videoMetadata: null,
          outputRelativePath: null, sourceSlug: null, errorCode: null, errorMessage: null,
          createdAt, updatedAt: createdAt, completedAt: null,
        };
        return { id, job };
      });
      entries = [...entries, ...added];
      notify();
      void drain();
      return added.map(entry => entry.id);
    },
    cancel(id: string) {
      const entry = entries.find(item => item.id === id);
      if (!entry || !pending.has(id) || !["queued", "failed"].includes(entry.job.status)) return;
      pending.delete(id);
      update(id, { status: "cancelled", currentStage: "Cancelled", completedAt: new Date().toISOString() });
      void drain();
    },
    retry(id: string) {
      const entry = entries.find(item => item.id === id);
      const input = pending.get(id);
      if (!entry || !input || entry.job.status !== "failed") return;
      input.retryAt = 0;
      update(id, { status: "queued", currentStage: "Waiting to upload", errorMessage: null, completedAt: null });
      void drain();
    },
  };
}

export const gardenMediaUploadQueue = createGardenMediaUploadQueue();
export const emptyMediaUploads: readonly MediaUploadEntry[] = [];
