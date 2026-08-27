"use client";

// Everything the user has attached to a chat, as a file list.
//
// The rows come from the transcript rather than a store of their own, so this
// panel can show a document that was uploaded before Breadboard kept sizes, and
// says plainly when the bytes themselves were not retained instead of offering
// a download that would fail.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ModelCubeIcon from "@/app/components/model-cube-icon";
import {
  ReclaimingAudio,
  ReclaimingVideo,
} from "@/app/components/reclaiming-media";
import { formatUploadSize, type StoredUpload } from "@/lib/conversations/uploads";
import { defaultModelUpAxis } from "@/lib/model-attachments";

const ModelViewer = dynamic(() => import("@/app/components/cad/model-viewer"), {
  ssr: false,
  loading: () => (
    <p className="flex h-full items-center justify-center text-sm text-[var(--ink-muted)]">
      Loading the 3D viewer…
    </p>
  ),
});

interface Props {
  /**
   * Opens the chat an upload was sent in; omitted for surfaces that cannot.
   * The id is whatever the host surface opens a chat by — the conversation's
   * public id in the Terminal, the legacy chat-session id in a garden.
   */
  onOpenChat?: (chatId: string) => void;
  activeSurface?: string;
  /** Set inside a garden: only that garden's uploads are listed. */
  gardenSlug?: string | null;
}

function formatUploadDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    [],
    sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" },
  );
}

function ModelGlyph() {
  return (
    <span className="neu-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-[var(--botanical)]">
      <ModelCubeIcon className="h-5 w-5" />
    </span>
  );
}

function FileGlyph({ name }: { name: string }) {
  const extension = name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";
  return (
    <span className="neu-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-[8px] font-semibold tracking-wide text-[var(--ink-muted)]">
      {extension || "FILE"}
    </span>
  );
}

