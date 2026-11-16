"use client";

import { useEffect, useRef, useState } from "react";
import PdfViewerClient from "@/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client";
import styles from "@/app/garden/garden-files.module.css";
import VideoPlayerClient from "@/app/components/video-player-client";
import { LOCAL_DOCUMENT_ACCEPT, localDocument, localFileKind, setLocalDocument } from "@/lib/local-document";
import { DOCUMENT_FILENAME_HEADER } from "@/lib/document-attachments.ts";
import { STORED_FILE_FILENAME_HEADER } from "@/lib/stored-file-attachments.ts";
import { VIDEO_FILENAME_HEADER } from "@/lib/video-attachments.ts";

export type StoredOpenedFile = { kind: "pdf" | "image" | "video"; url: string };

// A picked PDF is identified by content, so reopening the same file lands on the
// same highlights, assistant chats and reading position. Every picked file's
// bytes are kept on this computer with the website-PDF lifetime: a restored tab
// reopens it after a restart (browser storage dies with the dashboard's
// per-launch origin) and Settings decides cleanup.
async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

const STORES = {
  pdf: { endpoint: "/api/chat-attachments/documents", header: DOCUMENT_FILENAME_HEADER },
  image: { endpoint: "/api/chat-attachments/files", header: STORED_FILE_FILENAME_HEADER },
  video: { endpoint: "/api/chat-attachments/videos", header: VIDEO_FILENAME_HEADER },
};

// ponytail: every pick stores a new copy; the 30-day sweep reaps duplicates. Dedupe by hash if disk use matters.
async function keep(kind: StoredOpenedFile["kind"], body: Blob, name: string, signal: AbortSignal): Promise<string> {
  const store = STORES[kind];
  const response = await fetch(store.endpoint, {
    method: "POST", body, signal,
    headers: { "content-type": body.type || "application/octet-stream", [store.header]: encodeURIComponent(name), "x-document-store-only": "true" },
  });
  const result = await response.json().catch(() => null) as { blobId?: string; error?: string; message?: string } | null;
  if (!response.ok || !result?.blobId) throw new Error(result?.message ?? result?.error ?? "This file couldn’t be kept.");
  return result.blobId;
}

function storedUrl(kind: StoredOpenedFile["kind"], blobId: string, name: string): string {
  const id = encodeURIComponent(blobId);
  return kind === "image" ? `/api/chat-attachments/files?${new URLSearchParams({ blobId, name })}` : `${STORES[kind].endpoint}/${id}`;
}

type Opened = StoredOpenedFile & { hash: string; name: string };

/** The garden file viewer's image surface, on an image opened from disk. */
function ImageViewer({ opened }: { opened: Opened }) {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => { document.title = opened.name; }, [opened.name]);
  return <section className={`${styles.viewer} min-h-0 flex-1`} aria-label={opened.name}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.imageCanvas}>
      <div className={styles.zoom}>
        <button onClick={() => setZoom(value => Math.max(.25, value - .25))} aria-label="Zoom out">−</button>
        <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom(value => Math.min(4, value + .25))} aria-label="Zoom in">+</button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local file, not an optimizable asset */}
      <img src={opened.url} alt={opened.name} style={{ maxWidth: `${zoom * 100}%`, width: zoom > 1 ? `${zoom * 100}%` : undefined }}
        onError={() => setError("This image could not be displayed.")} />
    </div>
  </section>;
}

export default function LocalDocumentViewer({ stored, fastRead, showNavbarFlowers }: { stored: StoredOpenedFile | null; fastRead: boolean; showNavbarFlowers: boolean }) {
  const [file, setFile] = useState<File | null>(() => localDocument());
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setOpened(null); setError(""); setMissing(false);
    (async () => {
      if (!file) {
        const params = new URLSearchParams(window.location.search);
        const hash = /^[0-9a-f]{64}$/.test(params.get("doc") ?? "") ? params.get("doc")! : "";
        const name = params.get("name")?.trim() || "File";
        // A PDF without its content hash would land on fresh highlights and chats.
        if (!stored || (stored.kind === "pdf" && !hash)) { setMissing(true); return; }
        setOpened({ ...stored, hash, name });
        return;
      }
      const media = localFileKind(file.name);
      const kind = media === "document" ? "pdf" : media;
      let body: Blob = file;
      let hash = "";
      let name = file.name;
      if (kind === "pdf") {
        if (!/\.pdf$/i.test(file.name)) {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/local-document/pdf", { method: "POST", body: form, signal: controller.signal });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "This file couldn’t be opened.");
          body = await response.blob();
          name = `${file.name.replace(/\.[^.]+$/, "")}.pdf`;
        }
        // Hash the picked file, not the conversion, so a reconverted .docx keeps its identity.
        hash = await sha256(file);
      }
      const blobId = await keep(kind, body, name, controller.signal);
      const query = new URLSearchParams({ ...(hash ? { doc: hash } : {}), blob: blobId, name });
      window.history.replaceState(window.history.state, "", `/open?${query}`);
      if (controller.signal.aborted) return;
      setOpened({ kind, url: storedUrl(kind, blobId, name), hash, name });
    })().catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "This file couldn’t be opened.");
    });
    return () => controller.abort();
  }, [file, stored]);

  const choose = () => picker.current?.click();
  const input = <input ref={picker} type="file" hidden accept={LOCAL_DOCUMENT_ACCEPT} onChange={event => {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (next) { setLocalDocument(next); setFile(next); }
  }} />;

  if (opened?.kind === "pdf") {
    return <>{input}<PdfViewerClient key={opened.url} title={opened.name} browserTitle={opened.name} sourceUrl={opened.url} readOnly
      documentIdentity={`/open?doc=${opened.hash}`} fastRead={fastRead} showNavbarFlowers={showNavbarFlowers} /></>;
  }
  // Videos get the artifact video page's player: controls, keyboard, download and exit.
  if (opened?.kind === "video") {
    return <>{input}<VideoPlayerClient key={opened.url} title={opened.name} sourceUrl={opened.url} showNavbarFlowers={showNavbarFlowers} /></>;
  }
  if (opened) return <>{input}<ImageViewer key={opened.url} opened={opened} /></>;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      {input}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p>
        : missing ? <p className="text-sm text-gray-300">Open the file again to pick up where you left off.</p>
        : null}
      {(error || missing) && <button type="button" onClick={choose}
        className="rounded-md border border-gray-600 px-3 py-1.5 text-sm hover:bg-gray-800">Open a file</button>}
    </div>
  );
}
