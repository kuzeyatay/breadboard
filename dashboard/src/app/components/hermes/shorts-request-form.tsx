"use client";

// The composer's input while Shorts is the selected agent.
//
// This agent takes a video. The cloned pipeline downloads it, transcribes it,
// ranks the transcript and cuts the best moments out — there is nowhere in it
// for a sentence to go. So the message field is replaced by this form rather
// than left open to type into: a field that quietly discards what you wrote
// would be worse than no field.
//
// Two ways to give it a video, because there are two kinds of video people
// have: a link (yt-dlp fetches it) and a file on this machine (uploaded here,
// so the run addresses it by an id rather than by a path a page invented).

import { useCallback, useRef, useState } from "react";
import {
  MAX_SHORTS_CLIPS,
  SHORTS_ASPECT_RATIOS,
  SHORTS_RESOLUTIONS,
  isFetchableVideoUrl,
  validateShortsRequest,
  type ShortsAspectRatio,
  type ShortsRequest,
  type ShortsResolution,
} from "@/lib/shorts/identity.ts";
import { UPLOAD_ACCEPT } from "@/lib/shorts/uploads-accept.ts";

export interface ShortsFormState {
  /** What is typed in the link box. Ignored while an upload is chosen. */
  url: string;
  upload: { uploadId: string; filename: string; sizeBytes: number } | null;
  clipCount: number;
  aspectRatio: ShortsAspectRatio;
  resolution: ShortsResolution;
  language: string;
}

export function initialShortsForm(): ShortsFormState {
  return {
    url: "",
    upload: null,
    clipCount: 3,
    aspectRatio: "9:16",
    resolution: "720",
    language: "",
  };
}

/** The request a form state describes, or null while it is not runnable yet. */
export function shortsRequestFrom(form: ShortsFormState): ShortsRequest | null {
  const validated = validateShortsRequest({
    source: form.upload
      ? { kind: "upload", uploadId: form.upload.uploadId, filename: form.upload.filename }
      : { kind: "url", url: form.url },
    clipCount: form.clipCount,
    aspectRatio: form.aspectRatio,
    resolution: form.resolution,
    language: form.language,
  });
  return validated.ok ? validated.request : null;
}

const inputClass =
  "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/15";

