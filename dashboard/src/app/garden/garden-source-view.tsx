"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Captions, Clapperboard, Download, FileText, X } from "lucide-react";
import ChatMarkdown from "@/app/components/chat-markdown";
import { gardenDocumentNoteSlug } from "@/lib/garden-document-route";
import { audioAttachmentFormat } from "@/lib/audio-attachments";
import { videoAttachmentFormat } from "@/lib/video-attachments";
import type { QuartzAssistantSelectionRequest } from "@/lib/quartz-assistant-selection";
import type { GardenFileEntry } from "@/lib/garden-files/types";
import styles from "./garden-files.module.css";

const loadFileViewer = () => import("./garden-file-viewer");
const loadPdfViewer = () => import("@/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client");
const FileViewer = dynamic(loadFileViewer, { ssr: false });
const PdfViewer = dynamic(loadPdfViewer, { ssr: false });

interface SourceDoc { slug: string; relPath: string; type: string; title: string; sourceType: string; sourceFile: string; sourcePdf: string; sourceMedia: string }
type Source = { cluster: string; doc: SourceDoc; kind: "pdf" | "audio" | "video" | "word"; file?: GardenFileEntry };
type Bounds = { left: number; top: number; width: number; height: number };

const normal = (slug: string) => slug.toLowerCase().replace(/\s+/g, "-");
function kindOf(doc: SourceDoc): Source["kind"] | null {
  if (doc.type !== "source-document") return null;
  if (doc.sourcePdf) return "pdf";
  if (!doc.sourceMedia) return null;
  const type = doc.sourceType.toLowerCase();
  if (type.includes("audio") || audioAttachmentFormat(doc.sourceFile)) return "audio";
  if (type.includes("video") || type === "youtube" || videoAttachmentFormat(doc.sourceFile)) return "video";
  return null;
}

/**
 * An uploaded PDF, recording or video opens in the Garden reader itself: its Quartz page is replaced by the
 * original (the PDF viewer, or a player above the transcript), beside the file tree. The reader's Assistant
 * answers about it; selecting PDF text gives the usual menu (Ask in chat goes to that Assistant, Ask here answers in place, highlights).
 */
