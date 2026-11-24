"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { documentUploadTimeTitle, formatDocumentUploadTime } from "@/lib/document-upload-time";
import NavigationLink from "@/app/components/navigation-link";
import SpacesFileBadge from "@/app/spaces/spaces-file-badge";
import type { GardenFileEntry } from "@/lib/garden-files/types";
import { officeKind, spacesEditHref, spacesKindForPath, type OfficeFile } from "@/lib/office/types";

/** What the + menu makes here; Whiteboard is an AFFiNE page opened as a canvas. */
const MAKE = [
  { kind: "docx", label: "Doc" }, { kind: "xlsx", label: "Sheet" }, { kind: "pptx", label: "Slides" },
  { kind: "affine", label: "Page" }, { kind: "affine", label: "Whiteboard", whiteboard: true },
  { kind: "png", label: "Design" }, { kind: "mp4", label: "Video" }, { kind: "md", label: "Markdown" },
] as const;

/**
 * A Garden workspace's Spaces: the documents, pages, whiteboards, designs and videos kept in this
 * Garden, below Video & audio. Everything opens in Spaces' full-page editors with Bread in the corner,
 * and each file's Quartz note appears in this Garden's notes.
 */
/**
 * `selection` ties a row's selector to the Documents selection: a Spaces file is mirrored into a
 * source note, and selecting the row selects that note for chat, as a Documents row does.
 */
