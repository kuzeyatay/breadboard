"use client";

import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { shouldRenderInteractiveVisualizerInline } from "@/lib/hermes/interactive-visualizer-skills";
import ArtifactViewer, {
  ARTIFACT_BROWSER_EVENT,
  artifactDescription,
  artifactPdfHref,
  artifactUrl,
  ArtifactFileIcon,
  deleteArtifactRequest,
} from "./artifact-viewer";
import ArtifactImageStudio from "./artifact-image-studio";
import ArtifactVideoStudio from "./artifact-video-studio";
import InlineInteractiveVisualizer from "./inline-interactive-visualizer";

interface ArtifactScopeProps {
  conversationId?: string | null;
  legacyChatSessionId?: number | null;
  gardenSlug?: string | null;
  /** Increment to retire the cards currently shown for this conversation. */
  retireVersion?: number;
}

/**
 * The artifacts a transcript has already asked for, kept per query.
 *
 * Artifact cards used to arrive a full round trip after the message bubbles,
 * because the provider only mounts once the transcript has messages to wrap: a
 * chat that plainly had artifacts looked empty for a beat after opening. The
 * request now starts as soon as the conversation is known — alongside the
 * message load, via `useInlineArtifactPrefetch` — and the answer is kept here
 * so the provider can paint its cards in the same commit the messages do.
 */
const artifactCache = new Map<string, PresentedArtifact[]>();
const artifactRequests = new Map<string, Promise<PresentedArtifact[]>>();

export function inlineArtifactQuery({
  conversationId,
  legacyChatSessionId,
  gardenSlug,
}: ArtifactScopeProps): string {
  const params = new URLSearchParams();
  if (conversationId) params.set("conversationId", conversationId);
  if (!conversationId && legacyChatSessionId) {
    params.set("chatSessionId", String(legacyChatSessionId));
  }
  if (gardenSlug) params.set("gardenSlug", gardenSlug);
  return params.toString();
}

async function requestArtifacts(
  query: string,
  signal?: AbortSignal,
): Promise<PresentedArtifact[]> {
  const response = await fetch(`/api/hermes/artifacts?${query}`, { signal });
  if (!response.ok) throw new Error(`Artifacts request failed (${response.status})`);
  const data = await response.json();
  const artifacts = Array.isArray(data.artifacts)
    ? (data.artifacts as PresentedArtifact[])
    : [];
  artifactCache.set(query, artifacts);
  return artifacts;
}

/**
 * Start the artifact request for a conversation before its cards mount — call
 * it as early as the conversation id is known, next to the transcript load.
 * Safe to call repeatedly; one request per query is in flight at a time.
 */
export function primeInlineArtifacts(scope: ArtifactScopeProps): void {
  const query = inlineArtifactQuery(scope);
  if (!query || artifactRequests.has(query)) return;
  const request = requestArtifacts(query)
    // A failed prefetch is not worth reporting: the provider refreshes on
    // mount, and the full Artifacts panel remains available either way.
    .catch(() => [] as PresentedArtifact[])
    .finally(() => artifactRequests.delete(query));
  artifactRequests.set(query, request);
}

/** `primeInlineArtifacts` for a transcript that renders the conversation. */
export function useInlineArtifactPrefetch(scope: ArtifactScopeProps): void {
  const { conversationId, legacyChatSessionId, gardenSlug } = scope;
  useEffect(() => {
    primeInlineArtifacts({ conversationId, legacyChatSessionId, gardenSlug });
  }, [conversationId, legacyChatSessionId, gardenSlug]);
}

interface Props extends ArtifactScopeProps {
  /**
   * Place cards beside the assistant response that owns them. `null` selects
   * legacy/unassigned artifacts; omitted preserves the all-artifacts view.
   */
  ownerMessageId?: string | null;
}

/**
 * Opening the image studio without an artifact to start from.
 *
 * A Socials Manager post is the case this exists for: the copy lives in a database row,
 * not only in an artifact, so the card seeds the studio straight from the post
 * and takes the finished image back through `onCreated` instead of relying on
 * the transcript's artifact list.
 */
