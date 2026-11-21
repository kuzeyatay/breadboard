"use client";

import { useEffect, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { artifactUrl } from "./artifact-viewer";
import { openArtifactConversation } from "./artifact-conversation";

type CreateTab = "generate" | "upload";

/**
 * Opening values for a caller that has the copy in hand already — a social post
 * lives in a database row, so its card seeds the studio directly instead of
 * making the user reach it through the caption artifact.
 */
export interface ArtifactImageStudioSeed {
  title?: string;
  prompt?: string;
  /** Replaces the modal heading, e.g. "Create image for Instagram". */
  heading?: string;
}

/** Creates image artifacts. Editing an existing image happens on the Design page (open-in-design.ts). */
interface ArtifactImageStudioProps {
  /** A non-image artifact whose content should seed a new image. */
  promptArtifact?: PresentedArtifact | null;
  seed?: ArtifactImageStudioSeed | null;
  creationConversationId?: string | null;
  ensureCreationConversation?: () => Promise<string>;
  sourceSurface?: "dashboard_terminal" | "garden_chat";
  gardenSlug?: string | null;
  onClose: () => void;
  onCreated: (artifact: PresentedArtifact) => void;
}

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:ring-1 focus:ring-[var(--botanical)]";
const primaryButtonClass =
  "neu-button neu-button-accent rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

async function responseArtifact(response: Response): Promise<PresentedArtifact> {
  const body = (await response.json().catch(() => ({}))) as {
    artifact?: PresentedArtifact;
    error?: string;
  };
  if (!response.ok || !body.artifact) {
    throw new Error(body.error ?? "The image could not be saved.");
  }
  return body.artifact;
}

export default function ArtifactImageStudio({
  promptArtifact = null,
  seed = null,
  creationConversationId,
  ensureCreationConversation,
  sourceSurface,
  gardenSlug,
  onClose,
  onCreated,
}: ArtifactImageStudioProps) {
  const [createTab, setCreateTab] = useState<CreateTab>("generate");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeTab = createTab;
  const modalTitle =
    seed?.heading ??
    (promptArtifact
      ? `Create image for ${String(promptArtifact.metadata.socialsManagerNetworkName ?? "social post")}`
      : "Create image artifact");

  useEffect(() => {
    if (!file) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!seed) return;
    if (seed.prompt !== undefined) setPrompt(seed.prompt);
    if (seed.title !== undefined) setTitle(seed.title.slice(0, 240));
  }, [seed]);

  useEffect(() => {
    if (!promptArtifact) return;
    const network = String(
      promptArtifact.metadata.socialsManagerNetworkName ??
        promptArtifact.metadata.socialsManagerNetwork ??
        "social media",
    );
    const fallback =
      `Create a polished image to accompany this ${network} post. ` +
      "Match its mood and message, use a strong social-media composition, and do not place the full caption in the image.";
    setPrompt(fallback);
    setTitle(`${network} image — ${promptArtifact.title}`.slice(0, 240));
    if (!promptArtifact.previewAvailable) return;

    let cancelled = false;
    void fetch(artifactUrl(promptArtifact, "preview"), { cache: "no-store" })
      .then((response) =>
        response.ok ? response.text() : Promise.reject(new Error("Caption unavailable")),
      )
      .then((caption) => {
        if (cancelled || !caption.trim()) return;
        setPrompt((current) =>
          current === fallback
            ? `${fallback}\n\nPost copy:\n${caption.trim()}`.slice(0, 4_000)
            : current,
        );
      })
      .catch(() => {
        // The title-based prompt remains useful if the preview cannot load.
      });
    return () => {
      cancelled = true;
    };
  }, [promptArtifact]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function resolveConversationId(): Promise<string> {
    if (promptArtifact?.conversationId) return promptArtifact.conversationId;
    if (creationConversationId) return creationConversationId;
    if (ensureCreationConversation) return ensureCreationConversation();
    if (!sourceSurface) throw new Error("Open a Terminal or Garden chat before creating an image.");

    return openArtifactConversation({
      surface: sourceSurface,
      gardenSlug,
      title: "Artifact images",
    });
  }

  async function generate() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setError("Describe the image you want.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conversationId = await resolveConversationId();
      const response = await fetch("/api/hermes/artifacts/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "generate",
          conversationId,
          prompt: normalizedPrompt,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(promptArtifact ? { parentArtifactId: promptArtifact.id } : {}),
        }),
      });
      onCreated(await responseArtifact(response));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload(upload: File) {
    setBusy(true);
    setError(null);
    try {
      const conversationId = await resolveConversationId();
      const form = new FormData();
      form.set("conversationId", conversationId);
      form.set("file", upload);
      if (title.trim()) form.set("title", title.trim());
      if (promptArtifact) form.set("parentArtifactId", promptArtifact.id);
      const response = await fetch("/api/hermes/artifacts/images", {
        method: "POST",
        body: form,
      });
      onCreated(await responseArtifact(response));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const tabButton = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-[var(--paper-raised)] text-[var(--ink-heading)] shadow-sm"
        : "text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
    }`;

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="bb-modal-panel neu-dialog flex h-[92vh] max-h-[92vh] w-full max-w-[min(88rem,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--ink-heading)]">{modalTitle}</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {promptArtifact || seed
                  ? "Generate or upload artwork for this post. The caption is already included in the prompt."
                  : "Generate with AI or upload an existing image."}
            </p>
          </div>
          <button
            type="button"
            className="neu-button-icon rounded-lg px-2 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
            aria-label="Close image studio"
            disabled={busy}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-[18rem] flex-1 items-center justify-center overflow-auto bg-[var(--neu-surface-pressed)] p-5 sm:p-7">
            {filePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local user-selected object URL
              <img src={filePreview} alt="Upload preview" className="max-h-[74vh] max-w-full rounded-lg border border-[var(--line)] object-contain shadow-lg" />
            ) : (
              <div className="max-w-sm text-center text-[var(--ink-muted)]">
                <svg className="mx-auto mb-3 h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
                  <circle cx="9" cy="9" r="1.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5.5 18 4.5-4.5 3.1 3.1 2.2-2.2 3.2 3.2M17.5 6v4m-2-2h4" />
                </svg>
                <p className="text-sm font-medium text-[var(--ink-heading)]">Your image will appear as an artifact</p>
                <p className="mt-1 text-xs">It stays available in this archive for preview, editing, and download.</p>
              </div>
            )}
          </div>

          <aside className="w-full shrink-0 overflow-y-auto border-t border-[var(--line)] bg-[var(--paper-surface)] p-4 md:w-[26rem] md:border-l md:border-t-0">
            <div className="mb-4 flex rounded-lg bg-[var(--paper-strong)] p-1" role="tablist" aria-label="Image tools">
              <button type="button" role="tab" aria-selected={createTab === "generate"} className={`flex-1 ${tabButton(createTab === "generate")}`} onClick={() => setCreateTab("generate")}>Generate</button>
              <button type="button" role="tab" aria-selected={createTab === "upload"} className={`flex-1 ${tabButton(createTab === "upload")}`} onClick={() => setCreateTab("upload")}>Upload</button>
            </div>

            <label className="mb-4 block text-xs font-medium text-[var(--ink-heading)]">
              Artifact title <span className="font-normal text-[var(--ink-muted)]">(optional)</span>
              <input className={`${fieldClass} mt-1.5`} value={title} maxLength={240} placeholder="Generated image" onChange={(event) => setTitle(event.target.value)} />
            </label>

            {activeTab === "generate" ? (
              <>
                <label className="block text-xs font-medium text-[var(--ink-heading)]">
                  Describe the image
                  <textarea
                    className={`${fieldClass} mt-1.5 min-h-32 resize-y`}
                    value={prompt}
                    maxLength={4000}
                    placeholder="A cinematic poster with sapphire and violet light…"
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                </label>
                <p className="mt-2 text-[10px] leading-4 text-[var(--ink-muted)]">Uses the image provider selected for chat.</p>
                <button type="button" className={`${primaryButtonClass} mt-4 w-full`} disabled={busy || !prompt.trim()} onClick={() => void generate()}>
                  {busy ? "Generating…" : "Generate artifact"}
                </button>
              </>
            ) : null}

            {activeTab === "upload" ? (
              <>
                <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-8 text-center hover:bg-[var(--paper-raised)]">
                  <span className="text-sm font-medium text-[var(--ink-heading)]">Choose an image</span>
                  <span className="mt-1 text-xs text-[var(--ink-muted)]">PNG, JPEG, WebP, or GIF · 25 MiB max</span>
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                </label>
                {file ? <p className="mt-2 truncate text-xs text-[var(--ink-muted)]">{file.name}</p> : null}
                <button type="button" className={`${primaryButtonClass} mt-4 w-full`} disabled={busy || !file} onClick={() => { if (file) void submitUpload(file); }}>
                  {busy ? "Uploading…" : "Upload artifact"}
                </button>
              </>
            ) : null}

            {error ? (
              <p role="alert" className="mt-4 rounded-lg border border-[var(--danger)] bg-[var(--paper-strong)] p-2.5 text-xs text-[var(--danger)]">{error}</p>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
