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
const artifactFreshUntil = new Map<string, number>();
const artifactRequests = new Map<string, Promise<PresentedArtifact[]>>();
const MAX_CACHED_ARTIFACT_QUERIES = 32;
const ARTIFACT_FRESH_MS = 2_000;

function cacheArtifacts(query: string, artifacts: PresentedArtifact[]): void {
  artifactCache.delete(query);
  artifactCache.set(query, artifacts);
  while (artifactCache.size > MAX_CACHED_ARTIFACT_QUERIES) {
    const oldest = artifactCache.keys().next().value;
    if (oldest === undefined) break;
    artifactCache.delete(oldest);
    artifactFreshUntil.delete(oldest);
  }
}

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
  cacheArtifacts(query, artifacts);
  artifactFreshUntil.set(query, Date.now() + ARTIFACT_FRESH_MS);
  return artifacts;
}

/**
 * Start the artifact request for a conversation before its cards mount — call
 * it as early as the conversation id is known, next to the transcript load.
 * Safe to call repeatedly; one request per query is in flight at a time.
 */
export function primeInlineArtifacts(
  scope: ArtifactScopeProps,
  options: { revalidate?: boolean } = {},
): Promise<PresentedArtifact[]> {
  const query = inlineArtifactQuery(scope);
  if (!query) return Promise.resolve([]);
  if (!options.revalidate && artifactCache.has(query)) {
    return Promise.resolve(artifactCache.get(query) ?? []);
  }
  const pending = artifactRequests.get(query);
  if (pending) return pending;
  const request = requestArtifacts(query)
    // A failed prefetch is not worth reporting: the provider refreshes on
    // mount, and the full Artifacts panel remains available either way.
    .catch(() => [] as PresentedArtifact[])
    .finally(() => artifactRequests.delete(query));
  artifactRequests.set(query, request);
  return request;
}

/**
 * `primeInlineArtifacts` for a transcript that renders the conversation.
 * False means the chat must keep its loading cover up: message rows and their
 * artifact cards are one visible snapshot, never two staggered paints.
 */
export function useInlineArtifactPrefetch(scope: ArtifactScopeProps): boolean {
  const { conversationId, legacyChatSessionId, gardenSlug } = scope;
  const query = inlineArtifactQuery({
    conversationId,
    legacyChatSessionId,
    gardenSlug,
  });
  const [readiness, setReadiness] = useState(() => ({
    query,
    ready: !query,
  }));
  const queryChanged = readiness.query !== query;
  if (queryChanged) {
    // React immediately retries this render with the new query state. Returning
    // false below means a chat revisited from cache cannot paint a stale
    // artifact list for one frame before the effect starts its revalidation.
    setReadiness({ query, ready: !query });
  }

  useEffect(() => {
    let cancelled = false;
    if (!query) return;
    void primeInlineArtifacts({
      conversationId,
      legacyChatSessionId,
      gardenSlug,
    }, {
      revalidate: true,
    }).then(() => {
      if (!cancelled) setReadiness({ query, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, legacyChatSessionId, gardenSlug, query]);

  return !query || (!queryChanged && readiness.query === query && readiness.ready);
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
  scope: InlineArtifactScope;
  openId: string | null;
  openArtifact: (id: string) => Promise<void>;
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

function InlineImageArtifact({
  artifact,
  context,
}: {
  artifact: PresentedArtifact;
  context: ArtifactCardsContextValue;
}) {
  const previewUrl = artifactUrl(artifact, "preview");
  return (
    <article className="bb-neu-artifact-card relative isolate overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] shadow-[0_10px_30px_rgba(28,45,36,0.08)]">
      <button
        type="button"
        onClick={() => void context.openArtifact(artifact.id)}
        className="absolute inset-0 z-[1] cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--botanical)]"
        title={`${context.openId === artifact.id ? "Close" : "Open"} ${artifact.title}`}
        aria-label={`${context.openId === artifact.id ? "Close" : "Open"} ${artifact.title}`}
        aria-pressed={context.openId === artifact.id}
      />
      <div className="neu-inset block w-full overflow-hidden bg-[var(--paper-bg)]">
        {/* The intrinsic aspect ratio must remain untouched: generated images
            are shown as full artwork here, never cropped into a thumbnail. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={artifact.title}
          className="block h-auto w-full object-contain"
          loading="eager"
        />
      </div>
      <div
        className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--paper-surface)] px-3.5 py-3"
        aria-label={`Artifact details for ${artifact.title}`}
      >
        <span className="bb-neu-artifact-preview bb-neu-artifact-preview-tilted inline-flex h-10 w-10 shrink-0 -rotate-3 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-current">
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
    if ((artifactFreshUntil.get(query) ?? 0) > Date.now()) {
      // The cache is the external artifact store snapshot this effect syncs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshot({ query, artifacts: artifactCache.get(query) ?? [] });
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
      setOpenId((current) => (current === id ? null : id));
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
    const cachedOrVisible = artifactCache.get(query) ?? (
      snapshotRef.current.query === query ? snapshotRef.current.artifacts : []
    );
    const artifacts = [
      artifact,
      ...cachedOrVisible.filter(
        (item) => item.id !== artifact.id,
      ),
    ];
    cacheArtifacts(query, artifacts);
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
    scope: {
      conversationId: conversationId ?? null,
      gardenSlug: gardenSlug ?? null,
      sourceSurface: gardenSlug ? "garden_chat" : "dashboard_terminal",
    },
    openId,
    openArtifact: openArtifactById,
    openImageStudio,
    registerArtifact,
  };

  return (
    <ArtifactCardsContext.Provider value={context}>
      {children}
      <ArtifactViewer
        artifact={openArtifact}
        onClose={() => setOpenId(null)}
        // Register the returned version before the background refresh. The
        // editor must stay mounted while an AI-applied document save becomes
        // visible to the surrounding transcript.
        onUpdated={registerArtifact}
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
  const pdfHref = artifactPdfHref(artifact);
  const openClasses =
    "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]";
  const fileContent = (
    <>
      <span className="bb-neu-artifact-preview bb-neu-artifact-preview-tilted inline-flex h-14 w-12 shrink-0 -rotate-3 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)] shadow-sm [&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.6]">
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
          onClick={() => void context.openArtifact(artifact.id)}
          className={openClasses}
          title={`${context.openId === artifact.id ? "Close" : "Open"} ${artifact.title}`}
          aria-pressed={context.openId === artifact.id}
        >
          {fileContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {fileContent}
        </div>
      )}

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
  // In-progress and failed artifacts are represented by the response activity
  // UI. A file card appears only when there is a generated artifact to open.
  const visibleArtifacts = artifacts.filter(
    (artifact) => artifact.status === "ready",
  );
  if (visibleArtifacts.length === 0) return null;

  return (
    <section
      className="bb-inline-artifact-list mt-3 space-y-2"
      aria-label={
        ownerMessageId === undefined
          ? "Files created in this chat"
          : ownerMessageId === null
            ? "Unassigned files created in this chat"
            : "Files created by this response"
      }
    >
      {visibleArtifacts.map((artifact) => {
        if (
          shouldRenderInteractiveVisualizerInline(artifact) &&
          artifact.status === "ready" &&
          artifact.previewAvailable
        ) {
          return (
            <Fragment key={artifact.id}>
              <InlineInteractiveVisualizer artifact={artifact} />
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