export interface InlineImageStudioRequest {
  /** Title and prompt to open with, when no artifact supplies them. */
  seed?: { title?: string; prompt?: string; heading?: string };
  /** A text artifact whose content should seed the prompt. */
  promptArtifact?: PresentedArtifact | null;
  /** An existing image to edit rather than create. */
  sourceArtifact?: PresentedArtifact | null;
  onCreated?: (artifact: PresentedArtifact) => void;
}

/**
 * Where this transcript files artifacts. A card that creates one of its own —
 * the Socials Manager post studio makes artwork — needs the same answer the shared image
 * studio gets, without going through the shared studio to ask.
 */
export interface InlineArtifactScope {
  conversationId: string | null;
  gardenSlug: string | null;
  sourceSurface: "dashboard_terminal" | "garden_chat";
}

interface ArtifactCardsContextValue {
  artifacts: PresentedArtifact[];
  deletingId: string | null;
  deleteError: string | null;
  scope: InlineArtifactScope;
  setOpenId: (id: string | null) => void;
  openArtifact: (id: string) => Promise<void>;
  handleDelete: (artifact: PresentedArtifact) => Promise<void>;
  openImageStudio: (request: InlineImageStudioRequest) => void;
  registerArtifact: (artifact: PresentedArtifact) => void;
}

const ArtifactCardsContext = createContext<ArtifactCardsContextValue | null>(null);

/** Open an artifact in the viewer owned by the surrounding transcript. */
export function useInlineArtifactViewer():
  | ((artifactId: string) => Promise<void>)
  | null {
  return useContext(ArtifactCardsContext)?.openArtifact ?? null;
}

/** Open the image studio owned by the surrounding transcript. */
export function useInlineImageStudio():
  | ((request: InlineImageStudioRequest) => void)
  | null {
  return useContext(ArtifactCardsContext)?.openImageStudio ?? null;
}

/** The conversation and surface this transcript files new artifacts on. */
export function useInlineArtifactScope(): InlineArtifactScope | null {
  return useContext(ArtifactCardsContext)?.scope ?? null;
}

/** Show an artifact a card created itself among this transcript's cards. */
export function useRegisterInlineArtifact():
  | ((artifact: PresentedArtifact) => void)
  | null {
  return useContext(ArtifactCardsContext)?.registerArtifact ?? null;
}

function artifactStatusLabel(artifact: PresentedArtifact): string {
  if (artifact.status === "failed") return "Failed";
  const lifecycle = typeof artifact.metadata.lifecycleStatus === "string"
    ? artifact.metadata.lifecycleStatus
    : "";
  if (lifecycle === "planning") return "Planning";
  if (lifecycle === "generating" || lifecycle === "building") return "Building";
  if (lifecycle === "validating" || lifecycle === "browser_testing") return "Validating";
  if (lifecycle === "repairing") return "Repairing";
  if (lifecycle === "cancelled") return "Cancelled";
  return "Generating";
}

/** A quiet, botanical loading mark for the artifact's otherwise-empty preview. */
function ArtifactBloomLoader() {
  return (
    <span
      className="relative inline-flex h-14 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--paper-strong)]"
      aria-hidden="true"
    >
      <span className="absolute h-8 w-8 rounded-full bg-[var(--botanical)]/10 blur-md motion-safe:animate-pulse" />
      <svg className="relative h-8 w-8 text-[var(--botanical)]" viewBox="0 0 32 32" fill="none">
        <g className="origin-center motion-safe:animate-spin [animation-duration:3.8s]">
          <ellipse cx="16" cy="7" rx="2.7" ry="5" fill="currentColor" fillOpacity=".72" />
          <ellipse cx="16" cy="25" rx="2.7" ry="5" fill="currentColor" fillOpacity=".38" />
          <ellipse cx="7" cy="16" rx="5" ry="2.7" fill="currentColor" fillOpacity=".52" />
          <ellipse cx="25" cy="16" rx="5" ry="2.7" fill="currentColor" fillOpacity=".9" />
        </g>
        <g className="origin-center motion-safe:animate-spin [animation-direction:reverse] [animation-duration:5.4s]">
          <circle cx="10" cy="10" r="1.6" fill="currentColor" fillOpacity=".45" />
          <circle cx="22" cy="22" r="1.6" fill="currentColor" fillOpacity=".7" />
          <circle cx="22" cy="10" r="1.2" fill="currentColor" fillOpacity=".35" />
          <circle cx="10" cy="22" r="1.2" fill="currentColor" fillOpacity=".55" />
        </g>
        <circle cx="16" cy="16" r="3.25" fill="var(--paper-raised)" stroke="currentColor" strokeWidth="1.35" />
        <circle cx="16" cy="16" r="1.15" fill="currentColor" />
      </svg>
    </span>
  );
}

