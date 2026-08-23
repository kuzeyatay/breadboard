"use client";

// Shared artifact viewer + the small set of constants/helpers every artifact
// surface needs. Everything lives here (not in artifact-panel) so both the
// Artifacts tab and the inline chat cards can import it without a circular
// dependency — artifact-panel imports from this module, never the reverse.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useArtifactDockHost } from "./artifact-dock-host";
import ChatMarkdown from "@/app/components/chat-markdown";
import { parseStoredDesign } from "@/lib/hardware/schemas.ts";
import { parseStoredCadArtifact } from "@/lib/cad/schemas.ts";
import { parseStoredProduction } from "@/lib/vimax/schemas.ts";
import { parseStoredProduction as parseStoredVoxProduction } from "@/lib/vox-director/schemas.ts";
import { parseStoredSocialsPost } from "@/lib/socials-manager/post-artifact.ts";
import type { HardwareDesign } from "@/lib/hardware/types";
import type { ParametricCADArtifact } from "@/lib/cad/types";
import type { VimaxProduction } from "@/lib/vimax/types";
import type { VoxProduction } from "@/lib/vox-director/types";
import type { SocialsPostDocument } from "@/lib/socials-manager/post-artifact";
import type { ArtifactKind, PresentedArtifact } from "@/lib/hermes/artifact-types";

// The blueprint pulls in Wokwi's custom elements, which only exist in a
// browser, so it is loaded on demand rather than with every artifact view.
const HardwareBlueprintArtifact = dynamic(
  () => import("@/app/components/hardware/hardware-blueprint-artifact"),
  { ssr: false, loading: () => <p className="text-sm text-[var(--ink-muted)]">Loading blueprint…</p> },
);

// The CAD viewer pulls in three.js and a WebGL context, so it is loaded on
// demand rather than with every artifact view.
const ParametricCadArtifact = dynamic(
  () => import("@/app/components/cad/parametric-cad-artifact"),
  { ssr: false, loading: () => <p className="text-sm text-[var(--ink-muted)]">Loading the CAD model…</p> },
);

// Imported GLB artifacts use the same local Three.js viewer as model
// attachments. Keeping it lazy means ordinary documents never initialize a
// WebGL renderer or download the glTF loader.
const ModelViewer = dynamic(
  () => import("@/app/components/cad/model-viewer"),
  { ssr: false, loading: () => <p className="text-sm text-[var(--ink-muted)]">Loading the 3D model…</p> },
);

// The film player runs an animation loop over the storyboard and loads every
// frame image, so it is loaded on demand rather than with every artifact view.
const VimaxFilmArtifact = dynamic(
  () => import("@/app/components/vimax/vimax-film-artifact"),
  { ssr: false, loading: () => <p className="text-sm text-[var(--ink-muted)]">Loading the film…</p> },
);

// A Vox production carries a video, every poster and the whole beat map, so it
// is loaded on demand for the same reason the film player is.
const VoxProductionArtifact = dynamic(
  () => import("@/app/components/vox-director/vox-production-artifact"),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-[var(--ink-muted)]">Opening the production…</p>
    ),
  },
);

// A post artifact opens as the post studio, which brings the image picker and
// the ComfyUI panel with it — none of which the rest of the viewer needs, so it
// is loaded only when a post is actually opened.
const SocialsManagerPostArtifact = dynamic(
  () => import("@/app/components/hermes/socials-manager-post-artifact"),
  { ssr: false, loading: () => <p className="text-sm text-[var(--ink-muted)]">Opening the post…</p> },
);

// A gadget mounts its own sandbox frame and talks to the host bridge, so it is
// loaded only when one is actually opened. `inline-gadget` deliberately does not
// import from this module, so there is no cycle with the inline chat cards.
const InlineGadget = dynamic(() => import("@/app/components/hermes/inline-gadget"), {
  ssr: false,
  loading: () => <p className="text-sm text-[var(--ink-muted)]">Starting the gadget…</p>,
});

export const ARTIFACT_BROWSER_EVENT = "breadboard:artifact-event";
export const ARTIFACT_REVISE_EVENT = "breadboard:artifact-revise";
export const GARDEN_DOCUMENTS_CHANGED_EVENT = "breadboard:garden-documents-changed";

const ARTIFACTS_FOLDER = "artifacts";

