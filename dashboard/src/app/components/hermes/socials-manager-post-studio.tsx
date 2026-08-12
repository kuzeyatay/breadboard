"use client";

// The editor behind a post card's single "Edit" button — and the way a post
// artifact opens.
//
// A post is copy *and* a picture, and both used to be edited from different
// places — a textarea that grew out of the card, a generic image studio that
// knew nothing about posts, a separate button to reach the draft artifact. This
// is one room for all of it: the caption and the artwork are staged side by
// side against a live preview of the post, and one Save writes both.
//
// It renders two ways. As a modal it sits over the run card that drafted the
// post; inline (`variant="inline"`) it is the body of the post artifact's
// viewer, which is why the header, the backdrop and Escape-to-close belong to
// the chrome rather than to the editor.
//
// Artwork can be generated, uploaded, rendered on the local ComfyUI, or — the
// reason this exists — picked from pictures already in the archive. Creating an
// image is unavoidably immediate (it becomes an artifact the moment it is
// made), but *attaching* it to the post is not: every choice here is staged
// until Save, so Cancel really cancels.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import type { AttachablePostImage } from "@/lib/socials-manager/post-images";
import { artifactUrl } from "./artifact-viewer";
import { openArtifactConversation, type ArtifactSurface } from "./artifact-conversation";
import ComfyUiImagePanel, { type ComfyUiRenderRequest } from "./comfyui-image-panel";

/** The part of a post this studio edits. */
export interface SocialsManagerStudioPost {
  id: number;
  providerName: string;
  content: string;
  scheduledAt: string | null;
  calendarEventId: number | null;
  artifactId: string | null;
  imageArtifactId: string | null;
  imagePreviewUrl: string | null;
  remoteId: string | null;
  characterLimit: number | null;
}

/** An object type, not an interface, so a caller may take it as a plain patch. */
export type SocialsManagerStudioPatch = {
  content?: string;
  imageArtifactId?: string | null;
};

interface Props {
  post: SocialsManagerStudioPost;
  /**
   * `modal` puts the editor over the surface that opened it; `inline` renders
   * it as the body of a container that already has a header and a way out —
   * the post artifact's viewer.
   */
  variant?: "modal" | "inline";
  /** Where images made here are filed. Without it, only the archive is offered. */
  conversationId?: string | null;
  gardenSlug?: string | null;
  sourceSurface?: ArtifactSurface | null;
  /** Resolves to false when the save failed, so the studio stays open. */
  onSave: (patch: SocialsManagerStudioPatch) => Promise<boolean>;
  /** Required by the modal, which has nowhere to return to without it. */
  onClose?: () => void;
  onOpenArtifact?: ((artifactId: string) => void) | null;
  /** Lets the surrounding transcript notice artwork made in here. */
  onArtifactCreated?: (artifact: PresentedArtifact) => void;
  /** Wall-clock formatter shared with the card, so both name a slot the same way. */
  formatSlot?: (stamp: string | null) => string;
}

type Tab = "caption" | "image";
type ImageMode = "generate" | "upload" | "library" | "advanced";

/** A staged image: `null` artifact id means "remove the one that is there". */
interface StagedImage {
  artifactId: string | null;
  previewUrl: string | null;
}

const fieldClass =
  "w-full rounded-[13px] border border-[color-mix(in_srgb,var(--line)_70%,transparent)] bg-[var(--paper-surface)] px-3 py-2 text-[13px] leading-[1.618] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus-visible:border-[var(--line-strong)]";
const buttonClass =
  "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "neu-button neu-button-accent rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

/**
 * "2026-08-05T09:00" → "Wed 5 Aug, 09:00". Wall-clock in, wall-clock out: a
 * post's slot is a time on a wall, not an instant on a timeline, so it is never
 * put through a timezone.
 */
