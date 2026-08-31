"use client";

// The artifact archive: a searchable list of everything the chats on a surface
// have produced.
//
// The list itself carries no controls. Acting on artifacts happens through one
// dots menu, the same way the terminal rail's Recents does it — pick several
// and delete them, or take up a pen and mark them — because a row that shows a
// delete button at rest reads as a toolbar, and a destructive control sitting
// under the cursor of a list people mostly *read* is the one that gets hit by
// accident.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import {
  filterArtifactsForArchive,
  filterArtifactsForSearch,
} from "@/lib/hermes/artifact-search";
import { CHAT_HIGHLIGHTS, chatHighlight } from "@/lib/conversations/highlights";
import ArtifactViewer, {
  ARTIFACT_BROWSER_EVENT,
  artifactDescription,
  artifactPdfHref,
  ArtifactFileIcon,
  deleteArtifactRequest,
  highlightArtifactRequest,
} from "./artifact-viewer";
import ArtifactImageStudio from "./artifact-image-studio";
import ArtifactVideoStudio from "./artifact-video-studio";
import {
  ArtifactDockHostProvider,
  useArtifactDockHost,
} from "./artifact-dock-host";

// Re-exported so existing importers (garden-agent-chat, inline cards) keep a
// single stable import site even though the definitions now live in the viewer.
export {
  ARTIFACT_BROWSER_EVENT,
  ARTIFACT_AI_EDIT_EVENT,
  GARDEN_DOCUMENTS_CHANGED_EVENT,
  ArtifactArchiveIcon,
} from "./artifact-viewer";

interface ArtifactEventDetail {
  type: string;
  artifactId: string;
  runId: string;
  conversationId: string;
  gardenId: string | null;
  assistantMessageId: string | null;
  status: PresentedArtifact["status"];
  version: number;
  metadata?: Record<string, unknown>;
}

/** What the panel is doing to the list: nothing, picking rows, or marking them. */
type ArchiveMode = "idle" | "selecting" | "highlighting";

interface MenuPosition {
  top: number;
  left: number;
}

const MENU_WIDTH = 176;
const MENU_HEIGHT = 132;

/** Where the menu should sit given the button that opened it. */
function menuPositionFor(
  anchor: { bottom: number; right: number },
  viewport: { width: number; height: number },
): MenuPosition {
  return {
    top: Math.max(8, Math.min(anchor.bottom + 4, viewport.height - MENU_HEIGHT - 8)),
    left: Math.max(8, Math.min(anchor.right - MENU_WIDTH + 8, viewport.width - MENU_WIDTH - 8)),
  };
}

function MoreIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}

function SelectIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.4 12.2 2.5 2.5 4.7-5" />
    </svg>
  );
}

function HighlighterIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.5 4.75 18.75 6.5 20.5l4.25-4.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 16.5-3-3 8-8a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4l-8 8Z" />
    </svg>
  );
}

function RefreshIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5V9H15" />
    </svg>
  );
}

/** Escape, or a press anywhere outside, closes the menu. */
function useDismissOnOutside(
  menuRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // The button that opened the menu closes it through its own click
      // handler; treating its mousedown as "outside" would reopen it.
      if (target?.closest?.("[data-row-menu-button]")) return;
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
  }, [menuRef, onClose]);
}

/** The dots that open the archive's menu. Mirrors the rail's section control. */
function ArchiveMenuButton({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: (position: MenuPosition) => void;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-row-menu-button
      onClick={() => {
        if (open) {
          onClose();
          return;
        }
        const rect = buttonRef.current?.getBoundingClientRect();
        onOpen(
          rect
            ? menuPositionFor(rect, { width: window.innerWidth, height: window.innerHeight })
            : { top: 0, left: 0 },
        );
      }}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Artifact actions"
      aria-label="More actions for Artifacts"
      className="shrink-0 rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
    >
      <MoreIcon className="h-4 w-4" />
    </button>
  );
}

function ArchiveMenu({
  position,
  actionable,
  onClose,
  onStartSelecting,
  onStartHighlighting,
  onRefresh,
}: {
  position: MenuPosition;
  /** Nothing in the list: picking or marking would have nothing to act on. */
  actionable: boolean;
  onClose: () => void;
  onStartSelecting: () => void;
  onStartHighlighting: () => void;
  onRefresh: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuRef, onClose);
  const item =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Actions for Artifacts"
      style={{ top: position.top, left: position.left }}
      className="fixed z-[70] w-48 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] py-1 shadow-[0_10px_26px_rgba(0,0,0,0.18)]"
    >
      <button type="button" role="menuitem" onClick={onStartSelecting} disabled={!actionable} className={item}>
        <SelectIcon className="h-4 w-4 text-[var(--ink-muted)]" />
        Select artifacts
      </button>
      <button type="button" role="menuitem" onClick={onStartHighlighting} disabled={!actionable} className={item}>
        <HighlighterIcon className="h-4 w-4 text-[var(--ink-muted)]" />
        Highlight artifacts
      </button>
      <button type="button" role="menuitem" onClick={onRefresh} className={item}>
        <RefreshIcon className="h-4 w-4 text-[var(--ink-muted)]" />
        Refresh
      </button>
    </div>
  );
}