/**
 * An even split: the artifact takes half, the conversation keeps half. The
 * floor is what a document still reads at before the dock stops being worth
 * opening — below it, on a narrow window, the dock covers the surface instead.
 */
const DOCK_WIDTH = "max(24rem, 50vw)";

// A surface can have two viewers mounted at once — the Artifacts archive owns
// one and the transcript's inline cards own another — so the width the shell
// gives up is reference counted. The last dock to close is the one that hands
// it back; without the count, closing either would leave the other one
// overlapping the app it had already made room in.
let openDocks = 0;

/**
 * Reserve the dock's width on the shell for as long as one is open. Only the
 * free-floating dock needs this: a dock that lives in a surface's own lane is
 * already taking up space there.
 */
function useReservedDockWidth(open: boolean, width: string): void {
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    openDocks += 1;
    root.dataset.artifactDock = "open";
    root.style.setProperty("--bb-artifact-dock-width", width);
    return () => {
      openDocks -= 1;
      if (openDocks > 0) return;
      delete root.dataset.artifactDock;
      root.style.removeProperty("--bb-artifact-dock-width");
    };
  }, [open, width]);
}

const kindLabels: Partial<Record<ArtifactKind, string>> = {
  audio: "Audio",
  code: "Code",
  data: "Data",
  diagram: "Diagram",
  document: "Document",
  html: "Web page",
  image: "Image",
  markdown: "Markdown",
  model: "3D model",
  pdf: "PDF",
  presentation: "Presentation",
  spreadsheet: "Spreadsheet",
  text: "Text document",
  video: "Video",
};

function extensionLabel(filename: string): string {
  const extension = filename.match(/\.([a-z0-9]{1,12})$/i)?.[1];
  return extension ? extension.toUpperCase() : "FILE";
}

