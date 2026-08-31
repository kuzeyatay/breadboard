"use client";

// Garden Chat media import panel: upload a local video/audio file or paste a
// YouTube URL (mutually exclusive), submit for asynchronous Scriberr transcription,
// and follow the job through a persistent progress card that survives page
// refreshes. On completion the transcript Markdown lives under the garden's
// sources/ folder and the parent workspace is notified to refresh its tree.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import BreadboardLoader from "@/app/components/breadboard-loader";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  ACCEPTED_VIDEO_EXTENSIONS,
  MEDIA_FILE_ACCEPT_ATTR,
  formatBytes,
  formatElapsed,
  formatVideoDuration,
  hasActiveJob,
  isTerminalJob,
  mediaKindForFilename,
  nextPollDelayMs,
  statusLabel,
  validateMediaFile,
  validateYouTubeInput,
} from "@/lib/video-transcription-ui";
import type { PublicVideoTranscriptionJob } from "@/lib/scriberr/types";

const CLIENT_MAX_UPLOAD_BYTES = 2048 * 1024 * 1024;

interface YouTubePreview {
  videoId: string;
  canonicalUrl: string;
  metadataAvailable: boolean;
  metadata: {
    title: string | null;
    channel: string | null;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
  } | null;
}

interface HealthInfo {
  enabled: boolean;
  scriberr: { ok: boolean; detail?: string };
  ytdlp: { ok: boolean; detail?: string };
  ffmpeg: { ok: boolean; detail?: string };
  ffprobe: { ok: boolean; detail?: string };
}

export interface GardenVideoImportProps {
  clusterSlug: string;
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
  onSourceCreated?: (info: {
    jobId: string;
    sourceTitle: string;
    sourceRelPath: string;
    sourceSlug: string;
    mediaKind: "audio" | "video";
  }) => void;
}

function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return <BreadboardLoader className={className} />;
}