export function formatPostSlot(stamp: string | null): string {
  if (!stamp) return "Not scheduled";
  const [date, time] = stamp.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const rendered = new Date(year, month - 1, day);
  if (Number.isNaN(rendered.getTime())) return stamp;
  const weekday = rendered.toLocaleDateString(undefined, { weekday: "short" });
  const monthName = rendered.toLocaleDateString(undefined, { month: "short" });
  return `${weekday} ${day} ${monthName}, ${time}`;
}

/**
 * The prompt the Generate tab opens with. It mirrors `postImagePrompt` on the
 * server so artwork asked for here and artwork asked for with `--image` during
 * a run start from the same instruction.
 */
export function postImagePromptFor(networkName: string, content: string): string {
  return (
    `Create a polished image to accompany this ${networkName} post. ` +
    "Match its mood and message, use a strong social-media composition, and do not place the full caption in the image." +
    `\n\nPost copy:\n${content.trim()}`
  ).slice(0, 4_000);
}

function tabClass(active: boolean): string {
  return `flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
    active
      ? "bg-[var(--paper-raised)] text-[var(--ink-heading)] shadow-sm"
      : "text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
  }`;
}

export default function SocialsManagerPostStudio({
  post,
  variant = "modal",
  conversationId,
  gardenSlug,
  sourceSurface,
  onSave,
  onClose,
  onOpenArtifact,
  onArtifactCreated,
  formatSlot = formatPostSlot,
}: Props) {
  const [tab, setTab] = useState<Tab>("caption");
  const [imageMode, setImageMode] = useState<ImageMode>("library");
  const [caption, setCaption] = useState(post.content);
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const [prompt, setPrompt] = useState(() =>
    postImagePromptFor(post.providerName, post.content),
  );
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [library, setLibrary] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    items: AttachablePostImage[];
    error: string | null;
  }>({ status: "idle", items: [], error: null });
  const [busy, setBusy] = useState<null | "saving" | "generating" | "uploading" | "rendering">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // ComfyUI switched off is the one case where offering the tab at all would be
  // a dead end, so the panel says so once and the tab disappears.
  const [advancedOffered, setAdvancedOffered] = useState(true);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);

  const image: StagedImage = staged ?? {
    artifactId: post.imageArtifactId,
    previewUrl: post.imagePreviewUrl,
  };
  const captionChanged = caption !== post.content;
  const imageChanged = staged !== null && staged.artifactId !== post.imageArtifactId;
  const dirty = captionChanged || imageChanged;
  const characterCount = caption.length;
  const overLimit =
    post.characterLimit !== null && characterCount > post.characterLimit;
  // Artwork has to be filed somewhere before it can be attached; without a
  // surface to file it on, the archive is still perfectly usable.
  const canCreateImages = Boolean(conversationId || sourceSurface);

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
    if (tab === "caption") captionRef.current?.focus();
  }, [tab]);

  const loadLibrary = useCallback(async () => {
    setLibrary((current) => ({ ...current, status: "loading", error: null }));
    try {
      const response = await fetch("/api/socials-manager/images", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        images?: AttachablePostImage[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Your images could not be listed.");
      setLibrary({ status: "ready", items: data.images ?? [], error: null });
    } catch (cause) {
      setLibrary({
        status: "error",
        items: [],
        error: cause instanceof Error ? cause.message : "Your images could not be listed.",
      });
    }
  }, []);

  useEffect(() => {
    if (tab === "image" && imageMode === "library" && library.status === "idle") {
      void loadLibrary();
    }
  }, [imageMode, library.status, loadLibrary, tab]);

  const requestClose = useCallback(() => {
    if (busy || !onClose) return;
    if (
      dirty &&
      typeof window !== "undefined" &&
      !window.confirm("Discard the unsaved changes to this post?")
    ) {
      return;
    }
    onClose();
  }, [busy, dirty, onClose]);

  // Escape belongs to whatever owns the way out. Inline, that is the viewer
  // around this editor, and stealing the key would close the artifact from
  // under a half-written caption.
  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose, variant]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return library.items;
    return library.items.filter((item) => item.title.toLowerCase().includes(needle));
  }, [library.items, search]);

  async function resolveConversationId(): Promise<string> {
    if (conversationId) return conversationId;
    if (!sourceSurface) {
      throw new Error("Open a Terminal or Garden chat before creating an image.");
    }
    return openArtifactConversation({
      surface: sourceSurface,
      gardenSlug,
      title: "Post artwork",
    });
  }

  function stageCreated(artifact: PresentedArtifact) {
    setStaged({ artifactId: artifact.id, previewUrl: artifactUrl(artifact, "preview") });
    onArtifactCreated?.(artifact);
    // The new picture belongs in the archive list too, next time it is opened.
    setLibrary((current) => ({ ...current, status: "idle" }));
  }

  async function createdArtifact(response: Response): Promise<PresentedArtifact> {
    const body = (await response.json().catch(() => ({}))) as {
      artifact?: PresentedArtifact;
      error?: string;
    };
    if (!response.ok || !body.artifact) {
      throw new Error(body.error ?? "The image could not be saved.");
    }
    return body.artifact;
  }

  async function generate() {
    const instruction = prompt.trim();
    if (!instruction) {
      setError("Describe the image you want.");
      return;
    }
    setBusy("generating");
    setError(null);
    try {
      const response = await fetch("/api/hermes/artifacts/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "generate",
          conversationId: await resolveConversationId(),
          prompt: instruction,
          title: `${post.providerName} image`,
        }),
      });
      stageCreated(await createdArtifact(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be created.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Render on the local ComfyUI. Same destination as Generate — an artifact in
   * the archive, staged onto the post — so the two modes stay interchangeable
   * from the post's point of view; only the way the picture was made differs.
   */
  async function renderWithComfyUi(request: ComfyUiRenderRequest) {
    setBusy("rendering");
    setError(null);
    try {
      const response = await fetch("/api/hermes/artifacts/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "comfyui",
          conversationId: await resolveConversationId(),
          title: `${post.providerName} image`,
          comfyui: request,
        }),
      });
      stageCreated(await createdArtifact(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be rendered.");
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    if (!file) return;
    setBusy("uploading");
    setError(null);
    try {
      const form = new FormData();
      form.set("conversationId", await resolveConversationId());
      form.set("file", file);
      form.set("title", `${post.providerName} image`);
      const response = await fetch("/api/hermes/artifacts/images", {
        method: "POST",
        body: form,
      });
      stageCreated(await createdArtifact(response));
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("saving");
    setError(null);
    try {
      const saved = await onSave({
        ...(captionChanged ? { content: caption } : {}),
        ...(imageChanged ? { imageArtifactId: image.artifactId } : {}),
      });
      // The card reports the reason itself; this keeps the studio open over it
      // so nothing the user typed is lost to a failed write. A saved post closes
      // the modal; inline there is nothing to close, and the caller re-seeds the
      // editor from the post it just wrote.
      if (saved) onClose?.();
      else setError("The post could not be saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The post could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  const scheduleLine = `${
    post.calendarEventId
      ? `On your calendar · ${formatSlot(post.scheduledAt)}`
      : "Not on your calendar"
  }${post.remoteId ? " · saved in Postiz" : ""}`;

  return (
    <StudioChrome
      variant={variant}
      providerName={post.providerName}
      scheduleLine={scheduleLine}
      closeDisabled={Boolean(busy)}
      onRequestClose={requestClose}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* The post as it will go out — caption and artwork together, updating
            as either is edited, because that pairing is the whole judgement
            the user is making here. */}
        <div className="flex min-h-[16rem] flex-1 items-start justify-center overflow-y-auto bg-[var(--neu-surface-pressed)] p-5 sm:p-7">
          <article className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] shadow-[0_10px_30px_rgba(28,45,36,0.08)]">
            <div className="flex items-center gap-2.5 px-4 py-3">
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-strong)] text-xs font-semibold uppercase text-[var(--botanical)]"
              >
                {post.providerName.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
                  {post.providerName}
                </span>
                <span className="block text-xs text-[var(--ink-muted)]">
                  {post.calendarEventId ? formatSlot(post.scheduledAt) : "Draft"}
                </span>
              </span>
            </div>

            {caption.trim() ? (
              <p className="whitespace-pre-wrap break-words px-4 pb-3 text-[13px] leading-[1.618] text-[var(--ink)]">
                {caption}
              </p>
            ) : (
              <p className="px-4 pb-3 text-[13px] italic leading-[1.618] text-[var(--ink-muted)]">
                This post has no copy yet.
              </p>
            )}

            {busy === "generating" || busy === "rendering" ? (
              <div className="flex h-48 items-center justify-center border-t border-[var(--line)] bg-[var(--paper-strong)] text-xs text-[var(--ink-muted)]">
                {busy === "rendering"
                  ? "Rendering an image on this machine…"
                  : "Drawing an image for this post…"}
              </div>
            ) : image.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- auth-scoped artifact preview, not a next/image source
              <img
                src={image.previewUrl}
                alt={`Artwork attached to the ${post.providerName} post`}
                className="block max-h-[46vh] w-full border-t border-[var(--line)] object-cover"
              />
            ) : filePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL for a file not uploaded yet
              <img
                src={filePreview}
                alt="The image you chose, not added yet"
                className="block max-h-[46vh] w-full border-t border-[var(--line)] object-cover opacity-70"
              />
            ) : (
              <div className="border-t border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-xs text-[var(--ink-muted)]">
                No image on this post
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-2.5">
              <span
                className={`text-xs tabular-nums ${
                  overLimit ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"
                }`}
              >
                {characterCount}
                {post.characterLimit === null ? "" : ` / ${post.characterLimit}`}
              </span>
              {overLimit ? (
                <span className="text-xs text-[var(--danger)]">
                  Over the {post.providerName} limit
                </span>
              ) : null}
            </div>
          </article>
        </div>

        <aside className="flex w-full shrink-0 flex-col overflow-hidden border-t border-[var(--line)] bg-[var(--paper-surface)] md:w-[26rem] md:border-l md:border-t-0">
          <div className="shrink-0 p-4 pb-0">
            <div
              className="mb-4 flex rounded-lg bg-[var(--paper-strong)] p-1"
              role="tablist"
              aria-label="Post editor"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "caption"}
                className={tabClass(tab === "caption")}
                onClick={() => setTab("caption")}
              >
                Caption
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "image"}
                className={tabClass(tab === "image")}
                onClick={() => setTab("image")}
              >
                Image
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {tab === "caption" ? (
              <>
                <label className="block text-xs font-medium text-[var(--ink-heading)]">
                  Post copy
                  <textarea
                    ref={captionRef}
                    className={`${fieldClass} mt-1.5 min-h-64 resize-y`}
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    aria-label={`Edit the ${post.providerName} post`}
                  />
                </label>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
                    Saving also retitles this post&apos;s calendar entry.
                  </p>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!captionChanged || Boolean(busy)}
                    onClick={() => setCaption(post.content)}
                  >
                    Revert
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  className="mb-3 flex rounded-lg bg-[var(--paper-strong)] p-1"
                  role="tablist"
                  aria-label="Where the image comes from"
                >
                  {(
                    [
                      ["library", "My images"],
                      ["generate", "Generate"],
                      ["upload", "Upload"],
                      ...(advancedOffered ? ([["advanced", "Advanced"]] as const) : []),
                    ] as ReadonlyArray<readonly [ImageMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={imageMode === mode}
                      className={tabClass(imageMode === mode)}
                      onClick={() => setImageMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {imageMode === "library" ? (
                  <>
                    <div className="mb-3 flex items-center gap-2">
                      <input
                        className={fieldClass}
                        value={search}
                        placeholder="Search your images"
                        aria-label="Search your images"
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={library.status === "loading"}
                        onClick={() => void loadLibrary()}
                      >
                        Refresh
                      </button>
                    </div>

                    {library.status === "loading" ? (
                      <p className="text-xs text-[var(--ink-muted)]">
                        Looking through your images…
                      </p>
                    ) : library.status === "error" ? (
                      <p role="alert" className="text-xs text-[var(--danger)]">
                        {library.error}
                      </p>
                    ) : filtered.length ? (
                      <ul className="grid grid-cols-2 gap-2">
                        {filtered.map((item) => {
                          const selected = image.artifactId === item.id;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                aria-pressed={selected}
                                title={item.title}
                                onClick={() =>
                                  setStaged({
                                    artifactId: item.id,
                                    previewUrl: item.previewUrl,
                                  })
                                }
                                className={`block w-full overflow-hidden rounded-[13px] border bg-[var(--paper-strong)] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                                  selected
                                    ? "border-[var(--botanical)] ring-2 ring-[var(--botanical)]"
                                    : "border-[var(--line)] hover:border-[var(--line-strong)]"
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- auth-scoped artifact preview */}
                                <img
                                  src={item.previewUrl}
                                  alt={item.title}
                                  loading="lazy"
                                  className="block h-24 w-full object-cover"
                                />
                                <span className="block truncate px-2 py-1.5 text-[10px] leading-4 text-[var(--ink-muted)]">
                                  {item.title}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-[var(--ink-muted)]">
                        {library.items.length
                          ? "No image matches that search."
                          : "You have no images yet. Generate or upload one and it will be here next time."}
                      </p>
                    )}
                  </>
                ) : null}

                {imageMode === "generate" ? (
                  <>
                    <label className="block text-xs font-medium text-[var(--ink-heading)]">
                      Describe the image
                      <textarea
                        className={`${fieldClass} mt-1.5 min-h-40 resize-y`}
                        value={prompt}
                        maxLength={4000}
                        onChange={(event) => setPrompt(event.target.value)}
                      />
                    </label>
                    <p className="mt-2 text-[10px] leading-4 text-[var(--ink-muted)]">
                      The prompt already carries this post&apos;s copy. Artwork is made
                      with the provider selected for Breadboard chat and is filed in
                      your archive.
                    </p>
                    <button
                      type="button"
                      className={`${primaryButtonClass} mt-3 w-full`}
                      disabled={Boolean(busy) || !prompt.trim() || !canCreateImages}
                      onClick={() => void generate()}
                    >
                      {busy === "generating" ? "Drawing…" : "Generate image"}
                    </button>
                    <button
                      type="button"
                      className={`${buttonClass} mt-2 w-full`}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        setPrompt(postImagePromptFor(post.providerName, caption))
                      }
                    >
                      Rebuild the prompt from the current copy
                    </button>
                  </>
                ) : null}

                {imageMode === "upload" ? (
                  <>
                    <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-strong)] px-4 py-8 text-center hover:bg-[var(--paper-raised)]">
                      <span className="text-sm font-medium text-[var(--ink-heading)]">
                        Choose an image
                      </span>
                      <span className="mt-1 text-xs text-[var(--ink-muted)]">
                        PNG, JPEG, WebP, or GIF · 25 MiB max
                      </span>
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    {file ? (
                      <p className="mt-2 truncate text-xs text-[var(--ink-muted)]">
                        {file.name}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className={`${primaryButtonClass} mt-3 w-full`}
                      disabled={Boolean(busy) || !file || !canCreateImages}
                      onClick={() => void upload()}
                    >
                      {busy === "uploading" ? "Adding…" : "Add this image"}
                    </button>
                  </>
                ) : null}

                {imageMode === "advanced" ? (
                  <ComfyUiImagePanel
                    seedPrompt={prompt}
                    onRebuildPrompt={() => postImagePromptFor(post.providerName, caption)}
                    canCreateImages={canCreateImages}
                    busy={Boolean(busy)}
                    rendering={busy === "rendering"}
                    onRender={renderWithComfyUi}
                    onDisabled={() => {
                      setAdvancedOffered(false);
                      setImageMode("library");
                    }}
                  />
                ) : null}

                {!canCreateImages && imageMode !== "library" ? (
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">
                    New artwork needs an open chat to file it in. Pick one of your
                    existing images instead.
                  </p>
                ) : null}

                {image.artifactId ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
                    {onOpenArtifact ? (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => onOpenArtifact(image.artifactId as string)}
                      >
                        Open this image
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={Boolean(busy)}
                      onClick={() => setStaged({ artifactId: null, previewUrl: null })}
                    >
                      Remove image
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-[var(--danger)] bg-[var(--paper-strong)] p-2.5 text-xs text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-5 py-3">
        {/* Inline, this editor *is* the draft artifact, so there is nothing
            to open — only the artwork, which the Image tab reaches. */}
        {post.artifactId && onOpenArtifact && variant === "modal" ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => onOpenArtifact(post.artifactId as string)}
          >
            Open draft artifact
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[var(--ink-muted)]">
            {busy === "saving"
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : "Everything is saved"}
          </span>
          {variant === "modal" ? (
            <button
              type="button"
              className={buttonClass}
              disabled={Boolean(busy)}
              onClick={requestClose}
            >
              Cancel
            </button>
          ) : (
            // Cancel means "leave without saving", which inline is just not
            // saving. What is actually useful here is putting the post back.
            <button
              type="button"
              className={buttonClass}
              disabled={Boolean(busy) || !dirty}
              onClick={() => {
                setCaption(post.content);
                setStaged(null);
                setError(null);
              }}
            >
              Discard changes
            </button>
          )}
          <button
            type="button"
            className={primaryButtonClass}
            disabled={Boolean(busy) || !dirty}
            onClick={() => void save()}
          >
            Save post
          </button>
        </span>
      </footer>
    </StudioChrome>
  );
}

