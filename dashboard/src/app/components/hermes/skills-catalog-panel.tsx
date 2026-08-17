"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import SkillCreatorPanel from "./skill-creator-panel";
import FavoriteBox, {
  DEFAULT_CAPABILITY_HIGHLIGHT_COLOR,
  capabilityHighlightStyle,
} from "./favorite-box";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import {
  invalidateSkillsCatalogCache,
  loadCachedSkillsCatalog,
  peekCachedSkillsCatalog,
  skillsCatalogUrl,
} from "@/lib/hermes/skills-catalog-client-cache";

type CatalogFilter =
  | "all"
  | "recent"
  | "featured"
  | "scientific"
  | "reverse"
  | "design"
  | "engineering"
  | "office"
  | "documents"
  | "omh"
  | "coding"
  | "trending"
  | "hot"
  | "official"
  | "installed"
  | "updates"
  | "audited"
  | "unreviewed";

type CatalogSkill = {
  upstreamId: string;
  source: string;
  slug: string;
  name: string;
  slashCommand: string;
  command: string;
  sourceType: string | null;
  installUrl: string | null;
  pageUrl: string | null;
  installs: number;
  duplicate: boolean;
  curated: boolean;
  rankTrending: number | null;
  rankHot: number | null;
  description: string;
  descriptionLoaded: boolean;
  upstreamHash: string | null;
  approvedHash: string | null;
  localHash: string | null;
  reviewStatus: string;
  installationStatus: string;
  updateStatus: string;
  upstreamStatus: string;
  files: Array<{ path: string }> | null;
  audits: AuditResult[] | null;
  classification?: {
    classification: string;
    category: string;
    reasons: string[];
  };
  requiresOpenCode?: boolean;
  availability?: "ready" | "unavailable" | "incompatible" | "needs_review";
  reasons?: string[];
  contract?: {
    category?: string;
    surfaces: HermesSurface[];
    requiredTools: string[];
    requiredArtifactKinds: string[];
    requiredRuntimes: string[];
    requiredMcpServers: string[];
    optionalMcpServers: string[];
    requiredEnvironmentVariables: Array<{
      name: string;
      required: boolean;
      description?: string;
    }>;
    requiredBinaries: string[];
    compatibilityNotes: string[];
    allowedToolHints: string[];
  } | null;
  requirements?: SkillRequirement[];
};

type SkillRequirement = {
  id: string;
  type:
    | "surface"
    | "tool"
    | "artifact"
    | "runtime"
    | "mcp"
    | "environment"
    | "dependency"
    | "compatibility"
    | "review";
  label: string;
  detail?: string;
  required: boolean;
  status: "satisfied" | "action_required" | "unsupported" | "information";
  action?:
    | "connect_mcp"
    | "use_opencode"
    | "connect_repository"
    | "configure_environment"
    | "review_skill";
  target?: string;
};

type AuditResult = {
  provider: string;
  status: string;
  summary: string | null;
  auditedAt: string | null;
  riskLevel: string | null;
};

type CatalogStatus = {
  hasSnapshot: boolean;
  totalAvailable: number;
  stale: boolean;
  lastSuccessfulSyncAt: string | null;
  lastFailure: string | null;
  synchronizing?: boolean;
  rateLimit?: { remaining?: number | null; resetAt?: string | null } | null;
};

type CatalogResponse = {
  skills?: CatalogSkill[];
  pagination?: { page: number; perPage: number; total: number; hasMore: boolean };
  status?: CatalogStatus;
  message?: string;
  error?: string;
};

type DescriptionResponse = {
  skills?: Array<Pick<CatalogSkill, "upstreamId" | "description" | "descriptionLoaded">>;
  message?: string;
  error?: string;
};

type SkillDetailResponse = {
  skill?: CatalogSkill;
  detail?: {
    id: string;
    source: string;
    slug: string;
    installs: number;
    hash: string | null;
    files: Array<{ path: string; contents: string }> | null;
  };
  audits?: AuditResult[];
  auditError?: string | null;
  message?: string;
  error?: string;
  cached?: boolean;
};

type QuarantineReport = {
  name: string;
  slug?: string;
  upstreamId?: string;
  slashCommand?: string;
  package: string;
  exactVersion?: string;
  files: string[];
  fileHashes: Record<string, string>;
  requestedPermissions: string[];
  discoveredScripts: string[];
  externalNetworkRequirements: string[];
  risks: string[];
  riskSummary: string;
  integrityVerified: boolean;
  classification: {
    classification: string;
    category: string;
    reasons: string[];
  };
};

interface Props {
  runtimeSessionId: string | number | null;
  onUse: (skill: CatalogSkill) => void;
  onPrepareWithOpenCode?: (
    skill: CatalogSkill,
    requirement: SkillRequirement,
  ) => void;
  onOpenConnections?: (requiredServer?: string) => void;
  onInstalledChange?: () => void | Promise<void>;
  surface?: HermesSurface;
  /** Highlighted capability identities retained for favorite sorting/migration. */
  favoriteIds?: string[];
  /** Most recently used skill ids, newest first. */
  recentSkillIds?: string[];
  highlightColors?: Record<string, string>;
  onHighlightChange?: (upstreamId: string, color: string | null) => void;
}