export default function GardenSourceView({ iframeRef, quartzOrigin, onAsk }: { iframeRef: RefObject<HTMLIFrameElement | null>; quartzOrigin: string; onAsk: (request: QuartzAssistantSelectionRequest) => void }) {
  const [source, setSource] = useState<Source | null>(null), [bounds, setBounds] = useState<Bounds | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // View raw: the note's own text in Quartz, with an Open document button there to come back.
  const [raw, setRaw] = useState(false);
  // The video editor opens right here, over the player, with the reader's file tree and Assistant beside it.
  const [editing, setEditing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const documents = useRef(new Map<string, Promise<SourceDoc[]>>()), ticket = useRef(0), shown = useRef(false), shownNote = useRef("");
  const post = useCallback((message: object) => { if (quartzOrigin) iframeRef.current?.contentWindow?.postMessage(message, quartzOrigin); }, [iframeRef, quartzOrigin]);

  useEffect(() => {
    const listFor = (cluster: string, fresh = false) => {
      let list = documents.current.get(cluster);
      if (!list || fresh) {
        list = fetch(`/api/documents?clusterSlug=${encodeURIComponent(cluster)}`, { cache: "no-store" })
          .then(response => response.ok ? response.json() : { documents: [] })
          .then((body: { documents?: SourceDoc[] }) => body.documents ?? [])
          .catch(() => { documents.current.delete(cluster); return []; });
        documents.current.set(cluster, list);
      }
      return list;
    };
    const onNote = (event: Event) => {
      const { cluster, slug } = (event as CustomEvent<{ cluster: string; slug: string }>).detail ?? {};
      // Quartz re-announces the page it is on; keep what is showing (and any unsaved Word edits).
      if (shown.current && shownNote.current === `${cluster}/${slug}`) return;
      const mine = ++ticket.current;
      setSource(null); setRaw(false); setEditing(false); shown.current = false; shownNote.current = `${cluster}/${slug}`;
      if (!cluster || !slug) return;
      // Quartz hides every …/sources/<note> until answered; a note this view does not cover gets "none".
      if (!/^sources\//i.test(slug)) { if (/(^|\/)sources\/[^/]+$/i.test(slug)) post({ type: "second-brain:source-none" }); return; }
      const find = (list: SourceDoc[]) => list.find(entry => normal(gardenDocumentNoteSlug(entry)) === normal(slug));
      // The list is fetched once per Garden; a source added since then refetches it.
      void listFor(cluster).then(list => find(list) ? list : listFor(cluster, true)).then(list => {
        if (mine !== ticket.current) return;
        const doc = find(list);
        const kind = doc && kindOf(doc);
        if (doc?.type === "source-document" && !kind && /\.docx$/i.test(doc.sourceFile)) { void openWord(cluster, doc, mine); return; }
        // Quartz keeps a source note's text hidden until told: no original here, so show the note.
        if (!doc || !kind) { post({ type: "second-brain:source-none" }); return; }
        setSource({ cluster, doc, kind }); shown.current = true;
        post({ type: "second-brain:file-view", open: true });
      });
    };
    // A Word document opens as itself in the Word viewer (view, then Edit) from its Garden copy, made
    // the first time. A Word upload from before originals were kept stays on its note.
    const openWord = async (cluster: string, doc: SourceDoc, mine: number) => {
      const response = await fetch(`/api/documents/${encodeURIComponent(doc.slug)}/word-file?clusterSlug=${encodeURIComponent(cluster)}`, { method: "POST", cache: "no-store" }).catch(() => null);
      const file = response?.ok ? (await response.json().catch(() => null))?.file as GardenFileEntry | undefined : undefined;
      if (mine !== ticket.current) return;
      if (!file?.id) { post({ type: "second-brain:source-none" }); return; }
      setSource({ cluster, doc, kind: "word", file }); shown.current = true;
      post({ type: "second-brain:file-view", open: true });
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== quartzOrigin || !event.data) return;
      const data = event.data;
      if (data.type === "second-brain:file-bounds" && [data.left, data.top, data.width, data.height].every(Number.isFinite)) {
        const rect = iframeRef.current?.getBoundingClientRect();
        if (rect) setBounds({ left: rect.left + data.left, top: rect.top + data.top, width: Math.min(data.width, rect.width - data.left), height: rect.height - data.top }); // down to the frame's bottom: no strip of the page shows under it
      }
      if (data.type === "second-brain:source-view" && data.open === true) setRaw(false);
      // A Garden file opened from the tree takes the pane; the files bridge owns it from here.
      if (shown.current && /^second-brain:open-file/.test(data.type)) { ticket.current++; shown.current = false; setSource(null); }
    };
    window.addEventListener("sb:active-note", onNote);
    window.addEventListener("message", onMessage);
    // Opening a source should not wait on setup: fetch this Garden's sources and the viewers' code now.
    const garden = /^\/garden\/([^/?#]+)/.exec(location.pathname)?.[1];
    if (garden) void listFor(decodeURIComponent(garden));
    void loadPdfViewer().catch(() => {}); void loadFileViewer().catch(() => {});
    return () => { window.removeEventListener("sb:active-note", onNote); window.removeEventListener("message", onMessage); };
  }, [iframeRef, quartzOrigin, post]);

  // Quartz trusts the pane request only once the files snapshot has named this window; on a fresh
  // load the lookup above can win that race, so ask again until Quartz answers with bounds.
  const [sized, setSized] = useState(false);
  useEffect(() => {
    setSized(false);
    if (!source) return;
    if (raw) { post({ type: "second-brain:file-view", open: false, raw: true }); return; }
    // Ask for the pane's size now (listening first), and again until the reader answers.
    let tries = 0;
    // Bounds alone do not mean Quartz took the viewer as open (a "viewer open" sent before the file list was
    // dropped by older Quartz builds, leaving its text and reader-mode layout as if nothing were open): keep
    // asking until its bounds say open, for up to 10 s.
    const answered = (event: MessageEvent) => {
      if (event.data?.type !== "second-brain:file-bounds" || event.source !== iframeRef.current?.contentWindow) return;
      setSized(true);
      if (event.data.open === true) window.clearInterval(timer);
    };
    window.addEventListener("message", answered);
    post({ type: "second-brain:file-view", open: true });
    const timer = window.setInterval(() => { if (++tries > 40) window.clearInterval(timer); else post({ type: "second-brain:file-view", open: true }); }, 250);
    return () => { window.clearInterval(timer); window.removeEventListener("message", answered); };
  }, [source, raw, post, iframeRef]);

  // A recording's note: its generated notes go under the player, its transcript into the tab.
  useEffect(() => {
    setTranscript("");
    if (!source || source.kind === "pdf") return;
    const controller = new AbortController();
    void fetch(`/api/documents/${encodeURIComponent(source.doc.slug)}?clusterSlug=${encodeURIComponent(source.cluster)}`, { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null).then(body => { if (body?.body) setTranscript(String(body.body)); }).catch(() => {});
    return () => controller.abort();
  }, [source]);


  if (!source || !bounds || !sized || raw) return null;
  const viewRaw = <button type="button" className={styles.labeled} onClick={() => setRaw(true)} title="Show this page's text"><FileText size={15} />View raw</button>;
  const { cluster, doc, kind } = source, name = doc.sourceFile || doc.title;
  const media = `/api/gardens/${encodeURIComponent(cluster)}/media/${encodeURIComponent(doc.slug)}`;
  const editHref = `/spaces/edit?${new URLSearchParams({ app: "video", garden: cluster, title: (doc.title || "Recording").replace(/\.(mp4|webm|mov|m4v|mkv)$/i, "").slice(0, 100), media, embed: "1" })}`;
  return createPortal(<div className={styles.overlay} style={bounds} data-garden-source-view={kind}>
    <section className={styles.viewer} aria-label={name}>
      {(kind === "audio" || kind === "video") && <header className={styles.toolbar}>
        <div className={styles.title}><strong title={name}>{doc.title || name}</strong><span>{kind === "video" ? "Video" : "Recording"} · {name}</span></div>
        {viewRaw}
        <button type="button" className={styles.labeled} aria-pressed={transcriptOpen} onClick={() => setTranscriptOpen(open => !open)}><Captions size={15} />Transcript</button>
        {kind === "video" && <button type="button" className={styles.labeled} aria-pressed={editing} onClick={() => setEditing(open => !open)}><Clapperboard size={15} />{editing ? "Back to video" : "Edit video"}</button>}
        <a href={media} download={name} aria-label="Download original" title="Download"><Download size={17} /></a>
      </header>}
      <div className={styles.content}>
        {editing && kind === "video"
          ? <iframe className={styles.frame} title={`Edit video: ${name}`} src={editHref} allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera; cross-origin-isolated" />
          : kind === "word" && source.file
          ? <FileViewer key={source.file.id} file={source.file} onChanged={file => setSource(current => current?.file?.id === file.id ? { ...current, file } : current)} onClose={() => { ticket.current++; shown.current = false; setSource(null); }} />
          : kind === "pdf"
          ? <div className={styles.pdf}><PdfViewer key={doc.slug} clusterSlug={cluster} documentSlug={doc.slug} title={doc.title || name} browserTitle={name} showNavbarFlowers={false} framed
            onAskInChat={selection => onAsk({ requestId: `pdf-${Date.now()}`, highlightId: selection.id, mode: "chat", text: selection.quote, prefix: selection.prefix, suffix: selection.suffix, pageSlug: gardenDocumentNoteSlug(doc) })}
            toolbarActions={<button type="button" onClick={() => setRaw(true)} title="Show this page's text" className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white"><FileText size={13} aria-hidden="true" />View raw</button>} /></div>
          : <MediaSource key={doc.slug} kind={kind === "audio" ? "audio" : "video"} src={media} body={transcript} transcriptOpen={transcriptOpen} onCloseTranscript={() => setTranscriptOpen(false)}
            onOpenNote={path => post({ type: "second-brain:open-library-note", cluster, path })} />}
      </div>
    </section>
  </div>, document.body);
}

export interface TranscriptCue { time: number; text: string }

/**
 * A recording's note splits in two: the generated notes, and the transcript (`**[hh:mm:ss]** words` lines
 * under `## Transcript`). Wikilinks become `#bb-note:` links the view opens in the reader.
 */
export function splitMediaNote(body: string): { notes: string; cues: TranscriptCue[] } {
  const at = body.search(/^## Transcript\s*$/m);
  const notes = (at < 0 ? body : body.slice(0, at)).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
    (_, target: string, label?: string) => `[${(label ?? target.split("/").at(-1) ?? target).trim()}](#bb-note:${encodeURIComponent(target.trim())})`);
  const cues: TranscriptCue[] = [];
  if (at >= 0) for (const match of body.slice(at).matchAll(/^\*\*\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\*\*\s*(.+)$/gm)) {
    cues.push({ time: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), text: match[4].trim() });
  }
  return { notes: notes.trim(), cues };
}

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = Math.floor(seconds % 60);
  return `${h ? `${h}:` : ""}${h ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
};

/** The player, the generated notes under it, and a transcript tab from the left that follows and seeks the player. */
function MediaSource({ kind, src, body, transcriptOpen, onCloseTranscript, onOpenNote }: {
  kind: "audio" | "video"; src: string; body: string; transcriptOpen: boolean; onCloseTranscript: () => void; onOpenNote: (path: string) => void;
}) {
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null), list = useRef<HTMLOListElement>(null);
  const [now, setNow] = useState(0);
  const { notes, cues } = useMemo(() => splitMediaNote(body), [body]);
  let current = -1;
  for (let index = 0; index < cues.length && cues[index].time <= now; index++) current = index;
  useEffect(() => {
    if (transcriptOpen) list.current?.querySelector<HTMLElement>(`[data-cue="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, transcriptOpen]);
  const seek = (time: number) => { const media = player.current; if (!media) return; media.currentTime = time; void media.play().catch(() => {}); };
  const media = { ref: player, controls: true, preload: "metadata", src, onTimeUpdate: () => setNow(player.current?.currentTime ?? 0) } as const;
  return <div className={styles.mediaSource}>
    <aside className={styles.transcriptTab} data-open={transcriptOpen || undefined} aria-hidden={!transcriptOpen} aria-label="Transcript">
      <header><strong>Transcript</strong><button type="button" onClick={onCloseTranscript} aria-label="Close transcript"><X size={15} /></button></header>
      {cues.length ? <ol ref={list}>{cues.map((cue, index) => <li key={index} data-cue={index}>
        <button type="button" aria-current={index === current || undefined} tabIndex={transcriptOpen ? 0 : -1} onClick={() => seek(cue.time)}>
          <time>{clock(cue.time)}</time><span>{cue.text}</span>
        </button>
      </li>)}</ol> : <p>{body ? "This recording has no timed transcript." : "Loading the transcript…"}</p>}
    </aside>
    <div className={styles.prose} onClick={event => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#bb-note:']");
      if (!link) return;
      event.preventDefault();
      onOpenNote(`${decodeURIComponent(link.getAttribute("href")!.slice("#bb-note:".length))}.md`);
    }}>
      <div className={styles.sourcePlayer}>{kind === "video" ? <video {...media} /> : <audio {...media} />}</div>
      {notes && <ChatMarkdown content={notes} />}
    </div>
  </div>;
}

