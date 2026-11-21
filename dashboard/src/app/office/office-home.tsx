"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Folder, FolderOpen, Search, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { gardenFileApi, type GardenFileEntry } from "@/lib/garden-files/types";
import { OFFICE_FOLDER, OFFICE_KINDS, officeKindForName, type OfficeFile, type OfficeKindInfo, type OfficeTab, type OfficeWorkspace } from "@/lib/office/types";
import styles from "./office.module.css";

const TABS: { id: "all" | OfficeTab; label: string }[] = [
  { id: "all", label: "All" }, { id: "docs", label: "Docs" }, { id: "sheets", label: "Sheets" }, { id: "slides", label: "Slides" },
  { id: "pdf", label: "PDF" }, { id: "markdown", label: "Markdown" }, { id: "html", label: "HTML" },
];
const STAR_KEY = "breadboard:office:starred";
const WORKSPACE_KEY = "breadboard:office:workspace";
const ACCEPT = OFFICE_KINDS.flatMap(info => info.extensions.map(ext => `.${ext}`)).join(",");

function readStorage(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* starring still works for this visit */ } }

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function modified(iso: string): string {
  const date = new Date(iso), days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1 && date.getDate() === new Date().getDate()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days < 2) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function Badge({ info, size = 30 }: { info: OfficeKindInfo; size?: number }) {
  return <span className={styles.badge} style={{ background: info.color, width: size, height: size, fontSize: info.badge.length > 1 ? size * .3 : size * .45 }} aria-hidden="true">{info.badge}</span>;
}