/** The bar the archive grows while artifacts are being picked. */
function SelectionBar({
  count,
  total,
  busy,
  onSelectAll,
  onClear,
  onDelete,
  onCancel,
}: {
  count: number;
  total: number;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const allSelected = count === total && total > 0;
  return (
    <div className="mb-1.5 flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-1.5 py-1">
      <button
        type="button"
        onClick={allSelected ? onClear : onSelectAll}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
      >
        {allSelected ? "Clear" : "Select all"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy || count === 0}
        title={busy ? "Deleting…" : undefined}
        className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#9a4438] transition hover:bg-[color-mix(in_srgb,#9a4438_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Delete{count > 0 ? ` ${count}` : ""}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * The bar the archive grows while it is being marked: pick up a color, then
 * click artifacts to paint them. The pen stays in hand between rows, which is
 * the whole point of a mode — marking five artifacts is five clicks, not five
 * menus.
 */
function HighlightBar({
  pen,
  onPickPen,
  onDone,
}: {
  pen: string | null;
  onPickPen: (highlight: string | null) => void;
  onDone: () => void;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-1.5 py-1">
      {CHAT_HIGHLIGHTS.map((highlight) => (
        <button
          key={highlight.id}
          type="button"
          onClick={() => onPickPen(highlight.id)}
          aria-pressed={pen === highlight.id}
          title={highlight.label}
          aria-label={`${highlight.label} highlighter`}
          className={`h-4 w-4 shrink-0 rounded-full transition ${
            pen === highlight.id
              ? "ring-2 ring-[var(--ink-heading)] ring-offset-1 ring-offset-[var(--paper-raised)]"
              : "hover:scale-110"
          }`}
          style={{ background: highlight.color }}
        />
      ))}
      {/* The eraser is the same pen holding no color, so clearing a row is the
          same click as marking one. */}
      <button
        type="button"
        onClick={() => onPickPen(null)}
        aria-pressed={pen === null}
        title="Erase"
        aria-label="Eraser"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--ink-muted)] transition ${
          pen === null
            ? "ring-2 ring-[var(--ink-heading)] ring-offset-1 ring-offset-[var(--paper-raised)]"
            : "hover:text-[var(--ink)]"
        }`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDone}
        className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
      >
        Done
      </button>
    </div>
  );
}

export interface ArtifactPanelProps {
  conversationId?: string | null;
  gardenSlug?: string | null;
  legacyChatSessionId?: number | null;
  sourceSurface?: "dashboard_terminal" | "garden_chat";
  compact?: boolean;
  hideHeader?: boolean;
  /** Current chat used to own newly-created images while the archive remains cross-chat. */
  creationConversationId?: string | null;
  /** Creates/restores the visible chat before a first-turn image is made. */
  ensureCreationConversation?: () => Promise<string>;
}

export default function ArtifactPanel({
  conversationId,
  gardenSlug,
  legacyChatSessionId,
  sourceSurface,
  compact = false,
  hideHeader = false,
  creationConversationId,
  ensureCreationConversation,
}: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<PresentedArtifact[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // A surface can offer a proper artifact lane around this archive. The
  // Terminal uses one beside its transcript; the Garden learning map uses one
  // over its complete right rail. Only archives without a surface-owned lane
  // fall back to replacing their own body.
  const inheritedViewerHost = useArtifactDockHost();
  const [viewerHost, setViewerHost] = useState<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageStudioSource, setImageStudioSource] = useState<PresentedArtifact | "new" | null>(null);
  const [imagePromptSource, setImagePromptSource] = useState<PresentedArtifact | null>(null);
  const [videoStudioSource, setVideoStudioSource] = useState<PresentedArtifact | null>(null);
  const [ownedCreationConversationId, setOwnedCreationConversationId] = useState<string | null>(null);
  // What the panel is doing to the list, what is picked, and the color in hand
  // while marking. null is the eraser.
  const [mode, setMode] = useState<ArchiveMode>("idle");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pen, setPen] = useState<string | null>(CHAT_HIGHLIGHTS[0].id);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (!conversationId && legacyChatSessionId) params.set("chatSessionId", String(legacyChatSessionId));
    if (gardenSlug) params.set("gardenSlug", gardenSlug);
    if (sourceSurface) params.set("sourceSurface", sourceSurface);
    return params.toString();
  }, [conversationId, gardenSlug, legacyChatSessionId, sourceSurface]);

  const scopeLabel = sourceSurface === "dashboard_terminal"
    ? "across Terminal chats"
    : sourceSurface === "garden_chat"
      ? "across this garden's chats"
      : "in this chat";

  const refresh = useCallback(async () => {
    if (!query) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/hermes/artifacts?${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load artifacts.");
      setArtifacts(Array.isArray(data.artifacts) ? (data.artifacts as PresentedArtifact[]) : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load artifacts.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<ArtifactEventDetail>).detail;
      if (!detail?.artifactId) return;
      if (conversationId && detail.conversationId !== conversationId) return;
      if (gardenSlug && detail.gardenId !== gardenSlug) return;
      void refresh();
    };
    window.addEventListener(ARTIFACT_BROWSER_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_BROWSER_EVENT, listener);
  }, [conversationId, gardenSlug, refresh]);

  const stopWorking = useCallback(() => {
    setMode("idle");
    setSelectedIds(new Set());
  }, []);

  // Escape leaves either mode, the same way it closes a menu.
  useEffect(() => {
    if (mode === "idle") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopWorking();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, stopWorking]);

  const archiveArtifacts = useMemo(
    () => filterArtifactsForArchive(artifacts),
    [artifacts],
  );
  const openArtifact = openId ? archiveArtifacts.find((item) => item.id === openId) ?? null : null;
  const filteredArtifacts = useMemo(
    () => filterArtifactsForSearch(archiveArtifacts, searchQuery),
    [archiveArtifacts, searchQuery],
  );
  const searching = Boolean(searchQuery.trim());

  // Checked ids are intersected with the visible list on every render rather
  // than mirrored into a second copy: an artifact can leave it while checked
  // (deleted here, deleted in another chat, or filtered out by the search
  // above), and deriving keeps the count and the delete honest — a sweep can
  // only ever remove what the user can currently see.
  const selectedArtifacts = filteredArtifacts.filter((artifact) => selectedIds.has(artifact.id));

  const toggleOpenArtifact = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const toggleChecked = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Deletes run one at a time: each is its own request against a route that can
  // refuse individually, so a partial result is normal and has to be reported
  // rather than assumed away. What survived stays checked.
  const deleteSelected = useCallback(async () => {
    if (deleting || selectedArtifacts.length === 0) return;
    const subject =
      selectedArtifacts.length === 1
        ? `"${selectedArtifacts[0].title}"`
        : `${selectedArtifacts.length} artifacts`;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${subject}? This also removes them from your garden.`)
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    const removed = new Set<string>();
    let firstError: string | null = null;
    for (const artifact of selectedArtifacts) {
      try {
        await deleteArtifactRequest(artifact);
        removed.add(artifact.id);
      } catch (cause) {
        firstError ??= cause instanceof Error ? cause.message : "Could not delete the artifact.";
      }
    }
    if (removed.size > 0) {
      setArtifacts((current) => current.filter((item) => !removed.has(item.id)));
      setOpenId((current) => (current && removed.has(current) ? null : current));
    }
    const failed = selectedArtifacts.length - removed.size;
    if (failed > 0) {
      setError(
        failed === 1 && firstError
          ? firstError
          : `${failed} of ${selectedArtifacts.length} artifacts could not be deleted.`,
      );
    }
    setDeleting(false);
  }, [deleting, selectedArtifacts]);

  // Painting an artifact that already carries the pen's color lifts it instead,
  // so one pen both marks and unmarks and a mis-click is undone by repeating it.
  //
  // The mark is applied locally first: waiting out a round trip between rows
  // would make the pen feel stuck. A refused write is put back.
  const paint = useCallback(
    async (artifact: PresentedArtifact) => {
      const next = artifact.highlight === pen ? null : pen;
      const previous = artifact.highlight;
      setError(null);
      setArtifacts((current) =>
        current.map((item) => (item.id === artifact.id ? { ...item, highlight: next } : item)),
      );
      try {
        await highlightArtifactRequest(artifact, next);
      } catch (cause) {
        setArtifacts((current) =>
          current.map((item) => (item.id === artifact.id ? { ...item, highlight: previous } : item)),
        );
        setError(cause instanceof Error ? cause.message : "Could not highlight the artifact.");
      }
    },
    [pen],
  );

  const handleImageCreated = useCallback((artifact: PresentedArtifact) => {
    setArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)]);
    setOpenId(artifact.id);
    void refresh();
  }, [refresh]);

  const resolveCreationConversation = useCallback(async (): Promise<string> => {
    if (creationConversationId) return creationConversationId;
    if (ownedCreationConversationId) return ownedCreationConversationId;
    if (ensureCreationConversation) {
      const id = await ensureCreationConversation();
      setOwnedCreationConversationId(id);
      return id;
    }
    if (!sourceSurface) throw new Error("Open a Terminal or Garden chat before creating an image.");
    const response = await fetch("/api/hermes/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        surface: sourceSurface,
        ...(gardenSlug ? { gardenSlug } : {}),
        title: "Artifact images",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      session?: { id?: string };
      error?: string;
    };
    if (!response.ok || !body.session?.id) {
      throw new Error(body.error ?? "The artifact workspace could not be opened.");
    }
    setOwnedCreationConversationId(body.session.id);
    return body.session.id;
  }, [creationConversationId, ensureCreationConversation, gardenSlug, ownedCreationConversationId, sourceSurface]);

  const menuButton = (
    <ArchiveMenuButton
      open={menuPosition !== null}
      onOpen={setMenuPosition}
      onClose={() => setMenuPosition(null)}
    />
  );

  return (
    <section
      className={`relative flex min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)] ${compact ? "h-full" : "max-h-[62vh]"}`}
      aria-label="Artifacts"
    >
      {!hideHeader ? (
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink-heading)]">Artifacts</h3>
            <p className="text-[10px] text-[var(--ink-muted)]">
              {searching ? `${filteredArtifacts.length} of ${archiveArtifacts.length}` : archiveArtifacts.length} {scopeLabel}
            </p>
          </div>
          {mode === "idle" ? menuButton : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 border-b border-[var(--line)] bg-[var(--paper-surface)] p-2.5">
        <div className="neu-inset relative min-w-0 flex-1 rounded-xl">
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
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search artifacts"
            aria-label="Search artifacts"
            autoComplete="off"
            spellCheck={false}
            className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] py-2 pl-9 pr-9 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:ring-2 focus:ring-[var(--botanical)]/15"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear artifact search"
              title="Clear search"
              className="neu-button-icon absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
                <path strokeLinecap="round" d="m7 7 10 10M17 7 7 17" />
              </svg>
            </button>
          ) : null}
        </div>
        {/* Garden tabs hide the panel header, so the menu rides beside the
            search field there — the archive is never without its actions. */}
        {hideHeader && mode === "idle" ? menuButton : null}
      </div>

      {menuPosition ? (
        <ArchiveMenu
          position={menuPosition}
          actionable={filteredArtifacts.length > 0}
          onClose={() => setMenuPosition(null)}
          onStartSelecting={() => {
            setMenuPosition(null);
            setSelectedIds(new Set());
            setMode("selecting");
          }}
          onStartHighlighting={() => {
            setMenuPosition(null);
            setMode("highlighting");
          }}
          onRefresh={() => {
            setMenuPosition(null);
            void refresh();
          }}
        />
      ) : null}

      {error ? <p className="m-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && archiveArtifacts.length === 0 ? (
          <p className="p-3 text-xs text-[var(--ink-muted)]">Loading…</p>
        ) : null}
        {archiveArtifacts.length === 0 && !loading ? (
          <p className="p-3 text-xs text-[var(--ink-muted)]">No artifacts yet.</p>
        ) : null}
        {archiveArtifacts.length > 0 && filteredArtifacts.length === 0 && !loading ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-[var(--ink-muted)]">No artifacts match “{searchQuery.trim()}”.</p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="neu-button mt-3 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink)]"
            >
              Clear search
            </button>
          </div>
        ) : null}

        {mode === "selecting" ? (
          <SelectionBar
            count={selectedArtifacts.length}
            total={filteredArtifacts.length}
            busy={deleting}
            onSelectAll={() => setSelectedIds(new Set(filteredArtifacts.map((item) => item.id)))}
            onClear={() => setSelectedIds(new Set())}
            onDelete={() => void deleteSelected()}
            onCancel={stopWorking}
          />
        ) : null}
        {mode === "highlighting" ? (
          <HighlightBar pen={pen} onPickPen={setPen} onDone={stopWorking} />
        ) : null}

        {filteredArtifacts.map((artifact) => {
          const pdfHref = artifactPdfHref(artifact);
          const checked = selectedIds.has(artifact.id);
          const highlight = chatHighlight(artifact.highlight);
          const rowInner = (
            <>
              <span className="bb-neu-artifact-preview inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--botanical)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.6]">
                <ArtifactFileIcon kind={artifact.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink-heading)]">
                  {artifact.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
                  {artifactDescription(artifact)}
                </span>
              </span>
              {artifact.status === "failed" ? (
                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-[var(--danger)]">
                  Failed
                </span>
              ) : null}
            </>
          );
          const openClasses =
            "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]";
          // The mark and the checked outline are painted inline because the
          // card's own material is unlayered CSS a utility class cannot beat.
          // A marked row keeps its color in every mode: an edge bar for the eye
          // scanning the list and a wash for the row it belongs to, both mixed
          // against the paper so one palette works light and dark.
          const edges = [
            highlight ? `inset 3px 0 0 ${highlight.color}` : null,
            checked && mode === "selecting" ? "inset 0 0 0 2px var(--botanical)" : null,
          ].filter(Boolean);
          return (
            <div
              key={artifact.id}
              className="bb-neu-artifact-card mb-1.5 flex w-full items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--paper-strong)]"
              style={{
                ...(highlight
                  ? { background: `color-mix(in srgb, ${highlight.color} 15%, transparent)` }
                  : {}),
                ...(edges.length > 0 ? { boxShadow: edges.join(", ") } : {}),
              }}
            >
              {mode === "selecting" ? (
                // A sibling of the row button, never inside it: the whole row
                // toggles the box, and the box stays operable by keyboard.
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleChecked(artifact.id)}
                  aria-label={`Select ${artifact.title}`}
                  className="h-3.5 w-3.5 shrink-0 accent-[var(--botanical)]"
                />
              ) : null}
              {mode === "idle" && pdfHref ? (
                <a href={pdfHref} className={openClasses} title={`Open ${artifact.title} in the PDF viewer`}>
                  {rowInner}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (mode === "selecting") toggleChecked(artifact.id);
                    else if (mode === "highlighting") void paint(artifact);
                    else toggleOpenArtifact(artifact.id);
                  }}
                  title={
                    mode === "highlighting"
                      ? `Highlight ${artifact.title}`
                      : mode === "idle"
                        ? `${openId === artifact.id ? "Close" : "Open"} ${artifact.title}`
                        : undefined
                  }
                  aria-pressed={mode === "idle" ? openId === artifact.id : undefined}
                  className={openClasses}
                >
                  {rowInner}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Keep a local fallback for compact archives that do not live inside a
          surface-owned artifact lane. The list stays mounted underneath, so
          closing the artifact returns to the same scroll position and search. */}
      <div
        ref={setViewerHost}
        aria-hidden={openArtifact && !inheritedViewerHost ? undefined : true}
        className={`absolute inset-0 z-20 ${
          openArtifact && !inheritedViewerHost ? "" : "pointer-events-none invisible"
        }`}
      />

      <ArtifactDockHostProvider host={inheritedViewerHost ?? viewerHost}>
        <ArtifactViewer
          artifact={openArtifact}
          onClose={() => setOpenId(null)}
          onUpdated={(updated) => {
            // Keep the open viewer on the new version immediately. Waiting for
            // the archive refresh can briefly make the artifact disappear and
            // knock a live document editor back to its preview.
            setArtifacts((current) => current.map((item) =>
              item.id === updated.id ? updated : item
            ));
            void refresh();
          }}
          onEditImage={(artifact) => {
            setOpenId(null);
            setImagePromptSource(null);
            setImageStudioSource(artifact);
          }}
          onCreateImage={(artifact) => {
            setOpenId(null);
            setImagePromptSource(artifact);
            setImageStudioSource("new");
          }}
          onEditVideo={(artifact) => {
            setOpenId(null);
            setVideoStudioSource(artifact);
          }}
        />
      </ArtifactDockHostProvider>
      {videoStudioSource ? (
        <ArtifactVideoStudio
          artifact={videoStudioSource}
          onUpdated={() => {
            void refresh();
          }}
          onClose={() => setVideoStudioSource(null)}
        />
      ) : null}
      {imageStudioSource ? (
        <ArtifactImageStudio
          sourceArtifact={imageStudioSource === "new" ? null : imageStudioSource}
          promptArtifact={imagePromptSource}
          creationConversationId={creationConversationId ?? ownedCreationConversationId ?? conversationId}
          ensureCreationConversation={resolveCreationConversation}
          sourceSurface={sourceSurface}
          gardenSlug={gardenSlug}
          onCreated={handleImageCreated}
          onClose={() => {
            setImageStudioSource(null);
            setImagePromptSource(null);
          }}
        />
      ) : null}
    </section>
  );
}