const FILTER_GROUPS: Array<{
  label: string;
  filters: Array<{ id: CatalogFilter; label: string }>;
}> = [
  {
    label: "Browse",
    filters: [
      { id: "all", label: "All" },
      { id: "recent", label: "Recent" },
      { id: "featured", label: "Featured" },
      { id: "scientific", label: "Scientific" },
      { id: "reverse", label: "Reverse" },
      { id: "design", label: "Design" },
      { id: "engineering", label: "Engineering" },
      { id: "office", label: "Office" },
      { id: "documents", label: "Documents" },
      { id: "omh", label: "Workflow" },
      { id: "official", label: "Official" },
    ],
  },
  {
    label: "Runtime",
    filters: [
      { id: "coding", label: "OpenCode" },
    ],
  },
  {
    label: "Discover",
    filters: [
      { id: "trending", label: "Trending" },
      { id: "hot", label: "Hot" },
    ],
  },
  {
    label: "Library",
    filters: [
      { id: "installed", label: "Installed" },
      { id: "updates", label: "Updates" },
    ],
  },
  {
    label: "Review",
    filters: [
      { id: "audited", label: "Audited" },
      { id: "unreviewed", label: "Unreviewed" },
    ],
  },
];

const FILTERS = FILTER_GROUPS.flatMap((group) => group.filters);
const DESCRIPTION_BATCH_SIZE = 6;