function InlineArtifactLoadingCard({ artifact }: { artifact: PresentedArtifact }) {
  const status = artifactStatusLabel(artifact);
  return (
    <article
      className="bb-neu-artifact-card flex min-h-[5.25rem] items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 shadow-[0_8px_24px_rgba(28,45,36,0.06)]"
      role="status"
      aria-label={`${status} ${artifact.title}`}
      aria-live="polite"
    >
      <ArtifactBloomLoader />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
          {artifact.title}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
          Your artifact is taking shape
        </span>
      </span>
      {status !== "Repairing" ? (
        <span className="shrink-0 rounded-full bg-[var(--paper-strong)] px-2.5 py-1 text-xs text-[var(--ink-muted)]">
          {status}
        </span>
      ) : null}
    </article>
  );
}

function InlineImageArtifact({
  artifact,
  context,
}: {
  artifact: PresentedArtifact;
  context: ArtifactCardsContextValue;
}) {
  const previewUrl = artifactUrl(artifact, "preview");
  const downloadUrl = artifactUrl(artifact, "download");
  return (
    <article className="bb-neu-artifact-card overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] shadow-[0_10px_30px_rgba(28,45,36,0.08)]">
      <button
        type="button"
        onClick={() => context.setOpenId(artifact.id)}
        className="neu-inset block w-full overflow-hidden bg-[var(--paper-bg)] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--botanical)]"
        title={`Open ${artifact.title}`}
      >
        {/* The intrinsic aspect ratio must remain untouched: generated images
            are shown as full artwork here, never cropped into a thumbnail. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={artifact.title}
          className="block h-auto w-full object-contain"
          loading="eager"
        />
      </button>
      <div
        className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--paper-surface)] px-3.5 py-3"
        aria-label={`Artifact actions for ${artifact.title}`}
      >
        <span className="bb-neu-artifact-preview inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-current">
          <ArtifactFileIcon kind="image" />
        </span>
        <span className="min-w-[10rem] flex-1">
          <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
            {artifact.title}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
            {artifactDescription(artifact)}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => context.setOpenId(artifact.id)}
            className="neu-button rounded-lg border px-3 py-2 text-xs font-medium text-[var(--ink-heading)]"
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => context.openImageStudio({ sourceArtifact: artifact })}
            className="neu-button rounded-lg border px-3 py-2 text-xs font-medium text-[var(--ink-heading)]"
          >
            Edit
          </button>
          {artifact.downloadAvailable ? (
            <a
              href={downloadUrl}
              className="neu-button rounded-lg border px-3 py-2 text-xs font-medium text-[var(--ink-heading)]"
            >
              Download
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void context.handleDelete(artifact)}
            disabled={context.deletingId === artifact.id}
            aria-label={`Delete ${artifact.title}`}
            title="Delete artifact"
            className="neu-button-icon rounded-lg border p-2 text-[var(--ink-muted)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7.5h12M9.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 6v1.5m-6 0 .5 11a1.5 1.5 0 0 0 1.5 1.4h3a1.5 1.5 0 0 0 1.5-1.4l.5-11" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}

export function InlineArtifactCardsProvider({
  conversationId,
  legacyChatSessionId,
  gardenSlug,
  retireVersion = 0,
  children,
}: ArtifactScopeProps & { children: ReactNode }) {
  const query = useMemo(
    () => inlineArtifactQuery({ conversationId, legacyChatSessionId, gardenSlug }),
    [conversationId, gardenSlug, legacyChatSessionId],
  );
  const [snapshot, setSnapshot] = useState<{
    query: string;
    artifacts: PresentedArtifact[];
  }>(() => ({ query, artifacts: artifactCache.get(query) ?? [] }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [imageStudioSource, setImageStudioSource] = useState<PresentedArtifact | "new" | null>(null);
  const [imagePromptSource, setImagePromptSource] = useState<PresentedArtifact | null>(null);
  const [imageStudioRequest, setImageStudioRequest] =
    useState<InlineImageStudioRequest | null>(null);
  const [videoStudioSource, setVideoStudioSource] = useState<PresentedArtifact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retiredSnapshot, setRetiredSnapshot] = useState<{
    query: string;
    version: number;
    ids: string[];
  }>({ query, version: retireVersion, ids: [] });
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const currentSnapshot = snapshotRef.current;
    setRetiredSnapshot((current) => {
      if (current.query !== query) {
        return { query, version: retireVersion, ids: [] };
      }
      if (current.version === retireVersion) return current;

      const ids = new Set(current.query === query ? current.ids : []);
      if (currentSnapshot.query === query) {
        for (const artifact of currentSnapshot.artifacts) ids.add(artifact.id);
      }
      return { query, version: retireVersion, ids: Array.from(ids) };
    });
    setOpenId(null);
    setImageStudioSource(null);
    setImagePromptSource(null);
    setImageStudioRequest(null);
  }, [query, retireVersion]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!query) return;
    try {
      const artifacts = await requestArtifacts(query, signal);
      if (signal?.aborted) return;
      setSnapshot({ query, artifacts });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        // The full Artifacts panel remains available if an inline refresh fails.
      }
    }
  }, [query]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    // The transcript usually prefetches these while the messages are still
    // loading. Join that request instead of asking the same question twice —
    // it is what lets the cards appear with the messages rather than after.
    const pending = artifactRequests.get(query);
    if (pending) {
      void pending.then((artifacts) => {
        if (controller.signal.aborted) return;
        setSnapshot({ query, artifacts });
      });
      return () => controller.abort();
    }
    const timer = window.setTimeout(() => void refresh(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, refresh]);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<{
        conversationId?: string;
        gardenId?: string | null;
      }>).detail;
      if (conversationId && detail?.conversationId !== conversationId) return;
      if (gardenSlug && detail?.gardenId !== gardenSlug) return;
      void refresh();
    };
    window.addEventListener(ARTIFACT_BROWSER_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_BROWSER_EVENT, listener);
  }, [conversationId, gardenSlug, refresh]);

  const handleDelete = useCallback(
    async (artifact: PresentedArtifact) => {
      if (deletingId) return;
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Delete "${artifact.title}"? This also removes it from your garden.`,
        )
      ) {
        return;
      }
      setDeletingId(artifact.id);
      setDeleteError(null);
      try {
        await deleteArtifactRequest(artifact);
        // The cache is written by every path that sets the snapshot, so it is
        // the current list even mid-render.
        const remaining = (artifactCache.get(query) ?? []).filter(
          (item) => item.id !== artifact.id,
        );
        artifactCache.set(query, remaining);
        setSnapshot({ query, artifacts: remaining });
        setOpenId((current) => (current === artifact.id ? null : current));
        void refresh();
      } catch (error) {
        setDeleteError(
          error instanceof Error ? error.message : "Could not delete the artifact.",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId, query, refresh],
  );

  const retirementPending =
    retiredSnapshot.query === query &&
    retiredSnapshot.version !== retireVersion;
  const retiredIds = new Set(
    retiredSnapshot.query === query ? retiredSnapshot.ids : [],
  );
  // Switching chats leaves the snapshot behind for a tick; the cache answers
  // for the new one so its cards are there on the first paint.
  const knownArtifacts =
    snapshot.query === query
      ? snapshot.artifacts
      : artifactCache.get(query) ?? [];
  const artifacts = retirementPending
    ? []
    : knownArtifacts.filter((artifact) => !retiredIds.has(artifact.id));
  const openArtifact = openId ? artifacts.find((item) => item.id === openId) ?? null : null;
  const openArtifactById = useCallback(
    async (id: string) => {
      setOpenId(id);
      const current = snapshotRef.current;
      if (
        current.query !== query ||
        !current.artifacts.some((artifact) => artifact.id === id)
      ) {
        await refresh();
      }
    },
    [query, refresh],
  );
  const registerArtifact = useCallback((artifact: PresentedArtifact) => {
    const artifacts = [
      artifact,
      ...(artifactCache.get(query) ?? []).filter(
        (item) => item.id !== artifact.id,
      ),
    ];
    artifactCache.set(query, artifacts);
    setSnapshot({ query, artifacts });
    void refresh();
  }, [query, refresh]);

  const handleImageCreated = useCallback((artifact: PresentedArtifact) => {
    registerArtifact(artifact);
    // A caller that took the image itself (a post card attaching artwork to
    // its post) owns what happens next; only the generic path pops the viewer.
    if (imageStudioRequest?.onCreated) {
      imageStudioRequest.onCreated(artifact);
    } else {
      setOpenId(artifact.id);
    }
  }, [imageStudioRequest, registerArtifact]);

  const openImageStudio = useCallback((request: InlineImageStudioRequest) => {
    setOpenId(null);
    setImageStudioRequest(request);
    setImagePromptSource(request.promptArtifact ?? null);
    setImageStudioSource(request.sourceArtifact ?? "new");
  }, []);

  // The video studio takes no seed and creates nothing: it always opens on one
  // artifact that already exists, so the whole of its state is which one.
  const closeVideoStudio = useCallback(() => setVideoStudioSource(null), []);
  const openVideoStudio = useCallback((artifact: PresentedArtifact) => {
    setOpenId(null);
    setVideoStudioSource(artifact);
  }, []);

  const closeImageStudio = useCallback(() => {
    setImageStudioSource(null);
    setImagePromptSource(null);
    setImageStudioRequest(null);
  }, []);

  const context: ArtifactCardsContextValue = {
    artifacts,
    deletingId,
    deleteError,
    scope: {
      conversationId: conversationId ?? null,
      gardenSlug: gardenSlug ?? null,
      sourceSurface: gardenSlug ? "garden_chat" : "dashboard_terminal",
    },
    setOpenId,
    openArtifact: openArtifactById,
    handleDelete,
    openImageStudio,
    registerArtifact,
  };

  return (
    <ArtifactCardsContext.Provider value={context}>
      {children}
      <ArtifactViewer
        artifact={openArtifact}
        onClose={() => setOpenId(null)}
        onEditImage={(artifact) => openImageStudio({ sourceArtifact: artifact })}
        onCreateImage={(artifact) => openImageStudio({ promptArtifact: artifact })}
        onEditVideo={openVideoStudio}
      />
      {videoStudioSource ? (
        <ArtifactVideoStudio
          artifact={videoStudioSource}
          onUpdated={() => void refresh()}
          onClose={closeVideoStudio}
        />
      ) : null}
      {imageStudioSource ? (
        <ArtifactImageStudio
          sourceArtifact={imageStudioSource === "new" ? null : imageStudioSource}
          promptArtifact={imagePromptSource}
          seed={imageStudioRequest?.seed ?? null}
          creationConversationId={conversationId}
          // A post card seeds the studio from a database row, so there is no
          // artifact to borrow a conversation from. The Garden transcript is
          // addressed by its legacy chat id and has none to pass either, so the
          // studio is told which surface to open one on.
          sourceSurface={gardenSlug ? "garden_chat" : "dashboard_terminal"}
          gardenSlug={gardenSlug}
          onCreated={handleImageCreated}
          onClose={closeImageStudio}
        />
      ) : null}
    </ArtifactCardsContext.Provider>
  );
}

function InlineArtifactFileCard({
  artifact,
  context,
}: {
  artifact: PresentedArtifact;
  context: ArtifactCardsContextValue;
}) {
  const downloadUrl = artifactUrl(artifact, "download");
  const pdfHref = artifactPdfHref(artifact);
  const openClasses =
    "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]";
  const fileContent = (
    <>
      <span className="bb-neu-artifact-preview inline-flex h-14 w-12 shrink-0 -rotate-3 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)] shadow-sm [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.6]">
        <ArtifactFileIcon kind={artifact.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
          {artifact.title}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
          {artifactDescription(artifact)}
        </span>
      </span>
    </>
  );

  return (
    <article className="bb-neu-artifact-card flex min-h-[5.25rem] items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 shadow-[0_8px_24px_rgba(28,45,36,0.06)]">
      {pdfHref ? (
        <a href={pdfHref} className={openClasses} title={`Open ${artifact.title} in the PDF viewer`}>
          {fileContent}
        </a>
      ) : artifact.previewAvailable ? (
        <button
          type="button"
          onClick={() => context.setOpenId(artifact.id)}
          className={openClasses}
          title={`Open ${artifact.title}`}
        >
          {fileContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {fileContent}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {artifact.downloadAvailable ? (
          <a
            href={downloadUrl}
            className="neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)]"
          >
            Download
          </a>
        ) : (
          <span
            className={`rounded-full px-2.5 py-1 text-xs ${
              artifact.status === "failed"
                ? "bg-red-50 text-[var(--danger)]"
                : "bg-[var(--paper-strong)] text-[var(--ink-muted)]"
            }`}
            role="status"
          >
            {artifactStatusLabel(artifact)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void context.handleDelete(artifact)}
          disabled={context.deletingId === artifact.id}
          aria-label={`Delete ${artifact.title}`}
          title="Delete artifact"
          className="neu-button-icon rounded-lg p-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 7.5h12M9.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 6v1.5m-6 0 .5 11a1.5 1.5 0 0 0 1.5 1.4h3a1.5 1.5 0 0 0 1.5-1.4l.5-11" />
          </svg>
        </button>
      </div>
    </article>
  );
}

function ArtifactCardList({
  ownerMessageId,
}: Pick<Props, "ownerMessageId">) {
  const context = useContext(ArtifactCardsContext);
  if (!context) return null;
  const artifacts = ownerMessageId === undefined
    ? context.artifacts
    : context.artifacts.filter(
        (artifact) => artifact.assistantMessageId === ownerMessageId,
      );
  // Keep the artifact's space in the response from the moment it is created.
  // The loading card becomes the finished preview instead of letting artifacts
  // pop into the transcript without an arrival state.
  const visibleArtifacts = artifacts.filter(
    (artifact) => artifact.status !== "archived",
  );
  if (visibleArtifacts.length === 0) return null;

  return (
    <section
      className="mt-3 space-y-2"
      aria-label={
        ownerMessageId === undefined
          ? "Files created in this chat"
          : ownerMessageId === null
            ? "Unassigned files created in this chat"
            : "Files created by this response"
      }
    >
      {context.deleteError ? (
        <p className="rounded-lg border border-red-900/40 bg-red-50 px-3 py-2 text-xs text-[var(--danger)]" role="alert">
          {context.deleteError}
        </p>
      ) : null}
      {visibleArtifacts.map((artifact) => {
        if (artifact.status === "draft" || artifact.status === "generating") {
          return <InlineArtifactLoadingCard key={artifact.id} artifact={artifact} />;
        }
        if (
          shouldRenderInteractiveVisualizerInline(artifact) &&
          artifact.status === "ready" &&
          artifact.previewAvailable
        ) {
          return (
            <Fragment key={artifact.id}>
              <InlineInteractiveVisualizer
                artifact={artifact}
                onOpen={() => context.setOpenId(artifact.id)}
              />
              <InlineArtifactFileCard artifact={artifact} context={context} />
            </Fragment>
          );
        }
        if (
          artifact.kind === "image" &&
          artifact.status === "ready" &&
          artifact.previewAvailable
        ) {
          return (
            <InlineImageArtifact
              key={artifact.id}
              artifact={artifact}
              context={context}
            />
          );
        }
        return (
          <InlineArtifactFileCard
            key={artifact.id}
            artifact={artifact}
            context={context}
          />
        );
      })}
    </section>
  );
}

export default function InlineArtifactCards({
  conversationId,
  legacyChatSessionId,
  gardenSlug,
  retireVersion = 0,
  ownerMessageId,
}: Props) {
  const context = useContext(ArtifactCardsContext);
  if (context) return <ArtifactCardList ownerMessageId={ownerMessageId} />;

  return (
    <InlineArtifactCardsProvider
      conversationId={conversationId}
      legacyChatSessionId={legacyChatSessionId}
      gardenSlug={gardenSlug}
      retireVersion={retireVersion}
    >
      <ArtifactCardList ownerMessageId={ownerMessageId} />
    </InlineArtifactCardsProvider>
  );
}
