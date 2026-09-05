import { beginRuntimeIngestRecovery, bindRuntimeIngestRecovery, recoverRuntimeIngest } from "../runtime-v2/ingest-recovery-client.ts";

export const GARDEN_SOURCE_IMPORTED_EVENT = "breadboard:garden-source-imported";
const pending = new Set<string>();

interface SourceImportNotice {
  gardenId: string;
  kind: string;
  title: string;
  jobId: string | null;
  processing: boolean;
}

/** Both runtime adapters wrap tool JSON; unwrap only the known result envelopes. */
export function gardenSourceImportNotice(value: unknown, depth = 0): SourceImportNotice | null {
  if (depth > 6) return null;
  if (typeof value === "string") {
    if (value.length > 1_000_000) return null;
    try { return gardenSourceImportNotice(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ok === false || row.success === false || row.error) return null;
  const notice = row.sourceImport as Record<string, unknown> | undefined;
  if (notice && typeof notice.gardenId === "string" && notice.gardenId.length <= 256 &&
      typeof notice.kind === "string" && ["audio", "video", "link", "pdf"].includes(notice.kind)) {
    return {
      gardenId: notice.gardenId, kind: notice.kind,
      title: typeof notice.title === "string" ? notice.title.slice(0, 180) : "Imported source",
      jobId: typeof notice.jobId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(notice.jobId) ? notice.jobId : null,
      processing: notice.processing === true,
    };
  }
  for (const key of ["result", "data", "output", "details"]) {
    const result = gardenSourceImportNotice(row[key], depth + 1);
    if (result) return result;
  }
  return null;
}

export function handleGardenSourceImportResult(value: unknown): void {
  if (typeof window === "undefined") return;
  const notice = gardenSourceImportNotice(value);
  if (!notice) return;
  const notify = () => window.dispatchEvent(new CustomEvent(GARDEN_SOURCE_IMPORTED_EVENT, { detail: notice }));
  notify();
  if (notice.kind !== "pdf" || !notice.processing || !notice.jobId || pending.has(notice.jobId)) return;
  const jobId = notice.jobId;
  const requestId = jobId;
  pending.add(jobId);
  beginRuntimeIngestRecovery({
    requestId, clusterSlug: notice.gardenId, filename: `${notice.title.slice(0, 100)}.pdf`, fileKey: requestId, startedAt: Date.now(),
  });
  const record = bindRuntimeIngestRecovery(requestId, { jobId });
  if (!record) { pending.delete(jobId); return; }
  // Uses the same resumable SSE and reload recovery as manual uploads.
  void recoverRuntimeIngest(record, (event) => {
    if (event.type === "done" || event.type === "error") notify();
  }).catch(() => {}).finally(() => { pending.delete(jobId); notify(); });
}