export default function SkillsCatalogPanel({
  runtimeSessionId,
  onUse,
  onPrepareWithOpenCode,
  onOpenConnections,
  onInstalledChange,
  surface = "dashboard_terminal",
  favoriteIds = [],
  recentSkillIds = [],
  highlightColors = {},
  onHighlightChange,
}: Props) {
  const initialCatalog = peekCachedSkillsCatalog<CatalogResponse>(
    skillsCatalogUrl({ surface }),
  );
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [skills, setSkills] = useState<CatalogSkill[]>(() =>
    Array.isArray(initialCatalog?.skills) ? initialCatalog.skills : [],
  );
  const [pagination, setPagination] = useState(() => initialCatalog?.pagination ?? {
    page: 0,
    perPage: 50,
    total: 0,
    hasMore: false,
  });
  const [status, setStatus] = useState<CatalogStatus | null>(() => initialCatalog?.status ?? null);
  const [loading, setLoading] = useState(initialCatalog === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogSkill | null>(null);
  const [detail, setDetail] = useState<SkillDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [report, setReport] = useState<QuarantineReport | null>(null);
  const [approvedPermissions, setApprovedPermissions] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuIndex, setFilterMenuIndex] = useState(0);
  const filterMenuId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const filterMenuRootRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const descriptionRequestsRef = useRef(new Set<string>());
  const catalogRequestRef = useRef(0);
  const recentSkillIdsKey = recentSkillIds.join("\n");

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), query.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page, query, recentSkillIdsKey]);

  useEffect(() => setActiveIndex((value) => Math.min(value, Math.max(0, skills.length - 1))), [skills.length]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const frame = window.requestAnimationFrame(() => filterOptionRefs.current[filterMenuIndex]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [filterMenuIndex, filterMenuOpen]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (filterMenuRootRef.current?.contains(target)) return;
      setFilterMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [filterMenuOpen]);

  function openFilterMenu(index = FILTERS.findIndex((item) => item.id === filter)) {
    setFilterMenuIndex(Math.max(0, index));
    setFilterMenuOpen(true);
  }

  function closeFilterMenu(restoreFocus = false) {
    setFilterMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
  }

  function selectCatalogFilter(nextFilter: CatalogFilter) {
    setFilter(nextFilter);
    setPage(0);
    setActiveIndex(0);
    closeFilterMenu(true);
  }

  function onFilterTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openFilterMenu(event.key === "ArrowUp"
        ? FILTERS.length - 1
        : FILTERS.findIndex((item) => item.id === filter));
    } else if (event.key === "Escape" && filterMenuOpen) {
      event.preventDefault();
      closeFilterMenu(true);
    }
  }

  function onFilterMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (filterMenuIndex + 1) % FILTERS.length;
    else if (event.key === "ArrowUp") nextIndex = (filterMenuIndex - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = FILTERS.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const nextFilter = FILTERS[filterMenuIndex]?.id;
      if (nextFilter) selectCatalogFilter(nextFilter);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFilterMenu(true);
      return;
    } else if (event.key === "Tab") {
      setFilterMenuOpen(false);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    setFilterMenuIndex(nextIndex);
  }

  async function loadCatalog(force = false) {
    const requestId = ++catalogRequestRef.current;
    const endpoint = skillsCatalogUrl({
      filter,
      page,
      perPage: 50,
      query,
      recentSkillIds,
      surface,
    });
    const cached = force
      ? null
      : peekCachedSkillsCatalog<CatalogResponse & { stale?: boolean }>(endpoint);
    const hadCachedResponse = cached !== null;
    setLoading(!hadCachedResponse);
    setError(null);
    const applyPayload = (payload: CatalogResponse & { stale?: boolean }) => {
      if (requestId !== catalogRequestRef.current) return;
      let nextSkills = Array.isArray(payload.skills) ? payload.skills : [];
      if (query.trim() && filter !== "all") {
        nextSkills = applyClientFilter(nextSkills, filter, recentSkillIds);
      }
      setSkills(nextSkills);
      void hydrateDescriptions(nextSkills);
      setPagination(payload.pagination ?? {
        page: 0,
        perPage: nextSkills.length,
        total: nextSkills.length,
        hasMore: false,
      });
      if (payload.status) setStatus(payload.status);
      else if (payload.stale) setStatus((current) => current ? { ...current, stale: true } : current);
    };
    try {
      if (cached) applyPayload(cached);
      const payload = await loadCachedSkillsCatalog<CatalogResponse & { stale?: boolean }>(
        endpoint,
        { force: force || hadCachedResponse },
      );
      applyPayload(payload);
    } catch (cause) {
      if (requestId !== catalogRequestRef.current) return;
      if (hadCachedResponse) return;
      setError(cause instanceof Error ? cause.message : "The skills catalog is unavailable.");
      setSkills([]);
    } finally {
      if (requestId === catalogRequestRef.current) setLoading(false);
    }
  }

  async function hydrateDescriptions(catalogSkills: CatalogSkill[]) {
    const pending = catalogSkills.filter((skill) =>
      !skill.descriptionLoaded && !descriptionRequestsRef.current.has(skill.upstreamId)
    );
    pending.forEach((skill) => descriptionRequestsRef.current.add(skill.upstreamId));
    for (let index = 0; index < pending.length; index += DESCRIPTION_BATCH_SIZE) {
      const batch = pending.slice(index, index + DESCRIPTION_BATCH_SIZE);
      try {
        const response = await fetch("/api/hermes/skills/descriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: batch.map((skill) => skill.upstreamId) }),
        });
        const payload = (await response.json().catch(() => ({}))) as DescriptionResponse;
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Descriptions are unavailable.");
        const updates = new Map((payload.skills ?? []).map((skill) => [skill.upstreamId, skill]));
        setSkills((current) => current.map((skill) => updates.has(skill.upstreamId)
          ? { ...skill, ...updates.get(skill.upstreamId)! }
          : skill));
      } catch {
        const ids = new Set(batch.map((skill) => skill.upstreamId));
        setSkills((current) => current.map((skill) => ids.has(skill.upstreamId)
          ? { ...skill, description: "Description is temporarily unavailable from the publisher.", descriptionLoaded: true }
          : skill));
      }
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/hermes/skills", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Catalog refresh failed.");
      invalidateSkillsCatalogCache();
      await loadCatalog(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function openSkill(skill: CatalogSkill, button?: HTMLButtonElement | null) {
    selectedButtonRef.current = button ?? null;
    setSelected(skill);
    setDetail(null);
    setReport(null);
    setActionMessage(null);
    if (isLocallyOwnedSkill(skill)) {
      setDetail({ skill });
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    try {
      const parameters = new URLSearchParams({
        id: skill.upstreamId,
        surface,
      });
      const response = await fetch(`/api/hermes/skills/detail?${parameters}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as SkillDetailResponse;
      if (!response.ok && !payload.cached) throw new Error(payload.message ?? payload.error ?? "Skill details are unavailable.");
      setDetail(payload);
      if (payload.skill) setSelected((current) => current ? { ...current, ...payload.skill } : payload.skill ?? null);
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : "Skill details are unavailable.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetails() {
    setSelected(null);
    setDetail(null);
    setReport(null);
    setActionMessage(null);
    window.setTimeout(() => selectedButtonRef.current?.focus() ?? searchRef.current?.focus(), 0);
  }

  async function prepareReview() {
    if (!selected) return;
    setActionBusy(true);
    setActionMessage("Retrieving the current immutable revision into inactive quarantine…");
    try {
      const response = await fetch("/api/hermes/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstreamId: selected.upstreamId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { report?: QuarantineReport; message?: string; error?: string };
      if (!response.ok || !payload.report) throw new Error(payload.message ?? payload.error ?? "The skill could not enter review.");
      setReport(payload.report);
      setApprovedPermissions(new Set());
      setActionMessage("Review the files, risk signals, capabilities, and hashes before approval.");
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : "The skill could not enter review.");
    } finally {
      setActionBusy(false);
    }
  }

  async function decideReview(decision: "promote" | "reject") {
    if (!report || !selected) return;
    setActionBusy(true);
    try {
      const response = await fetch("/api/hermes/skills/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: report.name,
          decision,
          runtimeSessionId,
          approvedPermissions: [...approvedPermissions],
          classificationOverride: report.classification.classification === "eligible_coding_conditional"
            ? "eligible_coding_conditional"
            : "eligible_general",
          overwrite: selected.installationStatus === "installed",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Could not ${decision} the skill.`);
      setReport(null);
      setActionMessage(decision === "promote" ? "Approved revision installed. The slash command is ready." : "Quarantined revision removed.");
      await onInstalledChange?.();
      invalidateSkillsCatalogCache();
      await loadCatalog(true);
      if (decision === "promote") await openSkill({ ...selected, installationStatus: "installed" });
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : `Could not ${decision} the skill.`);
    } finally {
      setActionBusy(false);
    }
  }

  async function removeSkill() {
    if (!selected) return;
    setActionBusy(true);
    try {
      // A distilled document is not a catalog install; deleting it removes the
      // built skill and its files, and the next chat that sees the document
      // rebuilds it.
      if (selected.sourceType === "document") {
        const response = await fetch(`/api/document-skills?slug=${encodeURIComponent(selected.slug)}`, {
          method: "DELETE",
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "The document skill could not be removed.");
        closeDetails();
        invalidateSkillsCatalogCache();
        await loadCatalog(true);
        return;
      }
      const response = await fetch("/api/hermes/skills/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstreamId: selected.upstreamId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "The skill could not be removed.");
      await onInstalledChange?.();
      closeDetails();
      invalidateSkillsCatalogCache();
      await loadCatalog(true);
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : "The skill could not be removed.");
    } finally {
      setActionBusy(false);
    }
  }

  function onRowsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!skills.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((value) => (value + direction + skills.length) % skills.length);
    } else if (event.key === "Enter") {
      const skill = skills[activeIndex];
      if (skill) {
        event.preventDefault();
        void openSkill(skill);
      }
    } else if (event.key === "Escape" && selected) {
      event.preventDefault();
      closeDetails();
    }
  }

  if (creating) {
    return (
      <SkillCreatorPanel
        runtimeSessionId={runtimeSessionId}
        onBack={() => setCreating(false)}
        onInstalledChange={async () => {
          invalidateSkillsCatalogCache();
          await onInstalledChange?.();
          await loadCatalog(true);
        }}
      />
    );
  }

  if (selected) {
    return (
      <section className="p-3" aria-label={`${selected.command} details`}>
        <button type="button" onClick={closeDetails} className="text-xs font-medium text-[var(--botanical)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">← Back to skills</button>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-all font-mono text-base font-semibold text-[var(--ink-heading)]">{selected.command}</h3>
            <p className="mt-1 text-sm text-[var(--ink)]">{(detail?.skill?.description ?? selected.description) || "Loading description…"}</p>
            <p className="mt-1 break-all text-xs text-[var(--ink-muted)]">
              {selected.sourceType === "first-party"
                ? "Built into Breadboard"
                : selected.sourceType === "local-install"
                  ? "Installed in Breadboard"
                  : selected.sourceType === "document"
                    ? "Distilled from your document with book-to-skill"
                    : `${selected.source} · ${formatInstalls(selected.installs)} installs`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.installationStatus === "installed" && selected.availability === "ready" ? (
              <button type="button" onClick={() => onUse(selected)} className="neu-button-accent rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white">Use {selected.command}</button>
            ) : null}
            {isLocallyOwnedSkill(selected) ? null : (
              <a href={selected.pageUrl ?? `https://skills.sh/${selected.source}/${selected.slug}`} target="_blank" rel="noreferrer" className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink)]">Open source</a>
            )}
          </div>
        </div>

        {detailLoading ? <p role="status" className="mt-5 text-sm text-[var(--ink-muted)]">Loading official files and audits…</p> : null}
        {actionMessage ? <p role="status" className="mt-4 rounded-lg bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]">{actionMessage}</p> : null}
        {selected.availability && selected.availability !== "ready" ? (
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]">
            <p className="font-medium text-[var(--ink-heading)]">
              {selected.availability === "needs_review" ? "Review required before installation" : "Unavailable on this surface"}
            </p>
            <ul className="mt-1 space-y-1 text-[var(--ink-muted)]">
              {(selected.reasons?.length
                ? selected.reasons
                : selected.classification?.reasons?.length
                  ? selected.classification.reasons
                  : ["This skill does not currently have a compatible Breadboard execution path."]
              ).map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        ) : null}

        {selected.contract?.requiredArtifactKinds.length ? (
          <section className="neu-card mt-4 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-3">
            <h4 className="text-xs font-semibold text-[var(--ink-heading)]">Produces</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {selected.contract.requiredArtifactKinds.map((kind) => (
                <span
                  key={kind}
                  className="neu-chip inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)]"
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--botanical)]" />
                  {artifactKindLabel(kind)} artifact
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
              The finished product is attached to the message and stays in the chat where it was generated.
            </p>
          </section>
        ) : null}

        {selected.requirements?.length ? (
          <section className="neu-card mt-4 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-3">
            <h4 className="text-xs font-semibold text-[var(--ink-heading)]">Requirements</h4>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {selected.requirements
                .filter((item) => item.type !== "artifact")
                .map((item) => (
                  <li key={item.id} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
                    <span
                      aria-label={requirementStatusLabel(item.status)}
                      title={requirementStatusLabel(item.status)}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${requirementStatusClass(item.status)}`}
                    >
                      {requirementStatusIcon(item.status)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-xs font-medium text-[var(--ink-heading)]">
                        {item.label}
                        {!item.required ? <span className="ml-1 font-normal text-[var(--ink-muted)]">optional</span> : null}
                      </span>
                      {item.detail ? <span className="mt-0.5 block text-[11px] leading-4 text-[var(--ink-muted)]">{item.detail}</span> : null}
                    </span>
                    {item.action && item.status !== "satisfied" ? (
                      <button
                        type="button"
                        onClick={() => void satisfyRequirement(item)}
                        className="neu-button shrink-0 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--botanical)]"
                      >
                        {requirementActionLabel(item)}
                      </button>
                    ) : item.action === "use_opencode" && selected.installationStatus === "installed" ? (
                      <button
                        type="button"
                        onClick={() => void satisfyRequirement(item)}
                        className="neu-button shrink-0 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--botanical)]"
                      >
                        Use
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        {report ? (
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <h4 className="text-sm font-semibold text-[var(--ink-heading)]">Breadboard review</h4>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{report.riskSummary}</p>
            {report.risks.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--ink)]">{report.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-[var(--ink-heading)]">Requested capabilities</p>
                {report.requestedPermissions.length ? report.requestedPermissions.map((permission) => (
                  <label key={permission} className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={approvedPermissions.has(permission)} onChange={() => setApprovedPermissions((current) => toggleSet(current, permission))} />
                    {permission}
                  </label>
                )) : <p className="mt-1 text-xs text-[var(--ink-muted)]">None declared or derived.</p>}
                {report.discoveredScripts.length ? (
                  <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                    Scripts: {report.discoveredScripts.join(", ")}
                  </p>
                ) : null}
                {report.externalNetworkRequirements.length ? (
                  <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                    Network requirements: {report.externalNetworkRequirements.join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="text-xs text-[var(--ink-heading)]">
                <p className="font-medium">Runtime category</p>
                <p className="mt-1 text-[var(--ink-muted)]">
                  {report.classification.classification === "eligible_coding_conditional"
                    ? "Software implementation guidance. This skill always launches OpenCode in the connected repository and cannot widen its repository or permission boundary."
                    : "Reviewed local or knowledge-work guidance. The skill cannot widen Breadboard permissions."}
                </p>
              </div>
            </div>
            <details className="mt-3 border-t border-[var(--line)] pt-3">
              <summary className="cursor-pointer text-xs font-medium">Reviewed files and SHA-256 ({report.files.length})</summary>
              <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-[10px] text-[var(--ink-muted)]">{report.files.map((file) => <li key={file} className="break-all py-0.5">{file} · {report.fileHashes[file]}</li>)}</ul>
            </details>
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={actionBusy} type="button" onClick={() => void decideReview("reject")} className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium">Cancel</button>
              <button disabled={actionBusy || !report.integrityVerified || report.requestedPermissions.some((permission) => !approvedPermissions.has(permission))} type="button" onClick={() => void decideReview("promote")} className="neu-button-accent rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Approve and install</button>
            </div>
          </div>
        ) : detail?.detail ? (
          <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4 text-xs">
            <dl className="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-2">
              <dt className="text-[var(--ink-muted)]">Upstream ID</dt><dd className="break-all font-mono">{selected.upstreamId}</dd>
              <dt className="text-[var(--ink-muted)]">Upstream hash</dt><dd className="break-all font-mono">{detail.detail.hash ?? "Snapshot unavailable"}</dd>
              <dt className="text-[var(--ink-muted)]">Approved hash</dt><dd className="break-all font-mono">{selected.approvedHash ?? "Not approved"}</dd>
              <dt className="text-[var(--ink-muted)]">Install URL</dt><dd className="break-all">{selected.installUrl ?? "Not reported"}</dd>
              <dt className="text-[var(--ink-muted)]">Duplicate</dt><dd>{selected.duplicate ? "Marked duplicate upstream" : "No duplicate flag"}</dd>
              <dt className="text-[var(--ink-muted)]">State</dt><dd>{statusLabel(selected)}</dd>
            </dl>
            <div>
              <h4 className="font-medium text-[var(--ink-heading)]">Upstream audits</h4>
              {detail.audits?.length ? <ul className="mt-2 divide-y divide-[var(--line)]">{detail.audits.map((audit) => <li key={`${audit.provider}-${audit.auditedAt}`} className="py-2"><span className="font-medium">{audit.provider}: {audit.status}</span>{audit.riskLevel ? ` · ${audit.riskLevel}` : ""}{audit.summary ? <p className="mt-0.5 text-[var(--ink-muted)]">{audit.summary}</p> : null}</li>)}</ul> : <p className="mt-1 text-[var(--ink-muted)]">No upstream audit result was returned.</p>}
              {detail.auditError ? <p className="mt-1 text-[#9a6b19]">Audit endpoint: {detail.auditError}</p> : null}
              <p className="mt-1 text-[var(--ink-muted)]">Upstream audits do not replace Breadboard inspection or permission review.</p>
            </div>
            <details>
              <summary className="cursor-pointer font-medium">Files ({detail.detail.files?.length ?? 0})</summary>
              <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-[10px] text-[var(--ink-muted)]">{detail.detail.files?.map((file) => <li key={file.path} className="break-all py-0.5">{file.path}</li>) ?? <li>No upstream snapshot is available.</li>}</ul>
            </details>
            <div className="flex flex-wrap justify-end gap-2">
              {!isLocallyOwnedSkill(selected) && selected.installationStatus === "installed" ? <button disabled={actionBusy} type="button" onClick={() => void removeSkill()} className="neu-button-destructive rounded-lg border border-[#b87268] px-3 py-2 font-medium text-[#9a4438]">Remove</button> : null}
              {!isLocallyOwnedSkill(selected) && selected.availability !== "incompatible" ? <button disabled={actionBusy} type="button" onClick={() => void prepareReview()} className="neu-button-accent rounded-lg bg-[var(--botanical)] px-3 py-2 font-medium text-white">{selected.updateStatus === "update_available" ? "Review update" : selected.installationStatus === "installed" ? "Re-review" : "Review for install"}</button> : null}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  async function satisfyRequirement(item: SkillRequirement) {
    if (!selected || !item.action) return;
    if (item.action === "connect_mcp") {
      onOpenConnections?.(item.target);
      return;
    }
    if (item.action === "review_skill") {
      await prepareReview();
      return;
    }
    if (item.action === "use_opencode" || item.action === "connect_repository") {
      if (selected.installationStatus !== "installed") {
        setActionMessage("Review and install this skill before preparing it with OpenCode.");
        return;
      }
      if (onPrepareWithOpenCode) {
        onPrepareWithOpenCode(selected, item);
      } else {
        setActionMessage(
          "OpenCode setup is available from Terminal or a repository-connected Garden.",
        );
      }
      return;
    }
    if (item.action === "configure_environment" && item.target) {
      try {
        await navigator.clipboard.writeText(`${item.target}=`);
        setActionMessage(
          `Copied ${item.target}=. Add the value to dashboard/.env.local or your desktop environment, restart Breadboard, then refresh compatibility. Breadboard never stores the secret in the skill catalog.`,
        );
      } catch {
        setActionMessage(
          `Configure ${item.target} in dashboard/.env.local or your desktop environment, restart Breadboard, then refresh compatibility.`,
        );
      }
    }
  }

  const activeFilter = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];

  return (
    <section className="min-h-0" aria-label="skills.sh catalog">
      <div className="sticky top-0 z-10 bg-[var(--paper-raised)] px-3 pb-2 pt-3">
        <div className="flex gap-2">
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search every public skill" aria-label="Search skills.sh" className="neu-control min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]" />
          <div ref={filterMenuRootRef} className="relative shrink-0">
            <button
              ref={filterTriggerRef}
              type="button"
              onClick={() => filterMenuOpen ? closeFilterMenu() : openFilterMenu()}
              onKeyDown={onFilterTriggerKeyDown}
              aria-label={`Filter skills: ${activeFilter.label}`}
              aria-haspopup="menu"
              aria-expanded={filterMenuOpen}
              aria-controls={filterMenuId}
              title={`Filter skills: ${activeFilter.label}`}
              className={`neu-button-icon relative flex h-9 w-9 items-center justify-center rounded-lg border text-[var(--ink)] ${
                filter !== "all"
                  ? "neu-selected border-[var(--botanical)] bg-[var(--paper-strong)] text-[var(--botanical)]"
                  : "border-[var(--line)] bg-[var(--paper-raised)]"
              }`}
            >
              <FilterIcon />
              {filter !== "all" ? <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--botanical)]" /> : null}
            </button>
            {filterMenuOpen ? (
              <div
                id={filterMenuId}
                role="menu"
                aria-label="Filter skills"
                onKeyDown={onFilterMenuKeyDown}
                className="neu-popover absolute right-0 top-full z-30 mt-2 max-h-[min(24rem,calc(100dvh-8rem))] w-52 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-[var(--ink)]"
              >
                {FILTER_GROUPS.map((group, groupIndex) => (
                  <div
                    key={group.label}
                    role="group"
                    aria-label={group.label}
                    className={groupIndex ? "mt-1 border-t border-[var(--line)] pt-1" : undefined}
                  >
                    <p aria-hidden className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                      {group.label}
                    </p>
                    {group.filters.map((item) => {
                      const itemIndex = FILTERS.findIndex((candidate) => candidate.id === item.id);
                      const selectedFilter = filter === item.id;
                      return (
                        <button
                          key={item.id}
                          ref={(node) => { filterOptionRefs.current[itemIndex] = node; }}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selectedFilter}
                          tabIndex={filterMenuIndex === itemIndex ? 0 : -1}
                          onFocus={() => setFilterMenuIndex(itemIndex)}
                          onMouseEnter={() => setFilterMenuIndex(itemIndex)}
                          onClick={() => selectCatalogFilter(item.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--botanical)] ${
                            selectedFilter
                              ? "neu-selected bg-[var(--paper-surface)] font-medium text-[var(--ink-heading)]"
                              : "text-[var(--ink)] hover:bg-[var(--paper-strong)]"
                          }`}
                        >
                          <span>{item.label}</span>
                          {selectedFilter ? <span aria-hidden className="text-[var(--botanical)]">✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" disabled={refreshing} onClick={() => void refresh()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-50">{refreshing ? "Refreshing…" : "Refresh"}</button>
          <button type="button" onClick={() => setCreating(true)} className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--botanical)]">Create</button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--ink-muted)]" role="status">
          {catalogStatusText(status, pagination.total, query, refreshing, filter)}
          {status?.stale ? <span className="text-[#9a6b19]"> · Showing a stale last-known-good catalog{status.lastFailure ? ` · ${status.lastFailure}` : ""}</span> : null}
        </p>
        {error ? <p className="mt-2 rounded-md bg-[var(--paper-surface)] px-2 py-1.5 text-xs text-[#9a4438]">{error}</p> : null}
      </div>
      <div onKeyDown={onRowsKeyDown}>
        {loading ? <p className="px-3 py-8 text-center text-sm text-[var(--ink-muted)]">Loading skills…</p> : skills.length ? (
          <ul role="listbox" aria-label="Public skills" className="divide-y divide-[var(--line)]">
            {skills.map((skill, index) => {
              const identity = `skill:${skill.upstreamId}`;
              const highlightColor = highlightColors[identity]
                ?? (favoriteIds.includes(identity) ? DEFAULT_CAPABILITY_HIGHLIGHT_COLOR : null);
              return (
                <li key={skill.upstreamId} role="option" aria-selected={activeIndex === index}>
                  <div
                    className={`group flex items-center gap-2 ${activeIndex === index ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}`}
                    style={capabilityHighlightStyle(highlightColor)}
                  >
                    <button type="button" onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={(event) => void openSkill(skill, event.currentTarget)} className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)]">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{skill.command}</span>
                          <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">{skill.descriptionLoaded ? skill.description : "Loading description…"}</span>
                          <span className="mt-1 block break-all text-[10px] text-[var(--ink-muted)]">{skill.source} · {formatInstalls(skill.installs)} installs{skill.duplicate ? " · duplicate" : ""}</span>
                        </span>
                        <span className="shrink-0 pt-0.5 text-[10px] font-medium text-[var(--ink-muted)]">{rowAction(skill)}</span>
                      </span>
                    </button>
                    {onHighlightChange ? (
                      <FavoriteBox
                        color={highlightColor}
                        onColorChange={(color) => onHighlightChange(skill.upstreamId, color)}
                        label={`Choose ${skill.command} highlight color`}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">{query ? "No skills matched this search." : filter === "recent" ? "No recently used skills yet." : "No skills are available in this view."}</p>}
      </div>
      {!query && pagination.total > pagination.perPage ? (
        <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2 text-xs">
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-md px-2 py-1 disabled:opacity-30">Previous</button>
          <span className="text-[var(--ink-muted)]">{page * pagination.perPage + 1}–{Math.min((page + 1) * pagination.perPage, pagination.total)} of {pagination.total}</span>
          <button type="button" disabled={!pagination.hasMore} onClick={() => setPage((value) => value + 1)} className="rounded-md px-2 py-1 disabled:opacity-30">Next</button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Skills Breadboard ships or holds locally, with no skills.sh catalog record
 * behind them: `first-party` featured capabilities and `local-install` entries
 * that live only in the reviewed store. Neither has an upstream page to open,
 * a detail snapshot to fetch, or an update to re-review.
 */
function isLocallyOwnedSkill(skill: Pick<CatalogSkill, "sourceType">): boolean {
  return (
    skill.sourceType === "first-party" ||
    skill.sourceType === "local-install" ||
    // A distilled document has no upstream page and no review flow: it was
    // built here, from a file the user supplied.
    skill.sourceType === "document"
  );
}

function applyClientFilter(
  skills: CatalogSkill[],
  filter: CatalogFilter,
  recentSkillIds: string[] = [],
): CatalogSkill[] {
  if (filter === "recent") {
    const positions = new Map(recentSkillIds.map((id, index) => [id, index]));
    return skills
      .filter((skill) => positions.has(skill.upstreamId))
      .sort((left, right) => positions.get(left.upstreamId)! - positions.get(right.upstreamId)!);
  }
  if (filter === "featured") return skills.filter((skill) => skill.sourceType === "first-party");
  if (filter === "scientific") return skills.filter((skill) => skill.source === "k-dense-ai/scientific-agent-skills");
  if (filter === "reverse") return skills.filter((skill) => skill.source === "zhaoxuya520/reverse-skill");
  if (filter === "design") return skills.filter((skill) => skill.source === "emilkowalski/skills");
  if (filter === "engineering") return skills.filter((skill) => skill.source === "addyosmani/agent-skills");
  if (filter === "office") return skills.filter((skill) => skill.source === "iOfficeAI/OfficeCLI");
  if (filter === "documents") return skills.filter((skill) => skill.sourceType === "document");
  if (filter === "omh") return skills.filter((skill) => skill.source === "rlaope/oh-my-hermes");
  if (filter === "coding") {
    return skills.filter((skill) =>
      skill.requiresOpenCode === true ||
      skill.classification?.classification === "eligible_coding_conditional" ||
      skill.classification?.category?.toLowerCase() === "implementation"
    );
  }
  if (filter === "installed") return skills.filter((skill) => skill.installationStatus === "installed");
  if (filter === "updates") return skills.filter((skill) => skill.updateStatus === "update_available");
  if (filter === "official") return skills.filter((skill) => skill.curated || skill.sourceType?.toLowerCase() === "official");
  if (filter === "trending") return skills.filter((skill) => skill.rankTrending !== null);
  if (filter === "hot") return skills.filter((skill) => skill.rankHot !== null);
  if (filter === "audited") return skills.filter((skill) => Boolean(skill.audits?.length));
  if (filter === "unreviewed") return skills.filter((skill) => skill.reviewStatus === "unreviewed");
  return skills;
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function formatInstalls(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function rowAction(skill: CatalogSkill): string {
  if (
    skill.requiresOpenCode ||
    skill.classification?.classification ===
      "eligible_coding_conditional"
  ) {
    return skill.installationStatus === "installed"
      ? "OpenCode · installed"
      : "Coding agent required";
  }
  if (skill.sourceType === "first-party") return "Built in";
  if (skill.sourceType === "local-install") return "Installed";
  if (skill.upstreamStatus === "unlisted_upstream") return "Removed upstream";
  if (skill.updateStatus === "local_content_changed") return "Local content changed";
  if (skill.updateStatus === "upstream_unavailable") return "Upstream unavailable";
  if (skill.updateStatus === "update_available") return "Update available";
  if (skill.reviewStatus === "quarantined") return "Reviewing";
  if (skill.installationStatus === "installed") return "Installed";
  if (skill.availability === "needs_review") return "Needs compatibility";
  if (skill.availability && skill.availability !== "ready") return "Incompatible";
  return "Review";
}

function statusLabel(skill: CatalogSkill): string {
  return rowAction(skill);
}

function artifactKindLabel(kind: string): string {
  if (kind === "html") return "Web page";
  if (kind === "document") return "Word document";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function requirementStatusLabel(status: SkillRequirement["status"]): string {
  if (status === "satisfied") return "Ready";
  if (status === "action_required") return "Setup required";
  if (status === "unsupported") return "Unsupported";
  return "Information";
}

function requirementStatusIcon(status: SkillRequirement["status"]): string {
  if (status === "satisfied") return "✓";
  if (status === "action_required") return "!";
  if (status === "unsupported") return "×";
  return "i";
}

function requirementStatusClass(status: SkillRequirement["status"]): string {
  if (status === "satisfied") {
    return "border-[var(--botanical)]/40 bg-[var(--paper-raised)] text-[var(--botanical)]";
  }
  if (status === "action_required") {
    return "border-[#c99a59]/50 bg-[#fff7e8] text-[#9a6b19]";
  }
  if (status === "unsupported") {
    return "border-[#b87268]/50 bg-[#fff1ed] text-[#9a4438]";
  }
  return "border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink-muted)]";
}

function requirementActionLabel(item: SkillRequirement): string {
  if (item.action === "connect_mcp") return "Connect";
  if (item.action === "configure_environment") return "Set up";
  if (item.action === "review_skill") return "Review";
  if (item.action === "connect_repository") return "Connect repo";
  return "Use OpenCode";
}

function catalogStatusText(status: CatalogStatus | null, total: number, query: string, refreshing: boolean, filter: CatalogFilter): string {
  if (refreshing || status?.synchronizing) return `Synchronizing skills.sh · ${total.toLocaleString()} currently shown`;
  if (!status) return query ? `${total.toLocaleString()} search results` : `${total.toLocaleString()} skills`;
  const updated = status.lastSuccessfulSyncAt ? new Date(status.lastSuccessfulSyncAt).toLocaleString() : "never";
  const count = query ? total : filter === "all" ? status.totalAvailable || total : total;
  const filterLabel = FILTERS.find((item) => item.id === filter)?.label ?? "filtered";
  const label = query ? "search results" : filter === "all" ? "public skills" : `${filterLabel} skills`;
  return `${count.toLocaleString()} ${label} · last synchronized ${updated}`;
}

function FilterIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}