function Field({
  id,
  label,
  title,
  className = "",
  children,
}: {
  id: string;
  label: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={id}
        title={title}
        className="text-[11px] font-medium leading-4 text-[var(--ink-heading)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

export default function ShortsRequestForm({
  form,
  onChange,
  onSubmit,
  onOpenSettings,
  disabled = false,
  busy = false,
}: {
  form: ShortsFormState;
  onChange: (next: ShortsFormState) => void;
  onSubmit: () => void;
  /** Opens the agent's settings panel, where the environment and defaults live. */
  onOpenSettings?: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const urlLooksWrong = form.url.trim().length > 0 && !isFetchableVideoUrl(form.url);
  const request = shortsRequestFrom(form);
  const ready = Boolean(request) && !disabled && !busy && !uploading;

  const chooseFile = useCallback(
    async (file: File) => {
      setUploadError("");
      setUploading(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/shorts/uploads", { method: "POST", body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.upload?.uploadId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "That video could not be uploaded.",
          );
        }
        onChange({
          ...form,
          url: "",
          upload: {
            uploadId: String(data.upload.uploadId),
            filename: String(data.upload.filename ?? file.name),
            sizeBytes: Number(data.upload.sizeBytes ?? file.size) || file.size,
          },
        });
      } catch (cause) {
        setUploadError(
          cause instanceof Error ? cause.message : "That video could not be uploaded.",
        );
      } finally {
        setUploading(false);
      }
    },
    [form, onChange],
  );

  return (
    <div className="px-2 pb-1.5 pt-1">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
        {form.upload ? (
          // A chosen file replaces the link box entirely: the two are the same
          // field, and showing both invites filling in one while the other wins.
          <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-2">
            <svg
              aria-hidden
              className="h-4 w-4 shrink-0 text-[var(--botanical)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <rect x="3" y="6" width="13" height="12" rx="2" />
              <path d="m16 12 5-3v6l-5-3Z" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">
              {form.upload.filename}
              <span className="ml-1.5 text-[11px] text-[var(--ink-muted)]">
                {formatSize(form.upload.sizeBytes)}
              </span>
            </span>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => onChange({ ...form, upload: null })}
              className="neu-button rounded-full px-2 py-1 text-[11px] text-[var(--ink-muted)] disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Field id="shorts-url" label="Video link" className="min-w-0 flex-1">
              <input
                id="shorts-url"
                value={form.url}
                disabled={disabled || uploading}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                onChange={(event) => onChange({ ...form, url: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  if (ready) onSubmit();
                }}
                className={inputClass}
                aria-invalid={urlLooksWrong}
              />
            </Field>
            <button
              type="button"
              disabled={disabled || busy || uploading}
              onClick={() => fileRef.current?.click()}
              className="neu-button shrink-0 rounded-xl px-3 py-1.5 text-xs text-[var(--ink)] disabled:opacity-50"
              title="Use a video file on this machine"
            >
              {uploading ? "Uploading…" : "Choose file"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void chooseFile(file);
              }}
            />
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-start gap-x-2.5 gap-y-2.5">
          <Field id="shorts-clips" label="Clips" className="w-[4.5rem] shrink-0">
            <input
              id="shorts-clips"
              type="number"
              min={1}
              max={MAX_SHORTS_CLIPS}
              value={form.clipCount}
              disabled={disabled}
              onChange={(event) => {
                const next = Number(event.target.value);
                onChange({ ...form, clipCount: Number.isFinite(next) ? next : 3 });
              }}
              className={`${inputClass} px-2 text-center`}
            />
          </Field>

          <Field
            id="shorts-ratio"
            label="Shape"
            title="Vertical slides the crop across the frame to keep the speaker's face centred."
            className="min-w-[8rem] flex-[1_1_8rem]"
          >
            <select
              id="shorts-ratio"
              value={form.aspectRatio}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...form, aspectRatio: event.target.value as ShortsAspectRatio })
              }
              className={inputClass}
            >
              {SHORTS_ASPECT_RATIOS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          {form.upload ? null : (
            <Field
              id="shorts-resolution"
              label="Quality"
              title="How large a copy of the source video is downloaded."
              className="w-[6.5rem] shrink-0"
            >
              <select
                id="shorts-resolution"
                value={form.resolution}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...form, resolution: event.target.value as ShortsResolution })
                }
                className={inputClass}
              >
                {SHORTS_RESOLUTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            id="shorts-language"
            label="Language"
            title="A two-letter code stops Whisper guessing. Empty lets it detect one."
            className="w-[5.5rem] shrink-0"
          >
            <input
              id="shorts-language"
              value={form.language}
              disabled={disabled}
              maxLength={2}
              spellCheck={false}
              autoComplete="off"
              placeholder="auto"
              onChange={(event) =>
                onChange({ ...form, language: event.target.value.toLowerCase() })
              }
              className={`${inputClass} text-center`}
            />
          </Field>
        </div>

        <p className="mt-2.5 text-[10px] leading-4 text-[var(--ink-muted)]">
          {uploadError ? (
            <span className="text-[var(--danger)]">{uploadError}</span>
          ) : urlLooksWrong ? (
            "That is not a link this agent can fetch — it takes an http or https video URL."
          ) : (
            <>
              Transcribes the audio on this machine and ranks the moments through this chat&apos;s
              model. Each clip comes back as a video you can play and download.
              {onOpenSettings ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="underline underline-offset-2 hover:text-[var(--botanical)]"
                  >
                    Change the defaults
                  </button>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
