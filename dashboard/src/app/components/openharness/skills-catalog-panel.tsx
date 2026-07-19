"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import SkillCreatorPanel from "./skill-creator-panel";

type CatalogFilter = "all" | "trending" | "hot" | "official" | "installed" | "updates";

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
  runtimeSessionId: number | null;
  onUse: (skill: CatalogSkill) => void;
  onInstalledChange?: () => void | Promise<void>;
}

const FILTERS: Array<{ id: CatalogFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "trending", label: "Trending" },
  { id: "hot", label: "Hot" },
  { id: "official", label: "Official" },
  { id: "installed", label: "Installed" },
  { id: "updates", label: "Updates" },
];

export default function SkillsCatalogPanel({
  runtimeSessionId,
  onUse,
  onInstalledChange,
}: Props) {
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [skills, setSkills] = useState<CatalogSkill[]>([]);
  const [pagination, setPagination] = useState({ page: 0, perPage: 50, total: 0, hasMore: false });
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogSkill | null>(null);
  const [detail, setDetail] = useState<SkillDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [report, setReport] = useState<QuarantineReport | null>(null);
  const [approvedPermissions, setApprovedPermissions] = useState<Set<string>>(new Set());
  const [reviewClass, setReviewClass] = useState<"eligible_general" | "eligible_coding_conditional">("eligible_general");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), query.trim() ? 280 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page, query]);

  useEffect(() => setActiveIndex((value) => Math.min(value, Math.max(0, skills.length - 1))), [skills.length]);

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const parameters = new URLSearchParams({ filter, page: String(page), perPage: "50" });
      if (query.trim()) parameters.set("q", query.trim());
      const endpoint = query.trim()
        ? `/api/openharness/skills/search?q=${encodeURIComponent(query.trim())}`
        : `/api/openharness/skills?${parameters}`;
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as CatalogResponse & { stale?: boolean };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "The skills catalog is unavailable.");
      let nextSkills = Array.isArray(payload.skills) ? payload.skills : [];
      if (query.trim() && filter !== "all") nextSkills = applyClientFilter(nextSkills, filter);
      setSkills(nextSkills);
      setPagination(payload.pagination ?? {
        page: 0,
        perPage: nextSkills.length,
        total: nextSkills.length,
        hasMore: false,
      });
      if (payload.status) setStatus(payload.status);
      else if (payload.stale) setStatus((current) => current ? { ...current, stale: true } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The skills catalog is unavailable.");
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/openharness/skills", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Catalog refresh failed.");
      await loadCatalog();
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
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/openharness/skills/detail?id=${encodeURIComponent(skill.upstreamId)}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as SkillDetailResponse;
      if (!response.ok && !payload.cached) throw new Error(payload.message ?? payload.error ?? "Skill details are unavailable.");
      setDetail(payload);
      if (payload.skill) setSelected(payload.skill);
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
      const response = await fetch("/api/openharness/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstreamId: selected.upstreamId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { report?: QuarantineReport; message?: string; error?: string };
      if (!response.ok || !payload.report) throw new Error(payload.message ?? payload.error ?? "The skill could not enter review.");
      setReport(payload.report);
      setApprovedPermissions(new Set());
      setReviewClass(payload.report.classification.classification === "eligible_coding_conditional" ? "eligible_coding_conditional" : "eligible_general");
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
      const response = await fetch("/api/openharness/skills/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: report.name,
          decision,
          runtimeSessionId,
          approvedPermissions: [...approvedPermissions],
          classificationOverride: reviewClass,
          overwrite: selected.installationStatus === "installed",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Could not ${decision} the skill.`);
      setReport(null);
      setActionMessage(decision === "promote" ? "Approved revision installed. The slash command is ready." : "Quarantined revision removed.");
      await onInstalledChange?.();
      await loadCatalog();
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
      const response = await fetch("/api/openharness/skills/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstreamId: selected.upstreamId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "The skill could not be removed.");
      await onInstalledChange?.();
      closeDetails();
      await loadCatalog();
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
        onInstalledChange={onInstalledChange}
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
            <p className="mt-1 text-sm text-[var(--ink)]">{detail?.skill?.description ?? selected.description}</p>
            <p className="mt-1 break-all text-xs text-[var(--ink-muted)]">{selected.source} · {formatInstalls(selected.installs)} installs</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.installationStatus === "installed" ? (
              <button type="button" onClick={() => onUse(selected)} className="neu-button-accent rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white">Use {selected.command}</button>
            ) : null}
            <a href={selected.pageUrl ?? `https://skills.sh/${selected.source}/${selected.slug}`} target="_blank" rel="noreferrer" className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink)]">Open source</a>
          </div>
        </div>

        {detailLoading ? <p role="status" className="mt-5 text-sm text-[var(--ink-muted)]">Loading official files and audits…</p> : null}
        {actionMessage ? <p role="status" className="mt-4 rounded-lg bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]">{actionMessage}</p> : null}

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
              </div>
              <label className="text-xs font-medium text-[var(--ink-heading)]">Runtime category
                <select value={reviewClass} onChange={(event) => setReviewClass(event.target.value as typeof reviewClass)} className="neu-control mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-2 text-xs">
                  <option value="eligible_general">General guidance</option>
                  <option value="eligible_coding_conditional">Coding guidance (permissions still task-scoped)</option>
                </select>
              </label>
            </div>
            <details className="mt-3 border-t border-[var(--line)] pt-3">
              <summary className="cursor-pointer text-xs font-medium">Reviewed files and SHA-256 ({report.files.length})</summary>
              <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-[10px] text-[var(--ink-muted)]">{report.files.map((file) => <li key={file} className="break-all py-0.5">{file} · {report.fileHashes[file]}</li>)}</ul>
            </details>
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={actionBusy} type="button" onClick={() => void decideReview("reject")} className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium">Cancel</button>
              <button disabled={actionBusy || !report.integrityVerified} type="button" onClick={() => void decideReview("promote")} className="neu-button-accent rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Approve and install</button>
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
              {selected.installationStatus === "installed" ? <button disabled={actionBusy} type="button" onClick={() => void removeSkill()} className="neu-button-destructive rounded-lg border border-[#b87268] px-3 py-2 font-medium text-[#9a4438]">Remove</button> : null}
              <button disabled={actionBusy} type="button" onClick={() => void prepareReview()} className="neu-button-accent rounded-lg bg-[var(--botanical)] px-3 py-2 font-medium text-white">{selected.updateStatus === "update_available" ? "Review update" : selected.installationStatus === "installed" ? "Re-review" : "Review for install"}</button>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="min-h-0" aria-label="skills.sh catalog">
      <div className="sticky top-0 z-10 bg-[var(--paper-raised)] px-3 pb-2 pt-3">
        <div className="flex gap-2">
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search every public skill" aria-label="Search skills.sh" className="neu-control min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]" />
          <button type="button" disabled={refreshing} onClick={() => void refresh()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-50">{refreshing ? "Refreshing…" : "Refresh"}</button>
          <button type="button" onClick={() => setCreating(true)} className="neu-button rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--botanical)]">Create</button>
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="Skill catalog views">
          {FILTERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => { setFilter(item.id); setPage(0); }} className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs ${filter === item.id ? "neu-selected bg-[var(--paper-strong)] font-medium text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}>{item.label}</button>)}
        </div>
        <p className="mt-2 text-[10px] text-[var(--ink-muted)]" role="status">{catalogStatusText(status, pagination.total, query, refreshing)}</p>
        {status?.stale ? <p className="mt-1 text-[10px] text-[#9a6b19]">Showing a stale last-known-good catalog{status.lastFailure ? ` · ${status.lastFailure}` : ""}</p> : null}
        {error ? <p className="mt-2 rounded-md bg-[var(--paper-surface)] px-2 py-1.5 text-xs text-[#9a4438]">{error}</p> : null}
      </div>
      <div onKeyDown={onRowsKeyDown}>
        {loading ? <p className="px-3 py-8 text-center text-sm text-[var(--ink-muted)]">Loading skills…</p> : skills.length ? (
          <ul role="listbox" aria-label="Public skills" className="divide-y divide-[var(--line)]">
            {skills.map((skill, index) => (
              <li key={skill.upstreamId} role="option" aria-selected={activeIndex === index}>
                <button type="button" onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={(event) => void openSkill(skill, event.currentTarget)} className={`w-full px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] ${activeIndex === index ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-sm font-medium text-[var(--ink-heading)]">{skill.command}</span>
                      <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink)]">{skill.description}</span>
                      <span className="mt-1 block break-all text-[10px] text-[var(--ink-muted)]">{skill.source} · {formatInstalls(skill.installs)} installs{skill.duplicate ? " · duplicate" : ""}</span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[10px] font-medium text-[var(--ink-muted)]">{rowAction(skill)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-10 text-center text-sm text-[var(--ink-muted)]">{query ? "No skills matched this search." : "No skills are available in this view."}</p>}
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

function applyClientFilter(skills: CatalogSkill[], filter: CatalogFilter): CatalogSkill[] {
  if (filter === "installed") return skills.filter((skill) => skill.installationStatus === "installed");
  if (filter === "updates") return skills.filter((skill) => skill.updateStatus === "update_available");
  if (filter === "official") return skills.filter((skill) => skill.curated || skill.sourceType?.toLowerCase() === "official");
  if (filter === "trending") return skills.filter((skill) => skill.rankTrending !== null);
  if (filter === "hot") return skills.filter((skill) => skill.rankHot !== null);
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
  if (skill.upstreamStatus === "unlisted_upstream") return "Removed upstream";
  if (skill.updateStatus === "local_content_changed") return "Local content changed";
  if (skill.updateStatus === "upstream_unavailable") return "Upstream unavailable";
  if (skill.updateStatus === "update_available") return "Update available";
  if (skill.reviewStatus === "quarantined") return "Reviewing";
  if (skill.installationStatus === "installed") return "Installed";
  return "Review";
}

function statusLabel(skill: CatalogSkill): string {
  return rowAction(skill);
}

function catalogStatusText(status: CatalogStatus | null, total: number, query: string, refreshing: boolean): string {
  if (refreshing || status?.synchronizing) return `Synchronizing skills.sh · ${total.toLocaleString()} currently shown`;
  if (!status) return query ? `${total.toLocaleString()} search results` : `${total.toLocaleString()} skills`;
  const updated = status.lastSuccessfulSyncAt ? new Date(status.lastSuccessfulSyncAt).toLocaleString() : "never";
  return `${query ? total : status.totalAvailable || total.toLocaleString()} ${query ? "search results" : "public skills"} · last synchronized ${updated}`;
}
