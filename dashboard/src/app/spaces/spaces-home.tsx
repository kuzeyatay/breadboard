"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Folder, FolderOpen, Hand, PenLine, Search, Sparkles, Star, Trash2, Upload, Workflow } from "lucide-react";
import SpotifyAmbientBackground from "@/app/components/spotify-ambient-background";
import { SpotifyAmbientProvider } from "@/app/components/spotify-ambient-context";
import { usePageAppearance } from "@/app/components/use-page-appearance";
import { gardenFileApi, type GardenFileEntry } from "@/lib/garden-files/types";
import { OFFICE_FOLDER, OFFICE_KINDS, officeKind, spacesEditHref, spacesKindForPath, type OfficeFile, type OfficeKindInfo, type OfficeTab, type OfficeWorkspace } from "@/lib/office/types";
import { WorkflowProposals } from "@/app/workflows/components/workflow-proposals";
import { loadTeachAvailability, type TeachAvailabilityView } from "@/app/workflows/teach/teach-client";
import SpacesFileBadge from "./spaces-file-badge";
import styles from "./spaces.module.css";

type SpacesTab = "all" | OfficeTab | "workflows";
const TABS: { id: SpacesTab; label: string }[] = [
  { id: "all", label: "All" }, { id: "docs", label: "Docs" }, { id: "sheets", label: "Sheets" }, { id: "slides", label: "Slides" },
  { id: "pages", label: "Pages" }, { id: "designs", label: "Designs" }, { id: "videos", label: "Videos" },
  { id: "pdf", label: "PDF" }, { id: "markdown", label: "Markdown" }, { id: "html", label: "HTML" }, { id: "workflows", label: "Workflows" },
];
const STAR_KEY = "breadboard:office:starred";
const WORKSPACE_KEY = "breadboard:office:workspace";
const ACCEPT = OFFICE_KINDS.flatMap(info => info.extensions.map(ext => `.${ext}`)).join(",");

/** What each tile makes. Whiteboard is an AFFiNE page that opens in edgeless mode. */
interface Tile { id: string; info: OfficeKindInfo; label: string; detail: string; whiteboard?: boolean }
const kind = (id: string) => officeKind(id)!;
const TILES: Tile[] = [
  { id: "docx", info: kind("docx"), label: "Docs", detail: ".docx" },
  { id: "xlsx", info: kind("xlsx"), label: "Sheets", detail: ".xlsx" },
  { id: "pptx", info: kind("pptx"), label: "Slides", detail: ".pptx" },
  { id: "pdf", info: kind("pdf"), label: "PDF", detail: ".pdf" },
  { id: "page", info: kind("affine"), label: "Page", detail: "Blocks, databases, embeds" },
  { id: "whiteboard", info: kind("affine"), label: "Whiteboard", detail: "Canvas, shapes, mind maps", whiteboard: true },
  { id: "png", info: kind("png"), label: "Design", detail: "Posters, posts, photo edits" },
  { id: "mp4", info: kind("mp4"), label: "Video", detail: "Timeline editor" },
  { id: "md", info: kind("md"), label: "Markdown", detail: ".md" },
  { id: "html", info: kind("html"), label: "HTML", detail: ".html" },
];

/** Workflows belong to the account, not to a workspace: they are listed beside the files in every view but a workspace's own. */
interface WorkflowItem { id: string; name: string; description?: string; source?: "canvas" | "demonstration"; nodeCount?: number; stepCount?: number; updatedAt: string | null }
const WORKFLOW_COLOR = "#b4691f";
const workflowHref = (id: string) => `/workflows?workflow=${encodeURIComponent(id)}`;
/** SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC; read it as UTC so it sorts and prints beside ISO file times. */
const sqlTime = (value: string) => /^\d{4}-\d\d-\d\d \d/.test(value) ? `${value.replace(" ", "T")}Z` : value;

function WorkflowBadge({ teach, size = 30 }: { teach?: boolean; size?: number }) {
  const Icon = teach ? Hand : Workflow;
  return <span aria-hidden="true" className={styles.badge} style={{ backgroundColor: WORKFLOW_COLOR, width: size, height: size }}><Icon size={Math.round(size * 0.52)} strokeWidth={2.2} /></span>;
}

function readStorage(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* starring still works for this visit */ } }

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

