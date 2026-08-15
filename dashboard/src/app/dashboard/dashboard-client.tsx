"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createCluster,
  deleteCluster,
  updateClusterDetails,
  setClusterBorderColor,
  setClusterVisibility,
  setClusterChatAccessible,
  setClusterForkAllowed,
  setClusterCardSize,
  setClusterFolder,
  createClusterFolder,
  deleteClusterFolder,
  moveClusterFolder,
  reorderClusterFolder,
  setClusterRepository,
} from "@/app/actions/clusters";
import type { Cluster, ClusterVisibility } from "@/app/actions/clusters";
import {
  FOLDER_SEPARATOR,
  expandFolderPaths,
  folderLabel,
  folderParent,
  folderRankFromOrder,
  isInSubtree,
  visibleFolderRows,
} from "@/lib/cluster-folders";
import NavBar from "@/app/components/navbar";
import type { NavbarShortcuts } from "@/lib/profile/navbar-shortcuts.ts";
import DashboardAgentTerminal from "@/app/components/hermes/dashboard-agent-terminal";
import type { TerminalPanel } from "@/app/components/hermes/terminal-sidebar";
import ScheduledChatsDock from "@/app/components/scheduled-chats-dock";
import DocumentIngestionTokenUsage from "@/app/components/document-ingestion-token-usage";
import DocumentIngestionVisionError from "@/app/components/document-ingestion-vision-error";
import {
  VLM_PARSE_FILE_RE,
  VlmParseOption,
  useVlmOcrAvailability,
} from "@/app/components/vlm-parse-option";
import {
  ANYDOC_PARSE_FILE_RE,
  AnydocParseOption,
  useAnydocAvailability,
} from "@/app/components/anydoc-parse-option";
import {
  TRANSFER_ACCEPT,
  describeImport,
  exportClusterFile,
  exportGardenFile,
  importTransferFile,
} from "@/lib/garden-transfer/client";
import { useToast, Toaster } from "@/app/components/toast";
import {
  sumIngestTokenUsage,
  type IngestTokenUsage,
} from "@/lib/ingest-token-usage";
import {
  APP_THEME_CHANGE_EVENT,
  applyAppTheme,
  getStoredAppTheme,
  isAppTheme,
  type AppTheme,
} from "@/lib/app-theme";

interface Props {
  userEmail: string;
  username: string;
  initialClusters: Cluster[];
  initialPublicClusters: Cluster[];
  initialClusterFolders: string[];
  /** Optional navbar entries this account switched on from its profile page. */
  navbarShortcuts: NavbarShortcuts;
  /** A top-level terminal route, such as /hooks, can open its panel on arrival. */
  initialTerminalPanel?: TerminalPanel | null;
}

const ACCEPTED =
  ".pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,.docx,.pptx,.xlsx,.zip";
const HANDWRITING_FILE_RE = /\.(pdf|jpg|jpeg|png|webp)$/i;
const DEFAULT_BORDER_COLOR = "#a9c1b1";
const CLUSTER_BORDER_COLORS = [
  DEFAULT_BORDER_COLOR,
  "#facc15",
  "#fb7185",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#a3e635",
];
const CARD_MIN_WIDTH = 280;
const CARD_MAX_WIDTH = 640;
const CARD_MIN_HEIGHT = 190;
const CARD_MAX_HEIGHT = 440;

// Masonry grid: small base track + gap so resizable cards pack tightly and
// backfill gaps instead of leaving the staggered voids a flex-wrap row leaves.
const CARD_GRID_UNIT = 8;
const CARD_GRID_GAP = 16;

// Clusters nest like folders; a cluster is addressed by its full path.
const FOLDER_INDENT_PX = 20;

function cardGridSpan(sizePx: number): number {
  return Math.max(
    1,
    Math.round((sizePx + CARD_GRID_GAP) / (CARD_GRID_UNIT + CARD_GRID_GAP)),
  );
}

type FileStatus = "pending" | "uploading" | "done" | "error";
type ClusterView = "mine" | "public";
type ResizeDirection = "right" | "bottom" | "corner";

interface ResizeSession {
  clusterId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  previousWidth: number;
  previousHeight: number;
  latestWidth: number;
  latestHeight: number;
  direction: ResizeDirection;
}

function fileKey(f: File) {
  return `${f.name}-${f.size}`;
}

function appendUniqueUploadFiles(current: File[], incoming: File[]): File[] {
  const keys = new Set(current.map(fileKey));
  const unique = [...current];
  for (const file of incoming) {
    const key = fileKey(file);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(file);
  }
  return unique;
}

