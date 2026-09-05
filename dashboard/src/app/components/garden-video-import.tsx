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
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import BreadboardLoader from "@/app/components/breadboard-loader";
import OverflowMarquee from "@/app/components/overflow-marquee";
import styles from "./garden-video-import.module.css";
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
  stageIndexForStatus,
  stagesForInputKind,
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

export interface GardenMediaSource {
  slug: string;
  title: string;
  description: string;
  originalFilename: string;
  sourceType: string;
  sourceMedia: string;
  href: string;
  wordCount: number;
  flagColor?: string;
}

export interface GardenVideoImportProps {
  clusterSlug: string;
  isOwner: boolean;
  open: boolean;
  expanded: boolean;
  mediaSources: GardenMediaSource[];
  deletingSourceSlug?: string | null;
  selectedSourceSlugs?: string[];
  flagColors?: readonly string[];
  openFlagPaletteSlug?: string | null;
  savingFlagSlug?: string | null;
  onClose: () => void;
  onExpand: () => void;
  onDeleteSource?: (sourceSlug: string) => void;
  onColorButtonClick?: (sourceSlug: string) => void;
  onFlagSource?: (sourceSlug: string, flagColor: string) => void;
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

function mediaSourceKind(source: GardenMediaSource): "audio" | "video" {
  return source.sourceType.toLowerCase().includes("audio") ? "audio" : "video";
}

function mediaSourceFilename(source: GardenMediaSource): string {
  return source.originalFilename.trim() || source.title.trim() || "Media transcript";
}

function mediaSourceDescription(source: GardenMediaSource): string {
  const filename = mediaSourceFilename(source);
  const description = source.description.trim();
  if (description && description !== filename) return description;
  const title = source.title.trim();
  return title !== filename ? title : "";
}

function normalizedMediaSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function mediaSourceSearchText(source: GardenMediaSource): string {
  return normalizedMediaSearchText(
    [
      mediaSourceFilename(source),
      mediaSourceDescription(source),
      mediaSourceKind(source),
      source.sourceType,
    ].join(" "),
  );
}

function PlayIcon({ playing = false }: { playing?: boolean }) {
  return playing ? (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.75 5.25h3.5v13.5h-3.5zM13.75 5.25h3.5v13.5h-3.5z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.25 5.6v12.8a.75.75 0 0 0 1.14.64l9.75-6.4a.75.75 0 0 0 0-1.28l-9.75-6.4a.75.75 0 0 0-1.14.64Z" />
    </svg>
  );
}

function VideoPanelIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <rect x="3.75" y="6.25" width="11.5" height="11.5" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m15.25 10 4.25-2v8l-4.25-2" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.75 7.5 9H4.75v6H7.5L11 18.25z" />
      {muted ? (
        <path strokeLinecap="round" d="m15.5 9.5 4 5m0-5-4 5" />
      ) : (
        <path strokeLinecap="round" d="M15.25 9a4.25 4.25 0 0 1 0 6M17.75 6.75a7.4 7.4 0 0 1 0 10.5" />
      )}
    </svg>
  );
}

interface SourceColorSelectProps {
  source: GardenMediaSource;
  selected: boolean;
  saving: boolean;
  paletteOpen: boolean;
  flagColors: readonly string[];
  onColorButtonClick: () => void;
  onFlagSource: (flagColor: string) => void;
}