export default function OfficeHome({ userName }: { userName: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<OfficeFile[] | null>(null);
  const [workspaces, setWorkspaces] = useState<OfficeWorkspace[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [view, setView] = useState<"recent" | "starred" | { garden: string }>("recent");
  const [tab, setTab] = useState<"all" | OfficeTab>("all");
  const [query, setQuery] = useState("");
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<OfficeKindInfo | null>(null);
  const [title, setTitle] = useState(""), [brief, setBrief] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), upload = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const body = await request<{ files: OfficeFile[]; workspaces: OfficeWorkspace[] }>("/api/office/files");
      setFiles(body.files); setWorkspaces(body.workspaces);
      setWorkspace(current => {
        const remembered = current || readStorage(WORKSPACE_KEY) || "";
        return body.workspaces.some(w => w.slug === remembered) ? remembered : body.workspaces[0]?.slug ?? "";
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your documents could not be loaded."); setFiles(current => current ?? []); }
  }, []);

  useEffect(() => {
    void load();
    try { setStarred(new Set(JSON.parse(readStorage(STAR_KEY) ?? "[]") as string[])); } catch { /* no stars yet */ }
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load]);

  const chooseWorkspace = (slug: string) => { setWorkspace(slug); writeStorage(WORKSPACE_KEY, slug); };

  const toggleStar = (id: string) => setStarred(current => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    writeStorage(STAR_KEY, JSON.stringify([...next]));
    return next;
  });

  /** Office documents need a Garden to live in; a first-time user gets one made for them. */
  const targetWorkspace = async (): Promise<string> => {
    if (workspace) return workspace;
    const body = await request<{ slug: string }>("/api/clusters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Office", description: "Documents, spreadsheets and slides made in Office." }) });
    setWorkspaces(current => [...current, { slug: body.slug, name: "Office" }]);
    chooseWorkspace(body.slug);
    return body.slug;
  };

  const open = (file: { id: string; gardenId: string; name: string }, ask?: string) => {
    const params = new URLSearchParams({ file: file.id, fileGarden: file.gardenId });
    // Bread writes the document itself; anything else opens straight into its editor.
    if (ask) params.set("ask", ask); else params.set("edit", "1");
    router.push(`/garden/${encodeURIComponent(file.gardenId)}?${params}`);
  };

  const startCreate = (info: OfficeKindInfo) => { setCreating(info); setTitle(""); setBrief(""); setError(""); dialog.current?.showModal(); };

  const create = async (withBread: boolean) => {
    if (!creating || busy) return;
    setBusy(true); setError("");
    try {
      const gardenId = await targetWorkspace();
      const { file } = await request<{ file: GardenFileEntry }>("/api/office/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: creating.kind, gardenId, title: title.trim() || (withBread ? brief.trim().split(/\s+/).slice(0, 6).join(" ") : "") }),
      });
      dialog.current?.close();
      const ask = withBread
        ? `Write this ${creating.noun}${brief.trim() ? `: ${brief.trim()}` : ""}.\n\nIt is the Office file "${file.name}" in this Garden. When it is finished, save it back into that file with garden_save_file (gardenId ${file.gardenId}, fileId ${file.id}).`
        : undefined;
      open(file, ask);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The document could not be created."); }
    finally { setBusy(false); }
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length || busy) return;
    setBusy(true); setError("");
    try {
      const gardenId = await targetWorkspace();
      let last: GardenFileEntry | null = null;
      for (const item of Array.from(list)) {
        if (!officeKindForName(item.name)) throw new Error(`${item.name} is not a document Office opens.`);
        ({ file: last } = await request<{ file: GardenFileEntry }>(gardenFileApi(gardenId), {
          method: "POST", body: item,
          headers: { "x-file-path": encodeURIComponent(`${OFFICE_FOLDER}/${item.name}`), "x-file-size": String(item.size) },
        }));
      }
      if (list.length === 1 && last) open(last); else await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be added."); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  };

  const trash = async (file: OfficeFile) => {
    if (!window.confirm(`Move ${file.name} to the Garden's trash?`)) return;
    try {
      await request(gardenFileApi(file.gardenId, file.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "trash", revision: file.revision }) });
      setFiles(current => current?.filter(entry => entry.id !== file.id) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be moved to trash."); }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (files ?? []).filter(file =>
      (view === "recent" || (view === "starred" ? starred.has(file.id) : file.gardenId === view.garden)) &&
      (tab === "all" || file.tab === tab) &&
      (!needle || file.name.toLowerCase().includes(needle) || file.gardenName.toLowerCase().includes(needle)));
  }, [files, view, tab, query, starred]);

  const firstName = userName.split(/\s+/)[0];
  const starCount = files?.filter(file => starred.has(file.id)).length ?? 0;

  return <div className={styles.page}>
    <aside className={styles.sidebar} aria-label="Office">
      <nav className={styles.nav}>
        <button type="button" aria-pressed={view === "recent"} onClick={() => setView("recent")}><Clock size={15} />Recent<span>{files?.length ?? ""}</span></button>
        <button type="button" aria-pressed={view === "starred"} onClick={() => setView("starred")}><Star size={15} />Starred<span>{starCount || ""}</span></button>
      </nav>
      <h2 className={styles.sideHeading}>Workspaces</h2>
      <nav className={styles.nav}>
        {workspaces.map(garden => {
          const active = typeof view === "object" && view.garden === garden.slug;
          return <button key={garden.slug} type="button" aria-pressed={active} onClick={() => { setView({ garden: garden.slug }); chooseWorkspace(garden.slug); }}>
            {active ? <FolderOpen size={15} /> : <Folder size={15} />}<em>{garden.name}</em>
          </button>;
        })}
        {!workspaces.length && files && <p className={styles.sideNote}>Your first document creates an Office Garden.</p>}
      </nav>
    </aside>

    <main className={styles.main}>
      <h1 className={styles.greeting}>{greeting()}{firstName ? `, ${firstName}` : ""}.<br />What would you like to create today?</h1>

      <div className={styles.tiles}>
        {OFFICE_KINDS.map(info => <button key={info.kind} type="button" className={styles.tile} onClick={() => startCreate(info)} disabled={files === null}>
          <Badge info={info} />
          <span className={styles.tileName}>AI {info.label} <i>AI</i></span>
          <span className={styles.tileExt}>.{info.kind}</span>
        </button>)}
        <button type="button" className={`${styles.tile} ${styles.wide}`} onClick={() => upload.current?.click()} disabled={busy || files === null}>
          <span className={styles.uploadIcon}><Upload size={16} /></span>
          <span className={styles.tileName}>Open Local File</span>
          <span className={styles.tileExt}>docx / xlsx / pptx / pdf / md / html / csv / odt</span>
        </button>
        <input ref={upload} type="file" multiple accept={ACCEPT} hidden onChange={event => void uploadFiles(event.target.files)} />
      </div>

      {workspaces.length > 1 && <label className={styles.workspacePick}>New documents go to
        <select value={workspace} onChange={event => chooseWorkspace(event.target.value)}>
          {workspaces.map(garden => <option key={garden.slug} value={garden.slug}>{garden.name}</option>)}
        </select>
      </label>}

      {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => { setError(""); void load(); }}>Retry</button></p>}

      <section className={styles.library} aria-label="Documents">
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist">
            {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
          </div>
          <label className={styles.search}><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search file names" aria-label="Search documents" /></label>
          {files && <span className={styles.count}>{visible.length} {visible.length === 1 ? "file" : "files"}</span>}
        </div>
        <div className={styles.table} role="table">
          <div className={styles.head} role="row"><span role="columnheader">Name</span><span role="columnheader">Workspace</span><span role="columnheader">Modified</span><span /></div>
          {files === null && <p className={styles.empty}>Loading your documents…</p>}
          {files && !visible.length && <p className={styles.empty}>{files.length ? "No documents match." : "Nothing here yet. Create a document above, or ask Bread to write one."}</p>}
          {visible.map(file => {
            const info = officeKindForName(file.name)!;
            return <div key={file.id} className={styles.row} role="row">
              <button type="button" className={styles.name} onClick={() => open(file)} role="cell"><Badge info={info} size={22} /><span>{file.name}</span></button>
              <span role="cell" className={styles.muted}>{file.gardenName}</span>
              <span role="cell" className={styles.muted}>{modified(file.updatedAt)}</span>
              <span role="cell" className={styles.actions}>
                <button type="button" title="Ask Bread about this document" aria-label={`Ask Bread about ${file.name}`} onClick={() => open(file, `About ${file.name}: `)}><Sparkles size={14} /></button>
                <button type="button" title={starred.has(file.id) ? "Unstar" : "Star"} aria-label={`${starred.has(file.id) ? "Unstar" : "Star"} ${file.name}`} aria-pressed={starred.has(file.id)} onClick={() => toggleStar(file.id)}><Star size={14} /></button>
                <button type="button" title="Move to trash" aria-label={`Move ${file.name} to trash`} onClick={() => void trash(file)}><Trash2 size={14} /></button>
              </span>
            </div>;
          })}
        </div>
      </section>
    </main>

    <dialog ref={dialog} className={styles.dialog} onClose={() => setCreating(null)}>
      {creating && <form method="dialog" onSubmit={event => { event.preventDefault(); void create(Boolean(brief.trim())); }}>
        <h2><Badge info={creating} size={26} />New {creating.noun}</h2>
        <label>Name<input value={title} onChange={event => setTitle(event.target.value)} placeholder={`Untitled ${creating.label}`} maxLength={120} /></label>
        <label>What should Bread write? <small>Optional</small>
          <textarea value={brief} onChange={event => setBrief(event.target.value)} rows={4} placeholder={`Describe the ${creating.noun}, or leave empty for a blank one.`} />
        </label>
        {workspaces.length > 1 && <label>Workspace<select value={workspace} onChange={event => chooseWorkspace(event.target.value)}>
          {workspaces.map(garden => <option key={garden.slug} value={garden.slug}>{garden.name}</option>)}
        </select></label>}
        <div className={styles.dialogActions}>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" onClick={() => void create(false)} disabled={busy}>Create blank</button>
          <button type="submit" className={styles.primary} disabled={busy || !brief.trim()}><Sparkles size={14} />Write with Bread</button>
        </div>
      </form>}
    </dialog>
  </div>;
}