// "0:05" / "1:23" style elapsed-time marker; falls back to seconds under a minute.
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default function DashboardClient({
  userEmail,
  username,
  initialClusters,
  initialPublicClusters,
  initialClusterFolders,
  navbarShortcuts,
  initialTerminalPanel = null,
}: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The cluster a new garden should be created in, set by the "+" on a cluster
  // header. Null creates it at the top level, as the toolbar button always does.
  const [newGardenFolder, setNewGardenFolder] = useState<string | null>(null);
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [clusterView, setClusterView] = useState<ClusterView>("mine");
  const [searchQuery, setSearchQuery] = useState("");
  const [myClusters, setMyClusters] = useState(initialClusters);
  const [publicClusters, setPublicClusters] = useState(initialPublicClusters);
  const [clusterFolders, setClusterFolders] = useState<string[]>(
    initialClusterFolders,
  );
  const [clusterFolderModalOpen, setClusterFolderModalOpen] = useState(false);
  const [clusterFolderName, setClusterFolderName] = useState("");
  const [clusterFolderParent, setClusterFolderParent] = useState<string | null>(
    null,
  );
  const [clusterFolderError, setClusterFolderError] = useState<string | null>(
    null,
  );
  const [draggingClusterId, setDraggingClusterId] = useState<number | null>(
    null,
  );
  const [draggingFolderPath, setDraggingFolderPath] = useState<string | null>(
    null,
  );
  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(
    null,
  );
  // Which cluster header the pointer is hovering an *edge* of, and which side.
  // An edge means "reorder next to this one"; the middle means "nest inside".
  const [dropEdge, setDropEdge] = useState<{
    key: string;
    place: "before" | "after";
  } | null>(null);
  const [expandedClusterFolders, setExpandedClusterFolders] = useState<
    Set<string>
  >(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [linkingRepoId, setLinkingRepoId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmVisibilityId, setConfirmVisibilityId] = useState<number | null>(
    null,
  );
  const [colorClusterId, setColorClusterId] = useState<number | null>(null);
  const [resizingClusterId, setResizingClusterId] = useState<number | null>(
    null,
  );

  const [uploadCluster, setUploadCluster] = useState<Cluster | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadStatuses, setUploadStatuses] = useState<
    Record<string, FileStatus>
  >({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, string>>(
    {},
  );
  const [uploadTokenUsage, setUploadTokenUsage] = useState<
    Record<string, IngestTokenUsage>
  >({});
  const [uploadVisionErrors, setUploadVisionErrors] = useState<
    Record<string, string>
  >({});
  // Final elapsed time per finished file (ms), shown next to its status.
  const [uploadDurations, setUploadDurations] = useState<
    Record<string, number>
  >({});
  // Ticks while uploading so the live elapsed-time markers re-render each second.
  const [nowTick, setNowTick] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [parseWithVlm, setParseWithVlm] = useState(false);
  const [parseWithAnydoc, setParseWithAnydoc] = useState(false);
  const [generateMap, setGenerateMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showBgModal, setShowBgModal] = useState(false);
  const [appTheme, setAppTheme] = useState<AppTheme>("light");
  // The terminal dock is fixed to the bottom of the viewport, so it covers the
  // end of the page rather than pushing it. Measuring it keeps the last row of
  // cards scrollable into view however far the dock is dragged open.
  const [dockHeight, setDockHeight] = useState(0);

  // Which garden or cluster is being written to a file right now, keyed
  // "garden:<slug>" / "cluster:<path>"; "import" while one is being read back.
  const [transferBusy, setTransferBusy] = useState<string | null>(null);
  // The cluster an import should land in, chosen by which control opened the
  // picker. Null imports a garden back where it came from, a cluster top-level.
  const [importTargetFolder, setImportTargetFolder] = useState<string | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transferInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  // Per-file upload start timestamps (ms) for the live duration markers.
  const uploadStartedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const stored = localStorage.getItem("dashboard:bg-image");
    if (stored) setBgImage(stored);
    setAppTheme(getStoredAppTheme(localStorage));

    const handleThemeChange = (event: Event) => {
      const theme = (event as CustomEvent<unknown>).detail;
      if (isAppTheme(theme)) setAppTheme(theme);
    };
    window.addEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange);
    return () => {
      window.removeEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, []);

  function selectAppTheme(theme: AppTheme) {
    setAppTheme(theme);
    applyAppTheme(theme);
  }

  // Track the dock's height so the page keeps scrollable room beneath it.
  useEffect(() => {
    const dock = document.querySelector("[data-terminal-dock]");
    if (!dock) return;
    const observer = new ResizeObserver(([entry]) => {
      setDockHeight(entry.contentRect.height);
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  // Re-render once a second while uploading so elapsed-time markers tick up.
  useEffect(() => {
    if (!isUploading) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isUploading]);

  function handleBgFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setBgImage(result);
      localStorage.setItem("dashboard:bg-image", result);
      setShowBgModal(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function removeBgImage() {
    setBgImage(null);
    localStorage.removeItem("dashboard:bg-image");
    setShowBgModal(false);
  }

  useEffect(() => {
    setMyClusters(initialClusters);
  }, [initialClusters]);

  useEffect(() => {
    setPublicClusters(initialPublicClusters);
  }, [initialPublicClusters]);

  const activeClusters = clusterView === "mine" ? myClusters : publicClusters;
  const filteredClusters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeClusters;

    return activeClusters.filter((cluster) => {
      const searchable = [
        cluster.name,
        cluster.description ?? "",
        cluster.ownerUsername ?? "",
        cluster.ownerEmail ?? "",
        cluster.visibility,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [activeClusters, searchQuery]);

  useEffect(() => {
    setClusterFolders(initialClusterFolders);
  }, [initialClusterFolders]);

  type ClusterRenderEntry =
    | { kind: "header"; folder: string; key: string; depth: number }
    | { kind: "card"; cluster: Cluster };

  // `clusterFolders` arrives from the server in the order the user dragged its
  // clusters into, so its own indices are the ranks the tree sorts siblings by.
  const folderRank = useMemo(
    () => folderRankFromOrder(clusterFolders),
    [clusterFolders],
  );

  // Clusters nest, and a cluster is identified by its full path
  // ("EE Year 1/Semester 2").
  const folderPaths = useMemo(
    () =>
      expandFolderPaths(
        [
          ...clusterFolders,
          ...filteredClusters.map((cluster) => cluster.folder),
        ],
        folderRank,
      ),
    [clusterFolders, filteredClusters, folderRank],
  );

  const clusterRenderList = useMemo<ClusterRenderEntry[]>(() => {
    if (clusterView !== "mine") {
      return filteredClusters.map((cluster) => ({ kind: "card", cluster }));
    }

    // With no clusters, show every garden flat (no accordion headers).
    if (folderPaths.length === 0) {
      return filteredClusters.map((cluster) => ({ kind: "card", cluster }));
    }

    // Gardens that have not been placed in a named cluster remain ordinary,
    // always-visible cards. Creating the first named cluster must not wrap all
    // existing gardens in a synthetic fallback folder.
    const entries: ClusterRenderEntry[] = [];
    for (const cluster of filteredClusters.filter((c) => !c.folder)) {
      entries.push({ kind: "card", cluster });
    }

    // Depth-first, so a cluster's own gardens are emitted before its nested
    // clusters and the section folding below attributes each card to the right
    // header.
    const rows = visibleFolderRows(
      folderPaths,
      (folder) => expandedClusterFolders.has(`folder:${folder}`),
      folderRank,
    );
    for (const { folder, depth } of rows) {
      const key = `folder:${folder}`;
      entries.push({ kind: "header", folder, key, depth });
      if (!expandedClusterFolders.has(key)) continue;
      for (const cluster of filteredClusters.filter(
        (c) => c.folder === folder,
      )) {
        entries.push({ kind: "card", cluster });
      }
    }
    return entries;
  }, [
    clusterView,
    filteredClusters,
    folderPaths,
    folderRank,
    expandedClusterFolders,
  ]);

  // Fold the flat header/card list into per-folder sections so each group packs
  // (masonry) on its own and cards never bleed across a folder boundary.
  const clusterSections = useMemo(() => {
    const sections: {
      key: string;
      header: { folder: string; key: string } | null;
      depth: number;
      cards: Cluster[];
    }[] = [];
    let current: (typeof sections)[number] | null = null;
    for (const entry of clusterRenderList) {
      if (entry.kind === "header") {
        current = {
          key: entry.key,
          header: { folder: entry.folder, key: entry.key },
          depth: entry.depth,
          cards: [],
        };
        sections.push(current);
      } else {
        if (!current) {
          current = { key: "__flat__", header: null, depth: 0, cards: [] };
          sections.push(current);
        }
        current.cards.push(entry.cluster);
      }
    }
    return sections;
  }, [clusterRenderList]);

  // A cluster's badge counts every garden nested anywhere beneath it, so a
  // collapsed cluster never reads as empty while hiding its subtree.
  const subtreeGardenCount = (folder: string) =>
    myClusters.filter((c) => isInSubtree(c.folder, folder)).length;

  const rewriteFolderPrefix = (
    value: string | null | undefined,
    from: string,
    to: string,
  ): string | null => {
    const folder = value ?? null;
    if (!folder) return folder;
    if (folder === from) return to;
    if (folder.startsWith(`${from}${FOLDER_SEPARATOR}`)) {
      return `${to}${folder.slice(from.length)}`;
    }
    return folder;
  };

  /* ---------------------------------------------------------------------- */
  /* Import and export: a garden travels as .garden, a cluster as .cluster    */
  /* ---------------------------------------------------------------------- */

  async function runTransfer(key: string, work: () => Promise<void>) {
    if (transferBusy) return;
    setTransferBusy(key);
    try {
      await work();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setTransferBusy(null);
    }
  }

  function handleExportGarden(cluster: Cluster) {
    void runTransfer(`garden:${cluster.slug}`, () =>
      exportGardenFile(cluster.slug, cluster.name),
    );
  }

  function handleExportCluster(folder: string) {
    void runTransfer(`cluster:${folder}`, () =>
      exportClusterFile(folder, folderLabel(folder)),
    );
  }

  /** Open the file picker; whatever is chosen lands in `target`. */
  function openImportPicker(target: string | null) {
    if (transferBusy) return;
    setImportTargetFolder(target);
    transferInputRef.current?.click();
  }

  function importTransfer(file: File, target: string | null) {
    void runTransfer("import", async () => {
      const result = await importTransferFile(file, target);
      addToast(describeImport(result));
      if (result.clusterPath) {
        setExpandedClusterFolders((prev) =>
          new Set(prev).add(`folder:${result.clusterPath}`),
        );
      }
      router.refresh();
    });
  }

  function handleTransferFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = importTargetFolder;
    e.target.value = "";
    setImportTargetFolder(null);
    if (file) importTransfer(file, target);
  }

  /** A file dragged from the desktop, as opposed to a card or a cluster row. */
  function isFileDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function toggleClusterFolder(key: string) {
    setExpandedClusterFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDeleteClusterFolder(name: string) {
    const count = subtreeGardenCount(name);
    const nested = folderPaths.filter(
      (f) => f !== name && isInSubtree(f, name),
    ).length;
    const ok = window.confirm(
      [
        `Delete cluster "${folderLabel(name)}"?`,
        nested > 0
          ? `The ${nested} cluster${nested === 1 ? "" : "s"} nested inside it will be deleted too.`
          : "",
        count > 0
          ? `Its ${count} garden${count === 1 ? "" : "s"} will remain on the main Gardens page (the gardens are not deleted).`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (!ok) return;

    setMyClusters((prev) =>
      prev.map((c) => (isInSubtree(c.folder, name) ? { ...c, folder: null } : c)),
    );
    setClusterFolders((prev) => prev.filter((f) => !isInSubtree(f, name)));
    startTransition(async () => {
      try {
        await deleteClusterFolder(name);
        router.refresh();
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to delete cluster",
        );
        router.refresh();
      }
    });
  }

  function handleMoveClusterToFolder(clusterId: number, folder: string | null) {
    setDraggingClusterId(null);
    setDraggingFolderPath(null);
    setDragOverFolderKey(null);
    setDropEdge(null);
    const target = folder && folder.trim() ? folder.trim() : null;
    const existing = myClusters.find((c) => c.id === clusterId);
    if (!existing || (existing.folder ?? null) === target) return;

    setMyClusters((prev) =>
      prev.map((c) => (c.id === clusterId ? { ...c, folder: target } : c)),
    );
    if (target) {
      setExpandedClusterFolders((prev) => new Set(prev).add(`folder:${target}`));
    }
    startTransition(async () => {
      try {
        await setClusterFolder(clusterId, target);
        router.refresh();
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to move garden");
        setMyClusters((prev) =>
          prev.map((c) =>
            c.id === clusterId ? { ...c, folder: existing.folder ?? null } : c,
          ),
        );
      }
    });
  }

  /** Re-parent a cluster. A null target moves it back to the top level. */
  function handleMoveClusterFolder(source: string, targetParent: string | null) {
    setDraggingClusterId(null);
    setDraggingFolderPath(null);
    setDragOverFolderKey(null);
    setDropEdge(null);
    const parent = targetParent?.trim() ?? "";
    const name = folderLabel(source);
    const target = parent ? `${parent}${FOLDER_SEPARATOR}${name}` : name;
    if (!name || source === target) return;
    if (isInSubtree(parent, source)) {
      addToast("A cluster cannot be moved inside itself.");
      return;
    }
    if (folderPaths.includes(target)) {
      addToast("A cluster with this name already exists here.");
      return;
    }

    const previousFolders = clusterFolders;
    const previousClusters = myClusters;
    // No re-sort: this array's order *is* the manual order, and a re-parent
    // leaves every cluster's rank among its siblings alone.
    setClusterFolders((prev) => [
      ...new Set(prev.map((f) => rewriteFolderPrefix(f, source, target) ?? f)),
    ]);
    setMyClusters((prev) =>
      prev.map((c) => ({
        ...c,
        folder: rewriteFolderPrefix(c.folder, source, target),
      })),
    );
    // Carry the open/closed state across the move so the tree does not collapse.
    setExpandedClusterFolders((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        const folder = key.slice("folder:".length);
        next.add(
          `folder:${rewriteFolderPrefix(folder, source, target) ?? folder}`,
        );
      }
      if (parent) next.add(`folder:${parent}`);
      return next;
    });

    startTransition(async () => {
      try {
        await moveClusterFolder(source, parent || null);
        router.refresh();
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to move cluster");
        setClusterFolders(previousFolders);
        setMyClusters(previousClusters);
      }
    });
  }

  /**
   * Drop a cluster onto a sibling's top or bottom edge: it takes that sibling's
   * parent and sits immediately before or after it. Ordering is the array's own
   * order, so the optimistic update is a splice.
   */
  function handleReorderClusterFolder(
    source: string,
    target: string,
    place: "before" | "after",
  ) {
    setDraggingClusterId(null);
    setDraggingFolderPath(null);
    setDragOverFolderKey(null);
    setDropEdge(null);
    if (!source || !target || source === target) return;
    if (isInSubtree(target, source)) {
      addToast("A cluster cannot be moved inside itself.");
      return;
    }

    const parent = folderParent(target);
    const name = folderLabel(source);
    const moved = parent ? `${parent}${FOLDER_SEPARATOR}${name}` : name;
    if (moved !== source && folderPaths.includes(moved)) {
      addToast("A cluster with this name already exists here.");
      return;
    }

    const previousFolders = clusterFolders;
    const previousClusters = myClusters;
    setClusterFolders((prev) => {
      const rewritten = [
        ...new Set(prev.map((f) => rewriteFolderPrefix(f, source, moved) ?? f)),
      ];
      const rest = rewritten.filter((f) => f !== moved);
      const at = rest.indexOf(target);
      const index =
        at < 0 ? rest.length : place === "before" ? at : at + 1;
      rest.splice(index, 0, moved);
      return rest;
    });
    if (moved !== source) {
      setMyClusters((prev) =>
        prev.map((c) => ({
          ...c,
          folder: rewriteFolderPrefix(c.folder, source, moved),
        })),
      );
      setExpandedClusterFolders((prev) => {
        const next = new Set<string>();
        for (const key of prev) {
          const folder = key.slice("folder:".length);
          next.add(
            `folder:${rewriteFolderPrefix(folder, source, moved) ?? folder}`,
          );
        }
        if (parent) next.add(`folder:${parent}`);
        return next;
      });
    }

    startTransition(async () => {
      try {
        await reorderClusterFolder(source, target, place);
        router.refresh();
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to reorder cluster",
        );
        setClusterFolders(previousFolders);
        setMyClusters(previousClusters);
      }
    });
  }

  function openClusterFolderModal(parent: string | null = null) {
    setClusterFolderName("");
    setClusterFolderParent(parent);
    setClusterFolderError(null);
    setClusterFolderModalOpen(true);
  }

  function closeClusterFolderModal() {
    if (isPending) return;
    setClusterFolderModalOpen(false);
    setClusterFolderName("");
    setClusterFolderParent(null);
    setClusterFolderError(null);
  }

  function handleCreateClusterFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = clusterFolderName.trim();
    if (!name) return;
    const parent = clusterFolderParent;
    const folder = parent ? `${parent}${FOLDER_SEPARATOR}${name}` : name;
    if (
      clusterFolders.some(
        (existing) =>
          existing.toLocaleLowerCase() === folder.toLocaleLowerCase(),
      )
    ) {
      setClusterFolderError("A cluster with this name already exists.");
      return;
    }
    setClusterFolderError(null);
    if (!clusterFolders.includes(folder)) {
      // Appending matches where the server files a new cluster: last among the
      // siblings it was created under.
      setClusterFolders((prev) => [...prev, folder]);
    }
    if (parent) {
      setExpandedClusterFolders((prev) => new Set(prev).add(`folder:${parent}`));
    }
    startTransition(async () => {
      try {
        await createClusterFolder(name, parent);
        setClusterFolderModalOpen(false);
        setClusterFolderName("");
        setClusterFolderParent(null);
        router.refresh();
      } catch (err) {
        setClusterFolders((prev) => prev.filter((item) => item !== folder));
        setClusterFolderError(
          err instanceof Error ? err.message : "Failed to create cluster",
        );
      }
    });
  }

  /**
   * True when what is being dragged may land in `folder` (null = top level).
   * A cluster cannot be dropped on itself or on anything it contains.
   */
  function canDropInFolder(folder: string | null) {
    const isSelfDrop =
      draggingFolderPath != null &&
      folder != null &&
      isInSubtree(folder, draggingFolderPath);
    return (
      (draggingClusterId != null || draggingFolderPath != null) && !isSelfDrop
    );
  }

  /**
   * Drop handlers for a whole cluster section — its header row *and* the cards
   * underneath. A header is a thin strip, so aiming a dragged cluster at one is
   * fiddly next to the generous target a garden card grid already offers; the
   * section gives clusters the same landing area. `folder` is null for the
   * unfoldered, top-level section.
   */
  function folderDropProps(folder: string | null, key: string) {
    const canDrop = canDropInFolder(folder);
    return {
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
        // A .garden or .cluster dragged in from the desktop imports here.
        const fileDrag = isFileDrag(e);
        if (!canDrop && !fileDrag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = fileDrag ? "copy" : "move";
        if (dragOverFolderKey !== key) setDragOverFolderKey(key);
        // Reveal a collapsed cluster so it's clear where the drop will land.
        if (folder != null && !expandedClusterFolders.has(key)) {
          setExpandedClusterFolders((prev) => new Set(prev).add(key));
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOverFolderKey((prev) => (prev === key ? null : prev));
        }
      },
      onDrop: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverFolderKey(null);
        setDropEdge(null);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) {
          importTransfer(dropped, folder);
          return;
        }
        if (!canDrop) return;
        if (draggingFolderPath) {
          handleMoveClusterFolder(draggingFolderPath, folder);
          return;
        }
        const id =
          Number(e.dataTransfer.getData("text/plain")) || draggingClusterId;
        if (id != null) handleMoveClusterToFolder(id, folder);
      },
    };
  }

  /**
   * Which third of a header the pointer sits in. The outer thirds reorder the
   * dragged cluster next to this one; the middle drops it inside, which is what
   * the section handler underneath already does.
   */
  function edgePlaceAt(
    e: React.DragEvent<HTMLDivElement>,
  ): "before" | "after" | null {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const offset = (e.clientY - rect.top) / rect.height;
    if (offset <= 0.3) return "before";
    if (offset >= 0.7) return "after";
    return null;
  }

  function renderFolderHeader(folder: string, key: string, depth = 0) {
    const isOver = dragOverFolderKey === key && dropEdge?.key !== key;
    const isExpanded = expandedClusterFolders.has(key);
    const count = subtreeGardenCount(folder);
    // Reordering only applies between clusters, and never against itself or a
    // cluster it contains.
    const canReorder =
      clusterView === "mine" &&
      draggingFolderPath != null &&
      draggingFolderPath !== folder &&
      !isInSubtree(folder, draggingFolderPath);
    const edge = dropEdge?.key === key ? dropEdge.place : null;
    return (
      <div
        key={key}
        role="button"
        tabIndex={0}
        draggable={clusterView === "mine"}
        onDragOver={(e) => {
          if (!canReorder) return;
          const place = edgePlaceAt(e);
          if (!place) {
            // Middle band: let the section underneath claim it as a nest.
            if (dropEdge?.key === key) setDropEdge(null);
            return;
          }
          // Owning the event keeps the section from also lighting up as a
          // "drop inside here" target while the insertion line is showing.
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          if (dropEdge?.key !== key || dropEdge.place !== place) {
            setDropEdge({ key, place });
          }
          if (dragOverFolderKey !== null) setDragOverFolderKey(null);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropEdge((prev) => (prev?.key === key ? null : prev));
          }
        }}
        onDrop={(e) => {
          if (!canReorder || !draggingFolderPath) return;
          const place = edgePlaceAt(e);
          if (!place) return;
          e.preventDefault();
          e.stopPropagation();
          handleReorderClusterFolder(draggingFolderPath, folder, place);
        }}
        onDragStart={(e) => {
          e.stopPropagation();
          // Grabbing one of the trailing buttons must not drag the cluster, the
          // same guard a garden card applies to its own action links.
          if (
            (e.target as HTMLElement).closest('[data-card-action="true"]') !=
            null
          ) {
            e.preventDefault();
            return;
          }
          // Firefox will not start a drag without payload. The path is never
          // read back as a garden id — `draggingFolderPath` decides the branch.
          e.dataTransfer.setData("text/plain", folder);
          e.dataTransfer.effectAllowed = "move";
          setDraggingClusterId(null);
          setDraggingFolderPath(folder);
        }}
        onDragEnd={() => {
          setDraggingFolderPath(null);
          setDragOverFolderKey(null);
          setDropEdge(null);
        }}
        onClick={() => toggleClusterFolder(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleClusterFolder(key);
          }
        }}
        style={{ marginLeft: depth * FOLDER_INDENT_PX }}
        title={
          clusterView === "mine"
            ? "Drag onto another cluster to nest it, or onto its top or bottom edge to reorder"
            : undefined
        }
        className={[
          "relative basis-full mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors",
          clusterView === "mine" ? "cursor-grab active:cursor-grabbing" : "",
          isOver
            ? "border-cyan-400/60 bg-cyan-950/20"
            : "border-gray-800 hover:border-gray-700 hover:bg-gray-900/50",
          draggingFolderPath === folder ? "opacity-50" : "",
        ].join(" ")}
      >
        {edge && (
          // Where the dragged cluster will land, drawn on the edge it will
          // take, and indented to the level it will end up at.
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-cyan-400 ${
              edge === "before" ? "-top-1" : "-bottom-1"
            }`}
          />
        )}
        {clusterView === "mine" && (
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-gray-700"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M9 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 19a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
          </svg>
        )}
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m8.25 4.5 7.5 7.5-7.5 7.5"
          />
        </svg>
        <svg
          className="h-4 w-4 shrink-0 text-amber-300/70"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
          />
        </svg>
        <span className="text-sm font-medium text-gray-300">
          {folderLabel(folder)}
        </span>
        <span className="text-[11px] text-gray-600">{count}</span>
        {folder && (
          <span
            data-card-action="true"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              openModal(folder);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                openModal(folder);
              }
            }}
            className="ml-auto rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-emerald-300"
            aria-label={`New garden inside ${folderLabel(folder)}`}
            title="New garden in this cluster"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.7}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v6m3-3H9m10.5 0a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
              />
            </svg>
          </span>
        )}
        {folder && (
          <span
            data-card-action="true"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              openClusterFolderModal(folder);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                openClusterFolderModal(folder);
              }
            }}
            className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
            aria-label={`New cluster inside ${folderLabel(folder)}`}
            title="New cluster inside this one"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.7}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 10.5v6m3-3h-6M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.061.44H18A2.25 2.25 0 0 1 20.25 9v.776"
              />
            </svg>
          </span>
        )}
        {folder && (
          <span
            data-card-action="true"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleExportCluster(folder);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                handleExportCluster(folder);
              }
            }}
            className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
            aria-label={`Export cluster ${folderLabel(folder)}`}
            title="Export this cluster as a .cluster file"
          >
            {transferBusy === `cluster:${folder}` ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.7}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v12m0 0 4-4m-4 4-4-4M3.75 16.5v1.875A2.625 2.625 0 0 0 6.375 21h11.25a2.625 2.625 0 0 0 2.625-2.625V16.5"
                />
              </svg>
            )}
          </span>
        )}
        {folder && (
          <span
            data-card-action="true"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClusterFolder(folder);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteClusterFolder(folder);
              }
            }}
            className="rounded p-1 text-gray-600 transition-colors hover:bg-red-950/40 hover:text-red-300"
            aria-label={`Delete cluster ${folderLabel(folder)}`}
            title="Delete cluster"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.7}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </span>
        )}
      </div>
    );
  }

  function openModal(folder: string | null = null) {
    setName("");
    setDescription("");
    setError(null);
    setNewGardenFolder(folder);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setError(null);
    setNewGardenFolder(null);
  }

  function openEditModal(cluster: Cluster) {
    setEditingCluster(cluster);
    setEditName(cluster.name);
    setEditDescription(cluster.description ?? "");
    setEditError(null);
    setConfirmDeleteId(null);
    setConfirmVisibilityId(null);
    setColorClusterId(null);
  }

  function closeEditModal() {
    setEditingCluster(null);
    setEditError(null);
  }

  function updateLocalCluster(
    clusterId: number,
    updater: (cluster: Cluster) => Cluster,
  ) {
    setMyClusters((previous) =>
      previous.map((cluster) =>
        cluster.id === clusterId ? updater(cluster) : cluster,
      ),
    );
    setPublicClusters((previous) =>
      previous.map((cluster) =>
        cluster.id === clusterId ? updater(cluster) : cluster,
      ),
    );
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const folder = newGardenFolder;
    startTransition(async () => {
      try {
        await createCluster(name.trim(), description.trim(), folder);
        // Reveal the cluster it landed in, so the new card is not created
        // behind a collapsed header.
        if (folder) {
          setExpandedClusterFolders((prev) =>
            new Set(prev).add(`folder:${folder}`),
          );
        }
        closeModal();
        router.refresh();
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to create garden",
        );
      }
    });
  }

  function handleUpdateCluster(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCluster || !editName.trim()) return;

    const clusterId = editingCluster.id;
    const nextName = editName.trim();
    const nextDescription = editDescription.trim();
    const previous = editingCluster;
    setEditError(null);

    updateLocalCluster(clusterId, (cluster) => ({
      ...cluster,
      name: nextName,
      description: nextDescription,
    }));

    startTransition(async () => {
      try {
        await updateClusterDetails(clusterId, nextName, nextDescription);
        closeEditModal();
        router.refresh();
      } catch (err: unknown) {
        updateLocalCluster(clusterId, (cluster) => ({
          ...cluster,
          name: previous.name,
          description: previous.description,
        }));
        setEditError(
          err instanceof Error ? err.message : "Failed to update garden",
        );
      }
    });
  }

  function handleDelete(clusterId: number) {
    setDeletingId(clusterId);
    startTransition(async () => {
      try {
        await deleteCluster(clusterId);
        setMyClusters((previous) =>
          previous.filter((cluster) => cluster.id !== clusterId),
        );
        setPublicClusters((previous) =>
          previous.filter((cluster) => cluster.id !== clusterId),
        );
        router.refresh();
      } catch (err: unknown) {
        addToast(
          err instanceof Error ? err.message : "Failed to delete garden",
        );
      } finally {
        setDeletingId(null);
      }
    });
  }

  async function handleVisibilityChange(cluster: Cluster) {
    if (!cluster.isOwner) return;

    const previousVisibility = cluster.visibility;
    const nextVisibility: ClusterVisibility =
      previousVisibility === "public" ? "private" : "public";
    setConfirmVisibilityId(null);
    updateLocalCluster(cluster.id, (item) => ({
      ...item,
      visibility: nextVisibility,
    }));

    try {
      await setClusterVisibility(cluster.id, nextVisibility);
      router.refresh();
    } catch (err) {
      updateLocalCluster(cluster.id, (item) => ({
        ...item,
        visibility: previousVisibility,
      }));
      addToast(
        err instanceof Error
          ? err.message
          : "Failed to update garden visibility",
      );
    }
  }

  async function handleChatAccessibleToggle(cluster: Cluster) {
    if (!cluster.isOwner) return;
    const next = !cluster.chat_accessible;
    updateLocalCluster(cluster.id, (item) => ({
      ...item,
      chat_accessible: next,
    }));
    try {
      await setClusterChatAccessible(cluster.id, next);
    } catch (err) {
      updateLocalCluster(cluster.id, (item) => ({
        ...item,
        chat_accessible: !next,
      }));
      addToast(
        err instanceof Error
          ? err.message
          : "Failed to update garden accessibility",
      );
    }
  }

  async function handleForkAllowedToggle(cluster: Cluster) {
    if (!cluster.isOwner) return;
    const next = !cluster.fork_allowed;
    updateLocalCluster(cluster.id, (item) => ({
      ...item,
      fork_allowed: next,
    }));
    try {
      await setClusterForkAllowed(cluster.id, next);
    } catch (err) {
      updateLocalCluster(cluster.id, (item) => ({
        ...item,
        fork_allowed: !next,
      }));
      addToast(
        err instanceof Error ? err.message : "Failed to update fork access",
      );
    }
  }

  async function handleConnectRepository(cluster: Cluster) {
    if (!cluster.isOwner || linkingRepoId !== null) return;
    const desktop = (
      window as Window & {
        breadboardDesktop?: { pickFolder: () => Promise<string | null> };
      }
    ).breadboardDesktop;
    if (!desktop) {
      addToast(
        "Repository linking uses Breadboard Desktop so the path stays on your computer.",
      );
      return;
    }

    setLinkingRepoId(cluster.id);
    try {
      const repositoryPath = await desktop.pickFolder();
      if (!repositoryPath) return;
      const result = await setClusterRepository(cluster.id, repositoryPath);
      updateLocalCluster(cluster.id, (item) => ({
        ...item,
        repo_connected: true,
        repo_name: result.repoName,
      }));
      addToast(
        `${result.repoName} is now available to OpenCode in this Garden.`,
        "success",
        "Repository connected",
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to connect repository",
      );
    } finally {
      setLinkingRepoId(null);
    }
  }

  function handleClusterBorderClick(
    e: React.MouseEvent<HTMLDivElement>,
    cluster: Cluster,
  ) {
    if (clusterView !== "mine" || !cluster.isOwner) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-card-action="true"]')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const threshold = 12;
    const clickedBorder =
      x <= threshold ||
      y <= threshold ||
      rect.width - x <= threshold ||
      rect.height - y <= threshold;

    if (!clickedBorder) return;

    setConfirmDeleteId(null);
    setConfirmVisibilityId(null);
    setColorClusterId((current) =>
      current === cluster.id ? null : cluster.id,
    );
  }

  async function handleBorderColorChange(color: string) {
    const clusterId = colorClusterId;
    if (!clusterId) return;

    const previous =
      myClusters.find((cluster) => cluster.id === clusterId)?.border_color ??
      DEFAULT_BORDER_COLOR;
    setColorClusterId(null);
    updateLocalCluster(clusterId, (cluster) => ({
      ...cluster,
      border_color: color,
    }));

    try {
      await setClusterBorderColor(clusterId, color);
      router.refresh();
    } catch (err) {
      updateLocalCluster(clusterId, (cluster) => ({
        ...cluster,
        border_color: previous,
      }));
      addToast(
        err instanceof Error ? err.message : "Failed to update border color",
      );
    }
  }

  function handleClusterResizePointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    cluster: Cluster,
    direction: ResizeDirection,
  ) {
    if (clusterView !== "mine" || !cluster.isOwner) return;
    e.preventDefault();
    e.stopPropagation();

    const session: ResizeSession = {
      clusterId: cluster.id,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: cluster.card_width,
      startHeight: cluster.card_height,
      previousWidth: cluster.card_width,
      previousHeight: cluster.card_height,
      latestWidth: cluster.card_width,
      latestHeight: cluster.card_height,
      direction,
    };
    resizeSessionRef.current = session;
    setResizingClusterId(cluster.id);
    setColorClusterId(null);
    setConfirmDeleteId(null);
    setConfirmVisibilityId(null);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor =
      direction === "right"
        ? "ew-resize"
        : direction === "bottom"
          ? "ns-resize"
          : "nwse-resize";
    document.body.style.userSelect = "none";

    const handleMove = (event: PointerEvent) => {
      const current = resizeSessionRef.current;
      if (!current || current.clusterId !== cluster.id) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      const nextWidth =
        current.direction === "right" || current.direction === "corner"
          ? clamp(current.startWidth + dx, CARD_MIN_WIDTH, CARD_MAX_WIDTH)
          : current.startWidth;
      const nextHeight =
        current.direction === "bottom" || current.direction === "corner"
          ? clamp(current.startHeight + dy, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT)
          : current.startHeight;

      resizeSessionRef.current = {
        ...current,
        latestWidth: nextWidth,
        latestHeight: nextHeight,
      };
      updateLocalCluster(current.clusterId, (item) => ({
        ...item,
        card_width: nextWidth,
        card_height: nextHeight,
      }));
    };

    const handleEnd = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;

      const finished = resizeSessionRef.current;
      resizeSessionRef.current = null;
      setResizingClusterId(null);
      if (!finished) return;

      const widthChanged = finished.latestWidth !== finished.previousWidth;
      const heightChanged = finished.latestHeight !== finished.previousHeight;
      if (!widthChanged && !heightChanged) return;

      void (async () => {
        try {
          await setClusterCardSize(
            finished.clusterId,
            finished.latestWidth,
            finished.latestHeight,
          );
        } catch (err) {
          updateLocalCluster(finished.clusterId, (item) => ({
            ...item,
            card_width: finished.previousWidth,
            card_height: finished.previousHeight,
          }));
          addToast(
            err instanceof Error ? err.message : "Failed to update card size",
          );
        }
      })();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
  }

  function openUploadModal(cluster: Cluster) {
    setUploadCluster(cluster);
    setUploadFiles([]);
    setUploadStatuses({});
    setUploadErrors({});
    setUploadProgress({});
    setUploadTokenUsage({});
    setUploadVisionErrors({});
    setUploadDurations({});
    uploadStartedAtRef.current = {};
    setUploadLabel("");
    setIsHandwriting(false);
    setGenerateMap(true);
    setIsDragging(false);
    setIsUploading(false);
  }

  function closeUploadModal() {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }
    setIsUploading(false);
    setUploadCluster(null);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) {
      setUploadFiles((prev) => appendUniqueUploadFiles(prev, dropped));
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) {
      setUploadFiles((prev) => appendUniqueUploadFiles(prev, files));
    }
    e.target.value = "";
  }

  function removeUploadFile(index: number) {
    setUploadFiles((prev) => {
      const removed = prev[index];
      if (removed) {
        const key = fileKey(removed);
        setUploadStatuses((statuses) => {
          const next = { ...statuses };
          delete next[key];
          return next;
        });
        setUploadErrors((errors) => {
          const next = { ...errors };
          delete next[key];
          return next;
        });
        setUploadProgress((progress) => {
          const next = { ...progress };
          delete next[key];
          return next;
        });
        setUploadTokenUsage((usage) => {
          const next = { ...usage };
          delete next[key];
          return next;
        });
        setUploadVisionErrors((errors) => {
          const next = { ...errors };
          delete next[key];
          return next;
        });
        setUploadDurations((durations) => {
          const next = { ...durations };
          delete next[key];
          return next;
        });
        delete uploadStartedAtRef.current[key];
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploadFiles.length === 0 || !uploadCluster || isUploading) return;

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const sessionStartedAt = Date.now();
    setIsUploading(true);
    const initial: Record<string, FileStatus> = {};
    uploadFiles.forEach((f) => {
      initial[fileKey(f)] = "pending";
    });
    setUploadStatuses(initial);
    setUploadErrors({});
    setUploadProgress({});
    setUploadTokenUsage({});
    setUploadVisionErrors({});
    setUploadDurations({});
    uploadStartedAtRef.current = {};

    let successCount = 0;
    let duplicateCount = 0;
    let snapshotCount = 0;
    const screenshotWarnings: string[] = [];

    for (const file of uploadFiles) {
      if (controller.signal.aborted) break;
      const key = fileKey(file);
      uploadStartedAtRef.current[key] = Date.now();
      setUploadStatuses((prev) => ({ ...prev, [key]: "uploading" }));

      // One reader per file, most specific first: the VLM reads pixels, anydoc
      // reads document packages, handwriting OCR is the fallback for the pages
      // neither of the first two was asked for.
      const usesVlm =
        parseWithVlm &&
        vlmStatus.available &&
        VLM_PARSE_FILE_RE.test(file.name);
      const usesAnydoc =
        !usesVlm &&
        parseWithAnydoc &&
        anydocStatus.available &&
        ANYDOC_PARSE_FILE_RE.test(file.name);
      const usesHandwriting =
        !usesVlm &&
        !usesAnydoc &&
        isHandwriting &&
        HANDWRITING_FILE_RE.test(file.name);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clusterSlug", uploadCluster.slug);
      if (uploadLabel.trim())
        formData.append("sourceLabel", uploadLabel.trim());
      formData.append("isHandwriting", String(usesHandwriting));
      formData.append("parseWithVlm", String(usesVlm));
      formData.append("parseWithAnydoc", String(usesAnydoc));
      formData.append("generateMap", String(usesHandwriting || generateMap));

      const clearProgress = () =>
        setUploadProgress((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });

      try {
        setUploadProgress((prev) => ({ ...prev, [key]: "Uploading file…" }));
        const res = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        // Validation/auth failures come back as a normal JSON error response.
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          const message =
            typeof data.error === "string" ? data.error : "Upload failed";
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          setUploadErrors((prev) => ({ ...prev, [key]: message }));
          clearProgress();
          addToast(`${file.name}: ${message}`);
          continue;
        }

        // Otherwise the route streams Server-Sent Events ("data: {json}\n\n"):
        // a series of { type: "progress", step } events, then a final result or
        // error, then a "[DONE]" sentinel.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: {
          duplicate?: boolean;
          imageCount?: number;
          screenshotWarning?: string;
          durationMs?: number;
        } | null = null;
        let streamError: string | null = null;

        const handleEvent = (block: string) => {
          const payload = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s?/, ""))
            .join("\n")
            .trim();
          if (!payload || payload === "[DONE]") return;
          let event: {
            type?: string;
            step?: string;
            error?: string;
            duplicate?: boolean;
            imageCount?: number;
            screenshotWarning?: string;
            visionError?: string;
            durationMs?: number;
            tokenUsage?: IngestTokenUsage;
          };
          try {
            event = JSON.parse(payload);
          } catch {
            return;
          }
          if (event.tokenUsage) {
            setUploadTokenUsage((prev) => ({
              ...prev,
              [key]: event.tokenUsage!,
            }));
          }
          if (
            typeof event.visionError === "string" &&
            event.visionError.trim()
          ) {
            setUploadVisionErrors((prev) => ({
              ...prev,
              [key]: `${file.name}: ${event.visionError!.trim()}`,
            }));
          }
          if (event.type === "progress" && typeof event.step === "string") {
            const step = event.step;
            setUploadProgress((prev) => ({ ...prev, [key]: step }));
          } else if (event.type === "result") {
            result = event;
          } else if (event.type === "error") {
            streamError =
              typeof event.error === "string" ? event.error : "Upload failed";
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) handleEvent(block);
        }
        if (buffer.trim()) handleEvent(buffer);
        clearProgress();

        const finishedAt = Date.now();
        const elapsed =
          finishedAt - (uploadStartedAtRef.current[key] ?? finishedAt);
        setUploadDurations((prev) => ({ ...prev, [key]: elapsed }));

        if (streamError) {
          if (controller.signal.aborted) break;
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          setUploadErrors((prev) => ({ ...prev, [key]: streamError! }));
          addToast(`${file.name}: ${streamError}`);
        } else if (result) {
          const data = result as {
            duplicate?: boolean;
            imageCount?: number;
            screenshotWarning?: string;
            visionError?: string;
            durationMs?: number;
            tokenUsage?: IngestTokenUsage;
          };
          setUploadStatuses((prev) => ({ ...prev, [key]: "done" }));
          setUploadErrors((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          if (typeof data.durationMs === "number") {
            setUploadDurations((prev) => ({
              ...prev,
              [key]: data.durationMs!,
            }));
          }
          if (data.duplicate) {
            duplicateCount++;
            addToast(
              `${file.name} is already in Documents; duplicate upload skipped`,
            );
          } else {
            successCount++;
            snapshotCount +=
              typeof data.imageCount === "number" ? data.imageCount : 0;
            if (typeof data.screenshotWarning === "string") {
              screenshotWarnings.push(
                `${file.name}: ${data.screenshotWarning}`,
              );
            }
          }
        } else {
          if (controller.signal.aborted) break;
          const message = "Upload ended unexpectedly";
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          setUploadErrors((prev) => ({ ...prev, [key]: message }));
          addToast(`${file.name}: ${message}`);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") break;
        const message = err instanceof Error ? err.message : "Network error";
        setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
        setUploadErrors((prev) => ({ ...prev, [key]: message }));
        clearProgress();
        addToast(`${file.name}: ${message}`);
      }
    }

    if (!controller.signal.aborted) {
      if (successCount > 0) {
        const totalDuration = formatDuration(Date.now() - sessionStartedAt);
        addToast(
          `Added ${successCount} file${successCount > 1 ? "s" : ""} to ${uploadCluster.name}${vlmUploadEnabled ? " with VLM parsing" : anydocUploadEnabled ? " with anydoc conversion" : isHandwriting && hasHandwritingCompatibleFile ? " with handwriting OCR" : ""}${snapshotCount > 0 ? ` and ${snapshotCount} source snapshot${snapshotCount === 1 ? "" : "s"}` : ""} in ${totalDuration}`,
        );
        for (const warning of screenshotWarnings) addToast(warning);
        router.refresh();
      } else if (duplicateCount > 0) {
        router.refresh();
      }
      setIsUploading(false);
      uploadAbortRef.current = null;
    }
  }

  const hasHandwritingCompatibleFile = uploadFiles.some((f) =>
    HANDWRITING_FILE_RE.test(f.name),
  );
  const handwritingUploadEnabled =
    isHandwriting && hasHandwritingCompatibleFile;
  const hasVlmCompatibleFile = uploadFiles.some((f) =>
    VLM_PARSE_FILE_RE.test(f.name),
  );
  const { status: vlmStatus, loading: vlmStatusLoading } =
    useVlmOcrAvailability(Boolean(uploadCluster) && hasVlmCompatibleFile);
  const vlmUploadEnabled =
    parseWithVlm && hasVlmCompatibleFile && vlmStatus.available;
  const hasAnydocCompatibleFile = uploadFiles.some((f) =>
    ANYDOC_PARSE_FILE_RE.test(f.name),
  );
  const { status: anydocStatus, loading: anydocStatusLoading } =
    useAnydocAvailability(Boolean(uploadCluster) && hasAnydocCompatibleFile);
  const anydocUploadEnabled =
    parseWithAnydoc && hasAnydocCompatibleFile && anydocStatus.available;
  const ingestionTokenUsage = sumIngestTokenUsage(
    Object.values(uploadTokenUsage),
  );
  const ingestionVisionErrors = Object.values(uploadVisionErrors).filter(
    (error) => error.trim().length > 0,
  );
  const allDoneOrError = (cluster: Cluster | null) =>
    cluster !== null &&
    uploadFiles.length > 0 &&
    uploadFiles.every((f) => {
      const status = uploadStatuses[fileKey(f)];
      return status === "done" || status === "error";
    });

  return (
    <div
      // Marks the pixels the terminal dock's glass bar refracts.
      data-glass-scene-root
      className="dashboard-shell min-h-screen bg-gray-950 text-white flex flex-col"
      style={{
        // Clear the fixed dock, then a screenful of slack so the bottom of the
        // grid can always be scrolled up to a comfortable reading position.
        paddingBottom: `calc(${Math.round(dockHeight)}px + 40vh)`,
        ...(bgImage
          ? {
              backgroundImage: `url(${bgImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundAttachment: "fixed",
            }
          : {}),
      }}
    >
      <NavBar
        email={userEmail}
        username={username}
        shortcuts={navbarShortcuts}
      />

      {/* Persistent, top-left: what is scheduled to run on its own. */}
      <ScheduledChatsDock />

      {/* Dashboard appearance pencil button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowBgModal(true)}
          title="Customize dashboard appearance"
          aria-label="Customize dashboard appearance"
          className="neu-button-icon absolute right-4 top-2 z-10 rounded-full p-1.5 text-gray-600 transition-colors hover:bg-gray-800 hover:text-gray-300"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z"
            />
          </svg>
        </button>
      </div>

      <input
        ref={bgFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBgFileChange}
      />

      <input
        ref={transferInputRef}
        type="file"
        accept={TRANSFER_ACCEPT}
        className="hidden"
        onChange={handleTransferFileChange}
      />

      <div className="max-w-5xl mx-auto w-full px-6 py-12 flex-1">
        <div className="flex flex-col gap-5 mb-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Gardens</h1>
              <p className="text-sm text-gray-500 mt-1">
                {clusterView === "mine"
                  ? "Your knowledge gardens"
                  : "Public knowledge gardens"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/garden"
                className="neu-button px-4 py-2 text-sm font-medium text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors"
              >
                View gardens
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="neu-segmented flex rounded-lg border border-gray-800 bg-gray-900/60 p-1">
              <button
                type="button"
                onClick={() => setClusterView("mine")}
                className={[
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  clusterView === "mine"
                    ? "bg-white text-gray-950"
                    : "text-gray-400 hover:text-white",
                ].join(" ")}
              >
                My gardens
              </button>
              <button
                type="button"
                onClick={() => setClusterView("public")}
                className={[
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  clusterView === "public"
                    ? "bg-white text-gray-950"
                    : "text-gray-400 hover:text-white",
                ].join(" ")}
              >
                Public gardens
              </button>
            </div>

            <div className="relative min-w-0 flex-1">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.7}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                />
              </svg>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  clusterView === "mine"
                    ? "Search your gardens"
                    : "Search public gardens"
                }
                className="neu-control w-full rounded-lg border border-gray-800 bg-gray-900 px-9 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-gray-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-600 hover:text-white"
                  aria-label="Clear search"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => openModal(null)}
            className="neu-button-primary inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-gray-100"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
            </svg>
            New garden
          </button>
          {clusterView === "mine" && (
            <button
              type="button"
              onClick={() => openClusterFolderModal(null)}
              className="neu-button inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 10.5v6m3-3h-6M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.061.44H18A2.25 2.25 0 0 1 20.25 9v.776"
                />
              </svg>
              New cluster
            </button>
          )}
          <button
            type="button"
            onClick={() => openImportPicker(null)}
            disabled={transferBusy !== null}
            className="neu-button inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white disabled:opacity-40"
            title="Import a .garden or .cluster file"
          >
            {transferBusy === "import" ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5"
                />
              </svg>
            )}
            Import
          </button>
        </div>

        {clusterSections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-600">
            <p className="text-lg">
              {searchQuery
                ? "No matching gardens."
                : clusterView === "mine"
                  ? "No gardens yet."
                  : "No public gardens yet."}
            </p>
            <p className="text-sm mt-1">
              {searchQuery
                ? "Try a different search."
                : clusterView === "mine"
                  ? "Create one to get started."
                  : "Make one of your gardens public to share it here."}
            </p>
          </div>
        ) : (
          <>
            {clusterView === "mine" &&
              (draggingClusterId != null || draggingFolderPath != null) && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverFolderKey !== "root") setDragOverFolderKey("root");
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDragOverFolderKey((prev) =>
                        prev === "root" ? null : prev,
                      );
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingFolderPath) {
                      handleMoveClusterFolder(draggingFolderPath, null);
                      return;
                    }
                    const id =
                      Number(e.dataTransfer.getData("text/plain")) ||
                      draggingClusterId;
                    if (id != null) handleMoveClusterToFolder(id, null);
                  }}
                  className={[
                    "mb-2 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition-colors",
                    dragOverFolderKey === "root"
                      ? "border-cyan-400/60 bg-cyan-950/20 text-cyan-200"
                      : "border-gray-800 text-gray-600",
                  ].join(" ")}
                >
                  Drop here to move to the top level
                </div>
              )}
            <div className="flex flex-col gap-2">
              {clusterSections.map((section) => {
                // The whole section is the drop target, not just its header
                // strip: a dragged cluster lands anywhere over the cluster it is
                // being moved into. The flat section stands in for the top level.
                const dropKey = section.header ? section.header.key : "root";
                const dropFolder = section.header
                  ? section.header.folder
                  : null;
                const sectionOver =
                  clusterView === "mine" &&
                  dragOverFolderKey === dropKey &&
                  canDropInFolder(dropFolder);
                return (
                <div
                  key={section.key}
                  {...(clusterView === "mine"
                    ? folderDropProps(dropFolder, dropKey)
                    : {})}
                  className={[
                    "flex flex-col rounded-xl transition-colors",
                    sectionOver ? "bg-cyan-950/10 ring-1 ring-cyan-400/30" : "",
                  ].join(" ")}
                >
                  {section.header &&
                    renderFolderHeader(
                      section.header.folder,
                      section.header.key,
                      section.depth,
                    )}
                  {section.cards.length > 0 && (
                    <div
                      className="mt-2 grid"
                      style={{
                        gridTemplateColumns: `repeat(auto-fill, ${CARD_GRID_UNIT}px)`,
                        gridAutoRows: `${CARD_GRID_UNIT}px`,
                        gridAutoFlow: "row dense",
                        gap: `${CARD_GRID_GAP}px`,
                        marginLeft: section.header
                          ? (section.depth + 1) * FOLDER_INDENT_PX
                          : 0,
                      }}
                    >
                      {section.cards.map((cluster) => {
                        const isDeleting = deletingId === cluster.id;
                        const canManage =
                          clusterView === "mine" && cluster.isOwner;
                        const descriptionText = cluster.description?.trim();
                        const cardDraggable =
                          clusterView === "mine" && Boolean(cluster.isOwner);

                        return (
                          <div
                            key={cluster.id}
                            draggable={cardDraggable}
                            onDragStart={(e) => {
                              const dragSource = e.target as HTMLElement;
                              if (
                                !cardDraggable ||
                                dragSource.closest('[data-card-action="true"]')
                              ) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.setData(
                                "text/plain",
                                String(cluster.id),
                              );
                              e.dataTransfer.effectAllowed = "move";
                              setDraggingFolderPath(null);
                              setDraggingClusterId(cluster.id);
                            }}
                            onDragEnd={() => {
                              setDraggingClusterId(null);
                              setDragOverFolderKey(null);
                            }}
                            onClick={(e) =>
                              handleClusterBorderClick(e, cluster)
                            }
                            className={[
                              "dashboard-garden-card neu-surface relative flex flex-col overflow-hidden bg-gray-900 border-2 rounded-xl p-5 gap-4 transition-colors",
                              resizingClusterId === cluster.id
                                ? "select-none ring-1 ring-[#7b97aa]/50"
                                : "",
                            ].join(" ")}
                            style={{
                              borderColor: cluster.border_color,
                              gridColumn: `span ${cardGridSpan(cluster.card_width)}`,
                              gridRow: `span ${cardGridSpan(cluster.card_height)}`,
                            }}
                            title={
                              canManage
                                ? "Click the border to change its color. Drag the right, bottom, or corner edge to resize."
                                : undefined
                            }
                          >
                            {canManage && colorClusterId === cluster.id && (
                              <div
                                data-card-action="true"
                                className="neu-popover absolute left-3 top-3 z-20 w-36 rounded-lg border border-gray-800 bg-gray-950 p-2"
                              >
                                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-600">
                                  Border color
                                </div>
                                <div className="grid grid-cols-6 gap-1.5">
                                  {CLUSTER_BORDER_COLORS.map((color) => (
                                    <button
                                      key={color}
                                      type="button"
                                      onClick={() =>
                                        handleBorderColorChange(color)
                                      }
                                      className={[
                                        "h-4 w-4 rounded border transition-transform hover:scale-110",
                                        cluster.border_color === color
                                          ? "border-white"
                                          : "border-gray-800",
                                      ].join(" ")}
                                      style={{ backgroundColor: color }}
                                      aria-label={`Use border color ${color}`}
                                      title={
                                        color === DEFAULT_BORDER_COLOR
                                          ? "Default border"
                                          : color
                                      }
                                    />
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setColorClusterId(null)}
                                  className="mt-2 w-full rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-500 transition-colors hover:border-gray-700 hover:text-white"
                                >
                                  Close
                                </button>
                              </div>
                            )}
                            {canManage && confirmDeleteId === cluster.id && (
                              <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 shadow-lg">
                                <span className="text-xs text-gray-400">
                                  Delete?
                                </span>
                                <button
                                  data-card-action="true"
                                  onClick={() => {
                                    setConfirmDeleteId(null);
                                    handleDelete(cluster.id);
                                  }}
                                  disabled={isDeleting || isPending}
                                  className="text-xs text-red-500 hover:text-red-400 font-medium transition-colors disabled:opacity-40"
                                >
                                  Yes
                                </button>
                                <button
                                  data-card-action="true"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-xs text-gray-500 hover:text-white transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            )}
                            {canManage &&
                              confirmDeleteId !== cluster.id &&
                              confirmVisibilityId === cluster.id && (
                                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 shadow-lg">
                                  <span className="text-xs text-gray-400">
                                    Make{" "}
                                    {cluster.visibility === "public"
                                      ? "private"
                                      : "public"}
                                    ?
                                  </span>
                                  <button
                                    data-card-action="true"
                                    onClick={() =>
                                      handleVisibilityChange(cluster)
                                    }
                                    className="text-xs text-gray-200 hover:text-white font-medium transition-colors"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    data-card-action="true"
                                    onClick={() => setConfirmVisibilityId(null)}
                                    className="text-xs text-gray-500 hover:text-white transition-colors"
                                  >
                                    No
                                  </button>
                                </div>
                              )}
                            {canManage &&
                              confirmDeleteId !== cluster.id &&
                              confirmVisibilityId !== cluster.id && (
                                <div className="absolute top-3 right-3 flex items-center gap-2">
                                  <button
                                    data-card-action="true"
                                    type="button"
                                    onClick={() =>
                                      void handleConnectRepository(cluster)
                                    }
                                    disabled={linkingRepoId !== null}
                                    style={{
                                      backgroundColor: "var(--paper-surface)",
                                    }}
                                    className={[
                                      "neu-button grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40",
                                      cluster.repo_connected
                                        ? "text-[var(--botanical)]"
                                        : "text-gray-500 hover:text-white",
                                    ].join(" ")}
                                    title={
                                      cluster.repo_connected
                                        ? `Change repository (${cluster.repo_name ?? "connected"})`
                                        : "Connect a local repository"
                                    }
                                    aria-label={
                                      cluster.repo_connected
                                        ? `Change connected repository ${cluster.repo_name ?? ""}`.trim()
                                        : "Connect a local repository"
                                    }
                                  >
                                    {linkingRepoId === cluster.id ? (
                                      <Spinner className="h-3.5 w-3.5" />
                                    ) : (
                                      <svg
                                        className="h-3.5 w-3.5"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={1.8}
                                        aria-hidden
                                      >
                                        <circle cx="6" cy="5" r="2" />
                                        <circle cx="18" cy="6" r="2" />
                                        <circle cx="6" cy="19" r="2" />
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M6 7v10m2-8h5a5 5 0 0 0 5-5"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                  <button
                                    data-card-action="true"
                                    type="button"
                                    onClick={() => openEditModal(cluster)}
                                    className="p-1 text-gray-500 hover:text-white transition-colors"
                                    title="Edit garden"
                                    aria-label="Edit garden"
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={1.8}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    data-card-action="true"
                                    type="button"
                                    onClick={() => handleExportGarden(cluster)}
                                    disabled={transferBusy !== null}
                                    className="p-1 text-gray-500 hover:text-white transition-colors disabled:opacity-40"
                                    title="Export garden as a .garden file"
                                    aria-label="Export garden"
                                  >
                                    {transferBusy === `garden:${cluster.slug}` ? (
                                      <Spinner className="w-3.5 h-3.5" />
                                    ) : (
                                      <svg
                                        className="w-3.5 h-3.5"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={1.8}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M12 3v12m0 0 4-4m-4 4-4-4M3.75 16.5v1.875A2.625 2.625 0 0 0 6.375 21h11.25a2.625 2.625 0 0 0 2.625-2.625V16.5"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                  <button
                                    data-card-action="true"
                                    type="button"
                                    onClick={() =>
                                      setConfirmVisibilityId(cluster.id)
                                    }
                                    className="shrink-0 rounded-full border border-gray-700 px-2.5 py-0.5 text-[11px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                                    title={`Make ${cluster.visibility === "public" ? "private" : "public"}`}
                                  >
                                    {cluster.visibility}
                                  </button>
                                  <button
                                    data-card-action="true"
                                    onClick={() =>
                                      setConfirmDeleteId(cluster.id)
                                    }
                                    disabled={isDeleting || isPending}
                                    className="p-1 text-gray-700 hover:text-red-500 transition-colors disabled:opacity-40"
                                    title="Delete garden"
                                  >
                                    {isDeleting ? (
                                      <Spinner className="w-3.5 h-3.5" />
                                    ) : (
                                      <svg
                                        className="w-3.5 h-3.5"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M6 18 18 6M6 6l12 12"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                </div>
                              )}
                            {!canManage && (
                              <span className="absolute top-3 right-3 shrink-0 rounded-full border border-gray-700 px-2.5 py-0.5 text-[11px] text-gray-400">
                                {cluster.visibility}
                              </span>
                            )}

                            <div className="min-h-0 flex min-w-0 flex-1 flex-col overflow-hidden">
                              <div className="shrink-0">
                                <div className="flex items-start gap-2 pr-28">
                                  <h2 className="min-w-0 flex-1 text-base font-semibold text-white truncate">
                                    {cluster.name}
                                  </h2>
                                </div>
                                {clusterView === "public" &&
                                  (cluster.ownerUsername ||
                                    cluster.ownerEmail) && (
                                    <p className="mt-1 truncate text-xs text-gray-600">
                                      by{" "}
                                      {cluster.ownerUsername ??
                                        cluster.ownerEmail}
                                    </p>
                                  )}
                                {cluster.noteCount === 0 ? (
                                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-gray-800 px-3 py-2.5">
                                    <svg
                                      className="w-4 h-4 text-gray-600 shrink-0"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={1.5}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                                      />
                                    </svg>
                                    <span className="text-xs text-gray-600">
                                      No notes yet
                                      {canManage && (
                                        <>
                                          {" - "}
                                          <button
                                            data-card-action="true"
                                            onClick={() =>
                                              openUploadModal(cluster)
                                            }
                                            className="text-gray-400 hover:text-white underline underline-offset-2 transition-colors"
                                          >
                                            upload your first
                                          </button>
                                        </>
                                      )}
                                    </span>
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-600 mt-2">
                                    {cluster.noteCount}{" "}
                                    {cluster.noteCount === 1
                                      ? "knowledge node"
                                      : "knowledge nodes"}{" "}
                                    -{" "}
                                    {new Date(
                                      cluster.created_at,
                                    ).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })}
                                  </p>
                                )}
                              </div>
                              {descriptionText && (
                                <p className="mt-4 min-h-0 flex-1 overflow-hidden whitespace-pre-line text-sm leading-6 text-gray-400">
                                  {descriptionText}
                                </p>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-col gap-2 pt-3 border-t border-gray-800">
                              {canManage && cluster.visibility === "public" && (
                                <>
                                  <button
                                    data-card-action="true"
                                    type="button"
                                    onClick={() =>
                                      handleChatAccessibleToggle(cluster)
                                    }
                                    className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 transition-colors hover:border-gray-700 hover:bg-gray-950/70"
                                  >
                                    <span className="text-xs text-gray-400">
                                      Allow others to chat
                                    </span>
                                    <span
                                      className={[
                                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
                                        cluster.chat_accessible
                                          ? "border-[#7b97aa] bg-[#7b97aa]"
                                          : "border-gray-700 bg-gray-900",
                                      ].join(" ")}
                                    >
                                      <span
                                        className={[
                                          "block h-3.5 w-3.5 rounded-full shadow-sm transition-transform",
                                          cluster.chat_accessible
                                            ? "translate-x-[18px] bg-gray-950"
                                            : "translate-x-0.5 bg-gray-500",
                                        ].join(" ")}
                                      />
                                    </span>
                                  </button>
                                  <button
                                    data-card-action="true"
                                    type="button"
                                    onClick={() =>
                                      handleForkAllowedToggle(cluster)
                                    }
                                    className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 transition-colors hover:border-gray-700 hover:bg-gray-950/70"
                                  >
                                    <span className="text-xs text-gray-400">
                                      Allow users to fork
                                    </span>
                                    <span
                                      className={[
                                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
                                        cluster.fork_allowed
                                          ? "border-[#7b97aa] bg-[#7b97aa]"
                                          : "border-gray-700 bg-gray-900",
                                      ].join(" ")}
                                    >
                                      <span
                                        className={[
                                          "block h-3.5 w-3.5 rounded-full shadow-sm transition-transform",
                                          cluster.fork_allowed
                                            ? "translate-x-[18px] bg-gray-950"
                                            : "translate-x-0.5 bg-gray-500",
                                        ].join(" ")}
                                      />
                                    </span>
                                  </button>
                                </>
                              )}
                              {clusterView === "mine" ||
                              cluster.chat_accessible ? (
                                <>
                                  <Link
                                    data-card-action="true"
                                    href={`/garden/${cluster.slug}`}
                                    className="bb-garden-card-action block w-full rounded-lg py-2 text-center text-sm font-medium"
                                  >
                                    Open garden view
                                  </Link>
                                  <Link
                                    data-card-action="true"
                                    href={`/gardens/${cluster.slug}`}
                                    className="bb-garden-card-action block w-full rounded-lg py-2 text-center text-sm font-medium"
                                  >
                                    Open garden dashboard
                                  </Link>
                                </>
                              ) : (
                                <Link
                                  data-card-action="true"
                                  href={`/garden/${cluster.slug}`}
                                  className="bb-garden-card-action block w-full rounded-lg py-2 text-center text-sm font-medium"
                                >
                                  Open garden view
                                </Link>
                              )}
                            </div>

                            {canManage && (
                              <>
                                <div
                                  data-card-action="true"
                                  role="separator"
                                  aria-orientation="vertical"
                                  aria-label="Resize garden width"
                                  onPointerDown={(e) =>
                                    handleClusterResizePointerDown(
                                      e,
                                      cluster,
                                      "right",
                                    )
                                  }
                                  className="absolute bottom-8 right-0 top-8 w-3 cursor-ew-resize rounded-r-xl transition-colors hover:bg-[#7b97aa]/15"
                                />
                                <div
                                  data-card-action="true"
                                  role="separator"
                                  aria-orientation="horizontal"
                                  aria-label="Resize garden height"
                                  onPointerDown={(e) =>
                                    handleClusterResizePointerDown(
                                      e,
                                      cluster,
                                      "bottom",
                                    )
                                  }
                                  className="absolute bottom-0 left-8 right-8 h-3 cursor-ns-resize transition-colors hover:bg-[#7b97aa]/15"
                                />
                                <div
                                  data-card-action="true"
                                  role="button"
                                  aria-label="Resize garden"
                                  onPointerDown={(e) =>
                                    handleClusterResizePointerDown(
                                      e,
                                      cluster,
                                      "corner",
                                    )
                                  }
                                  className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize rounded-br-lg"
                                >
                                  <span className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b border-r border-gray-600" />
                                  <span className="pointer-events-none absolute bottom-1 right-1 h-4 w-4 border-b border-r border-gray-700" />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {clusterFolderModalOpen && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeClusterFolderModal();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeClusterFolderModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-cluster-title"
            className="bb-modal-panel neu-dialog w-full max-w-sm rounded-2xl border p-5"
          >
            <h2 id="new-cluster-title" className="mb-1 text-lg font-semibold">
              {clusterFolderParent ? "New nested cluster" : "New cluster"}
            </h2>
            {clusterFolderParent ? (
              <p className="mb-4 text-xs text-gray-500">
                Inside{" "}
                <span className="text-gray-300">{clusterFolderParent}</span>
              </p>
            ) : (
              <div className="mb-4" />
            )}

            <form onSubmit={handleCreateClusterFolder} className="space-y-4">
              <div>
                <label
                  htmlFor="new-cluster-name"
                  className="mb-1.5 block text-sm text-gray-400"
                >
                  Cluster name
                </label>
                <input
                  id="new-cluster-name"
                  type="text"
                  value={clusterFolderName}
                  onChange={(event) => {
                    setClusterFolderName(event.target.value);
                    if (clusterFolderError) setClusterFolderError(null);
                  }}
                  maxLength={80}
                  autoComplete="off"
                  autoFocus
                  className="neu-control w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-gray-600"
                />
              </div>

              {clusterFolderError ? (
                <p role="alert" className="text-sm text-red-400">
                  {clusterFolderError}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeClusterFolderModal}
                  disabled={isPending}
                  className="neu-button rounded-lg border border-gray-800 px-4 py-2 text-sm text-gray-400 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-wait disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !clusterFolderName.trim()}
                  className="neu-button-primary flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Spinner /> : null}
                  {isPending ? "Creating..." : "Create cluster"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="bb-modal-panel neu-dialog w-full max-w-md rounded-2xl border p-6">
            <h2 className="text-lg font-semibold">New garden</h2>
            <p className="mb-5 mt-0.5 text-sm text-gray-500">
              {newGardenFolder
                ? `Inside ${newGardenFolder}`
                : "At the top level"}
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  placeholder="My garden"
                  className="neu-control w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What's this garden about?"
                  className="neu-control w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="neu-button flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !name.trim()}
                  className="neu-button-primary flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isPending && <Spinner />}
                  {isPending ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingCluster && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
        >
          <div
            className="bb-modal-panel neu-dialog w-full max-w-md rounded-2xl border p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-garden-title"
          >
            <h2 id="edit-garden-title" className="text-lg font-semibold mb-5">
              Edit garden
            </h2>
            <form onSubmit={handleUpdateCluster} className="space-y-4">
              <div>
                <label
                  htmlFor="edit-garden-name"
                  className="block text-sm text-gray-400 mb-1.5"
                >
                  Name
                </label>
                <input
                  id="edit-garden-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                  className="neu-control w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-garden-description"
                  className="block text-sm text-gray-400 mb-1.5"
                >
                  Description
                </label>
                <textarea
                  id="edit-garden-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  placeholder="What's this garden about?"
                  className="neu-control w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                />
              </div>
              {editError && <p className="text-sm text-red-400">{editError}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="neu-button flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !editName.trim()}
                  className="neu-button-primary flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isPending && <Spinner />}
                  {isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {uploadCluster && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUploadModal();
          }}
        >
          <div className="bb-modal-panel neu-dialog w-full max-w-md rounded-2xl border p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Add documents</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {uploadCluster.name}
              </p>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                multiple
                onChange={handleFileInput}
                className="hidden"
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={[
                  "rounded-xl border-2 border-dashed transition-colors",
                  isDragging ? "border-white/40 bg-white/5" : "border-gray-800",
                ].join(" ")}
              >
                {uploadFiles.length === 0 ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-sm cursor-pointer text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <span>
                      Drop files or{" "}
                      <span className="text-white underline underline-offset-2">
                        browse
                      </span>
                    </span>
                    <span className="text-xs text-gray-600">
                      PDF, DOCX, PPTX, XLSX, CSV, ZIP, images, TXT, MD
                    </span>
                  </div>
                ) : (
                  <div className="p-3 space-y-1.5">
                    {uploadFiles.map((f, i) => {
                      const key = fileKey(f);
                      const status = uploadStatuses[key];
                      const error = uploadErrors[key];
                      const progress = uploadProgress[key];
                      const startedAt = uploadStartedAtRef.current[key];
                      const finalDuration = uploadDurations[key];
                      // `nowTick` (updated each second) keeps the live marker fresh.
                      const liveNow = nowTick || Date.now();
                      const durationLabel =
                        status === "uploading" && startedAt
                          ? formatDuration(liveNow - startedAt)
                          : typeof finalDuration === "number"
                            ? formatDuration(finalDuration)
                            : null;
                      return (
                        <div
                          key={key}
                          className="rounded-lg bg-gray-800/50 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className="w-4 h-4 text-gray-500 shrink-0"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={1.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                              />
                            </svg>
                            <span className="flex-1 text-xs text-gray-300 truncate">
                              {f.name}
                            </span>
                            {durationLabel && (
                              <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
                                {durationLabel}
                              </span>
                            )}
                            {status === "uploading" && (
                              <Spinner className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            )}
                            {status === "done" && (
                              <svg
                                className="w-3.5 h-3.5 text-green-400 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m4.5 12.75 6 6 9-13.5"
                                />
                              </svg>
                            )}
                            {status === "error" && (
                              <span className="shrink-0 text-[11px] font-medium text-red-300">
                                Failed
                              </span>
                            )}
                            {!isUploading && (
                              <button
                                type="button"
                                onClick={() => removeUploadFile(i)}
                                className="p-0.5 text-gray-600 hover:text-white transition-colors shrink-0"
                                aria-label={`Remove ${f.name}`}
                              >
                                <svg
                                  className="w-3.5 h-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18 18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                          {status === "uploading" && progress && (
                            <p className="mt-1.5 pl-6 text-[11px] leading-4 text-gray-400 animate-pulse">
                              {progress}
                            </p>
                          )}
                          {status === "error" && error && (
                            <p className="mt-1.5 pl-6 text-[11px] leading-4 text-red-300">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {!isUploading && !allDoneOrError(uploadCluster) && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-1.5 text-xs text-gray-600 hover:text-white transition-colors border border-dashed border-gray-800 rounded-lg hover:border-gray-600"
                      >
                        + Add more files
                      </button>
                    )}
                  </div>
                )}
              </div>

              <DocumentIngestionVisionError errors={ingestionVisionErrors} />

              {(isUploading || ingestionTokenUsage.startedCalls > 0) && (
                <DocumentIngestionTokenUsage
                  usage={ingestionTokenUsage}
                  pending={isUploading}
                />
              )}

              {hasVlmCompatibleFile && !allDoneOrError(uploadCluster) && (
                <VlmParseOption
                  checked={parseWithVlm}
                  onChange={(next) => {
                    setParseWithVlm(next);
                    // The two page readers are alternatives, not a stack.
                    if (next) setIsHandwriting(false);
                  }}
                  disabled={isUploading}
                  status={vlmStatus}
                  loading={vlmStatusLoading}
                />
              )}

              {hasAnydocCompatibleFile && !allDoneOrError(uploadCluster) && (
                <AnydocParseOption
                  checked={parseWithAnydoc}
                  onChange={setParseWithAnydoc}
                  disabled={isUploading}
                  status={anydocStatus}
                  loading={anydocStatusLoading}
                  overriddenByVlm={vlmUploadEnabled}
                />
              )}

              {hasHandwritingCompatibleFile &&
                !allDoneOrError(uploadCluster) && (
                  <label
                    className={`flex items-start gap-2.5 select-none ${
                      vlmUploadEnabled ? "cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isHandwriting && !vlmUploadEnabled}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsHandwriting(checked);
                        if (checked) setGenerateMap(true);
                      }}
                      disabled={isUploading || vlmUploadEnabled}
                      className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
                    />
                    <span>
                      <span className="block text-sm text-gray-400">
                        Handwritten or scanned pages
                      </span>
                      <span className="block text-[11px] text-gray-600 mt-0.5">
                        {vlmUploadEnabled
                          ? "Not used while Parse using VLM is on — the VLM already reads the pages."
                          : anydocUploadEnabled
                            ? "Used for images only while Parse with anydoc is on — anydoc reads the PDFs."
                            : "Uses vision OCR on each PDF page or image before generating the Learning Map."}
                      </span>
                    </span>
                  </label>
                )}

              {!allDoneOrError(uploadCluster) && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={handwritingUploadEnabled || generateMap}
                    onChange={(e) => setGenerateMap(e.target.checked)}
                    disabled={isUploading || handwritingUploadEnabled}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
                  />
                  <div>
                    <span className="text-sm text-gray-400">
                      Generate Learning Map
                    </span>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      {handwritingUploadEnabled
                        ? "Required for handwritten uploads so the map is built from OCR text."
                        : "Build the Learning Spine, Source Map, and Scope Contract - slower but richer"}
                    </p>
                  </div>
                </label>
              )}

              {!allDoneOrError(uploadCluster) && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">
                    Source label{" "}
                    <span className="text-gray-600">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    placeholder="e.g. Lecture 3, My handwriting"
                    disabled={isUploading}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-50"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeUploadModal}
                  disabled={isUploading}
                  className="neu-button flex-1 py-2.5 text-sm disabled:opacity-40"
                >
                  {allDoneOrError(uploadCluster) ? "Close" : "Cancel"}
                </button>
                {!allDoneOrError(uploadCluster) && (
                  <button
                    type="submit"
                    disabled={uploadFiles.length === 0 || isUploading}
                    className="neu-button-primary flex flex-1 items-center justify-center gap-2 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUploading && <Spinner />}
                    {isUploading
                      ? `Uploading... (${Object.values(uploadStatuses).filter((s) => s === "done").length}/${uploadFiles.length})`
                      : `Upload ${uploadFiles.length > 0 ? `${uploadFiles.length} file${uploadFiles.length > 1 ? "s" : ""}` : ""}`}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {showBgModal && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBgModal(false);
          }}
        >
          <div className="bb-modal-panel neu-dialog w-full max-w-sm rounded-2xl border p-6">
            <h2 className="text-base font-semibold mb-1">
              Dashboard appearance
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              Choose a theme and optionally add a background image.
            </p>
            <div className="flex flex-col gap-3">
              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Theme
                </legend>
                <div className="neu-segmented grid grid-cols-2 gap-1 rounded-xl" role="radiogroup">
                  {(["light", "dark"] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      role="radio"
                      aria-checked={appTheme === theme}
                      onClick={() => selectAppTheme(theme)}
                      className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        appTheme === theme
                          ? "is-selected text-white"
                          : "text-gray-500 hover:text-white"
                      }`}
                    >
                      {theme === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="my-1 border-t border-gray-800" />
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Background image
              </p>
              <button
                type="button"
                onClick={() => bgFileInputRef.current?.click()}
                className="neu-button-primary w-full py-2.5 text-sm"
              >
                {bgImage ? "Replace image" : "Upload image"}
              </button>
              {bgImage && (
                <button
                  type="button"
                  onClick={removeBgImage}
                  className="neu-button-destructive w-full py-2.5 text-sm"
                >
                  Remove — restore original
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowBgModal(false)}
                className="neu-button w-full py-2.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismissToast} />

      <DashboardAgentTerminal
        scope={clusterView === "public" ? "public" : "mine"}
        initialPanel={initialTerminalPanel}
        backdropImage={bgImage}
      />
    </div>
  );
}