export default function GardenVideoImport({
  clusterSlug,
  isOwner,
  open,
  onClose,
  onSourceCreated,
}: GardenVideoImportProps) {
  const [jobs, setJobs] = useState<PublicVideoTranscriptionJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [preview, setPreview] = useState<YouTubePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef<number>(Date.now());
  const completedSeenRef = useRef<Set<string>>(new Set());
  const onSourceCreatedRef = useRef(onSourceCreated);
  onSourceCreatedRef.current = onSourceCreated;

  const apiBase = `/api/gardens/${encodeURIComponent(clusterSlug)}/video-transcriptions`;

  const applyJobs = useCallback(
    (nextJobs: PublicVideoTranscriptionJob[]) => {
      setJobs(nextJobs);
      for (const job of nextJobs) {
        if (
          job.status === "completed" &&
          job.sourceSlug &&
          job.outputRelativePath &&
          !completedSeenRef.current.has(job.id)
        ) {
          completedSeenRef.current.add(job.id);
          // Only announce completions observed while the panel is live; jobs
          // already complete on first load are history, not news.
          if (jobsLoaded) {
            onSourceCreatedRef.current?.({
              jobId: job.id,
              sourceTitle: job.sourceTitle ?? "Media transcript",
              sourceRelPath: job.outputRelativePath,
              sourceSlug: job.sourceSlug,
              mediaKind:
                job.inputKind === "youtube"
                  ? "video"
                  : mediaKindForFilename(job.originalFilename ?? ""),
            });
          }
        }
      }
    },
    [jobsLoaded],
  );

  const fetchJobs = useCallback(async (): Promise<
    PublicVideoTranscriptionJob[] | null
  > => {
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        jobs?: PublicVideoTranscriptionJob[];
      };
      if (res.ok && Array.isArray(data.jobs)) {
        return data.jobs;
      }
    } catch {
      // Polling silently tolerates transient failures.
    }
    return null;
  }, [apiBase]);

  // Restore jobs (and any in-flight progress) on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await fetchJobs();
      if (cancelled) return;
      if (restored) {
        for (const job of restored) {
          if (job.status === "completed") completedSeenRef.current.add(job.id);
        }
        setJobs(restored);
      }
      setJobsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchJobs]);

  // Dependency health, fetched once when the panel mounts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/health`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          health?: HealthInfo;
        };
        if (!cancelled && res.ok && data.health) setHealth(data.health);
      } catch {
        // Health display is advisory only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  // Single self-rescheduling poll loop; stops on terminal states and never
  // duplicates across rerenders (ref-guarded timer).
  useEffect(() => {
    if (!jobsLoaded) return;
    if (!hasActiveJob(jobs)) return;

    const delay = nextPollDelayMs(jobs, Date.now() - pollStartedAtRef.current);
    if (delay <= 0) return;
    if (pollTimerRef.current !== null) return;

    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      void fetchJobs().then((nextJobs) => {
        if (nextJobs) applyJobs(nextJobs);
      });
    }, delay);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [jobs, jobsLoaded, fetchJobs, applyJobs]);

  // Elapsed-time ticker while a job is active.
  useEffect(() => {
    if (!hasActiveJob(jobs)) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [jobs]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const selectFile = useCallback((file: File | null) => {
    setSubmitError(null);
    setDuplicateNotice(null);
    if (!file) {
      setSelectedFile(null);
      setFileError(null);
      return;
    }
    // The inputs are alternatives: choosing a file clears the URL side.
    setYoutubeUrl("");
    setUrlError(null);
    setPreview(null);
    const validation = validateMediaFile(file, CLIENT_MAX_UPLOAD_BYTES);
    setFileError(validation.ok ? null : (validation.message ?? null));
    setSelectedFile(file);
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) selectFile(file);
  };

  const handleUrlChange = (value: string) => {
    setYoutubeUrl(value);
    setSubmitError(null);
    setDuplicateNotice(null);
    setPreview(null);
    if (value.trim()) {
      // Entering a URL clears the file side (alternative inputs).
      setSelectedFile(null);
      setFileError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const validation = validateYouTubeInput(value);
      setUrlError(validation.ok ? null : (validation.message ?? null));
    } else {
      setUrlError(null);
    }
  };

  const checkYouTubeUrl = useCallback(async () => {
    const validation = validateYouTubeInput(youtubeUrl);
    if (!validation.ok) {
      setUrlError(validation.message ?? null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`${apiBase}/inspect-youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as YouTubePreview & {
        error?: string;
      };
      if (!res.ok) {
        setUrlError(data.error ?? "Could not check this YouTube URL.");
        return;
      }
      setUrlError(null);
      setPreview(data);
    } catch {
      setUrlError("Could not check this YouTube URL.");
    } finally {
      setPreviewLoading(false);
    }
  }, [apiBase, youtubeUrl]);

  const canSubmit =
    !submitting &&
    ((selectedFile !== null && !fileError) ||
      (youtubeUrl.trim() !== "" && !urlError && selectedFile === null));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setDuplicateNotice(null);
    try {
      let res: Response;
      if (selectedFile) {
        const form = new FormData();
        form.append("media", selectedFile, selectedFile.name);
        res = await fetch(apiBase, { method: "POST", body: form });
      } else {
        res = await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl: youtubeUrl.trim() }),
        });
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        duplicate?: boolean;
        job?: PublicVideoTranscriptionJob;
        source?: { title?: string; sourceRelPath?: string };
      };
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to start transcription.");
        return;
      }
      if (data.duplicate) {
        setDuplicateNotice(
          data.source
            ? `Already imported as “${data.source.title ?? data.source.sourceRelPath}”.`
            : "This media file is already being transcribed.",
        );
      }
      if (!data.job && !data.duplicate) {
        setSubmitError("The upload was accepted but no transcription job was created.");
        return;
      }

      // The create response is authoritative for the handoff. Paint that job
      // before clearing the chosen file, then preserve it if the immediate list
      // read is briefly stale (or the runner has not committed its next state
      // yet). Without this bridge an accepted upload appeared to vanish.
      const acceptedJob = data.job ?? null;
      if (acceptedJob) {
        applyJobs([
          acceptedJob,
          ...jobs.filter((job) => job.id !== acceptedJob.id),
        ]);
      }
      setSelectedFile(null);
      setFileError(null);
      setYoutubeUrl("");
      setUrlError(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      pollStartedAtRef.current = Date.now();
      const refreshedJobs = await fetchJobs();
      if (refreshedJobs) {
        applyJobs(
          acceptedJob && !refreshedJobs.some((job) => job.id === acceptedJob.id)
            ? [acceptedJob, ...refreshedJobs]
            : refreshedJobs,
        );
      }
    } catch {
      setSubmitError("Failed to start transcription.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        pollStartedAtRef.current = Date.now();
        const refreshedJobs = await fetchJobs();
        if (refreshedJobs) applyJobs(refreshedJobs);
      }
    } catch {
      // The next poll shows the true state.
    } finally {
      setBusyJobId(null);
    }
  };

  const healthIssues: string[] = [];
  if (health && !health.enabled) {
    healthIssues.push("Media transcription is disabled (VIDEO_TRANSCRIPTION_ENABLED).");
  }
  if (health?.enabled && !health.scriberr.ok) {
    healthIssues.push("Scriberr is not reachable — start Scriberr to transcribe media.");
  }
  if (health?.enabled && !health.ytdlp.ok) {
    healthIssues.push("yt-dlp not found — YouTube previews will be limited.");
  }
  if (health?.enabled && !health.ffprobe.ok) {
    healthIssues.push("ffprobe not found — uploads cannot be validated.");
  }

  const activeJobs = jobs
    .filter((job) => !isTerminalJob(job))
    .slice(0, 6);

  const composer = isOwner ? (
        <div className="space-y-3 px-5 py-4">
          {healthIssues.length > 0 && (
            <div className="space-y-0.5">
              {healthIssues.map((issue) => (
                <p key={issue} className="text-[11px] leading-4 text-amber-600">
                  {issue}
                </p>
              ))}
            </div>
          )}

          {/* Video or audio file upload */}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={[
              "rounded-md border border-dashed px-3 py-3 text-center transition-colors",
              dragActive
                ? "border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_8%,transparent)]"
                : "border-gray-800 hover:border-gray-700",
            ].join(" ")}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={MEDIA_FILE_ACCEPT_ATTR}
              onChange={handleFileChange}
              className="hidden"
              id="garden-media-file-input"
              aria-label="Video or audio file"
            />
            {selectedFile ? (
              <div className="flex items-center justify-between gap-2 text-left">
                <div className="min-w-0">
                  <p className="truncate text-xs text-gray-200" title={selectedFile.name}>
                    {selectedFile.name}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {formatBytes(selectedFile.size)}
                    {fileError ? "" : " · ready to transcribe"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    selectFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
                  aria-label="Remove selected media file"
                  title="Remove selected media file"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <label
                htmlFor="garden-media-file-input"
                className="block cursor-pointer"
              >
                <span className="text-xs text-gray-400">
                  Drop video or audio here, or{" "}
                  <span className="text-[var(--botanical)] underline underline-offset-2 transition-colors hover:text-[var(--botanical-hover)]">
                    choose a file
                  </span>
                </span>
                <span className="mt-1 block text-[10px] text-gray-600">
                  Video: {ACCEPTED_VIDEO_EXTENSIONS.join(" ")}
                </span>
                <span className="block text-[10px] text-gray-600">
                  Audio: {ACCEPTED_AUDIO_EXTENSIONS.join(" ")}
                </span>
              </label>
            )}
            {fileError && (
              <p className="mt-1.5 text-[11px] text-red-400">{fileError}</p>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-700">
            <span className="h-px flex-1 bg-gray-800" />
            or
            <span className="h-px flex-1 bg-gray-800" />
          </div>

          {/* YouTube URL */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={youtubeUrl}
                onChange={(event) => handleUrlChange(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  if (pasted.trim()) {
                    event.preventDefault();
                    handleUrlChange(pasted.trim());
                  }
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                className="neu-control h-8 min-w-0 flex-1 rounded-md border border-gray-800 bg-gray-950 px-2.5 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                aria-label="YouTube URL"
              />
              <button
                type="button"
                onClick={() => void checkYouTubeUrl()}
                disabled={!youtubeUrl.trim() || Boolean(urlError) || previewLoading}
                className="neu-button flex h-8 shrink-0 items-center justify-center rounded-md border border-gray-800 px-2.5 text-[11px] text-gray-500 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Check video details"
              >
                {previewLoading ? <Spinner /> : "Check"}
              </button>
            </div>
            {urlError && <p className="text-[11px] text-red-400">{urlError}</p>}
            {preview && (
              <div className="flex items-center gap-2.5 rounded-md border border-gray-800 bg-gray-950/60 px-2.5 py-2">
                {preview.metadata?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.metadata.thumbnailUrl}
                    alt=""
                    className="h-9 w-16 shrink-0 rounded object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-xs text-gray-200">
                    {preview.metadata?.title ?? `YouTube video ${preview.videoId}`}
                  </p>
                  <p className="truncate text-[10px] text-gray-600">
                    {[
                      preview.metadata?.channel,
                      formatVideoDuration(preview.metadata?.durationSeconds ?? null),
                      preview.metadataAvailable ? null : "details unavailable (yt-dlp missing)",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="neu-button flex h-8 w-full items-center justify-center gap-2 rounded-md border border-gray-800 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Spinner /> : null}
            {selectedFile
              ? `Transcribe ${mediaKindForFilename(selectedFile.name)}`
              : youtubeUrl.trim()
                ? "Transcribe video"
                : "Transcribe media"}
          </button>
          {submitError && <p className="text-[11px] text-red-400">{submitError}</p>}
          {duplicateNotice && (
            <p className="text-[11px] text-amber-400/90">{duplicateNotice}</p>
          )}
        </div>
  ) : null;

  const jobProgress = activeJobs.length > 0 ? (
    <div className="border-t border-gray-800 px-5 py-4">
      <div className="space-y-1.5">
        {activeJobs.map((job) => {
          const displayName =
            job.originalFilename ?? job.sourceTitle ?? "Media transcription";
          return (
            <div
              key={job.id}
              className="rounded-lg bg-gray-800/50 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 shrink-0 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-300">
                  {displayName}
                </span>
                <Spinner className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <button
                  type="button"
                  onClick={() => void cancelJob(job.id)}
                  disabled={busyJobId === job.id}
                  className="shrink-0 rounded p-0.5 text-gray-600 transition-colors hover:text-white disabled:opacity-40"
                  aria-label={`Cancel transcription for ${displayName}`}
                  title="Cancel transcription"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-2 pl-6 text-[11px] leading-4 text-gray-400">
                <span className="min-w-0 flex-1 truncate">
                  {statusLabel(job)}
                  {job.progressPercent !== null
                    ? ` · ${Math.round(job.progressPercent)}%`
                    : ""}
                </span>
                <span className="shrink-0 tabular-nums text-gray-600">
                  {formatElapsed(job.createdAt, nowMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  if (!open) return null;

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        id="garden-media-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="garden-media-composer-title"
        className="bb-modal-panel neu-dialog flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3.5">
          <div>
            <h2
              id="garden-media-composer-title"
              className="text-base font-semibold text-white"
            >
              Video &amp; audio
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {isOwner
                ? "Upload media or paste a YouTube link to transcribe it."
                : "View media imports and transcription progress."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon rounded-full p-1.5 text-gray-500"
            aria-label="Close video or audio dialog"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">
          {composer}
          {jobProgress}
        </div>
      </section>
    </div>
  );
}
