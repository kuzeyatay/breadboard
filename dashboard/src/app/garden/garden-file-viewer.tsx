"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Download, MoreHorizontal, X, Pencil, Save, RotateCcw } from "lucide-react";
import ChatMarkdown from "@/app/components/chat-markdown";
import { gardenFileApi, gardenFileExtension, gardenFileSize, type GardenFileEntry, type GardenFileVersion } from "@/lib/garden-files/types";
import type { ModelAttachmentFormat } from "@/lib/model-attachments";
import styles from "./garden-files.module.css";
import { fileRequest } from "@/lib/garden-files/client";
import { usePageLoading } from "@/app/components/use-page-loading";
import { fileExplorerControl, openInFileExplorer } from "@/lib/desktop-file-explorer";

const ModelViewer = dynamic(() => import("@/app/components/cad/model-viewer"), { ssr: false });
const PdfViewer = dynamic(() => import("@/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client"), { ssr: false });
const Knowledge = dynamic(() => import("./garden-file-knowledge"), { ssr: false });

type Block = { anchor: string; text: string; editable: boolean; sheet?: string; cell?: string; slide?: number };
type Preview = { kind: string; text?: string; markdown?: string; html?: string; warnings?: string[]; truncated?: boolean; entries?: { path: string; size: number; folder: boolean }[] };
type Editor = { file: GardenFileEntry; mode: string; content?: string; blocks?: Block[]; truncated?: boolean };

