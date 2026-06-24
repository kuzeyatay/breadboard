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
} from "@/app/actions/clusters";
import type { Cluster, ClusterVisibility } from "@/app/actions/clusters";
import type { ChatmockTarget } from "@/lib/chatmock-target";
import NavBar from "@/app/components/navbar";
import ChatmockTargetSwitch from "@/app/components/chatmock-target-switch";
import KnowledgeTerminal from "@/app/components/knowledge-terminal";
import { useToast, Toaster } from "@/app/components/toast";

interface Props {
  userEmail: string;
  username: string;
  initialClusters: Cluster[];
  initialPublicClusters: Cluster[];
  initialClusterFolders: string[];
  initialChatmockTarget: ChatmockTarget;
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
  initialChatmockTarget,
}: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [clusterView, setClusterView] = useState<ClusterView>("mine");
  const [searchQuery, setSearchQuery] = useState("");
  const [myClusters, setMyClusters] = useState(initialClusters);
  const [publicClusters, setPublicClusters] = useState(initialPublicClusters);
  const [clusterFolders, setClusterFolders] = useState<string[]>(initialClusterFolders);
  const [draggingClusterId, setDraggingClusterId] = useState<number | null>(null);
  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null);
  const [expandedClusterFolders, setExpandedClusterFolders] = useState<Set<string>>(
    new Set(),
  );
  const [deletingId, setDeletingId] = useState<number | null>(null);
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
  const [uploadLabel, setUploadLabel] = useState("");
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [generateMap, setGenerateMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showBgModal, setShowBgModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("dashboard:bg-image");
    if (stored) setBgImage(stored);
  }, []);

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
    | { kind: "header"; folder: string | null; key: string }
    | { kind: "card"; cluster: Cluster };

  const clusterRenderList = useMemo<ClusterRenderEntry[]>(() => {
    if (clusterView !== "mine") {
      return filteredClusters.map((cluster) => ({ kind: "card", cluster }));
    }

    const names = new Set<string>(clusterFolders.filter(Boolean));
    for (const cluster of filteredClusters) {
      if (cluster.folder) names.add(cluster.folder);
    }
    const ordered = [...names].sort((a, b) => a.localeCompare(b));

    // With no folders, show every cluster flat (no accordion headers).
    if (ordered.length === 0) {
      return filteredClusters.map((cluster) => ({ kind: "card", cluster }));
    }

    const entries: ClusterRenderEntry[] = [];
    const ungroupedKey = "__ungrouped__";
    entries.push({ kind: "header", folder: null, key: ungroupedKey });
    if (expandedClusterFolders.has(ungroupedKey)) {
      for (const cluster of filteredClusters.filter((c) => !c.folder)) {
        entries.push({ kind: "card", cluster });
      }
    }
    for (const name of ordered) {
      const key = `folder:${name}`;
      entries.push({ kind: "header", folder: name, key });
      if (expandedClusterFolders.has(key)) {
        for (const cluster of filteredClusters.filter((c) => c.folder === name)) {
          entries.push({ kind: "card", cluster });
        }
      }
    }
    return entries;
  }, [clusterView, filteredClusters, clusterFolders, expandedClusterFolders]);

  // Fold the flat header/card list into per-folder sections so each group packs
  // (masonry) on its own and cards never bleed across a folder boundary.
  const clusterSections = useMemo(() => {
    const sections: {
      key: string;
      header: { folder: string | null; key: string } | null;
      cards: Cluster[];
    }[] = [];
    let current: (typeof sections)[number] | null = null;
    for (const entry of clusterRenderList) {
      if (entry.kind === "header") {
        current = {
          key: entry.key,
          header: { folder: entry.folder, key: entry.key },
          cards: [],
        };
        sections.push(current);
      } else {
        if (!current) {
          current = { key: "__flat__", header: null, cards: [] };
          sections.push(current);
        }
        current.cards.push(entry.cluster);
      }
    }
    return sections;
  }, [clusterRenderList]);

  function toggleClusterFolder(key: string) {
    setExpandedClusterFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDeleteClusterFolder(name: string) {
    const count = myClusters.filter((c) => c.folder === name).length;
    const ok = window.confirm(
      count > 0
        ? `Delete cluster "${name}"? Its ${count} garden${count === 1 ? "" : "s"} will be moved to Ungrouped (the gardens are not deleted).`
        : `Delete cluster "${name}"?`,
    );
    if (!ok) return;

    setMyClusters((prev) =>
      prev.map((c) => (c.folder === name ? { ...c, folder: null } : c)),
    );
    setClusterFolders((prev) => prev.filter((f) => f !== name));
    startTransition(async () => {
      try {
        await deleteClusterFolder(name);
        router.refresh();
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to delete cluster");
        router.refresh();
      }
    });
  }

  function handleMoveClusterToFolder(clusterId: number, folder: string | null) {
    setDraggingClusterId(null);
    setDragOverFolderKey(null);
    const target = folder && folder.trim() ? folder.trim() : null;
    const existing = myClusters.find((c) => c.id === clusterId);
    if (!existing || (existing.folder ?? null) === target) return;

    setMyClusters((prev) =>
      prev.map((c) => (c.id === clusterId ? { ...c, folder: target } : c)),
    );
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

  function handleCreateClusterFolder() {
    const input = window.prompt("New cluster name");
    if (input === null) return;
    const folder = input.trim();
    if (!folder) return;
    if (!clusterFolders.includes(folder)) {
      setClusterFolders((prev) =>
        [...prev, folder].sort((a, b) => a.localeCompare(b)),
      );
    }
    startTransition(async () => {
      try {
        await createClusterFolder(folder);
        router.refresh();
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to create cluster");
      }
    });
  }

  function renderFolderHeader(folder: string | null, key: string) {
    const isOver = dragOverFolderKey === key;
    const isExpanded = expandedClusterFolders.has(key);
    const count = folder
      ? myClusters.filter((c) => c.folder === folder).length
      : myClusters.filter((c) => !c.folder).length;
    return (
      <div
        key={key}
        role="button"
        tabIndex={0}
        onClick={() => toggleClusterFolder(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleClusterFolder(key);
          }
        }}
        onDragOver={(e) => {
          if (draggingClusterId == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dragOverFolderKey !== key) setDragOverFolderKey(key);
          // Reveal a collapsed folder so it's clear where the cluster will land.
          if (!expandedClusterFolders.has(key)) {
            setExpandedClusterFolders((prev) => new Set(prev).add(key));
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOverFolderKey((prev) => (prev === key ? null : prev));
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = Number(e.dataTransfer.getData("text/plain")) || draggingClusterId;
          if (id != null) handleMoveClusterToFolder(id, folder);
        }}
        className={[
          "basis-full w-full mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors",
          isOver
            ? "border-cyan-400/60 bg-cyan-950/20"
            : "border-gray-800 hover:border-gray-700 hover:bg-gray-900/50",
        ].join(" ")}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
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
          {folder ?? "Ungrouped"}
        </span>
        <span className="text-[11px] text-gray-600">{count}</span>
        {folder && (
          <span
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
            className="ml-auto rounded p-1 text-gray-600 transition-colors hover:bg-red-950/40 hover:text-red-300"
            aria-label={`Delete cluster ${folder}`}
            title="Delete cluster"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
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

  function openModal() {
    setName("");
    setDescription("");
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setError(null);
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
    startTransition(async () => {
      try {
        await createCluster(name.trim(), description.trim());
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
    if (dropped.length) setUploadFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setUploadFiles((prev) => [...prev, ...files]);
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
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploadFiles.length === 0 || !uploadCluster || isUploading) return;

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setIsUploading(true);
    const initial: Record<string, FileStatus> = {};
    uploadFiles.forEach((f) => {
      initial[fileKey(f)] = "pending";
    });
    setUploadStatuses(initial);
    setUploadErrors({});

    let successCount = 0;
    let snapshotCount = 0;
    const screenshotWarnings: string[] = [];

    for (const file of uploadFiles) {
      if (controller.signal.aborted) break;
      const key = fileKey(file);
      setUploadStatuses((prev) => ({ ...prev, [key]: "uploading" }));

      const usesHandwriting =
        isHandwriting && HANDWRITING_FILE_RE.test(file.name);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clusterSlug", uploadCluster.slug);
      if (uploadLabel.trim())
        formData.append("sourceLabel", uploadLabel.trim());
      formData.append("isHandwriting", String(usesHandwriting));
      formData.append("generateMap", String(usesHandwriting || generateMap));

      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          const message = typeof data.error === "string" ? data.error : "Upload failed";
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          setUploadErrors((prev) => ({ ...prev, [key]: message }));
          addToast(`${file.name}: ${message}`);
        } else {
          setUploadStatuses((prev) => ({ ...prev, [key]: "done" }));
          setUploadErrors((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          successCount++;
          snapshotCount +=
            typeof data.imageCount === "number" ? data.imageCount : 0;
          if (typeof data.screenshotWarning === "string") {
            screenshotWarnings.push(`${file.name}: ${data.screenshotWarning}`);
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") break;
        const message = err instanceof Error ? err.message : "Network error";
        setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
        setUploadErrors((prev) => ({ ...prev, [key]: message }));
        addToast(`${file.name}: ${message}`);
      }
    }

    if (!controller.signal.aborted) {
      if (successCount > 0) {
        addToast(
          `Added ${successCount} file${successCount > 1 ? "s" : ""} to ${uploadCluster.name}${isHandwriting && hasHandwritingCompatibleFile ? " with handwriting OCR" : ""}${snapshotCount > 0 ? ` and ${snapshotCount} source snapshot${snapshotCount === 1 ? "" : "s"}` : ""}`,
        );
        for (const warning of screenshotWarnings) addToast(warning);
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
  const allDoneOrError = (cluster: Cluster | null) =>
    cluster !== null &&
    uploadFiles.length > 0 &&
    uploadFiles.every((f) => {
      const status = uploadStatuses[fileKey(f)];
      return status === "done" || status === "error";
    });

  return (
    <div
      className="min-h-screen bg-gray-950 text-white flex flex-col pb-12"
      style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" } : undefined}
    >
      <NavBar
        email={userEmail}
        username={username}
        actions={<ChatmockTargetSwitch initialTarget={initialChatmockTarget} />}
      />

      {/* Background image pen button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowBgModal(true)}
          title="Change dashboard background"
          className="absolute right-4 top-2 z-10 rounded-full p-1.5 text-gray-600 transition-colors hover:bg-gray-800 hover:text-gray-300"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z" />
          </svg>
        </button>
      </div>

      <input ref={bgFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgFileChange} />

      <div className="max-w-5xl mx-auto w-full px-6 py-12 flex-1">
        <div className="flex flex-col gap-5 mb-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Gardens
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {clusterView === "mine"
                  ? "Your knowledge gardens"
                  : "Public knowledge gardens"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/garden"
                className="px-4 py-2 text-sm font-medium text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors"
              >
                View garden
              </Link>
              <button
                onClick={openModal}
                className="px-4 py-2 bg-white text-gray-950 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
              >
                New garden
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-gray-800 bg-gray-900/60 p-1">
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
                className="w-full rounded-lg border border-gray-800 bg-gray-900 px-9 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-gray-600"
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

        {filteredClusters.length === 0 ? (
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
            {clusterView === "mine" && (
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateClusterFolder}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
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
              </div>
            )}
            <div className="flex flex-col gap-2">
              {clusterSections.map((section) => (
                <div key={section.key} className="flex flex-col">
                  {section.header &&
                    renderFolderHeader(section.header.folder, section.header.key)}
                  {section.cards.length > 0 && (
                    <div
                      className="mt-2 grid"
                      style={{
                        gridTemplateColumns: `repeat(auto-fill, ${CARD_GRID_UNIT}px)`,
                        gridAutoRows: `${CARD_GRID_UNIT}px`,
                        gridAutoFlow: "row dense",
                        gap: `${CARD_GRID_GAP}px`,
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
                    if (!cardDraggable) return;
                    e.dataTransfer.setData("text/plain", String(cluster.id));
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingClusterId(cluster.id);
                  }}
                  onDragEnd={() => {
                    setDraggingClusterId(null);
                    setDragOverFolderKey(null);
                  }}
                  onClick={(e) => handleClusterBorderClick(e, cluster)}
                  className={[
                    "relative flex flex-col overflow-hidden bg-gray-900 border-2 rounded-xl p-5 gap-4 transition-colors",
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
                      className="absolute left-3 top-3 z-20 w-36 rounded-lg border border-gray-800 bg-gray-950 p-2 shadow-xl"
                    >
                      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-600">
                        Border color
                      </div>
                      <div className="grid grid-cols-6 gap-1.5">
                        {CLUSTER_BORDER_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => handleBorderColorChange(color)}
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
                      <span className="text-xs text-gray-400">Delete?</span>
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
                          onClick={() => handleVisibilityChange(cluster)}
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
                          onClick={() => setConfirmVisibilityId(cluster.id)}
                          className="shrink-0 rounded-full border border-gray-700 px-2.5 py-0.5 text-[11px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                          title={`Make ${cluster.visibility === "public" ? "private" : "public"}`}
                        >
                          {cluster.visibility}
                        </button>
                        <button
                          data-card-action="true"
                          onClick={() => setConfirmDeleteId(cluster.id)}
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
                        (cluster.ownerUsername || cluster.ownerEmail) && (
                          <p className="mt-1 truncate text-xs text-gray-600">
                            by {cluster.ownerUsername ?? cluster.ownerEmail}
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
                                  onClick={() => openUploadModal(cluster)}
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
                          {new Date(cluster.created_at).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            },
                          )}
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
                          onClick={() => handleChatAccessibleToggle(cluster)}
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
                          onClick={() => handleForkAllowedToggle(cluster)}
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
                    {clusterView === "mine" || cluster.chat_accessible ? (
                      <>
                        <a
                          data-card-action="true"
                          href={`/garden/${cluster.slug}`}
                          className="w-full text-center py-1.5 text-sm border border-gray-700 text-gray-300 font-medium rounded-lg hover:border-gray-500 hover:text-white hover:bg-gray-900 transition-colors block"
                        >
                          Open garden view
                        </a>
                        <a
                          data-card-action="true"
                          href={`/gardens/${cluster.slug}`}
                          className="w-full text-center py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors block"
                        >
                          Open garden chat
                        </a>
                      </>
                    ) : (
                      <a
                        data-card-action="true"
                        href={`/garden/${cluster.slug}`}
                        className="w-full text-center py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors block"
                      >
                        Open garden view
                      </a>
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
                          handleClusterResizePointerDown(e, cluster, "right")
                        }
                        className="absolute bottom-8 right-0 top-8 w-3 cursor-ew-resize rounded-r-xl transition-colors hover:bg-[#7b97aa]/15"
                      />
                      <div
                        data-card-action="true"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Resize garden height"
                        onPointerDown={(e) =>
                          handleClusterResizePointerDown(e, cluster, "bottom")
                        }
                        className="absolute bottom-0 left-8 right-8 h-3 cursor-ns-resize transition-colors hover:bg-[#7b97aa]/15"
                      />
                      <div
                        data-card-action="true"
                        role="button"
                        aria-label="Resize garden"
                        onPointerDown={(e) =>
                          handleClusterResizePointerDown(e, cluster, "corner")
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
              ))}
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-semibold mb-5">New garden</h2>
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
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
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
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !name.trim()}
                  className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
        >
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-semibold mb-5">Edit garden</h2>
            <form onSubmit={handleUpdateCluster} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  placeholder="What's this garden about?"
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                />
              </div>
              {editError && <p className="text-sm text-red-400">{editError}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !editName.trim()}
                  className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUploadModal();
          }}
        >
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
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

              {hasHandwritingCompatibleFile &&
                !allDoneOrError(uploadCluster) && (
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isHandwriting}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsHandwriting(checked);
                        if (checked) setGenerateMap(true);
                      }}
                      disabled={isUploading}
                      className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
                    />
                    <span>
                      <span className="block text-sm text-gray-400">
                        Handwritten or scanned pages
                      </span>
                      <span className="block text-[11px] text-gray-600 mt-0.5">
                        Uses vision OCR on each PDF page or image before
                        generating the map.
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
                      Generate knowledge map
                    </span>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      {handwritingUploadEnabled
                        ? "Required for handwritten uploads so the map is built from OCR text."
                        : "Extract topics and links for the graph - slower but richer"}
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
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors disabled:opacity-40"
                >
                  {allDoneOrError(uploadCluster) ? "Close" : "Cancel"}
                </button>
                {!allDoneOrError(uploadCluster) && (
                  <button
                    type="submit"
                    disabled={uploadFiles.length === 0 || isUploading}
                    className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowBgModal(false); }}
        >
          <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Dashboard background</h2>
            <p className="text-sm text-gray-500 mb-5">Upload an image to use as the background for this page.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => bgFileInputRef.current?.click()}
                className="w-full py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors"
              >
                {bgImage ? "Replace image" : "Upload image"}
              </button>
              {bgImage && (
                <button
                  type="button"
                  onClick={removeBgImage}
                  className="w-full py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                >
                  Remove — restore original
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowBgModal(false)}
                className="w-full py-2.5 text-sm text-gray-600 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismissToast} />

      <KnowledgeTerminal scope={clusterView === "public" ? "public" : "mine"} />
    </div>
  );
}
