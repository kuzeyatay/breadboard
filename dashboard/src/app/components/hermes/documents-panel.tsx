"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { gardenDocumentHref } from "@/lib/garden-document-route";
import { gardenSourceDisplay } from "@/lib/garden-source-display";

/** A source document uploaded to one of the person's gardens. */
export interface GardenDocument {
  gardenSlug: string;
  gardenName: string;
  slug: string;
  relPath: string;
  type: string;
  title: string;
  description: string;
  sourceType: string;
  sourceFile: string;
  sourcePdf: string;
  sourceMedia: string;
  date: string;
}

/** Composer identity for an attached garden document. */
export function gardenDocumentKey(doc: Pick<GardenDocument, "gardenSlug" | "slug">): string {
  return `garden-document:${doc.gardenSlug}/${doc.slug}`;
}

/** Download a garden document the same way "copy from another garden" does. */
export async function gardenDocumentFile(doc: GardenDocument): Promise<File> {
  const query = `clusterSlug=${encodeURIComponent(doc.gardenSlug)}`;
  const base = (gardenSourceDisplay({ ...doc, name: doc.title }).title || doc.slug)
    .replace(/[\\/:*?"<>|]+/g, " ").trim() || doc.slug;
  if (doc.sourcePdf) {
    const res = await fetch(`/api/documents/${encodeURIComponent(doc.slug)}/source-pdf?${query}`);
    if (!res.ok) throw new Error(`Could not download ${base}.`);
    const name = doc.sourcePdf.split(/[\\/]/).pop() || `${base}.pdf`;
    return new File([await res.blob()], name, { type: "application/pdf" });
  }
  const res = await fetch(`/api/documents/${encodeURIComponent(doc.slug)}?${query}`);
  const data = (await res.json().catch(() => ({}))) as { content?: unknown };
  if (!res.ok || typeof data.content !== "string") throw new Error(`Could not read ${base}.`);
  return new File([data.content], `${base.replace(/\.[a-z0-9]+$/i, "")}.md`, { type: "text/markdown" });
}

type Kind = "all" | "pdf" | "other";
type Sort = "newest" | "oldest" | "name";

function kindOf(doc: GardenDocument): "pdf" | "other" {
  return doc.sourcePdf || doc.sourceType.toLowerCase() === "pdf" ? "pdf" : "other";
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";
}

interface Props {
  attachedKeys: ReadonlySet<string>;
  attachingKeys: ReadonlySet<string>;
  onToggleAttachment: (doc: GardenDocument) => void;
}

export default function DocumentsPanel({ attachedKeys, attachingKeys, onToggleAttachment }: Props) {
  const [documents, setDocuments] = useState<GardenDocument[]>([]);
  const [gardens, setGardens] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [garden, setGarden] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clusters", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { clusters?: { slug: string; name: string }[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Gardens could not be loaded.");
      const clusters = (data.clusters ?? []).map(({ slug, name }) => ({ slug, name }));
      setGardens(clusters);
      // ponytail: one request per garden; add a cross-garden endpoint if garden counts grow large.
      const perGarden = await Promise.all(clusters.map(async (cluster) => {
        try {
          const r = await fetch(`/api/documents?clusterSlug=${encodeURIComponent(cluster.slug)}`, { cache: "no-store" });
          const d = (await r.json().catch(() => ({}))) as { documents?: Omit<GardenDocument, "gardenSlug" | "gardenName">[] };
          return (d.documents ?? [])
            .filter((doc) => doc.type === "source-document" && !doc.sourceMedia)
            .map((doc) => ({ ...doc, gardenSlug: cluster.slug, gardenName: cluster.name }));
        } catch {
          return [];
        }
      }));
      setDocuments(perGarden.flat());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    const rows = documents.filter((doc) => {
      if (garden && doc.gardenSlug !== garden) return false;
      if (kind !== "all" && kindOf(doc) !== kind) return false;
      if (!needle) return true;
      return [doc.title, doc.sourceFile, doc.description, doc.gardenName]
        .some((field) => field?.toLowerCase().includes(needle));
    });
    const title = (doc: GardenDocument) => gardenSourceDisplay({ ...doc, name: doc.title }).title;
    const time = (doc: GardenDocument) => Date.parse(doc.date) || 0;
    return rows.sort((a, b) =>
      sort === "name" ? title(a).localeCompare(title(b))
        : sort === "newest" ? time(b) - time(a)
          : time(a) - time(b),
    );
  }, [documents, garden, kind, needle, sort]);

  const selectClass =
    "neu-control min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2 py-1 text-xs text-[var(--ink)] outline-none focus:border-[var(--botanical)]";

  return (
    <section
      aria-label="Documents"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink-heading)]">Documents</h3>
          <p className="text-[10px] text-[var(--ink-muted)]">
            {visible.length === documents.length ? documents.length : `${visible.length} of ${documents.length}`} across your gardens
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="neu-button rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-2 border-b border-[var(--line)] bg-[var(--paper-surface)] p-2.5">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search documents"
          aria-label="Search documents"
          autoComplete="off"
          spellCheck={false}
          className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:ring-2 focus:ring-[var(--botanical)]/15"
        />
        <div className="flex gap-2">
          <select aria-label="Filter by garden" value={garden} onChange={(e) => setGarden(e.target.value)} className={selectClass}>
            <option value="">All gardens</option>
            {gardens.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
          </select>
          <select aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={selectClass}>
            <option value="all">All types</option>
            <option value="pdf">PDF</option>
            <option value="other">Other</option>
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selectClass}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="px-3 py-4 text-xs text-[#9a4438]">{error}</p> : null}
        {loading && documents.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-[var(--ink-muted)]">Loading documents…</p>
        ) : visible.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              {documents.length === 0 ? "No documents yet" : "No document matches that"}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Documents you upload to a garden show up here.
            </p>
          </div>
        ) : (
          <ul>
            {visible.map((doc) => {
              const key = gardenDocumentKey(doc);
              const attached = attachedKeys.has(key);
              const attaching = attachingKeys.has(key);
              const display = gardenSourceDisplay({ ...doc, name: doc.title });
              const href = gardenDocumentHref(doc.gardenSlug, doc);
              return (
                <li
                  key={key}
                  className={`group flex items-center border-b border-[color-mix(in_srgb,var(--line)_60%,transparent)] transition hover:bg-[var(--paper-strong)] ${
                    attached
                      ? "border-l-2 border-l-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_8%,transparent)]"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onToggleAttachment(doc)}
                    disabled={attaching || (!attached && attachingKeys.size > 0)}
                    aria-pressed={attached}
                    title={attached ? "In chat; click to remove" : "Click to add to chat"}
                    className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--botanical)]"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        attached ? "border-[var(--botanical)] bg-[var(--botanical)] text-white" : "border-[var(--line)]"
                      }`}
                    >
                      {attaching ? "…" : attached ? (
                        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                          <path d="m2 6.25 2.6 2.6L10 3.35" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[var(--ink)]" title={display.title}>{display.title}</span>
                      {display.description ? (
                        <span className="line-clamp-2 block text-[10px] leading-4 text-[var(--ink-muted)]">{display.description}</span>
                      ) : null}
                      <span className="block truncate text-[10px] text-[var(--ink-muted)]">
                        {doc.gardenName}{kindOf(doc) === "pdf" ? ", PDF" : ""}{formatDate(doc.date) ? `, ${formatDate(doc.date)}` : ""}
                      </span>
                    </span>
                  </button>
                  <a
                    href={href}
                    title={display.hasPdf ? "Open PDF viewer" : "Open note"}
                    aria-label={`Open ${display.title}`}
                    className="mr-3 shrink-0 rounded p-1 text-[var(--ink-muted)] opacity-0 transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
