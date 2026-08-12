"use client";

import { useCallback, useRef, useState } from "react";
import {
  FORMSMITH_IMAGE_ACCEPT,
  FORMSMITH_IMAGE_EXTENSIONS,
  MAX_FORMSMITH_IMAGE_BYTES,
  validateFormsmithRequest,
  type FormsmithRequest,
} from "@/lib/shaper/identity.ts";

export interface FormsmithFormState {
  upload: FormsmithRequest | null;
}

export function initialFormsmithForm(): FormsmithFormState {
  return { upload: null };
}

export function formsmithRequestFrom(form: FormsmithFormState): FormsmithRequest | null {
  const result = validateFormsmithRequest(form.upload);
  return result.ok ? result.request : null;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function FormsmithRequestForm({
  form,
  onChange,
  onSubmit,
  disabled = false,
  busy = false,
}: {
  form: FormsmithFormState;
  onChange: (next: FormsmithFormState) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const ready = Boolean(formsmithRequestFrom(form)) && !disabled && !busy && !uploading;

  const choose = useCallback(async (file: File) => {
    setError("");
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!(FORMSMITH_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
      setError("Formsmith accepts only JPEG, PNG, or WebP pictures.");
      return;
    }
    if (!file.size || file.size > MAX_FORMSMITH_IMAGE_BYTES) {
      setError("Pictures must be 20 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/shaper/uploads", { method: "POST", body });
      const data = await response.json().catch(() => ({})) as {
        upload?: Partial<FormsmithRequest>;
        error?: string;
      };
      if (!response.ok || !data.upload?.uploadId) {
        throw new Error(data.error || "That picture could not be uploaded.");
      }
      onChange({
        upload: {
          uploadId: String(data.upload.uploadId),
          filename: String(data.upload.filename ?? file.name),
          sizeBytes: Number(data.upload.sizeBytes ?? file.size),
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That picture could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }, [onChange]);

  return (
    <div className="px-2 pb-1.5 pt-1">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
        {form.upload ? (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2.5">
            <svg aria-hidden className="h-5 w-5 shrink-0 text-[var(--botanical)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <circle cx="9" cy="10" r="1.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m5.5 17 4.3-4.2 3 2.7 2.3-2.2 3.4 3.7" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">
              {form.upload.filename}
              <span className="ml-1.5 text-[11px] text-[var(--ink-muted)]">{formatSize(form.upload.sizeBytes)}</span>
            </span>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => onChange({ upload: null })}
              className="neu-button rounded-full px-2.5 py-1 text-[11px] text-[var(--ink-muted)] disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            autoFocus
            disabled={disabled || busy || uploading}
            onClick={() => inputRef.current?.click()}
            className="neu-inset flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] px-4 py-5 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
          >
            <span aria-hidden className="text-lg text-[var(--botanical)]">＋</span>
            {uploading ? "Uploading picture…" : "Choose a picture"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={FORMSMITH_IMAGE_ACCEPT}
          multiple={false}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void choose(file);
          }}
        />
        <p className={`mt-2 text-[10px] leading-4 ${error ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"}`}>
          {error || "One JPEG, PNG, or WebP picture. Formsmith reconstructs it locally and returns a rotatable GLB artifact."}
        </p>
        {form.upload ? (
          <button type="button" className="sr-only" disabled={!ready} onClick={onSubmit}>
            Reconstruct picture
          </button>
        ) : null}
      </div>
    </div>
  );
}
