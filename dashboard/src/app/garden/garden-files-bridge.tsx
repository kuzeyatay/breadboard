"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { ArrowLeft, Folder, File, Upload, X, Trash2 } from "lucide-react";
import { gardenFileApi, gardenFileSize, type GardenFileEntry } from "@/lib/garden-files/types";
import { gardenFileUploadQueue } from "@/lib/garden-files/upload-queue";
import { fileRequest } from "@/lib/garden-files/client";
import { droppedGardenFiles } from "@/lib/garden-files/drop";
import styles from "./garden-files.module.css";

const Viewer = dynamic(() => import("./garden-file-viewer"), { ssr: false });
type Target = { cluster: string; folder: string; fileId?: string; trash?: boolean; action?: string };
type Bounds = { left: number; top: number; width: number; height: number };
const emptyUploads: ReturnType<typeof gardenFileUploadQueue.snapshot> = [];

function FilesFolder({ target, files, canEdit, onOpen, onFolder, onClose, onAdd, onImportFolder, onRefresh, onError, onNote }: {
  target: Target; files: GardenFileEntry[]; canEdit: boolean; onOpen: (entry: GardenFileEntry) => void; onFolder: (target: Target) => void;
  onClose: () => void; onAdd: () => void; onImportFolder: () => void; onRefresh: () => void; onError: (message: string) => void; onNote: (path: string) => void;
}) {
  const [name, setName] = useState(""), [newFolder, setNewFolder] = useState(false), [search, setSearch] = useState("");
  const [folderAction, setFolderAction] = useState<"rename" | "move" | null>(null);
  const currentFolder = files.find(file => file.kind === "folder" && file.path === target.folder);
  useEffect(() => {
    setSearch(""); setNewFolder(target.action === "new"); setFolderAction(target.action === "rename" ? "rename" : null);
    setName(target.action === "rename" ? target.folder.split("/").pop()! : "");
  }, [target.folder, target.action]);
  const [notes, setNotes] = useState<{ relPath: string; title: string; folder: string }[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!target.trash) void fileRequest<{ documents: typeof notes }>(`/api/documents?clusterSlug=${encodeURIComponent(target.cluster)}`, { signal: controller.signal }).then(body => setNotes(body.documents ?? [])).catch(() => {});
    return () => controller.abort();
  }, [target.cluster, target.trash]);
  const visible = files.filter(file => target.trash ? Boolean(file.deletedAt) && !files.some(parent => parent.kind === "folder" && file.path.startsWith(`${parent.path}/`)) : search ? !target.folder || file.path.startsWith(`${target.folder}/`) : file.folder === target.folder).filter(file => file.name.toLowerCase().includes(search.toLowerCase()));
  const folders = new Set(visible.filter(file => file.kind === "folder").map(file => file.path));
  const extraFolders = [...new Set(notes.flatMap(note => {
    const relative = target.folder ? note.relPath.startsWith(`${target.folder}/`) ? note.relPath.slice(target.folder.length + 1) : "" : note.relPath;
    return relative.includes("/") ? [`${target.folder ? `${target.folder}/` : ""}${relative.split("/")[0]}`] : [];
  }))].filter(folder => !folders.has(folder) && folder.toLowerCase().includes(search.toLowerCase()));
  const visibleNotes = target.trash ? [] : notes.filter(note => (search ? !target.folder || note.relPath.startsWith(`${target.folder}/`) : note.relPath.split("/").slice(0,-1).join("/") === target.folder) && note.title.toLowerCase().includes(search.toLowerCase()));
  const mutate = async (file: GardenFileEntry, action: string, destination?: string) => {
    setBusy(true);
    try {
      const result = await fileRequest<{ file: GardenFileEntry }>(gardenFileApi(target.cluster, file.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: file.revision, path: destination }) });
      setFolderAction(null); onRefresh();
      if (file.id === currentFolder?.id && (action === "move" || action === "copy")) onFolder({ cluster: target.cluster, folder: result.file.path, fileId: result.file.id });
    }
    catch (cause) { onError(cause instanceof Error ? cause.message : "The folder could not be changed."); }
    finally { setBusy(false); }
  };
  return <section className={styles.viewer} aria-label={target.trash ? "Trash" : target.folder || "Garden files"}>
    <header className={styles.toolbar}><button onClick={target.folder && !target.trash ? () => onFolder({ cluster: target.cluster, folder: target.folder.split("/").slice(0, -1).join("/") }) : onClose} aria-label="Back"><ArrowLeft size={17} /></button>
      <div className={styles.title}><strong>{target.trash ? "Trash" : target.folder || "Garden files"}</strong></div>
      {canEdit && !target.trash && <><button className={styles.labeled} onClick={onAdd}><Upload size={15} />Add files</button><details className={styles.menu}><summary aria-label="Folder actions">•••</summary><div><button onClick={onImportFolder}>Import folder</button><button onClick={() => { setNewFolder(true); setFolderAction(null); setName(""); }}>New folder</button>
        {currentFolder && <><button onClick={() => { setFolderAction("rename"); setNewFolder(false); setName(currentFolder.name); }}>Rename folder</button><button onClick={() => { setFolderAction("move"); setNewFolder(false); setName(currentFolder.folder); }}>Move folder to…</button><button disabled={busy} onClick={() => void mutate(currentFolder, "copy")}>Make a copy</button></>}
        <button onClick={() => onFolder({ ...target, trash: true })}>Trash</button></div></details></>}
    </header>
    {folderAction && currentFolder && <form className={styles.action} onSubmit={event => { event.preventDefault(); void mutate(currentFolder, "move", folderAction === "rename" ? `${currentFolder.folder ? `${currentFolder.folder}/` : ""}${name}` : `${name ? `${name}/` : ""}${currentFolder.name}`); }}><label>{folderAction === "rename" ? "Folder name" : "Destination folder (leave empty for garden root)"}<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy || folderAction === "rename" && !name.trim()}>{folderAction === "rename" ? "Rename" : "Move"}</button><button type="button" onClick={() => setFolderAction(null)}>Cancel</button></form>}
    {newFolder && <form className={styles.action} onSubmit={async event => {
      event.preventDefault(); setBusy(true);
      try { await fileRequest(gardenFileApi(target.cluster), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "folder", path: `${target.folder ? `${target.folder}/` : ""}${name}` }) }); setNewFolder(false); setName(""); onRefresh(); }
      catch (cause) { onError(cause instanceof Error ? cause.message : "The folder could not be created."); }
      finally { setBusy(false); }
    }}><label>Folder name<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label><button disabled={busy || !name.trim()}>Create</button><button type="button" onClick={() => setNewFolder(false)}>Cancel</button></form>}
    <input className={styles.filter} aria-label="Find files" placeholder="Find a file…" value={search} onChange={event => setSearch(event.target.value)} />
    <div className={styles.scroll}>
      {!target.trash && extraFolders.filter(folder => folder.toLowerCase().includes(search.toLowerCase())).map(folder => <div className={styles.folderRow} key={folder}><button onClick={() => onFolder({ cluster: target.cluster, folder })}><Folder size={15} />{folder.split("/").pop()}</button></div>)}
      {visible.sort((a,b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name)).map(file => <div className={styles.folderRow} key={file.id}>
        <button disabled={target.trash} onClick={() => file.kind === "folder" ? onFolder({ cluster: target.cluster, folder: file.path, fileId: file.id }) : onOpen(file)}>{file.kind === "folder" ? <Folder size={15} /> : <File size={15} />}{target.trash || search ? file.path : file.name}</button>
        <span>{file.kind === "folder" ? "Folder" : gardenFileSize(file.size)}</span>
        {canEdit && <button disabled={busy} title={target.trash ? "Restore" : "Move to trash"} aria-label={`${target.trash ? "Restore" : "Move to trash"} ${file.name}`} onClick={() => void mutate(file, target.trash ? "restore" : "trash")}>{target.trash ? "Restore" : <Trash2 size={14} />}</button>}
      </div>)}
      {visibleNotes.map(note => <div key={note.relPath} className={styles.folderRow}><button onClick={() => onNote(note.relPath)}><File size={15} />{note.title}</button><span>Markdown</span></div>)}
      {!visible.length && (target.trash || (!extraFolders.length && !visibleNotes.length)) && <p className={styles.empty}>{target.trash ? "Nothing in trash." : search ? "No files match this name." : "Drop files into this folder, or choose Add files."}</p>}
    </div>
  </section>;
}