function NativeWord({ file, editing, onSaved, onDirty, onError, copyRequest }: { file: GardenFileEntry; editing: boolean; onSaved: (file: GardenFileEntry) => void; onDirty: (dirty: boolean) => void; onError: (error: string, conflict: boolean) => void; copyRequest: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const unsaved = useRef(false);
  // Saving must not reload the editor or lose its selection.
  const src = useMemo(() => `/genoffice-editor/index.html?${new URLSearchParams({ gardenId: file.gardenId, fileId: file.id, mode: editing ? "edit" : "preview" })}`, [file.gardenId, file.id, editing]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.type === "breadboard:genoffice-file-saved" && event.data.file?.gardenId === file.gardenId && (event.data.file.id === file.id || event.data.sourceFileId === file.id)) onSaved(event.data.file);
      if (event.data?.type === "breadboard:genoffice-file-dirty" && event.data.fileId === file.id) { unsaved.current = event.data.dirty === true; onDirty(unsaved.current); }
      if (event.data?.type === "breadboard:genoffice-file-error" && event.data.fileId === file.id) onError(event.data.error, event.data.conflict === true);
      if (event.data?.type === "breadboard:genoffice-file-chat" && event.data.fileId === file.id) {
        if (unsaved.current) { onError("Save your document before using it in chat.", false); return; }
        window.dispatchEvent(new CustomEvent("sb:garden-file-use", { detail: { file, action: "chat", instruction: event.data.instruction } }));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [file, onSaved, onDirty, onError]);
  useEffect(() => { if (copyRequest) frame.current?.contentWindow?.postMessage({ type: "breadboard:genoffice-save-copy" }, location.origin); }, [copyRequest]);
  return <iframe ref={frame} src={src} title={`${editing ? "Edit" : "Preview"} ${file.name}`} className={styles.frame} allow={editing ? "clipboard-read; clipboard-write" : ""} />;
}

function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = useMemo(() => {
    const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
    for (let index = 0; index < text.length && rows.length < 1000; index++) {
      const char = text[index];
      if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
      else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }, [text, delimiter]);
  return <div className={styles.scroll}><table className={styles.table}><tbody>{rows.map((row, index) => <tr key={index}><th>{index + 1}</th>{row.slice(0, 100).map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table>{rows.length >= 1000 && <p className={styles.hint}>Showing the first 1,000 rows. Download the original for the complete table.</p>}</div>;
}

const sandboxHtml = (html: string) => `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><style>body{margin:20px;font:14px system-ui}img{max-width:100%}</style>${html}`;

export default function GardenFileViewer({ file, onChanged, onClose, onDirtyChange }: {
  file: GardenFileEntry; onChanged: (entry: GardenFileEntry) => void; onClose: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [editing, setEditing] = useState(false), [content, setContent] = useState(""), [blocks, setBlocks] = useState<Record<string, string>>({});
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const [action, setAction] = useState<"rename" | "move" | "history" | "knowledge" | null>(null), [name, setName] = useState(file.name), [folder, setFolder] = useState(file.folder);
  const [versions, setVersions] = useState<GardenFileVersion[]>([]), [folders, setFolders] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1), [filter, setFilter] = useState("");
  const [nativeDirty, setNativeDirty] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [copyRequest, setCopyRequest] = useState(0);
  const nativeError = useCallback((error: string, conflict: boolean) => { setError(error); setConflict(conflict); }, []);
  usePageLoading(loading || busy);
  const menu = useRef<HTMLDetailsElement>(null), surface = useRef<HTMLDivElement>(null);
  const endpoint = gardenFileApi(file.gardenId, file.id), source = `${endpoint}/content`, mode = file.capabilities.editor;
  const modelFormat = gardenFileExtension(file.name) as ModelAttachmentFormat, convertModel = ["step", "stp", "iges", "igs", "brep"].includes(modelFormat);
  const resourceUrl = useCallback((url: string) => {
    if (/^(?:blob:|data:)/i.test(url)) return url;
    const primary = convertModel ? `${endpoint}/model` : source, base = `${endpoint}/`;
    if (new URL(url, location.href).href === new URL(primary, location.href).href) return primary;
    const relative = url.startsWith(base) ? url.slice(base.length) : url;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(relative)) throw new Error("Models can only load companion files from this garden.");
    return `${endpoint}/resources?path=${encodeURIComponent(relative)}`;
  }, [source, endpoint, convertModel]);
  const dirty = nativeDirty || Boolean(editing && editor && (mode === "text" ? content !== editor.content : editor.blocks?.some(block => blocks[block.anchor] !== block.text)));
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const beforeNavigate = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.hasAttribute("download") || link.target && link.target !== "_self") return;
      const next = new URL(link.href, location.href);
      if (next.origin !== location.origin || next.pathname === location.pathname && next.search === location.search) return;
      if (!window.confirm("Discard your unsaved changes?")) { event.preventDefault(); event.stopImmediatePropagation(); }
      else window.removeEventListener("beforeunload", beforeUnload);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, { capture: true });
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", beforeNavigate, { capture: true }); };
  }, [dirty]);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(""); setPreview(null); setEditor(null);
    const native = ["pdf", "image", "audio", "video", "binary"].includes(file.capabilities.viewer);
    if ((editing && (mode === "text" || mode === "cells" || mode === "blocks")) || !native) {
      setLoading(true);
      void fileRequest<Editor & Preview>(`${endpoint}/${editing ? "edit" : "preview"}`, { signal: controller.signal }).then(data => {
        if (controller.signal.aborted) return;
        setNativeReady(true);
        if (editing) { setEditor(data); setContent(data.content ?? ""); setBlocks(Object.fromEntries((data.blocks ?? []).map(block => [block.anchor, block.text]))); }
        else setPreview(data);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    } else setLoading(false);
    return () => controller.abort();
  }, [endpoint, file.version, file.capabilities.viewer, mode, editing, reload]);

  const changed = useCallback((entry: GardenFileEntry) => { setError(""); setConflict(false); onChanged(entry); window.dispatchEvent(new CustomEvent("sb:garden-file-updated", { detail: entry })); }, [onChanged]);
  const mutate = useCallback(async (payload: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const body = await fileRequest<{ file: GardenFileEntry }>(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: file.revision, ...payload }) });
      changed(body.file); setAction(null); if (payload.action === "restore-version") setReload(value => value + 1); return body.file;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); return null; }
    finally { setBusy(false); }
  }, [endpoint, file.revision, changed]);
  const save = useCallback(async (copy = false) => {
    if (!editor || !dirty || busy) return;
    setBusy(true); setError("");
    try {
      const body = await fileRequest<{ file: GardenFileEntry }>(`${endpoint}/edit`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: editor.file.revision, copy, baseVersion: editor.file.version,
        ...(mode === "text" ? { content } : { patches: editor.blocks?.filter(block => blocks[block.anchor] !== block.text).map(block => ({ anchor: block.anchor, text: blocks[block.anchor] })) }) }) });
      setEditor(current => current && { ...current, file: body.file, content, blocks: current.blocks?.map(block => ({ ...block, text: blocks[block.anchor] })) });
      changed(body.file);
      setConflict(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be saved."); setConflict((cause as { status?: number }).status === 409); }
    finally { setBusy(false); }
  }, [editor, dirty, busy, endpoint, mode, content, blocks, changed]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editing) { event.preventDefault(); void save(); }
      if (event.key === "Escape" && menu.current?.open) menu.current.open = false;
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [editing, save]);

  const chooseAction = (next: typeof action) => {
    if (menu.current) menu.current.open = false;
    setAction(next); setName(file.name); setFolder(file.folder); setError("");
    if (next === "history") void fileRequest<{ versions: GardenFileVersion[] }>(`${endpoint}/versions`).then(body => setVersions(body.versions)).catch(cause => setError(cause.message));
    if (next === "move") void fileRequest<{ files: GardenFileEntry[] }>(gardenFileApi(file.gardenId)).then(body => setFolders(body.files.filter(entry => entry.kind === "folder").map(entry => entry.path))).catch(cause => setError(cause.message));
  };
  const toggleEdit = () => { if (dirty && !window.confirm("Discard your unsaved changes?")) return; setNativeDirty(false); setEditing(value => !value); setAction(null); };
  const exportToExplorer = async () => {
    if (menu.current) menu.current.open = false;
    setBusy(true); setError("");
    try {
      const result = await fileRequest<{ path: string }>(`${endpoint}/export`, { method: "POST" });
      if (!await openInFileExplorer({ path: result.path, isFolder: false })) throw new Error("File Explorer could not be opened. Use Download to save a copy instead.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be exported."); }
    finally { setBusy(false); }
  };

  let viewer;
  if (editing && editor && (mode === "text" || mode === "cells" || mode === "blocks")) {
    viewer = mode === "text" ? <textarea autoFocus className={styles.textEditor} aria-label={`Edit ${file.name}`} spellCheck={file.capabilities.viewer === "markdown"} value={content} onChange={event => setContent(event.target.value)} />
      : <div className={styles.scroll}><input className={styles.filter} aria-label="Find a cell or slide" placeholder={mode === "cells" ? "Find a sheet or cell…" : "Find slide text…"} value={filter} onChange={event => setFilter(event.target.value)} />
        {editor.truncated && <p className={styles.hint}>Only the first editable items are shown. Other content is preserved when saving.</p>}
        <table className={styles.table}><tbody>{editor.blocks?.filter(block => `${block.anchor} ${blocks[block.anchor]}`.toLowerCase().includes(filter.toLowerCase())).map(block => <tr key={block.anchor}><th>{block.sheet ? `${block.sheet} · ${block.cell}` : `Slide ${block.slide ?? ""}`}</th><td><textarea aria-label={block.anchor} disabled={!block.editable} value={blocks[block.anchor] ?? ""} onChange={event => setBlocks(current => ({ ...current, [block.anchor]: event.target.value }))} rows={mode === "cells" ? 1 : 3} /></td></tr>)}</tbody></table></div>;
  } else if (mode === "docx" && nativeReady) viewer = <NativeWord key={reload} file={file} editing={editing} onSaved={changed} onDirty={setNativeDirty} onError={nativeError} copyRequest={copyRequest} />;
  else if (file.capabilities.viewer === "pdf") viewer = <div className={styles.pdf}><PdfViewer key={reload} title={file.name} sourceUrl={source} readOnly={!file.canEdit || mode !== "pdf"} fileRevision={file.revision} showNavbarFlowers={false} /></div>;
  else if (file.capabilities.viewer === "image") viewer = <div className={styles.imageCanvas}><div className={styles.zoom}><button onClick={() => setZoom(value => Math.max(.25, value - .25))} aria-label="Zoom out">−</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(value => Math.min(4, value + .25))} aria-label="Zoom in">+</button></div><img key={`${file.version}:${reload}`} src={source} alt={file.name} style={{ maxWidth: `${zoom * 100}%`, width: zoom > 1 ? `${zoom * 100}%` : undefined }} onError={() => setError("This image could not be displayed. You can still download the original.")} /></div>;
  else if (file.capabilities.viewer === "audio") viewer = <div className={styles.media}><audio key={`${file.version}:${reload}`} controls src={source} preload="metadata" onError={() => setError("This audio format cannot be played here. Download it to open it in another app.")} /></div>;
  else if (file.capabilities.viewer === "video") viewer = <div className={styles.media}><video key={`${file.version}:${reload}`} controls src={source} preload="metadata" onError={() => setError("This video codec cannot be played here. Download it to open it in another app.")} /></div>;
  else if (file.capabilities.viewer === "model" && preview) viewer = <ModelViewer key={reload} source={convertModel ? `${endpoint}/model` : source} resourceUrl={resourceUrl} format={convertModel ? "glb" : modelFormat} presentation="asset" showGrid onError={() => setError("This model could not be previewed. Import any companion files beside it, try again, or download the original.")} />;
  else if (preview?.kind === "html") viewer = <iframe className={styles.frame} title={`${file.name} preview`} sandbox="" srcDoc={sandboxHtml(preview.html ?? "")} />;
  else if (preview?.kind === "archive") viewer = <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Name</th><th>Size</th></tr></thead><tbody>{preview.entries?.map(entry => <tr key={entry.path}><td>{entry.path}</td><td>{entry.folder ? "Folder" : gardenFileSize(entry.size)}</td></tr>)}</tbody></table></div>;
  else if (preview?.kind === "document" || (preview && file.capabilities.viewer === "markdown")) viewer = <div className={styles.prose}><ChatMarkdown content={preview.markdown ?? preview.text ?? ""} />{preview.warnings?.map(warning => <p key={warning} className={styles.hint}>{warning}</p>)}</div>;
  else if (preview && file.capabilities.viewer === "table") viewer = <DelimitedTable text={preview.text ?? ""} delimiter={gardenFileExtension(file.name) === "tsv" ? "\t" : ","} />;
  else if (preview && file.capabilities.viewer === "html") viewer = <iframe className={styles.frame} title={`${file.name} preview`} sandbox="" srcDoc={sandboxHtml(preview.text ?? "")} />;
  else if (preview?.text !== undefined) {
    let text = preview.text;
    if (file.capabilities.viewer === "json") { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Show the original if incomplete or malformed. */ } }
    viewer = <pre className={styles.code}>{text}</pre>;
  } else if (file.capabilities.viewer === "binary") viewer = <div className={styles.unavailable}><p>No preview is available for this file type.</p><a href={`${source}?download=1`} download={file.name}>Download {file.name}</a></div>;

  return <section ref={surface} className={styles.viewer} data-garden-file-viewer aria-label={file.name} aria-busy={loading || busy}>
    <header className={styles.toolbar}>
      <button onClick={onClose} title="Back to garden" aria-label="Back to garden"><ArrowLeft size={17} /></button>
      <div className={styles.title}><strong title={file.path}>{file.name}</strong><span>{file.folder ? `${file.folder} · ` : ""}{gardenFileSize(file.size)}{file.visibility === "private" ? " · Private" : " · Shared with garden"}</span></div>
      {file.canEdit && mode && mode !== "pdf" && <button onClick={toggleEdit} disabled={busy || loading} className={styles.labeled}>{editing ? <X size={15} /> : <Pencil size={15} />}{editing ? "Done" : "Edit"}</button>}
      {editing && mode !== "docx" && <button className={styles.labeled} onClick={() => void save()} disabled={!dirty || busy}><Save size={15} />{busy ? "Saving…" : "Save"}</button>}
      <a href={`${source}?download=1`} download={file.name} aria-label="Download original" title="Download"><Download size={17} /></a>
      {file.canEdit && <details ref={menu} className={styles.menu}><summary aria-label="File actions" title="File actions"><MoreHorizontal size={18} /></summary><div>
        <button onClick={() => chooseAction("rename")} disabled={dirty}>Rename</button><button onClick={() => chooseAction("move")} disabled={dirty}>Move to…</button>
        <button disabled={busy || dirty} onClick={() => { if (menu.current) menu.current.open = false; void mutate({ action: "copy" }); }}>Make a copy</button>
        <button onClick={() => chooseAction("history")} disabled={dirty}>Version history</button>
        {fileExplorerControl() && <button disabled={busy || dirty} onClick={() => void exportToExplorer()}>Export to File Explorer</button>}
        <button disabled={busy || dirty} onClick={() => { if (menu.current) menu.current.open = false; void mutate({ action: "share", visibility: file.visibility === "private" ? "garden" : "private" }); }}>{file.visibility === "private" ? "Share with garden" : "Make private"}</button>
        <button disabled={dirty} onClick={() => { if (menu.current) menu.current.open = false; window.dispatchEvent(new CustomEvent("sb:garden-file-use", { detail: { file, action: "chat" } })); }}>Use in chat</button>
        {file.capabilities.canIndex && <button disabled={dirty} onClick={() => chooseAction("knowledge")}>Add to knowledge</button>}
        <button disabled={busy || dirty} className={styles.danger} onClick={() => { if (menu.current) menu.current.open = false; void mutate({ action: "trash" }).then(result => { if (result) onClose(); }); }}>Move to trash</button>
      </div></details>}
    </header>
    {error && <p role="alert" className={styles.error}>{error}{conflict && dirty && (editor || mode === "docx") && <button disabled={busy} onClick={() => mode === "docx" ? setCopyRequest(value => value + 1) : void save(true)}>Save a copy</button>}{!dirty && <button onClick={() => setReload(value => value + 1)}>Retry</button>}</p>}
    {preview?.truncated && <p className={styles.hint}>Showing a preview of this large file. Download it for the complete contents.</p>}
    {action === "rename" || action === "move" ? <form className={styles.action} onSubmit={event => { event.preventDefault(); const path = action === "rename" ? `${file.folder ? `${file.folder}/` : ""}${name}` : `${folder ? `${folder}/` : ""}${file.name}`; void mutate({ action: "move", path }); }}>
      <label>{action === "rename" ? "File name" : "Folder"}<input autoFocus value={action === "rename" ? name : folder} onChange={event => action === "rename" ? setName(event.target.value) : setFolder(event.target.value)} list={action === "move" ? "garden-file-folders" : undefined} /></label>
      <datalist id="garden-file-folders"><option value="">Garden root</option>{folders.map(item => <option key={item} value={item} />)}</datalist>
      <button type="submit" disabled={busy || (action === "rename" && !name.trim())}>{action === "rename" ? "Rename" : "Move"}</button><button type="button" onClick={() => setAction(null)}>Cancel</button>
    </form> : action === "history" ? <div className={styles.history}><div><strong>Version history</strong><button onClick={() => setAction(null)} aria-label="Close version history"><X size={16} /></button></div>{versions.map(version => <div key={version.version}><span>Version {version.version} · {new Date(version.createdAt).toLocaleString()} · {gardenFileSize(version.size)}</span><a href={`${source}?download=1&version=${version.version}`}>Download</a>{version.version !== file.version && <button disabled={busy} onClick={() => void mutate({ action: "restore-version", version: version.version })}><RotateCcw size={13} />Restore</button>}</div>)}</div> : null}
    {action === "knowledge" && <Knowledge file={file} onClose={() => setAction(null)} />}
    <div className={styles.content}>{viewer}</div>
    {dirty && <div className={styles.saveStatus} role="status">Unsaved changes</div>}
  </section>;
}