function SourceColorSelect({
  source,
  selected,
  saving,
  paletteOpen,
  flagColors,
  onColorButtonClick,
  onFlagSource,
}: SourceColorSelectProps) {
  return (
    <div className="relative mt-0.5 shrink-0">
      <button
        type="button"
        onClick={onColorButtonClick}
        disabled={saving}
        className={`flex h-5 w-5 items-center justify-center rounded border border-gray-700 bg-gray-950 transition-[border-color,transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-gray-500 active:scale-[0.96] ${saving ? "cursor-wait opacity-50" : "cursor-pointer"}`}
        title={`${source.flagColor ? `Highlighted ${source.flagColor}. ` : ""}${
          selected
            ? "Selected for chat; click once to remove."
            : "Click once to select for chat."
        } Double-click to choose a highlight color.`}
        aria-label={
          selected
            ? "Recording highlight; selected for chat; click once to remove or twice to choose a color"
            : "Recording highlight; click once to select for chat or twice to choose a color"
        }
        aria-pressed={selected}
        aria-expanded={paletteOpen}
      >
        <span
          className="relative flex h-3 w-3 items-center justify-center rounded-sm border border-gray-800"
          style={{ backgroundColor: source.flagColor || "transparent" }}
        >
          {selected ? (
            <svg
              className="pointer-events-none absolute inset-0 h-3 w-3"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m2 6.25 2.6 2.6L10 3.35"
                stroke="rgb(3 7 18)"
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="m2 6.25 2.6 2.6L10 3.35"
                stroke="white"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
      </button>

      {paletteOpen ? (
        <div className="absolute left-0 top-6 z-20 w-32 rounded-lg border border-gray-800 bg-gray-950 p-2 shadow-xl">
          <div className="grid grid-cols-5 gap-1.5">
            {flagColors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onFlagSource(color)}
                className={`h-4 w-4 rounded border transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-110 active:scale-[0.96] ${
                  source.flagColor === color ? "border-white" : "border-gray-800"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Highlight recording ${color}`}
                title={color}
              />
            ))}
          </div>
          {source.flagColor ? (
            <button
              type="button"
              onClick={() => onFlagSource("")}
              className="mt-2 w-full rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-500 transition-[border-color,color,transform] duration-150 hover:border-gray-700 hover:text-white active:scale-[0.97]"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatPlaybackTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const totalSeconds = Math.floor(value);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}:${seconds.toString().padStart(2, "0")}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

interface AudioSourceRowProps {
  source: GardenMediaSource;
  src: string;
  active: boolean;
  selected: boolean;
  selectionControl: ReactNode;
  isOwner: boolean;
  deleting: boolean;
  onActivate: () => void;
  onDeleteSource?: (sourceSlug: string) => void;
}

function AudioSourceRow({
  source,
  src,
  active,
  selected,
  selectionControl,
  isOwner,
  deleting,
  onActivate,
  onDeleteSource,
}: AudioSourceRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const filename = mediaSourceFilename(source);
  const description = mediaSourceDescription(source);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  useEffect(() => {
    if (!active) audioRef.current?.pause();
  }, [active]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      onActivate();
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const updateDuration = () => {
    const nextDuration = audioRef.current?.duration ?? 0;
    setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
  };

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMuted = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <li
      className={`border-b border-gray-800/50 last:border-b-0 ${
        selected
          ? "border-l-2 border-l-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_8%,transparent)]"
          : ""
      }`}
    >
      <div className="group flex items-start gap-2.5 px-3 py-2">
        {selectionControl}
        <button
          type="button"
          onClick={togglePlayback}
          className={`neu-button-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-[border-color,background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] ${
            active
              ? "border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_10%,var(--paper-raised))] text-[var(--botanical)]"
              : "border-gray-700 text-[var(--botanical)] hover:border-[var(--botanical)]"
          }`}
          aria-label={isPlaying ? `Pause ${filename}` : `Play ${filename}`}
          aria-pressed={isPlaying}
          title={isPlaying ? "Pause audio" : "Play audio"}
        >
          <PlayIcon playing={isPlaying} />
        </button>

        <div className="min-w-0 flex-1">
          <Link
            href={source.href}
            className="block text-xs font-medium text-gray-300 transition-colors hover:text-white"
            title="Open transcript Markdown"
          >
            <OverflowMarquee>{filename}</OverflowMarquee>
          </Link>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-gray-500" title={description}>
              {description}
            </p>
          ) : null}
          <p className="mt-0.5 text-[10px] text-gray-600">
            Audio transcript · {source.wordCount}w
          </p>
        </div>

        {isOwner && onDeleteSource ? (
          <button
            type="button"
            onClick={() => onDeleteSource(source.slug)}
            disabled={deleting}
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-700 opacity-60 transition-colors hover:bg-red-950/40 hover:text-red-300 hover:opacity-100 disabled:cursor-wait disabled:opacity-60"
            aria-label={`Delete ${filename}`}
            title="Delete media transcript and source"
          >
            {deleting ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.35 9m-4.78 0L9.26 9m9.97-3.21c.35.05.7.1 1.05.16m-1.05-.16L18.16 19.67a2.25 2.25 0 0 1-2.24 2.08H8.08a2.25 2.25 0 0 1-2.24-2.08L4.77 5.79m14.46 0a48.1 48.1 0 0 0-3.48-.4m-10.98.4c.35-.06.7-.11 1.05-.16m0 0a48.1 48.1 0 0 1 3.48-.4m6.45.16V4.48c0-1.18-.91-2.16-2.09-2.2a52.1 52.1 0 0 0-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.75m7.5.16a48.7 48.7 0 0 0-7.5-.16" />
              </svg>
            )}
          </button>
        ) : null}
      </div>

      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
      >
        Your browser cannot play this audio file.
      </audio>

      {active ? (
        <div className={`px-3 pb-3 ${selectionControl ? "pl-[5.75rem]" : "pl-[3.875rem]"}`}>
          <div className={`${styles.transport} flex items-center gap-2 rounded-lg border border-[var(--line)] px-2 py-1.5`}>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
            </span>
            <div className={`${styles.scrubberWrap} min-w-0 flex-1`}>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={seek}
                disabled={duration <= 0}
                className={styles.scrubber}
                style={{ "--bb-media-progress": `${progress}%` } as CSSProperties}
                aria-label={`Seek ${filename}`}
              />
            </div>
            <button
              type="button"
              onClick={toggleMuted}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] active:scale-[0.96]"
              aria-label={muted ? `Unmute ${filename}` : `Mute ${filename}`}
              title={muted ? "Unmute" : "Mute"}
            >
              <VolumeIcon muted={muted} />
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function GardenVideoImport({
  clusterSlug,
  isOwner,
  open,
  expanded,
  mediaSources,
  deletingSourceSlug = null,
  selectedSourceSlugs = [],
  flagColors = [],
  openFlagPaletteSlug = null,
  savingFlagSlug = null,
  onClose,
  onExpand,
  onDeleteSource,
  onColorButtonClick,
  onFlagSource,
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [playingSourceSlug, setPlayingSourceSlug] = useState<string | null>(null);
  const [mediaSearch, setMediaSearch] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef<number>(Date.now());
  const completedSeenRef = useRef<Set<string>>(new Set());
  const onSourceCreatedRef = useRef(onSourceCreated);
  onSourceCreatedRef.current = onSourceCreated;

  const apiBase = `/api/gardens/${encodeURIComponent(clusterSlug)}/video-transcriptions`;

  const applyJobs = useCallback(
    (nextJobs: PublicVideoTranscriptionJob[]) => {
      // Server polling is authoritative for accepted jobs, but an upload can
      // spend time in the browser before the server creates its durable job.
      // Keep those client handoff rows until the submission response replaces
      // them with the real job (or a terminal error).
      setJobs((current) => [
        ...current.filter((job) => job.id.startsWith("client-")),
        ...nextJobs.filter((job) => !job.id.startsWith("client-")),
      ]);
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
    if (!open && !selectedJobId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedJobId) setSelectedJobId(null);
      else onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, selectedJobId]);

  useEffect(() => {
    if (
      playingSourceSlug &&
      !mediaSources.some((source) => source.slug === playingSourceSlug)
    ) {
      setPlayingSourceSlug(null);
    }
  }, [mediaSources, playingSourceSlug]);

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
    const submissionFile = selectedFile;
    const submissionUrl = youtubeUrl.trim();
    const provisionalId = `client-${crypto.randomUUID()}`;
    const submittedAt = new Date().toISOString();
    const provisionalJob: PublicVideoTranscriptionJob = {
      id: provisionalId,
      gardenId: clusterSlug,
      inputKind: submissionFile ? "upload" : "youtube",
      status: submissionFile ? "uploading" : "validating",
      progressPercent: null,
      currentStage: submissionFile ? "Uploading media" : "Checking YouTube URL",
      originalFilename: submissionFile?.name ?? null,
      originalUrl: submissionFile ? null : submissionUrl,
      canonicalUrl: preview?.canonicalUrl ?? null,
      youtubeVideoId: preview?.videoId ?? null,
      sourceTitle: preview?.metadata?.title ?? null,
      videoMetadata: null,
      outputRelativePath: null,
      sourceSlug: null,
      errorCode: null,
      errorMessage: null,
      createdAt: submittedAt,
      updatedAt: submittedAt,
      completedAt: null,
    };
    setJobs((current) => [
      provisionalJob,
      ...current.filter((job) => job.id !== provisionalId),
    ]);
    setSelectedJobId(provisionalId);
    onExpand();
    onClose();
    setSubmitting(true);
    setSubmitError(null);
    setDuplicateNotice(null);
    const failProvisionalJob = (message: string) => {
      const completedAt = new Date().toISOString();
      setJobs((current) =>
        current.map((job) =>
          job.id === provisionalId
            ? {
                ...job,
                status: "failed",
                currentStage: "Transcription could not start",
                errorMessage: message,
                updatedAt: completedAt,
                completedAt,
              }
            : job,
        ),
      );
    };
    try {
      let res: Response;
      if (submissionFile) {
        const form = new FormData();
        form.append("media", submissionFile, submissionFile.name);
        res = await fetch(apiBase, { method: "POST", body: form });
      } else {
        res = await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl: submissionUrl }),
        });
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        duplicate?: boolean;
        job?: PublicVideoTranscriptionJob;
        source?: { title?: string; sourceRelPath?: string };
      };
      if (!res.ok) {
        const message = data.error ?? "Failed to start transcription.";
        setSubmitError(message);
        failProvisionalJob(message);
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
        const message = "The upload was accepted but no transcription job was created.";
        setSubmitError(message);
        failProvisionalJob(message);
        return;
      }

      // The create response is authoritative for the handoff. Paint that job
      // before clearing the chosen file, then preserve it if the immediate list
      // read is briefly stale (or the runner has not committed its next state
      // yet). Without this bridge an accepted upload appeared to vanish.
      const acceptedJob = data.job ?? null;
      if (acceptedJob) {
        setJobs((current) => [
          acceptedJob,
          ...current.filter(
            (job) => job.id !== provisionalId && job.id !== acceptedJob.id,
          ),
        ]);
        setSelectedJobId(acceptedJob.id);
      } else {
        const completedAt = new Date().toISOString();
        setJobs((current) =>
          current.map((job) =>
            job.id === provisionalId
              ? {
                  ...job,
                  status: "completed",
                  progressPercent: 100,
                  currentStage: "Source already available",
                  sourceTitle: data.source?.title ?? job.sourceTitle,
                  outputRelativePath:
                    data.source?.sourceRelPath ?? job.outputRelativePath,
                  updatedAt: completedAt,
                  completedAt,
                }
              : job,
          ),
        );
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
      const message = "Failed to start transcription.";
      setSubmitError(message);
      failProvisionalJob(message);
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
  const selectedJob = selectedJobId
    ? (jobs.find((job) => job.id === selectedJobId) ?? null)
    : null;
  const mediaSearchTerms = normalizedMediaSearchText(mediaSearch)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const filteredMediaSources =
    mediaSearchTerms.length === 0
      ? mediaSources
      : mediaSources.filter((source) => {
          const haystack = mediaSourceSearchText(source);
          return mediaSearchTerms.every((term) => haystack.includes(term));
        });

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
      )
    : null;

  const jobProgress = (
    <div
      id="garden-media-items"
      className="bb-neu-accordion-panel border-t border-gray-800/70"
    >
      {mediaSources.length > 0 ? (
        <div className="border-b border-gray-800 px-3 py-2">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.7}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <input
              value={mediaSearch}
              onChange={(event) => {
                setMediaSearch(event.target.value);
                setPlayingSourceSlug(null);
              }}
              placeholder="Search video and audio"
              className="neu-control h-8 w-full rounded-md border border-gray-800 bg-gray-950 pl-8 pr-8 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
              aria-label="Search video and audio"
              autoComplete="off"
              spellCheck={false}
            />
            {mediaSearch ? (
              <button
                type="button"
                onClick={() => {
                  setMediaSearch("");
                  setPlayingSourceSlug(null);
                }}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
                aria-label="Clear media search"
                title="Clear search"
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
            ) : null}
          </div>
        </div>
      ) : null}
      {activeJobs.length > 0 || mediaSources.length > 0 ? (
        <div className="max-h-80 overflow-y-auto">
          {activeJobs.length > 0 ? (
            <div className="border-b border-gray-800/70 py-1">
              {activeJobs.map((job) => {
                const displayName =
                  job.originalFilename ?? job.sourceTitle ?? "Media transcription";
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                    className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-800/50"
                    aria-label={`View transcription progress for ${displayName}`}
                    title="View transcription progress"
                  >
                    <Spinner className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1">
                      <OverflowMarquee className="text-xs text-gray-300 group-hover:text-white">
                        {displayName}
                      </OverflowMarquee>
                      <span className="block truncate text-[11px] text-gray-600">
                        {statusLabel(job)}
                        {job.progressPercent !== null
                          ? ` · ${Math.round(job.progressPercent)}%`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-600">
                      {formatElapsed(job.createdAt, nowMs)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {filteredMediaSources.length > 0 ? (
            <ul className="py-1">
              {filteredMediaSources.map((source) => {
                const filename = mediaSourceFilename(source);
                const description = mediaSourceDescription(source);
                const kind = mediaSourceKind(source);
                const playing = playingSourceSlug === source.slug;
                const localPlaybackUrl = source.sourceMedia
                  ? `/api/gardens/${encodeURIComponent(clusterSlug)}/media/${encodeURIComponent(source.slug)}`
                  : "";
                const externalPlaybackUrl =
                  !localPlaybackUrl &&
                  source.sourceType.toLowerCase() === "youtube" &&
                  /^https?:\/\//i.test(source.originalFilename)
                    ? source.originalFilename
                    : "";
                const canPlay = Boolean(localPlaybackUrl || externalPlaybackUrl);
                const selectedForChat = selectedSourceSlugs.includes(source.slug);
                const selectionControl =
                  onColorButtonClick && onFlagSource ? (
                    <SourceColorSelect
                      source={source}
                      selected={selectedForChat}
                      saving={savingFlagSlug === source.slug}
                      paletteOpen={openFlagPaletteSlug === source.slug}
                      flagColors={flagColors}
                      onColorButtonClick={() => onColorButtonClick(source.slug)}
                      onFlagSource={(flagColor) => onFlagSource(source.slug, flagColor)}
                    />
                  ) : null;
                if (kind === "audio" && localPlaybackUrl) {
                  return (
                    <AudioSourceRow
                      key={source.slug}
                      source={source}
                      src={localPlaybackUrl}
                      active={playing}
                      selected={selectedForChat}
                      selectionControl={selectionControl}
                      isOwner={isOwner}
                      deleting={deletingSourceSlug === source.slug}
                      onActivate={() => setPlayingSourceSlug(source.slug)}
                      onDeleteSource={onDeleteSource}
                    />
                  );
                }
                return (
                  <li
                    key={source.slug}
                    className={`border-b border-gray-800/50 last:border-b-0 ${
                      selectedForChat
                        ? "border-l-2 border-l-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_8%,transparent)]"
                        : ""
                    }`}
                  >
                    <div className="group flex items-start gap-2.5 px-3 py-2">
                      {selectionControl}
                      {externalPlaybackUrl ? (
                        <a
                          href={externalPlaybackUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="neu-button-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-700 text-[var(--botanical)] transition-[border-color,background-color,color,transform] duration-150 hover:border-[var(--botanical)] active:scale-[0.96]"
                          aria-label={`Open ${filename} on YouTube`}
                          title="Open on YouTube"
                        >
                          <VideoPanelIcon />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setPlayingSourceSlug((current) =>
                              current === source.slug ? null : source.slug,
                            )
                          }
                          disabled={!canPlay}
                          className={`neu-button-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-[border-color,background-color,color,transform] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:text-gray-700 disabled:active:scale-100 ${
                            playing
                              ? "border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_10%,var(--paper-raised))] text-[var(--botanical)]"
                              : "border-gray-700 text-[var(--botanical)] hover:border-[var(--botanical)]"
                          }`}
                          aria-label={`${playing ? "Close player for" : "Open player for"} ${filename}`}
                          aria-expanded={playing}
                          title={canPlay ? (playing ? "Close video player" : "Open video player") : "Original media is unavailable"}
                        >
                          <VideoPanelIcon />
                        </button>
                      )}

                      <div className="min-w-0 flex-1">
                        <Link
                          href={source.href}
                          className="block text-xs font-medium text-gray-300 transition-colors hover:text-white"
                          title="Open transcript Markdown"
                        >
                          <OverflowMarquee>{filename}</OverflowMarquee>
                        </Link>
                        {description ? (
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-gray-500" title={description}>
                            {description}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[10px] text-gray-600">
                          {kind === "audio" ? "Audio" : "Video"} transcript · {source.wordCount}w
                        </p>
                      </div>

                      {isOwner && onDeleteSource ? (
                        <button
                          type="button"
                          onClick={() => onDeleteSource(source.slug)}
                          disabled={deletingSourceSlug === source.slug}
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-700 opacity-60 transition-colors hover:bg-red-950/40 hover:text-red-300 hover:opacity-100 disabled:cursor-wait disabled:opacity-60"
                          aria-label={`Delete ${filename}`}
                          title="Delete media transcript and source"
                        >
                          {deletingSourceSlug === source.slug ? (
                            <Spinner className="h-3.5 w-3.5" />
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.35 9m-4.78 0L9.26 9m9.97-3.21c.35.05.7.1 1.05.16m-1.05-.16L18.16 19.67a2.25 2.25 0 0 1-2.24 2.08H8.08a2.25 2.25 0 0 1-2.24-2.08L4.77 5.79m14.46 0a48.1 48.1 0 0 0-3.48-.4m-10.98.4c.35-.06.7-.11 1.05-.16m0 0a48.1 48.1 0 0 1 3.48-.4m6.45.16V4.48c0-1.18-.91-2.16-2.09-2.2a52.1 52.1 0 0 0-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.75m7.5.16a48.7 48.7 0 0 0-7.5-.16" />
                            </svg>
                          )}
                        </button>
                      ) : null}
                    </div>

                    {playing && localPlaybackUrl ? (
                      <div className="px-3 pb-3 pl-[3.875rem]">
                        <video key={localPlaybackUrl} className="max-h-48 w-full rounded-md bg-black" controls autoPlay preload="metadata" src={localPlaybackUrl}>
                          Your browser cannot play this video file.
                        </video>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : mediaSearchTerms.length > 0 ? (
            <div className="flex flex-col items-center px-4 py-6 text-center">
              <p className="text-xs text-gray-600">
                No video or audio matches {mediaSearch.trim()}
              </p>
              <button
                type="button"
                onClick={() => setMediaSearch("")}
                className="mt-2 text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-white"
              >
                Clear search
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-4 text-center text-xs text-gray-600">
          No video or audio yet.
        </p>
      )}
    </div>
  );

  const selectedJobStages = selectedJob
    ? stagesForInputKind(selectedJob.inputKind)
    : [];
  const selectedJobStageIndex = selectedJob
    ? stageIndexForStatus(selectedJob.inputKind, selectedJob.status)
    : 0;
  const selectedJobName = selectedJob
    ? selectedJob.originalFilename ??
      selectedJob.sourceTitle ??
      selectedJob.videoMetadata?.title ??
      "Media transcription"
    : "Media transcription";

  return (
    <>
      {expanded ? jobProgress : null}

      {open ? (
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
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto">{composer}</div>
          </section>
        </div>
      ) : null}

      {selectedJob ? (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedJobId(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="garden-media-status-title"
            className="bb-modal-panel neu-dialog flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3.5">
              <div className="min-w-0">
                <h2 id="garden-media-status-title" className="text-base font-semibold text-white">
                  Transcription status
                </h2>
                <p className="mt-0.5 truncate text-xs text-gray-500" title={selectedJobName}>
                  {selectedJobName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJobId(null)}
                className="neu-button-icon ml-3 shrink-0 rounded-full p-1.5 text-gray-500"
                aria-label="Close transcription status"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
              <div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-gray-300">{statusLabel(selectedJob)}</span>
                  <span className="tabular-nums text-gray-500">
                    {selectedJob.progressPercent !== null
                      ? `${Math.round(selectedJob.progressPercent)}%`
                      : formatElapsed(selectedJob.createdAt, nowMs)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className="h-full rounded-full bg-[var(--botanical)] transition-[width] duration-300"
                    style={{
                      width: `${
                        selectedJob.status === "completed"
                          ? 100
                          : Math.max(4, selectedJob.progressPercent ?? 4)
                      }%`,
                    }}
                    role="progressbar"
                    aria-label="Transcription progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={selectedJob.progressPercent ?? undefined}
                  />
                </div>
              </div>

              <ol className="space-y-2.5" aria-label="Transcription stages">
                {selectedJobStages.map((stage, index) => {
                  const complete =
                    selectedJob.status === "completed" || index < selectedJobStageIndex;
                  const current =
                    !isTerminalJob(selectedJob) && index === selectedJobStageIndex;
                  return (
                    <li key={stage.status} className="flex items-center gap-2.5 text-xs">
                      {complete ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--botanical)_18%,transparent)] text-[var(--botanical)]">✓</span>
                      ) : current ? (
                        <Spinner className="h-4 w-4 shrink-0 text-[var(--botanical)]" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-full border border-gray-700" />
                      )}
                      <span className={complete || current ? "text-gray-300" : "text-gray-600"}>
                        {stage.label}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-gray-800 pt-4 text-xs">
                <dt className="text-gray-600">Input</dt>
                <dd className="min-w-0 truncate text-right text-gray-400">
                  {selectedJob.inputKind === "youtube" ? "YouTube link" : "Media upload"}
                </dd>
                <dt className="text-gray-600">Started</dt>
                <dd className="text-right text-gray-400">
                  {new Date(selectedJob.createdAt).toLocaleString()}
                </dd>
                <dt className="text-gray-600">Elapsed</dt>
                <dd className="text-right tabular-nums text-gray-400">
                  {formatElapsed(selectedJob.createdAt, selectedJob.completedAt ? Date.parse(selectedJob.completedAt) : nowMs)}
                </dd>
                {selectedJob.outputRelativePath ? (
                  <>
                    <dt className="text-gray-600">Source</dt>
                    <dd className="min-w-0 truncate text-right text-gray-400" title={selectedJob.outputRelativePath}>
                      {selectedJob.outputRelativePath}
                    </dd>
                  </>
                ) : null}
              </dl>

              {selectedJob.errorMessage ? (
                <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs leading-5 text-red-300">
                  {selectedJob.errorMessage}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 gap-3 border-t border-gray-800 px-5 py-4">
              {!isTerminalJob(selectedJob) &&
              !selectedJob.id.startsWith("client-") ? (
                <button
                  type="button"
                  onClick={() => void cancelJob(selectedJob.id)}
                  disabled={busyJobId === selectedJob.id}
                  className="neu-button flex flex-1 items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40"
                >
                  {busyJobId === selectedJob.id ? <Spinner /> : null}
                  Cancel transcription
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedJobId(null)}
                className="neu-button-primary flex-1 py-2.5 text-sm"
              >
                {isTerminalJob(selectedJob) ? "Close" : "Continue in background"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