/**
 * The frame around the editor.
 *
 * As a modal it owns the backdrop, the panel and a header naming the post;
 * inline it owns almost nothing, because the artifact viewer it sits in already
 * has the post's title, a close button and its own scroll — all it adds is the
 * one line the header would otherwise carry, which is where the post stands.
 */
function StudioChrome({
  variant,
  providerName,
  scheduleLine,
  closeDisabled,
  onRequestClose,
  children,
}: {
  variant: "modal" | "inline";
  providerName: string;
  scheduleLine: string;
  closeDisabled: boolean;
  onRequestClose: () => void;
  children: ReactNode;
}) {
  if (variant === "inline") {
    return (
      <section
        aria-label={`Edit the ${providerName} post`}
        className="flex h-full min-h-[34rem] flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-surface)]"
      >
        <p className="shrink-0 truncate border-b border-[var(--line)] px-5 py-2.5 text-xs text-[var(--ink-muted)]">
          {scheduleLine}
        </p>
        {children}
      </section>
    );
  }

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit the ${providerName} post`}
      onClick={onRequestClose}
    >
      <div
        className="bb-modal-panel neu-dialog flex h-[92vh] max-h-[92vh] w-full max-w-[min(80rem,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--ink-heading)]">
              {providerName} post
            </h2>
            <p className="truncate text-xs text-[var(--ink-muted)]">{scheduleLine}</p>
          </div>
          <button
            type="button"
            className="neu-button-icon rounded-lg px-2 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
            aria-label="Close the post editor"
            disabled={closeDisabled}
            onClick={onRequestClose}
          >
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