/** Keeps Quartz's existing tree; only the selected file replaces the reading pane. */
export default function GardenFilesBridge({ iframeRef, quartzOrigin, initialCluster, onSelectCluster, onSelectDocument }: { iframeRef: RefObject<HTMLIFrameElement | null>; quartzOrigin: string; initialCluster?: string; onSelectCluster?: (cluster: string) => void; onSelectDocument?: (value: null) => void }) {
  const [file, setFile] = useState<GardenFileEntry | null>(null), [folder, setFolder] = useState<Target | null>(null), [bounds, setBounds] = useState<Bounds | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, { files: GardenFileEntry[]; canEdit: boolean }>>({});
  const [trash, setTrash] = useState<GardenFileEntry[]>([]), [error, setError] = useState(""), [mounted, setMounted] = useState(false);
  const [picker, setPicker] = useState<Target | null>(null), [showUploads, setShowUploads] = useState(() => gardenFileUploadQueue.snapshot().some(entry => ["queued", "uploading", "failed"].includes(entry.state)));
  const dirty = useRef(false), pickFiles = useRef<HTMLInputElement>(null), pickFolder = useRef<HTMLInputElement>(null), requests = useRef(new Map<string, AbortController>());
  const clusters = useRef(new Set(initialCluster ? [initialCluster] : [])), generation = useRef(0), navigationReady = useRef(false);
  const currentFile = useRef(file); currentFile.current = file;
  const uploads = useSyncExternalStore(gardenFileUploadQueue.subscribe, gardenFileUploadQueue.snapshot, () => emptyUploads);
  useEffect(() => { if (file) { onSelectCluster?.(file.gardenId); onSelectDocument?.(null); } }, [file?.id, onSelectCluster, onSelectDocument]);
  const failedUploads = uploads.filter(entry => entry.state === "failed").length;
  useEffect(() => { if (failedUploads) setShowUploads(true); }, [failedUploads]);
  const uploading = uploads.some(entry => entry.state === "queued" || entry.state === "uploading");
  useEffect(() => {
    if (!uploading) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [uploading]);
  const post = useCallback((message: object) => { if (quartzOrigin) iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin); }, [iframeRef, quartzOrigin]);
  const refresh = useCallback(async (cluster: string) => {
    clusters.current.add(cluster); requests.current.get(cluster)?.abort();
    const controller = new AbortController(); requests.current.set(cluster, controller);
    try {
      const body = await fileRequest<{ files: GardenFileEntry[]; canEdit: boolean }>(gardenFileApi(cluster), { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSnapshots(current => ({ ...current, [cluster]: body }));
      post({ type: "second-brain:files", cluster, ...body });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read garden files."); }
    finally { if (requests.current.get(cluster) === controller) requests.current.delete(cluster); }
  }, [post]);
  const mayLeave = useCallback(() => !dirty.current || window.confirm("Discard your unsaved changes?"), []);
  const close = useCallback(() => {
    if (!mayLeave()) { post({ type: "second-brain:file-view", open: true }); return; }
    generation.current++; dirty.current = false; setFile(null); setFolder(null); setPicker(null); post({ type: "second-brain:file-view", open: false });
    const url = new URL(window.location.href); url.searchParams.delete("file"); url.searchParams.delete("fileGarden"); window.history.replaceState(window.history.state, "", url);
  }, [mayLeave, post]);
  const openFile = useCallback(async (cluster: string, id: string, history = true) => {
    if (!mayLeave()) return;
    const ticket = ++generation.current; setError("");
    try {
      const body = await fileRequest<{ file: GardenFileEntry }>(gardenFileApi(cluster, id));
      if (generation.current !== ticket) return;
      dirty.current = false; setFile(body.file); setFolder(null); setPicker(null);
      await refresh(cluster);
      if (generation.current !== ticket) return;
      post({ type: "second-brain:file-view", open: true, fileId: id });
      if (history) { const url = new URL(window.location.href); url.searchParams.set("file", id); url.searchParams.set("fileGarden", cluster); window.history.pushState(window.history.state, "", url); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be opened."); }
  }, [mayLeave, post, refresh]);
  const openFolder = useCallback((target: Target) => {
    if (!mayLeave()) return;
    const ticket = ++generation.current; dirty.current = false; setFile(null); setFolder(target); setPicker(null); setError("");
    const url = new URL(location.href); url.searchParams.delete("file"); url.searchParams.delete("fileGarden"); history.replaceState(history.state, "", url);
    void refresh(target.cluster).then(() => { if (generation.current === ticket) post({ type: "second-brain:file-view", open: true }); });
    if (target.trash) void fileRequest<{ files: GardenFileEntry[] }>(`${gardenFileApi(target.cluster)}?trash=1`).then(body => setTrash(body.files)).catch(cause => setError(cause.message));
  }, [mayLeave, post, refresh]);
  const add = useCallback((target: Target, items: { file: File; path: string }[]) => {
    if (items.length > 5000) { setError("Add up to 5,000 files at a time."); return; }
    gardenFileUploadQueue.add(target.cluster, target.folder, items); setShowUploads(true); setPicker(null);
  }, []);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const syncHistory = () => { const params = new URLSearchParams(location.search), id = params.get("file"), cluster = params.get("fileGarden") || initialCluster; if (id && cluster) void openFile(cluster, id, false); else close(); };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== quartzOrigin) return;
      const data = event.data;
      if (!data) return;
      if (data.type === "second-brain:request-folders" && typeof data.cluster === "string") void refresh(data.cluster);
      if (data.type === "second-brain:open-file" && typeof data.cluster === "string" && typeof data.fileId === "string") void openFile(data.cluster, data.fileId);
      if (data.type === "second-brain:open-file-folder" && typeof data.cluster === "string" && typeof data.folder === "string") {
        if (["copy", "trash"].includes(data.action) && typeof data.fileId === "string") {
          if (!mayLeave()) return;
          void (async () => {
            const { file: current } = await fileRequest<{ file: GardenFileEntry }>(gardenFileApi(data.cluster, data.fileId));
            const { file: result } = await fileRequest<{ file: GardenFileEntry }>(gardenFileApi(data.cluster, data.fileId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: data.action, revision: current.revision }) });
            dirty.current = false; openFolder({ cluster: data.cluster, folder: data.action === "copy" ? result.path : current.folder });
          })().catch(cause => setError(cause.message));
        } else openFolder({ cluster: data.cluster, folder: data.folder, fileId: data.fileId, action: data.action });
      }
      if (data.type === "second-brain:add-files" && typeof data.cluster === "string" && typeof data.folder === "string") { setPicker({ cluster: data.cluster, folder: data.folder }); setError(""); }
      if (data.type === "second-brain:import-files" && typeof data.cluster === "string" && Array.isArray(data.files)) {
        add({ cluster: data.cluster, folder: data.folder || "" }, data.files.filter((item: { file: File; path: string }) => item.file instanceof File && typeof item.path === "string"));
        void (async () => {
          for (const path of (data.folders ?? []).slice(0, 5000)) await fileRequest(gardenFileApi(data.cluster), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "folder", path: `${data.folder ? `${data.folder}/` : ""}${path}` }) });
          await refresh(data.cluster);
        })().catch(cause => setError(cause.message));
      }
      if (data.type === "second-brain:move-file") {
        if (data.cluster !== data.destinationCluster) { setError("Move files within one garden. To use another garden, download and import the file there."); return; }
        void fileRequest<{ file: GardenFileEntry }>(gardenFileApi(data.cluster, data.fileId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move", revision: data.revision, path: `${data.folder ? `${data.folder}/` : ""}${data.name}` }) }).then(body => { if (!dirty.current) setFile(current => current?.id === body.file.id ? body.file : current); void refresh(data.cluster); }).catch(cause => setError(cause.message));
      }
      if (data.type === "second-brain:file-bounds" && [data.left,data.top,data.width,data.height].every(Number.isFinite)) {
        const rect = iframeRef.current?.getBoundingClientRect();
        if (rect) setBounds({ left: rect.left + data.left, top: rect.top + data.top, width: Math.min(data.width, rect.width), height: Math.min(data.height, rect.height - data.top) });
      }
      if (data.type === "second-brain:file-error" && typeof data.error === "string") setError(data.error);
      if (data.type === "second-brain:leave-file" && typeof data.url === "string" && mayLeave()) {
        dirty.current = false; close(); post({ type: "second-brain:open-library-url", url: data.url });
      }
      if (data.type === "second-brain:navigate") {
        if (!navigationReady.current) { navigationReady.current = true; syncHistory(); }
        else close();
      }
    };
    const changed = (event: Event) => {
      const entry = (event as CustomEvent<GardenFileEntry>).detail;
      if (!entry?.gardenId) return;
      void refresh(entry.gardenId);
      // A background save must never replace the draft currently being edited.
      if (dirty.current || currentFile.current?.id !== entry.id) return;
      if (entry.deletedAt) close(); else setFile(entry);
    };
    const loaded = () => { clusters.current.forEach(cluster => void refresh(cluster)); };
    const ref = iframeRef.current;
    ref?.addEventListener("load", loaded); window.addEventListener("message", onMessage); window.addEventListener("popstate", syncHistory); window.addEventListener("sb:garden-file-updated", changed); window.addEventListener("focus", loaded);
    loaded();
    return () => { ref?.removeEventListener("load", loaded); window.removeEventListener("message", onMessage); window.removeEventListener("popstate", syncHistory); window.removeEventListener("sb:garden-file-updated", changed); window.removeEventListener("focus", loaded); requests.current.forEach(controller => controller.abort()); };
  }, [iframeRef, quartzOrigin, initialCluster, post, refresh, openFile, openFolder, close, add, mayLeave]);
  const selectedTarget = picker ?? folder ?? (file ? { cluster: file.gardenId, folder: file.folder } : null);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onChanged = useCallback((entry: GardenFileEntry) => {
    setFile(entry.deletedAt ? null : entry);
    if (entry.deletedAt) {
      const url = new URL(location.href); url.searchParams.delete("file"); url.searchParams.delete("fileGarden"); history.replaceState(history.state, "", url);
      post({ type: "second-brain:file-view", open: false });
    }
    else {
      const url = new URL(location.href); url.searchParams.set("file", entry.id); url.searchParams.set("fileGarden", entry.gardenId); history.replaceState(history.state, "", url);
      post({ type: "second-brain:file-view", open: true, fileId: entry.id });
    }
  }, [post]);
  const pending = uploads.filter(entry => entry.state === "queued" || entry.state === "uploading"), failed = uploads.filter(entry => entry.state === "failed");
  return <>
    <input ref={pickFiles} type="file" multiple hidden onChange={event => { if (selectedTarget && event.target.files) add(selectedTarget, Array.from(event.target.files).map(file => ({ file, path: file.name }))); event.target.value = ""; }} />
    <input ref={pickFolder} type="file" multiple hidden {...({ webkitdirectory: "" } as Record<string,string>)} onChange={event => { if (selectedTarget && event.target.files) add(selectedTarget, Array.from(event.target.files).map(file => ({ file, path: file.webkitRelativePath || file.name }))); event.target.value = ""; }} />
    {mounted && (file || folder) && bounds && createPortal(<div className={styles.overlay} style={bounds}
      onDragOver={event => { if (folder && !folder.trash && snapshots[folder.cluster]?.canEdit && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={event => {
        if (!folder || folder.trash || !snapshots[folder.cluster]?.canEdit || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        const target = folder;
        void droppedGardenFiles(event.dataTransfer).then(async result => {
          add(target, result.files);
          for (const path of result.folders) await fileRequest(gardenFileApi(target.cluster), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "folder", path: `${target.folder ? `${target.folder}/` : ""}${path}` }) });
          await refresh(target.cluster);
        }).catch(cause => setError(cause.message));
      }}>
      {file ? <Viewer key={file.id} file={file} onChanged={onChanged} onClose={close} onDirtyChange={onDirty} /> : folder && <FilesFolder target={folder} files={folder.trash ? trash : snapshots[folder.cluster]?.files ?? []} canEdit={snapshots[folder.cluster]?.canEdit ?? false}
        onOpen={entry => void openFile(entry.gardenId, entry.id)} onFolder={openFolder} onClose={close} onAdd={() => pickFiles.current?.click()} onImportFolder={() => pickFolder.current?.click()}
        onRefresh={() => { void refresh(folder.cluster); if (folder.trash) void fileRequest<{ files: GardenFileEntry[] }>(`${gardenFileApi(folder.cluster)}?trash=1`).then(body => setTrash(body.files)); }} onError={setError}
        onNote={path => { close(); post({ type: "second-brain:open-library-note", cluster: folder.cluster, path }); }} />}
    </div>, document.body)}
    {picker && <div className={styles.uploadStatus} role="dialog" aria-label="Add files"><div><strong>Add to {picker.folder || picker.cluster}</strong><button onClick={() => setPicker(null)} aria-label="Close"><X size={14} /></button></div><div><button onClick={() => pickFiles.current?.click()}>Choose files</button><button onClick={() => pickFolder.current?.click()}>Import folder</button><button onClick={() => openFolder(picker)}>Browse files</button></div></div>}
    {error && <div className={styles.uploadStatus} role="alert"><div><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={14} /></button></div></div>}
    {showUploads && uploads.length > 0 && !picker && !error && <div className={styles.uploadStatus} role="status"><div><span>{pending.length ? `Adding ${pending.length} ${pending.length === 1 ? "file" : "files"}…` : failed.length ? `${failed.length} ${failed.length === 1 ? "file needs" : "files need"} a retry` : "Files added"}</span><button onClick={() => { setShowUploads(false); gardenFileUploadQueue.dismiss(); }} aria-label="Hide uploads"><X size={14} /></button></div>
      {uploads.filter(entry => entry.state === "uploading" || entry.state === "failed").slice(0,3).map(entry => <div key={entry.id}><span title={entry.error || entry.path}>{entry.path.split("/").pop()}{entry.state === "uploading" ? ` · ${entry.progress}%` : ` · ${entry.error}`}</span>{entry.state === "failed" ? <button onClick={() => gardenFileUploadQueue.retry(entry.id)}>Retry</button> : null}<button onClick={() => gardenFileUploadQueue.cancel(entry.id)}>Cancel</button></div>)}
    </div>}
  </>;
}