function uploadContentHref(
  upload: StoredUpload,
  options: { download?: boolean; preview?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (options.download) params.set("download", "1");
  if (options.preview) params.set("preview", "1");
  const query = params.toString();
  return `/api/hermes/uploads/${encodeURIComponent(upload.id)}/content${query ? `?${query}` : ""}`;
}

function UploadViewer({ upload, onClose }: { upload: StoredUpload; onClose: () => void }) {
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewHref = uploadContentHref(upload, { preview: upload.kind === "model" });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const unavailable = !upload.hasContent
    ? "Breadboard kept this upload's name, but not its original bytes."
    : !upload.previewAvailable
      ? "This format cannot be previewed in Breadboard. You can still download the original file."
      : null;

  return createPortal(
    <div
      className="bb-modal-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Upload preview: ${upload.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="neu-dialog flex h-[min(88vh,52rem)] w-full max-w-[min(72rem,94vw)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink)] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--ink-heading)]">{upload.name}</p>
            <p className="truncate text-xs text-[var(--ink-muted)]">
              {upload.conversationTitle} · {formatUploadSize(upload.sizeBytes)}
            </p>
          </div>
          {upload.hasContent ? (
            <a
              href={uploadContentHref(upload, { download: true })}
              download={upload.name}
              className="neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-heading)] hover:bg-[var(--paper-raised)]"
            >
              Download
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload preview"
            className="neu-button-icon grid h-8 w-8 place-items-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
              <path strokeLinecap="round" d="m7 7 10 10M17 7 7 17" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-[var(--paper-strong)] p-4">
          {unavailable ? (
            <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-[var(--ink-muted)]">
              <p className="max-w-md">{unavailable}</p>
            </div>
          ) : previewError ? (
            <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-[#9a4438]">
              <p className="max-w-md">{previewError}</p>
            </div>
          ) : upload.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, auth-scoped upload bytes
            <img
              src={previewHref}
              alt={upload.name}
              onError={() => setPreviewError("This image could not be opened.")}
              className="mx-auto h-full max-h-full w-full object-contain"
            />
          ) : upload.kind === "video" ? (
            <div className="flex h-full items-center justify-center">
              <ReclaimingVideo
                controls
                preload="metadata"
                src={previewHref}
                onError={() => setPreviewError("This video could not be opened.")}
                className="max-h-full w-full rounded-xl bg-black"
              >
                Your browser cannot preview this video file.
              </ReclaimingVideo>
            </div>
          ) : upload.kind === "audio" ? (
            <div className="flex h-full items-center justify-center">
              <ReclaimingAudio
                controls
                preload="metadata"
                src={previewHref}
                onError={() => setPreviewError("This audio file could not be opened.")}
                className="w-full max-w-xl"
              >
                Your browser cannot play this audio file.
              </ReclaimingAudio>
            </div>
          ) : upload.kind === "model" && upload.previewFormat ? (
            <div className="h-full min-h-[28rem] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-surface)]">
              <ModelViewer
                source={previewHref}
                format={upload.previewFormat}
                presentation="asset"
                upAxis={defaultModelUpAxis(upload.previewFormat)}
                gridUnit="units"
                onError={() => setPreviewError("This 3D model could not be opened.")}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RowMenu({
  upload,
  chatId,
  onClose,
  onPreview,
  onOpenChat,
}: {
  upload: StoredUpload;
  /** The id the host surface opens this upload's chat by. */
  chatId: string;
  onClose: () => void;
  onPreview: (upload: StoredUpload) => void;
  onOpenChat?: (chatId: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      // The ⋯ button toggles the menu itself; its mousedown is not "outside".
      if ((event.target as Element | null)?.closest?.("[data-upload-menu-button]")) return;
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const href = uploadContentHref(upload);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${upload.name}`}
      className="absolute right-2 top-9 z-20 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] py-1 shadow-[0_10px_26px_rgba(0,0,0,0.18)]"
    >
      {upload.hasContent ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onPreview(upload);
            }}
            className="block w-full px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
          >
            Open
          </button>
          <a
            role="menuitem"
            href={`${href}?download=1`}
            download={upload.name}
            onClick={onClose}
            className="block px-3 py-2 text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
          >
            Download
          </a>
        </>
      ) : (
        <p className="px-3 py-2 text-[11px] text-[var(--ink-muted)]">
          Only this file&apos;s name was kept.
        </p>
      )}
      {onOpenChat ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onOpenChat(chatId);
          }}
          className="block w-full px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
        >
          Go to chat
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          void navigator.clipboard?.writeText(upload.name);
          onClose();
        }}
        className="block w-full px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
      >
        Copy name
      </button>
    </div>
  );
}

export default function UploadsPanel({
  onOpenChat,
  activeSurface = "dashboard_terminal",
  gardenSlug = null,
}: Props) {
  const [uploads, setUploads] = useState<StoredUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<StoredUpload | null>(null);
  const closePreview = useCallback(() => setSelectedUpload(null), []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        gardenSlug
          ? `/api/hermes/uploads?gardenSlug=${encodeURIComponent(gardenSlug)}`
          : "/api/hermes/uploads",
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        uploads?: StoredUpload[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Uploads could not be loaded.");
      setUploads(payload.uploads ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Uploads could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [gardenSlug]);

  useEffect(() => {
    // Loading is asynchronous; state changes only after the response settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? uploads.filter(
        (upload) =>
          upload.name.toLowerCase().includes(needle) ||
          upload.conversationTitle.toLowerCase().includes(needle),
      )
    : uploads;

  return (
    // Same surface as the artifacts archive: both open in the same slot, so a
    // different material would read as a different kind of thing.
    <section
      aria-label="Uploads"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink-heading)]">Uploads</h3>
          <p className="text-[10px] text-[var(--ink-muted)]">
            {needle ? `${visible.length} of ${uploads.length}` : uploads.length} attached to your chats
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="neu-button rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
        >
          Refresh
        </button>
      </div>

      <div className="border-b border-[var(--line)] bg-[var(--paper-surface)] p-2.5">
        <div className="neu-inset relative rounded-xl">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]"
          >
            <circle cx="10.5" cy="10.5" r="5.75" />
            <path strokeLinecap="round" d="m15 15 4.25 4.25" />
          </svg>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search uploads"
            aria-label="Search uploads"
            autoComplete="off"
            spellCheck={false}
            className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] py-2 pl-9 pr-9 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:ring-2 focus:ring-[var(--botanical)]/15"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label="Clear upload search"
              title="Clear search"
              className="neu-button-icon absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
                <path strokeLinecap="round" d="m7 7 10 10M17 7 7 17" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="px-3 py-4 text-xs text-[#9a4438]">{error}</p> : null}
        {loading ? (
          <p className="px-3 py-8 text-center text-xs text-[var(--ink-muted)]">Loading uploads…</p>
        ) : visible.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              {uploads.length === 0 ? "Nothing uploaded yet" : "No upload matches that"}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Files you attach to a chat show up here, newest first.
            </p>
          </div>
        ) : (
          <ul>
            {visible.map((upload) => (
              <li
                key={upload.id}
                className="group relative flex items-center border-b border-[color-mix(in_srgb,var(--line)_60%,transparent)] transition hover:bg-[var(--paper-strong)]"
              >
                <button
                  type="button"
                  onClick={() => setSelectedUpload(upload)}
                  aria-label={`View upload ${upload.name}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--botanical)]"
                >
                  {upload.kind === "image" && upload.hasContent ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={uploadContentHref(upload)}
                      alt=""
                      loading="lazy"
                      className="h-9 w-9 shrink-0 rounded-md border border-[var(--line)] object-cover"
                    />
                  ) : upload.kind === "model" ? (
                    // A mesh has no thumbnail to fetch; rendering one would cost a
                    // WebGL context per row.
                    <ModelGlyph />
                  ) : (
                    <FileGlyph name={upload.name} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-[var(--ink)]" title={upload.name}>
                      {upload.name}
                    </p>
                    <p className="truncate text-[10px] text-[var(--ink-muted)]" title={upload.conversationTitle}>
                      {upload.conversationTitle}
                    </p>
                  </div>
                  <span className="w-20 shrink-0 text-right text-[11px] text-[var(--ink-muted)]">
                    {formatUploadDate(upload.uploadedAt)}
                  </span>
                  <span className="w-20 shrink-0 text-right text-[11px] text-[var(--ink-muted)]">
                    {formatUploadSize(upload.sizeBytes)}
                  </span>
                </button>
                <button
                  type="button"
                  data-upload-menu-button
                  onClick={() => setMenuId((current) => (current === upload.id ? null : upload.id))}
                  aria-haspopup="menu"
                  aria-expanded={menuId === upload.id}
                  aria-label={`More actions for ${upload.name}`}
                  className={`mr-3 shrink-0 rounded p-1 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] ${
                    menuId === upload.id ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  }`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="5.5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="18.5" cy="12" r="1.6" />
                  </svg>
                </button>
                {menuId === upload.id ? (
                  <RowMenu
                    upload={upload}
                    // A garden opens its chats by the legacy chat-session id;
                    // the Terminal opens them by the conversation's public id.
                    chatId={
                      gardenSlug && upload.chatSessionId !== null
                        ? String(upload.chatSessionId)
                        : upload.conversationId
                    }
                    onClose={() => setMenuId(null)}
                    onPreview={setSelectedUpload}
                    onOpenChat={
                      onOpenChat &&
                      upload.surface === activeSurface &&
                      // A garden addresses chats by the legacy id, so an upload
                      // from a chat that has no legacy row cannot be reached
                      // from there and the entry is left off rather than dead.
                      (!gardenSlug || upload.chatSessionId !== null)
                        ? onOpenChat
                        : undefined
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {selectedUpload ? <UploadViewer upload={selectedUpload} onClose={closePreview} /> : null}
    </section>
  );
}