/** The Terminal's ambient lights in their random-colour mode, drifting behind the launcher. */
function ShiftingBackground({ ownerKey }: { ownerKey: string }) {
  const { theme } = usePageAppearance(ownerKey, "new-tab");
  return <div className={styles.ambient} aria-hidden="true">
    <SpotifyAmbientProvider ownerKey={ownerKey}><SpotifyAmbientBackground theme={theme} spotifyColors={false} randomColors /></SpotifyAmbientProvider>
  </div>;
}

type Entry = { kind: "file"; file: OfficeFile; updatedAt: string } | { kind: "workflow"; workflow: WorkflowItem; updatedAt: string };

const ROOT_NAME = "Root", NO_WORKSPACE = "none";
const LOAD_ERROR = "Your files could not be loaded yet. Trying again…";
const isRoot = (garden: OfficeWorkspace) => garden.name === ROOT_NAME;

export default function SpacesHome({ ownerKey }: { ownerKey: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<OfficeFile[] | null>(null);
  const [workspaces, setWorkspaces] = useState<OfficeWorkspace[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [view, setView] = useState<"recent" | "starred" | { garden: string }>("recent");
  const [tab, setTab] = useState<SpacesTab>("all");
  const [workflows, setWorkflows] = useState<WorkflowItem[] | null>(null);
  const [teachAvailability, setTeachAvailability] = useState<TeachAvailabilityView | null>(null);
  const [query, setQuery] = useState("");
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<Tile | null>(null);
  const [title, setTitle] = useState(""), [brief, setBrief] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), upload = useRef<HTMLInputElement>(null);

  // Loading recovers by itself: a dropped connection (a dashboard restart, a refresh cut off mid-flight)
  // is retried with backoff. A list already on screen stays as it is; only a first load that keeps
  // failing says so, and that message clears as soon as a retry gets through.
  const loaded = useRef(false), retry = useRef<{ timer?: number; delay: number }>({ delay: 1_000 });
  const load = useCallback(async () => {
    window.clearTimeout(retry.current.timer);
    try {
      const body = await request<{ files: OfficeFile[]; workspaces: OfficeWorkspace[] }>("/api/office/files");
      loaded.current = true; retry.current.delay = 1_000;
      setFiles(body.files); setWorkspaces(body.workspaces); setError(current => current === LOAD_ERROR ? "" : current);
      setWorkspace(current => {
        const remembered = current || readStorage(WORKSPACE_KEY) || "";
        if (remembered === NO_WORKSPACE) return "";
        return body.workspaces.some(w => w.slug === remembered && !isRoot(w)) ? remembered : body.workspaces.find(w => !isRoot(w))?.slug ?? "";
      });
    } catch {
      if (!loaded.current) { setError(LOAD_ERROR); setFiles(current => current ?? []); }
      retry.current.timer = window.setTimeout(() => void load(), retry.current.delay);
      retry.current.delay = Math.min(retry.current.delay * 2, 30_000);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(retry.current.timer), []);

  const loadWorkflows = useCallback(async () => {
    try {
      const body = await request<{ workflows: WorkflowItem[] }>("/api/workflows/local");
      setWorkflows(body.workflows);
    } catch { setWorkflows(current => current ?? []); }
  }, []);

  useEffect(() => {
    void load(); void loadWorkflows();
    const teachCheck = new AbortController();
    loadTeachAvailability(teachCheck.signal).then(setTeachAvailability).catch(() => { /* starting a session reports the real reason */ });
    try { setStarred(new Set(JSON.parse(readStorage(STAR_KEY) ?? "[]") as string[])); } catch { /* no stars yet */ }
    const refresh = () => { if (document.visibilityState === "visible") { void load(); void loadWorkflows(); } };
    document.addEventListener("visibilitychange", refresh);
    return () => { teachCheck.abort(); document.removeEventListener("visibilitychange", refresh); };
  }, [load, loadWorkflows]);

  const chooseWorkspace = (slug: string) => { setWorkspace(slug); writeStorage(WORKSPACE_KEY, slug || NO_WORKSPACE); };

  const toggleStar = (id: string) => setStarred(current => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    writeStorage(STAR_KEY, JSON.stringify([...next]));
    return next;
  });

  /** "No workspace" files all live in one Garden called Root, made the first time it is needed. */
  const targetWorkspace = async (): Promise<string> => {
    if (workspace) return workspace;
    const root = workspaces.find(isRoot);
    if (root) return root.slug;
    const body = await request<{ slug: string }>("/api/clusters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ROOT_NAME, description: "Spaces files that belong to no workspace." }) });
    setWorkspaces(current => [...current, { slug: body.slug, name: ROOT_NAME }]);
    return body.slug;
  };
  const workspaceOptions = <>
    <option value="">No workspace</option>
    {workspaces.filter(garden => !isRoot(garden)).map(garden => <option key={garden.slug} value={garden.slug}>{garden.name}</option>)}
  </>;

  const open = (file: { id: string; gardenId: string }, ask?: string) => router.push(spacesEditHref(file, ask));

  const startCreate = (tile: Tile) => { setCreating(tile); setTitle(""); setBrief(""); setError(""); dialog.current?.showModal(); };
  // Bread writes documents; for a design it works in the open design. Pages and videos start empty.
  const breadWrites = creating ? ["docx", "xlsx", "pptx", "md", "html", "pdf", "png"].includes(creating.info.kind) : false;

  const create = async (withBread: boolean) => {
    if (!creating || busy) return;
    setBusy(true); setError("");
    try {
      const gardenId = await targetWorkspace();
      const name = title.trim() || (withBread ? brief.trim().split(/\s+/).slice(0, 6).join(" ") : "");
      if (creating.info.kind === "mp4") {
        dialog.current?.close();
        router.push(`/spaces/edit?${new URLSearchParams({ garden: gardenId, app: "video", title: name || "Untitled video" })}`);
        return;
      }
      const { file } = await request<{ file: GardenFileEntry }>("/api/office/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: creating.info.kind, gardenId, title: name, whiteboard: creating.whiteboard === true }),
      });
      dialog.current?.close();
      const ask = !withBread ? undefined : creating.info.kind === "png"
        ? `Design this in the design open in Spaces: ${brief.trim()}`
        : `Write this ${creating.info.noun}${brief.trim() ? `: ${brief.trim()}` : ""}.\n\nIt is the Spaces file "${file.name}" in this Garden. When it is finished, save it back into that file with garden_save_file (gardenId ${file.gardenId}, fileId ${file.id}).`;
      open(file, ask);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be created."); }
    finally { setBusy(false); }
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length || busy) return;
    setBusy(true); setError("");
    try {
      const gardenId = await targetWorkspace();
      let last: GardenFileEntry | null = null;
      for (const item of Array.from(list)) {
        if (!spacesKindForPath(`${OFFICE_FOLDER}/${item.name}`)) throw new Error(`${item.name} is not a file Spaces opens.`);
        ({ file: last } = await request<{ file: GardenFileEntry }>(gardenFileApi(gardenId), {
          method: "POST", body: item,
          headers: { "x-file-path": encodeURIComponent(`${OFFICE_FOLDER}/${item.name}`), "x-file-size": String(item.size) },
        }));
      }
      if (list.length === 1 && last) open(last); else await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be added."); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  };

  const openWorkflow = (id: string) => router.push(workflowHref(id));
  const createWorkflow = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { id } = await request<{ id: string }>("/api/workflows/local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled workflow" }) });
      openWorkflow(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workflow could not be created."); setBusy(false); }
  };
  const deleteWorkflow = async (workflow: WorkflowItem) => {
    if (!window.confirm(`Delete the workflow ${workflow.name}?`)) return;
    try {
      await request(`/api/workflows/${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
      setWorkflows(current => current?.filter(entry => entry.id !== workflow.id) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workflow could not be deleted."); }
  };

  const trash = async (file: OfficeFile) => {
    if (!window.confirm(`Move ${file.name} to the Garden's trash?`)) return;
    try {
      await request(gardenFileApi(file.gardenId, file.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "trash", revision: file.revision }) });
      setFiles(current => current?.filter(entry => entry.id !== file.id) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be moved to trash."); }
  };

  const visible = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase();
    const fileEntries: Entry[] = (files ?? []).filter(file =>
      (view === "recent" || (view === "starred" ? starred.has(file.id) : file.gardenId === view.garden)) &&
      (tab === "all" || file.tab === tab) &&
      (!needle || file.name.toLowerCase().includes(needle) || file.gardenName.toLowerCase().includes(needle)))
      .map(file => ({ kind: "file", file, updatedAt: file.updatedAt }));
    const workflowEntries: Entry[] = typeof view === "object" || (tab !== "all" && tab !== "workflows") ? [] : (workflows ?? [])
      .filter(workflow => (view === "recent" || starred.has(workflow.id)) && (!needle || workflow.name.toLowerCase().includes(needle)))
      .map(workflow => ({ kind: "workflow", workflow, updatedAt: sqlTime(workflow.updatedAt ?? "") }));
    if (!workflowEntries.length) return fileEntries;
    const time = (value: string) => new Date(value).getTime() || 0;
    return [...fileEntries, ...workflowEntries].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  }, [files, workflows, view, tab, query, starred]);

  const starCount = (files?.filter(file => starred.has(file.id)).length ?? 0) + (workflows?.filter(workflow => starred.has(workflow.id)).length ?? 0);

  return <div className={styles.home}>
    <ShiftingBackground ownerKey={ownerKey} />
    <div className={styles.page}>
      <aside className={styles.sidebar} aria-label="Spaces">
        <nav className={styles.nav}>
          <button type="button" aria-pressed={view === "recent"} onClick={() => setView("recent")}><Clock size={15} />Recent<span>{files ? files.length + (workflows?.length ?? 0) : ""}</span></button>
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
          {!workspaces.length && files && <p className={styles.sideNote}>Your first file creates a Spaces Garden.</p>}
        </nav>
      </aside>

      <main className={styles.main}>
        <h1 className={styles.greeting}>What would you like to create today?</h1>

        <div className={styles.tiles}>
          {TILES.map(tile => <button key={tile.id} type="button" className={styles.tile} onClick={() => startCreate(tile)} disabled={files === null}>
            <SpacesFileBadge info={tile.info} whiteboard={tile.whiteboard} />
            <span className={styles.tileName}>{tile.label}</span>
            <span className={styles.tileExt}>{tile.detail}</span>
          </button>)}
          <button type="button" className={`${styles.tile} ${styles.wide}`} onClick={() => upload.current?.click()} disabled={busy || files === null}>
            <span className={styles.uploadIcon}><Upload size={16} /></span>
            <span className={styles.tileName}>Open a file</span>
            <span className={styles.tileExt}>docx, xlsx, pptx, pdf, md, html, csv, odt, png, jpg, mp4, webm</span>
          </button>
          <input ref={upload} type="file" multiple accept={ACCEPT} hidden onChange={event => void uploadFiles(event.target.files)} />
          <button type="button" className={styles.tile} onClick={() => void createWorkflow()} disabled={busy}>
            <WorkflowBadge />
            <span className={styles.tileName}>Create workflow</span>
            <span className={styles.tileExt}>Blocks on a canvas</span>
          </button>
          <button type="button" className={styles.tile} onClick={() => router.push("/workflows?teach=1")}
            disabled={teachAvailability !== null && !teachAvailability.available}
            title={teachAvailability && !teachAvailability.available ? teachAvailability.reason : "Show Breadboard the task once, out loud, and it builds the workflow"}>
            <WorkflowBadge teach />
            <span className={styles.tileName}>Teach workflow</span>
            <span className={styles.tileExt}>Show it once, by demonstration</span>
          </button>
        </div>

        <label className={styles.workspacePick}>New files go to
          <select value={workspace} onChange={event => chooseWorkspace(event.target.value)}>{workspaceOptions}</select>
        </label>

        {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => { setError(""); void load(); }}>Retry</button></p>}

        <div className={styles.proposals}><WorkflowProposals onOpen={openWorkflow} /></div>

        <section className={styles.library} aria-label="Files">
          <div className={styles.toolbar}>
            <div className={styles.tabs} role="tablist">
              {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
            </div>
            <label className={styles.search}><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search file names" aria-label="Search files" /></label>
            {files && <span className={styles.count}>{visible.length} {visible.length === 1 ? "item" : "items"}</span>}
          </div>
          <div className={styles.table} role="table">
            <div className={styles.head} role="row"><span role="columnheader">Name</span><span role="columnheader">Workspace</span><span role="columnheader">Modified</span><span /></div>
            {files === null && <p className={styles.empty}>Loading your files…</p>}
            {files && !visible.length && <p className={styles.empty}>{files.length || workflows?.length ? "Nothing matches." : "Nothing here yet. Create something above, or ask Bread to make it."}</p>}
            {visible.map(entry => {
              if (entry.kind === "workflow") {
                const workflow = entry.workflow;
                return <div key={`workflow:${workflow.id}`} className={styles.row} role="row">
                  <button type="button" className={styles.name} onClick={() => openWorkflow(workflow.id)} role="cell" title={workflow.description || undefined}><WorkflowBadge teach={workflow.source === "demonstration"} size={22} /><span>{workflow.name}</span></button>
                  <span role="cell" className={styles.muted}>{workflow.source === "demonstration" ? `Workflow · ${workflow.stepCount ?? 0} steps` : `Workflow · ${workflow.nodeCount ?? 0} blocks`}</span>
                  <span role="cell" className={styles.muted}>{entry.updatedAt ? modified(entry.updatedAt) : ""}</span>
                  <span role="cell" className={styles.actionsCell}>
                    <button type="button" title="Ask Bread about this workflow" aria-label={`Ask Bread about ${workflow.name}`} onClick={() => openWorkflow(workflow.id)}><Sparkles size={14} /></button>
                    <button type="button" title={starred.has(workflow.id) ? "Unstar" : "Star"} aria-label={`${starred.has(workflow.id) ? "Unstar" : "Star"} ${workflow.name}`} aria-pressed={starred.has(workflow.id)} onClick={() => toggleStar(workflow.id)}><Star size={14} /></button>
                    <button type="button" title="Delete workflow" aria-label={`Delete ${workflow.name}`} onClick={() => void deleteWorkflow(workflow)}><Trash2 size={14} /></button>
                  </span>
                </div>;
              }
              const file = entry.file;
              const info = spacesKindForPath(file.path) ?? kind("docx");
              return <div key={file.id} className={styles.row} role="row">
                <button type="button" className={styles.name} onClick={() => open(file)} role="cell"><SpacesFileBadge info={info} size={22} /><span>{file.name}</span></button>
                <span role="cell" className={styles.muted}>{file.gardenName === ROOT_NAME ? "No workspace" : file.gardenName}</span>
                <span role="cell" className={styles.muted}>{modified(file.updatedAt)}</span>
                <span role="cell" className={styles.actionsCell}>
                  <button type="button" title="Ask Bread about this file" aria-label={`Ask Bread about ${file.name}`} onClick={() => open(file, `About ${file.name}: `)}><Sparkles size={14} /></button>
                  <button type="button" title={starred.has(file.id) ? "Unstar" : "Star"} aria-label={`${starred.has(file.id) ? "Unstar" : "Star"} ${file.name}`} aria-pressed={starred.has(file.id)} onClick={() => toggleStar(file.id)}><Star size={14} /></button>
                  <button type="button" title="Move to trash" aria-label={`Move ${file.name} to trash`} onClick={() => void trash(file)}><Trash2 size={14} /></button>
                </span>
              </div>;
            })}
          </div>
        </section>
      </main>
    </div>

    <dialog ref={dialog} className={styles.dialog} onClose={() => setCreating(null)}>
      {creating && <form method="dialog" onSubmit={event => { event.preventDefault(); void create(breadWrites && Boolean(brief.trim())); }}>
        <h2><SpacesFileBadge info={creating.info} whiteboard={creating.whiteboard} size={26} />New {creating.whiteboard ? "whiteboard" : creating.info.noun}</h2>
        <label>Name<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder={`Untitled ${creating.whiteboard ? "whiteboard" : creating.info.noun}`} maxLength={120} /></label>
        {breadWrites && <label>{creating.info.kind === "png" ? "What should Bread design?" : "What should Bread write?"} <small>Optional</small>
          <textarea value={brief} onChange={event => setBrief(event.target.value)} rows={4} placeholder={`Describe the ${creating.info.noun}, or leave empty for a blank one.`} />
        </label>}
        <label>Workspace<select value={workspace} onChange={event => chooseWorkspace(event.target.value)}>{workspaceOptions}</select></label>
        <div className={styles.dialogActions}>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          {breadWrites ? <>
            <button type="button" onClick={() => void create(false)} disabled={busy}>Create blank</button>
            <button type="submit" className={styles.primary} disabled={busy || !brief.trim()}><Sparkles size={14} />{creating.info.kind === "png" ? "Design with Bread" : "Write with Bread"}</button>
          </> : <button type="submit" className={styles.primary} disabled={busy}><PenLine size={14} />Create</button>}
        </div>
      </form>}
    </dialog>
  </div>;
}