/** One-line "Markdown · MD" descriptor used under an artifact's title. */
export function artifactDescription(artifact: PresentedArtifact): string {
  if (artifact.renderer === "interactive-visualizer") {
    return `Interactive model · ${extensionLabel(artifact.filename)}`;
  }
  if (artifact.renderer === "gadget") {
    const bindings = artifact.metadata?.bindings;
    const count = Array.isArray(bindings) ? bindings.length : 0;
    const writes =
      Array.isArray(bindings) &&
      bindings.some((binding) => (binding as { writable?: boolean })?.writable);
    return [
      "Gadget",
      count ? `${count} connection${count === 1 ? "" : "s"}` : "self-contained",
      // Worth saying on the card: it is the difference between a thing that
      // only shows you something and a thing that will ask to act.
      writes ? "asks before acting" : "read-only",
    ].join(" · ");
  }
  if (artifact.renderer === "hardware-blueprint") {
    return `Hardware blueprint · ${extensionLabel(artifact.filename)}`;
  }
  if (artifact.renderer === "parametric-cad") {
    const revision = artifact.metadata?.cadRevision;
    return `Parametric CAD${typeof revision === "number" ? ` · revision ${revision}` : ""}`;
  }
  if (artifact.renderer === "vimax-production") {
    const shots = artifact.metadata?.vimaxShotCount;
    const seconds = artifact.metadata?.vimaxDurationSeconds;
    return [
      "ViMax film",
      typeof shots === "number" ? `${shots} shot${shots === 1 ? "" : "s"}` : "",
      typeof seconds === "number" ? `${seconds}s` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (artifact.renderer === "vox-director-production") {
    const beats = artifact.metadata?.voxDirectorBeats;
    const seconds = artifact.metadata?.voxDirectorRuntimeSeconds;
    return [
      "Vox Director explainer",
      typeof beats === "number" ? `${beats} beat${beats === 1 ? "" : "s"}` : "",
      typeof seconds === "number" ? `${seconds}s` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (artifact.renderer === "socials-manager-post") {
    const network = artifact.metadata?.socialsManagerNetworkName;
    const scheduledAt = artifact.metadata?.socialsManagerScheduledAt;
    const characters = artifact.metadata?.characterCount;
    return [
      `${typeof network === "string" && network ? network : "Social"} post`,
      typeof scheduledAt === "string" && scheduledAt ? scheduledAt.replace("T", " ") : "",
      typeof characters === "number" ? `${characters} characters` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const kind = kindLabels[artifact.kind] ?? "Artifact";
  return `${kind} · ${extensionLabel(artifact.filename)}`;
}

export function artifactUrl(
  artifact: PresentedArtifact,
  purpose: "preview" | "download",
): string {
  const query = new URLSearchParams({
    conversationId: artifact.conversationId,
    version: String(artifact.version),
  });
  return `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/${purpose}?${query}`;
}

/**
 * PDF artifacts always open in Breadboard's full-page PDF viewer. Published
 * Garden PDFs retain their editable document route; otherwise the artifact
 * route opens the same viewer in read-only mode.
 */
export function artifactPdfHref(artifact: PresentedArtifact): string | null {
  if (artifact.kind !== "pdf") return null;
  const open = artifact.metadata?.gardenOpenPath;
  if (typeof open === "string" && open.startsWith("/gardens/")) return open;
  if (!artifact.previewAvailable || !artifact.conversationId) return null;
  const query = new URLSearchParams({
    conversationId: artifact.conversationId,
    version: String(artifact.version),
  });
  return `/artifacts/${encodeURIComponent(artifact.id)}/pdf?${query.toString()}`;
}

/** Deletes an artifact (and any garden note/asset it created) via the API. */
export async function deleteArtifactRequest(artifact: PresentedArtifact): Promise<void> {
  if (!artifact.conversationId) {
    throw new Error("This artifact cannot be deleted from here.");
  }
  const params = new URLSearchParams({ conversationId: artifact.conversationId });
  const response = await fetch(
    `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}?${params}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(typeof body.error === "string" ? body.error : "Could not delete the artifact.");
  }
}

/** Marks an artifact with a palette color, or clears the mark with null. */
export async function highlightArtifactRequest(
  artifact: PresentedArtifact,
  highlight: string | null,
): Promise<void> {
  if (!artifact.conversationId) {
    throw new Error("This artifact cannot be highlighted from here.");
  }
  const params = new URLSearchParams({ conversationId: artifact.conversationId });
  const response = await fetch(
    `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}?${params}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlight }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(typeof body.error === "string" ? body.error : "Could not highlight the artifact.");
  }
}

export function ArtifactArchiveIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.75 7.75h14.5v10.5a1.5 1.5 0 0 1-1.5 1.5H6.25a1.5 1.5 0 0 1-1.5-1.5V7.75Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 4.25h16.5v3.5H3.75v-3.5Zm5.75 7.5h5"
      />
    </svg>
  );
}

export function ArtifactFileIcon({ kind }: { kind: ArtifactKind }) {
  if (kind === "spreadsheet" || kind === "data") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="1.5" />
        <path d="M4 10h16M10 10v9M15 10v9" />
      </svg>
    );
  }

  if (kind === "image" || kind === "diagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m6 17 4-4 3 3 2-2 3 3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4M9 12h6M9 15h6M9 18h4" />
    </svg>
  );
}

const TEXTUAL_KINDS: ArtifactKind[] = ["markdown", "text", "code", "data"];
const DOCUMENT_VIEWER_KINDS: ArtifactKind[] = ["markdown", "pdf"];

function ArtifactDocumentViewport({ children }: { children: ReactNode }) {
  return (
    <div
      className="artifact-document-viewport h-full min-h-[30rem] overflow-auto bg-[var(--neu-surface-pressed)] p-3 sm:p-5"
      data-artifact-document-viewer
    >
      {children}
    </div>
  );
}

interface ArtifactViewerProps {
  artifact: PresentedArtifact | null;
  onClose: () => void;
  /** Open the local image studio for raster artifacts. */
  onEditImage?: (artifact: PresentedArtifact) => void;
  /** Start an image for a text-based artifact, such as a social post caption. */
  onCreateImage?: (artifact: PresentedArtifact) => void;
  /** Open the video studio. Offered for every video artifact, whoever made it. */
  onEditVideo?: (artifact: PresentedArtifact) => void;
  /** Hide the "Revise" action (e.g. surfaces that can't drive the agent). */
  hideRevise?: boolean;
}

/**
 * Reading view for a single artifact, docked down the right-hand edge beside
 * the chat that made it rather than thrown over the app as a modal — an
 * artifact is something you read *while* you keep talking about it, and a
 * dialog that blocks the conversation is the wrong shape for that. Markdown
 * renders through the same pipeline as chat messages, so a generated `.md`
 * file reads as a document, not as raw source dumped into a browser tab.
 */