export default function GardenSpacesSection({ clusterSlug, selection }: {
  clusterSlug: string;
  selection?: { slugFor: (path: string) => string | undefined; selected: readonly string[]; toggle: (slug: string) => void };
}) {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<OfficeFile[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState("");
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null), retryTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/office/files?garden=${encodeURIComponent(clusterSlug)}`, { cache: "no-store" });
      const body = await response.json() as { files?: OfficeFile[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Spaces could not be loaded.");
      setFiles(body.files ?? []); setError("");
    } catch {
      // A dropped connection retries by itself; a list already shown stays, only a first load says so.
      setFiles(current => { if (current === null) setError("Spaces could not be loaded yet. Trying again…"); return current ?? []; });
      window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => void load(), 3_000);
    }
  }, [clusterSlug]);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("sb:garden-file-updated", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("sb:garden-file-updated", refresh); };
  }, [load]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const make = async (item: (typeof MAKE)[number]) => {
    setMenu(false); setBusy(true); setError("");
    try {
      if (item.kind === "mp4") { location.href = `/spaces/edit?${new URLSearchParams({ garden: clusterSlug, app: "video", title: "Untitled video" })}`; return; }
      const response = await fetch("/api/office/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, gardenId: clusterSlug, title: "", whiteboard: "whiteboard" in item && item.whiteboard }),
      });
      const body = await response.json() as { file?: GardenFileEntry; error?: string };
      if (!response.ok || !body.file) throw new Error(body.error || "The file could not be created.");
      location.href = spacesEditHref(body.file);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be created."); }
    finally { setBusy(false); }
  };

  const remove = async (file: OfficeFile) => {
    if (!window.confirm(`Move ${file.name} to the trash?`)) return;
    setDeleting(file.id); setError("");
    try {
      const response = await fetch(`/api/gardens/${encodeURIComponent(file.gardenId)}/files/${encodeURIComponent(file.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "trash", revision: file.revision }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "The file could not be deleted.");
      setFiles(current => current?.filter(item => item.id !== file.id) ?? current);
      window.dispatchEvent(new Event("sb:garden-file-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be deleted."); }
    finally { setDeleting(""); }
  };

  const needle = query.trim().toLowerCase();
  const shown = files?.filter(file => !needle || `${file.name} ${file.path}`.toLowerCase().includes(needle)) ?? [];

  return <div className="border-t border-gray-800 shrink-0">
    <div className={`bb-neu-accordion flex w-full items-center text-xs font-medium text-gray-500 transition-colors hover:text-white ${expanded ? "bb-neu-accordion-open" : ""}`}>
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left focus-visible:outline-none"
        aria-expanded={expanded} aria-controls="garden-spaces-items">
        <LayoutGrid className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
        Spaces{files?.length ? ` (${files.length})` : ""}
      </button>
      <div ref={menuRef} className="relative flex shrink-0 items-center gap-1.5 pr-4">
        <button type="button" onClick={() => setMenu(value => !value)} disabled={busy}
          className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:text-[var(--botanical)] disabled:opacity-50"
          aria-haspopup="menu" aria-expanded={menu} aria-label="Make something in Spaces" title="Make a doc, page, whiteboard, design or video">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <button type="button" onClick={() => setExpanded(value => !value)} className="-m-1 p-1 text-gray-600 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-[var(--botanical)]"
          aria-label={expanded ? "Collapse Spaces" : "Expand Spaces"} aria-expanded={expanded} aria-controls="garden-spaces-items">
          <svg className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
        </button>
        {menu && <ul role="menu" className="absolute right-3 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-gray-700 bg-gray-950 py-1 text-xs shadow-xl"
          onKeyDown={event => { if (event.key === "Escape") setMenu(false); }}>
          {MAKE.map((item, index) => {
            const info = officeKind(item.kind)!;
            return <li key={item.label} role="none">
              <button type="button" role="menuitem" autoFocus={index === 0} onClick={() => void make(item)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-gray-300 hover:bg-gray-800 hover:text-white focus-visible:bg-gray-800 focus-visible:outline-none">
                <SpacesFileBadge info={info} whiteboard={"whiteboard" in item} size={22} />
                {item.label}
              </button>
            </li>;
          })}
        </ul>}
      </div>
    </div>
    {expanded && <div id="garden-spaces-items" className="bb-neu-accordion-panel border-t border-gray-800">
      {error && <p role="alert" className="px-4 py-3 text-[11px] text-red-300">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>}
      {files === null ? <p className="px-4 py-3 text-[11px] text-gray-600">Loading…</p>
        : !files.length ? <p className="px-4 py-3 text-[11px] leading-relaxed text-gray-600">Docs, pages, whiteboards, designs and videos made for this garden show up here. Use + to make one.</p>
        // The same row as Documents: selector, name with its file type, then kind and time, between dividers.
        : <>
        <SpacesSearch value={query} onChange={setQuery} />
        <ul className="pt-1 pb-2">
          {!shown.length && <li className="px-4 py-2 text-[11px] text-gray-600">No Spaces files match “{query.trim()}”.</li>}
          {shown.slice(0, 50).map(file => {
            const info = spacesKindForPath(file.path);
            const slug = selection?.slugFor(file.path), selected = !!slug && !!selection?.selected.includes(slug);
            return <li key={file.id} className={`group flex items-start gap-2.5 border-b border-gray-800/50 px-3 py-2 transition-colors last:border-b-0 ${selected ? "border-l-2 border-l-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_8%,transparent)]" : ""}`}>
              <button type="button" disabled={!slug} onClick={() => slug && selection?.toggle(slug)} aria-pressed={selected}
                aria-label={slug ? (selected ? `Selected for chat; remove ${file.name}` : `Select ${file.name} for chat`) : `${file.name} is not ready for chat yet`}
                title={slug ? (selected ? "Selected for chat; click to remove." : "Click to select for chat.") : "Not ready for chat yet."}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-700 bg-gray-950 transition-[border-color,transform] duration-150 hover:border-gray-500 active:scale-[0.96] disabled:cursor-default disabled:opacity-50">
                <span className="relative flex h-3 w-3 items-center justify-center rounded-sm border border-gray-800">
                  {selected && <svg className="pointer-events-none absolute inset-0 h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m2 6.25 2.6 2.6L10 3.35" stroke="rgb(3 7 18)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" /><path d="m2 6.25 2.6 2.6L10 3.35" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <NavigationLink href={spacesEditHref(file)} label={file.name} prefetch={false}
                  className="block truncate text-xs font-medium text-gray-300 transition-colors hover:text-white">{file.name}</NavigationLink>
                <p className="mt-0.5 text-[10px] text-gray-600" title={documentUploadTimeTitle(file.updatedAt)}>
                  {info ? info.noun.charAt(0).toUpperCase() + info.noun.slice(1) : "File"} &middot; {formatDocumentUploadTime(file.updatedAt).replace(/^Uploaded/, "Edited")}
                </p>
              </div>
              <button type="button" onClick={() => void remove(file)} disabled={deleting === file.id} title={`Move ${file.name} to the trash`} aria-label={`Delete ${file.name}`}
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-700 opacity-60 transition-colors hover:bg-red-950/40 hover:text-red-300 hover:opacity-100 disabled:cursor-wait">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
              </button>
            </li>;
          })}
          {files.length > 50 && !needle && <li><NavigationLink href="/spaces" label="All in Spaces" prefetch={false} className="block px-4 py-2 text-[11px] text-gray-500 hover:text-white">All {files.length} in Spaces</NavigationLink></li>}
        </ul></>}
    </div>}
  </div>;
}

/** The Documents search field, shared by Spaces and the workspace's Artifacts tab. */
export function SpacesSearch({ value, onChange, placeholder = "Search Spaces", label = "Search Spaces files" }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <div className="border-b border-gray-800 px-3 py-2">
    <div className="relative">
      <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={label}
        className="neu-control h-8 w-full rounded-md border border-gray-800 bg-gray-950 pl-8 pr-8 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600" />
      {value && <button type="button" onClick={() => onChange("")} title="Clear search" aria-label="Clear search"
        className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-800 hover:text-white">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>}
    </div>
  </div>;
}