export default function ArtifactViewer({
  artifact,
  onClose,
  onEditImage,
  onCreateImage,
  onEditVideo,
  hideRevise = false,
}: ArtifactViewerProps) {
  // Keyed by preview URL so switching artifacts never flashes stale text and we
  // avoid resetting state synchronously inside the effect (cascading renders).
  const [preview, setPreview] = useState<{ url: string; text: string | null } | null>(null);
  const [gardenSave, setGardenSave] = useState<{
    artifactId: string;
    status: "adding" | "added" | "error";
    message?: string;
  } | null>(null);
  const interactiveFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [interactiveHeight, setInteractiveHeight] = useState(620);
  // Expanded is a property of the dock, not of any one renderer: whatever the
  // body happens to be — a document, an image, a gadget's frame — it is the
  // panel around it that grows to the whole window, so every kind gets the
  // same button and the same result.
  const [expanded, setExpanded] = useState(false);

  // A parametric CAD manifest is JSON, which the textual branch would otherwise
  // dump as raw text; its own renderer needs that same text, so it is fetched
  // as textual content and handed to the viewer rather than printed.
  const isTextual = artifact
    ? TEXTUAL_KINDS.includes(artifact.kind) ||
      (artifact.kind === "spreadsheet" &&
        artifact.mimeType.startsWith("text/"))
    : false;
  const usesDocumentViewer = artifact
    ? DOCUMENT_VIEWER_KINDS.includes(artifact.kind)
    : false;
  const previewUrl = artifact ? artifactUrl(artifact, "preview") : "";
  const downloadUrl = artifact ? artifactUrl(artifact, "download") : "";
  const interactive = artifact?.renderer === "interactive-visualizer";
  const hardwareBlueprint = artifact?.renderer === "hardware-blueprint";
  const parametricCad = artifact?.renderer === "parametric-cad";
  const modelFile = artifact?.renderer === "model-file";
  const vimaxFilm = artifact?.renderer === "vimax-production";
  const voxProduction = artifact?.renderer === "vox-director-production";
  const socialsPost = artifact?.renderer === "socials-manager-post";
  const isGadget = artifact?.renderer === "gadget";
  const isRaster = artifact?.kind === "image" || artifact?.kind === "diagram";
  const artifactId = artifact?.id ?? "";
  const artifactVersion = artifact?.version ?? 0;
  const interactiveChannel = useMemo(
    () => interactive && artifactId
      ? `${artifactId}:${artifactVersion}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
      : "",
    [artifactId, artifactVersion, interactive],
  );
  const interactivePreviewUrl = interactive
    ? `${previewUrl}&channel=${encodeURIComponent(interactiveChannel)}`
    : previewUrl;

  // A surface that hosts the dock in its own layout (the Terminal) hands down
  // the lane to open in; one that does not (a full-page Garden) gets the dock
  // pinned to the viewport instead, and gives up the width for it.
  const dockHost = useArtifactDockHost();
  // An expanded dock covers the app outright, so there is no width beside it to
  // reserve — the shell takes its own back until the panel shrinks again.
  useReservedDockWidth(Boolean(artifact) && !dockHost && !expanded, DOCK_WIDTH);

  // Opening a different artifact starts it at the size the surface intended.
  useEffect(() => {
    setExpanded(false);
  }, [artifactId]);

  // While expanded the panel is the window, so Escape shrinks it rather than
  // closing the artifact outright. The listener captures so a surface that
  // closes its own overlays on Escape does not act on the same keystroke.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [expanded]);

  useEffect(() => {
    if (!artifact || !isTextual || !artifact.previewAvailable) return;
    let cancelled = false;
    void fetch(previewUrl)
      .then((response) =>
        response.ok ? response.text() : Promise.reject(new Error("Preview unavailable")),
      )
      .then((body) => {
        if (!cancelled) setPreview({ url: previewUrl, text: body });
      })
      .catch(() => {
        if (!cancelled) setPreview({ url: previewUrl, text: null });
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, isTextual, previewUrl]);

  const resolved = preview?.url === previewUrl ? preview : null;
  const text = resolved?.text ?? null;
  const loading = isTextual && Boolean(artifact?.previewAvailable) && resolved === null;

  // A stored blueprint is validated before it renders: a design that no longer
  // matches its schema must say so rather than render half a circuit.
  const blueprint = useMemo((): { design: HardwareDesign } | { error: string } | null => {
    if (!hardwareBlueprint || text === null) return null;
    try {
      const parsed = parseStoredDesign(JSON.parse(text) as unknown);
      return parsed.ok ? { design: parsed.value } : { error: parsed.error };
    } catch {
      return { error: "This blueprint's stored data could not be read." };
    }
  }, [hardwareBlueprint, text]);

  // Same contract for a CAD design: the stored manifest is validated before it
  // renders, so a design written by an older build says so rather than showing
  // an empty viewer that still looks authoritative.
  const cadDesign = useMemo((): { design: ParametricCADArtifact } | { error: string } | null => {
    if (!parametricCad || text === null) return null;
    try {
      const parsed = parseStoredCadArtifact(JSON.parse(text) as unknown);
      return parsed.ok ? { design: parsed.value } : { error: parsed.error };
    } catch {
      return { error: "This CAD design's stored data could not be read." };
    }
  }, [parametricCad, text]);

  // And for a film: a production written by an older build says so rather than
  // playing an empty animatic.
  const film = useMemo((): { production: VimaxProduction } | { error: string } | null => {
    if (!vimaxFilm || text === null) return null;
    try {
      const parsed = parseStoredProduction(JSON.parse(text) as unknown);
      return parsed.ok ? { production: parsed.value } : { error: parsed.error };
    } catch {
      return { error: "This film's stored data could not be read." };
    }
  }, [vimaxFilm, text]);

  // And for a Vox production, for the same reason: a document this viewer
  // cannot vouch for must not open as a film that looks finished.
  const voxFilm = useMemo((): { production: VoxProduction } | { error: string } | null => {
    if (!voxProduction || text === null) return null;
    try {
      const parsed = parseStoredVoxProduction(JSON.parse(text) as unknown);
      return parsed.ok ? { production: parsed.value } : { error: parsed.error };
    } catch {
      return { error: "This production's stored data could not be read." };
    }
  }, [voxProduction, text]);

  // And for a post: the studio is opened over what the artifact stored, so a
  // document it cannot vouch for must not become an editor.
  const post = useMemo((): { stored: SocialsPostDocument } | { error: string } | null => {
    if (!socialsPost || text === null) return null;
    try {
      const parsed = parseStoredSocialsPost(JSON.parse(text) as unknown);
      return parsed.ok ? { stored: parsed.value } : { error: parsed.error };
    } catch {
      return { error: "This post's stored data could not be read." };
    }
  }, [socialsPost, text]);

  useEffect(() => {
    if (!artifact) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [artifact, onClose]);

  useEffect(() => {
    if (!interactive || !interactiveChannel) return;
    const protocol = "breadboard:interactive-visualizer:v1";
    const theme = () => {
      const explicitTheme = document.documentElement.dataset.theme;
      if (explicitTheme === "light" || explicitTheme === "dark") {
        return explicitTheme;
      }
      if (document.documentElement.classList.contains("dark")) return "dark";
      if (document.documentElement.classList.contains("light")) return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    };
    const sendTheme = () => {
      interactiveFrameRef.current?.contentWindow?.postMessage({
        protocol,
        type: "host-theme",
        channel: interactiveChannel,
        theme: theme(),
      }, "*");
    };
    const onMessage = (event: MessageEvent) => {
      const frame = interactiveFrameRef.current;
      const data = event.data as Record<string, unknown> | null;
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== "null" ||
        !data ||
        data.protocol !== protocol ||
        data.channel !== interactiveChannel
      ) return;
      if (data.type === "ready") sendTheme();
      if (data.type === "ready" || data.type === "resize") {
        const height = Number(data.height);
        if (Number.isFinite(height)) setInteractiveHeight(Math.max(440, Math.min(900, height)));
      }
    };
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sendTheme);
    window.addEventListener("message", onMessage);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sendTheme);
      window.removeEventListener("message", onMessage);
    };
  }, [interactive, interactiveChannel]);

  if (!artifact) return null;

  const activeGardenSave = gardenSave?.artifactId === artifact.id ? gardenSave : null;
  const canAddToGarden = artifact.kind === "markdown" && Boolean(artifact.gardenId);
  const canCreateImage =
    artifact.sourceHermesTool === "socials_manager_draft" &&
    (artifact.kind === "text" || artifact.kind === "markdown") &&
    Boolean(onCreateImage);

  const actionButton =
    "neu-button shrink-0 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)] disabled:cursor-not-allowed disabled:opacity-60";

  async function addToGarden() {
    if (!artifact || !artifact.gardenId || artifact.kind !== "markdown") return;
    if (activeGardenSave?.status === "adding" || activeGardenSave?.status === "added") return;

    setGardenSave({ artifactId: artifact.id, status: "adding" });
    try {
      let markdown = text;
      if (markdown === null) {
        const previewResponse = await fetch(previewUrl, { cache: "no-store" });
        if (!previewResponse.ok) throw new Error("The Markdown preview could not be read.");
        markdown = await previewResponse.text();
      }

      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterSlug: artifact.gardenId,
          title: artifact.title,
          content: markdown,
          folder: ARTIFACTS_FOLDER,
          tags: ["artifact"],
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        slug?: string;
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "The artifact could not be added to the Garden.");
      }

      setGardenSave({ artifactId: artifact.id, status: "added" });
      window.dispatchEvent(new CustomEvent(GARDEN_DOCUMENTS_CHANGED_EVENT, {
        detail: {
          gardenId: artifact.gardenId,
          folder: ARTIFACTS_FOLDER,
          slug: result.slug ?? null,
        },
      }));
    } catch (error) {
      setGardenSave({
        artifactId: artifact.id,
        status: "error",
        message: error instanceof Error ? error.message : "The artifact could not be added to the Garden.",
      });
    }
  }

  function renderBody() {
    if (!artifact) return null;
    if (artifact.status === "failed" || artifact.error) {
      return (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {artifact.error?.message ?? "This artifact failed to generate."}
        </p>
      );
    }
    if (!artifact.previewAvailable) {
      return (
        <div className="flex h-full min-h-40 items-center justify-center text-sm text-[var(--ink-muted)]">
          {artifact.status === "ready"
            ? "No inline preview is available for this format. Use Download to open it."
            : "Generating preview…"}
        </div>
      );
    }
    // A gadget renders as the running app plus its approval queue, exactly as
    // it does inline. Its stored source is JSON, so the default textual preview
    // would show the user their own gadget's source code instead of the gadget.
    if (isGadget) {
      return <InlineGadget artifact={artifact} />;
    }
    if (hardwareBlueprint) {
      if (loading || blueprint === null) {
        return <p className="text-sm text-[var(--ink-muted)]">Loading blueprint…</p>;
      }
      if ("error" in blueprint) {
        return (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{blueprint.error}</p>
        );
      }
      return <HardwareBlueprintArtifact design={blueprint.design} />;
    }
    if (parametricCad) {
      if (loading || cadDesign === null) {
        return <p className="text-sm text-[var(--ink-muted)]">Loading the CAD model…</p>;
      }
      if ("error" in cadDesign) {
        return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{cadDesign.error}</p>;
      }
      return (
        <ParametricCadArtifact
          key={`${cadDesign.design.projectId}:${cadDesign.design.revision}`}
          design={cadDesign.design}
          conversationId={artifact.conversationId}
        />
      );
    }
    if (modelFile) {
      return (
        <div className="h-full min-h-[32rem] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-strong)]">
          <ModelViewer
            source={previewUrl}
            format="glb"
            presentation="asset"
            upAxis="y"
            gridUnit="units"
          />
        </div>
      );
    }
    if (vimaxFilm) {
      if (loading || film === null) {
        return <p className="text-sm text-[var(--ink-muted)]">Loading the film…</p>;
      }
      if ("error" in film) {
        return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{film.error}</p>;
      }
      return (
        <VimaxFilmArtifact
          production={film.production}
          conversationId={artifact.conversationId}
        />
      );
    }
    if (voxProduction) {
      if (loading || voxFilm === null) {
        return <p className="text-sm text-[var(--ink-muted)]">Opening the production…</p>;
      }
      if ("error" in voxFilm) {
        return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{voxFilm.error}</p>;
      }
      return (
        <VoxProductionArtifact
          production={voxFilm.production}
          conversationId={artifact.conversationId}
        />
      );
    }
    if (socialsPost) {
      if (loading || post === null) {
        return <p className="text-sm text-[var(--ink-muted)]">Opening the post…</p>;
      }
      if ("error" in post) {
        return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{post.error}</p>;
      }
      return <SocialsManagerPostArtifact stored={post.stored} artifact={artifact} />;
    }
    if (artifact.kind === "markdown") {
      if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading…</p>;
      if (text === null) return <p className="text-sm text-[var(--ink-muted)]">Preview unavailable.</p>;
      return (
        <ArtifactDocumentViewport>
          <article
            aria-label={`${artifact.title} Markdown preview`}
            className="artifact-document-page mx-auto min-h-full w-full max-w-[54rem] rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-6 py-7 text-[var(--ink)] shadow-[0_8px_24px_rgba(28,45,36,0.10)] sm:px-10 sm:py-9"
          >
            <ChatMarkdown content={text} />
          </article>
        </ArtifactDocumentViewport>
      );
    }
    if (isTextual) {
      return (
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--paper-strong)] p-3 text-xs text-[var(--ink)]">
          {loading ? "Loading…" : text ?? "Preview unavailable."}
        </pre>
      );
    }
    if (isRaster) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- auth-scoped blob from our API, not a next/image source */}
          <img
            src={previewUrl}
            alt={artifact.title}
            className="max-h-full max-w-full rounded-lg border border-[var(--line)] object-contain shadow-lg"
          />
        </div>
      );
    }
    if (artifact.kind === "audio") {
      return (
        <div className="flex min-h-56 items-center justify-center rounded-xl bg-[var(--paper-strong)] p-6">
          <audio
            controls
            preload="metadata"
            src={previewUrl}
            className="w-full max-w-xl"
          >
            Your browser cannot preview this audio file.
          </audio>
        </div>
      );
    }
    if (artifact.kind === "video") {
      return (
        <video
          controls
          preload="metadata"
          src={previewUrl}
          className="mx-auto max-h-[70vh] w-full rounded-xl border border-[var(--line)] bg-black"
        >
          Your browser cannot preview this video file.
        </video>
      );
    }
    if (artifact.kind === "pdf") {
      return (
        <ArtifactDocumentViewport>
          <iframe
            title={`${artifact.title} PDF preview`}
            src={previewUrl}
            className="mx-auto h-full min-h-[30rem] w-full max-w-[64rem] rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_8px_24px_rgba(28,45,36,0.10)]"
          />
        </ArtifactDocumentViewport>
      );
    }
    if (interactive) {
      return (
        <iframe
          ref={interactiveFrameRef}
          title={`${artifact.title} interactive visualization`}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          src={interactivePreviewUrl}
          style={{ height: interactiveHeight }}
          className="min-h-[28rem] w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)]"
        />
      );
    }
    if (
      artifact.kind === "html" ||
      artifact.kind === "document" ||
      (artifact.kind === "presentation" &&
        artifact.mimeType.startsWith("text/html")) ||
      // Imported .pptx/.xlsx files carry no inline preview by themselves, but
      // an office import can attach a pre-rendered HTML snapshot; when one
      // exists the preview route serves it as text/html.
      ((artifact.kind === "presentation" || artifact.kind === "spreadsheet") &&
        artifact.previewAvailable)
    ) {
      // A Bolt Slides deck is a React app rather than a static page: framed
      // with scripts off it renders an empty document, which reads as a broken
      // artifact. It gets the same frame every other generated interactive page
      // here gets — scripts on, same-origin off — and nothing else does, so a
      // plain HTML artifact stays inert.
      const liveDeck = artifact.metadata?.boltSlidesDeck === true;
      return (
        <iframe
          title={`${artifact.title} preview`}
          sandbox={liveDeck ? "allow-scripts" : ""}
          allow=""
          referrerPolicy="no-referrer"
          src={previewUrl}
          className="h-full min-h-[26rem] w-full rounded-lg border border-[var(--line)]"
        />
      );
    }
    return (
      <p className="text-sm text-[var(--ink-muted)]">
        No preview is available for this artifact. Use Download to open it.
      </p>
    );
  }

  const panelSurface =
    "flex min-h-0 flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink)]";
  const panelClass = expanded
    ? // Expanded, the panel stops being a dock beside the app and becomes the
      // window: same header, same body, the whole viewport.
      `bb-artifact-dock bb-artifact-dock-floating bb-artifact-dock-expanded fixed inset-0 z-[80] w-full ${panelSurface}`
    : dockHost
      ? // In a surface's own lane the split is the lane's business: the
        // panel simply fills it.
        `bb-artifact-dock h-full w-full ${panelSurface}`
      : `bb-artifact-dock bb-artifact-dock-floating fixed inset-y-0 right-0 z-[70] w-full lg:w-[var(--bb-artifact-dock-width)] ${panelSurface}`;

  const panel = (
      <aside
        style={
          dockHost || expanded
            ? undefined
            : ({ "--bb-artifact-dock-width": DOCK_WIDTH } as CSSProperties)
        }
        className={panelClass}
        // In a lane the panel is part of the surface, not a window over it.
        role={dockHost && !expanded ? undefined : "dialog"}
        aria-label={artifact.title}
      >
        {/* The dock is narrower than the dialog it replaces, so the actions
            wrap under the title rather than squeezing it out of the row. */}
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-[12rem] flex-1">
            <p className="truncate text-sm font-semibold text-[var(--ink-heading)]">
              {artifact.title}
            </p>
            <p className="truncate text-xs text-[var(--ink-muted)]">
              {artifactDescription(artifact)} · {artifact.filename}
            </p>
          </div>
          {canAddToGarden ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => void addToGarden()}
              disabled={activeGardenSave?.status === "adding" || activeGardenSave?.status === "added"}
              title={activeGardenSave?.status === "added" ? "Saved in the artifacts folder" : undefined}
            >
              {activeGardenSave?.status === "adding"
                ? "Adding…"
                : activeGardenSave?.status === "added"
                  ? "Added to garden"
                  : "Add to garden"}
            </button>
          ) : null}
          {artifact.kind === "video" && onEditVideo ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => onEditVideo(artifact)}
            >
              Edit video
            </button>
          ) : null}
          {artifact.kind === "image" && onEditImage ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => onEditImage(artifact)}
            >
              Edit image
            </button>
          ) : null}
          {canCreateImage && onCreateImage ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => onCreateImage(artifact)}
            >
              Create image
            </button>
          ) : null}
          {!hideRevise ? (
            <button
              type="button"
              className={actionButton}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent(ARTIFACT_REVISE_EVENT, { detail: artifact }),
                );
                onClose();
              }}
            >
              Revise
            </button>
          ) : null}
          {artifact.downloadAvailable ? (
            <a href={downloadUrl} className={actionButton}>
              Download
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? "Collapse artifact" : "Expand artifact"}
            aria-pressed={expanded}
            title={expanded ? "Collapse (Esc)" : "Expand"}
            className="neu-button-icon shrink-0 rounded-lg px-2 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {expanded ? (
                <>
                  <path d="M9.5 6.5h4M9.5 6.5v-4M9.5 6.5 14 2" />
                  <path d="M6.5 9.5h-4M6.5 9.5v4M6.5 9.5 2 14" />
                </>
              ) : (
                <>
                  <path d="M10 2h4v4M14 2l-4.5 4.5" />
                  <path d="M6 14H2v-4M2 14l4.5-4.5" />
                </>
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close artifact"
            className="neu-button-icon shrink-0 rounded-lg px-2 py-1.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
          >
            ✕
          </button>
        </header>
        {activeGardenSave?.status === "error" ? (
          <p role="alert" className="border-b border-[var(--line)] bg-[#fff1ed] px-5 py-2 text-xs text-[#9a4438]">
            {activeGardenSave.message}
          </p>
        ) : null}
        <div
          className={`bb-neu-recessed min-h-0 flex-1 ${
            usesDocumentViewer ? "overflow-hidden p-0" : "overflow-auto px-5 py-4"
          }`}
        >
          {renderBody()}
        </div>
      </aside>
  );

  // Expanded, the panel has to leave whatever lane it was living in: a surface
  // that hosts the dock in its own flex row cannot give it the whole window, so
  // it moves to the body for as long as it is expanded.
  if (expanded && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }

  if (dockHost) return createPortal(panel, dockHost);

  return (
    <>
      {/* A free-floating dock covers the app under the desktop breakpoint —
          there is no width to share there — so it keeps a scrim to dismiss it
          by. Wider than that the app makes room beside it instead, and a scrim
          over a chat the user can still type into would be a lie. */}
      <div
        className="bb-modal-backdrop fixed inset-0 z-[69] lg:hidden"
        aria-hidden="true"
        onClick={onClose}
      />
      {panel}
    </>
  );
}
