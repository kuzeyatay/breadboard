"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clapperboard } from "lucide-react";
import SpacesShell, { type SpacesGarden } from "@/app/spaces/spaces-shell";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import styles from "../design/design.module.css";
import own from "./video-studio.module.css";

interface Source { id: string; conversationId: string; title: string; kind: string }
interface Call { id: string; name: string; args: Record<string, unknown> }
type Outcome = { result?: unknown; error?: string };

/** A Spaces video: a Garden file the studio imports and saves exports into (a new video has no file until its first save). */
export interface VideoGardenFile { gardenId: string; fileId: string | null; name: string }
const VIDEO_FILE = /\.(mp4|webm|mov)$/i;

// Breadboard's code-to-video makers, one tap from the editor: the prompt lands in the video assistant's composer.
const MAKERS: { label: string; hint: string; text: string }[] = [
  { label: "2D title card", hint: "Motion graphics with /video", text: "/video Make a 4-second 2D title card for the video open in Spaces, titled after what it shows, in a look that fits it. Then import it and put it at the start of the timeline." },
  { label: "2D explainer shot", hint: "Animated diagram or text with /video", text: "/video Make a short 2D animated explainer shot that fits the video open in Spaces. Then import it and add it to the timeline after the current clip." },
  { label: "3D cinematic shot", hint: "Three.js scene with /film", text: "/film Make a 5-second 3D cinematic opening shot for the video open in Spaces. Then import it and put it at the start of the timeline." },
  { label: "Lower third", hint: "Name and title overlay with /video", text: "/video Make a 4-second lower third (name and role) for the person in the video open in Spaces. Then import it and place it as a picture-in-picture overlay near the start." },
];

/** Breadboard's theme now; the editor is served in a matching light or dark palette. */
const currentScheme = () => {
  const root = document.documentElement;
  return root.dataset.theme === "dark" || (root.dataset.theme !== "light" && getComputedStyle(root).colorScheme.includes("dark")) ? "dark" : "light";
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "The video editor did not answer.");
  return json;
}

/** Reads the media as a file for the editor, reporting how far it got (a lecture recording can be gigabytes). */
async function fileFrom(url: string, filename: string, progress?: (loaded: number, total: number) => void): Promise<File> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not read that media.");
  const named = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1];
  const type = response.headers.get("Content-Type") ?? "", total = Number(response.headers.get("Content-Length")) || 0;
  const chunks: BlobPart[] = [], reader = response.body?.getReader();
  let loaded = 0;
  if (reader) for (let part = await reader.read(); !part.done; part = await reader.read()) { chunks.push(part.value); loaded += part.value.byteLength; progress?.(loaded, total); }
  else chunks.push(await response.blob());
  return new File(chunks, named ? decodeURIComponent(named) : filename || "media", { type });
}
const gigabytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export default function VideoStudioClient({ source, gardenFile = null, garden, showFlowers, importUrl = null }: {
  source: Source | null; gardenFile?: VideoGardenFile | null; garden: SpacesGarden | null; showFlowers: boolean;
  /** A Garden recording opened from the reader ("Open in editor"): it goes into My assets; saving makes a new Spaces video. */
  importUrl?: string | null;
}) {
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [scheme, setScheme] = useState<"light" | "dark" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [spacesFile, setSpacesFile] = useState<VideoGardenFile | null>(gardenFile);
  const [editorReady, setEditorReady] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved"; error?: string }>({ state: "idle" });
  const [makersOpen, setMakersOpen] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, (outcome: Outcome) => void>());
  const ready = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!ready.current) { let resolve!: () => void; ready.current = { promise: new Promise<void>(r => { resolve = r; }), resolve }; }

  // Start the editor's server (a source checkout builds it on first use), then frame it.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    startNavigationProgress();
    (async () => {
      const response = await fetch("/api/video-studio", { cache: "no-store" });
      const access = await response.json().catch(() => ({})) as { port?: number; error?: string };
      if (!response.ok || !access.port) throw new Error(access.error ?? "The video editor could not start.");
      if (!cancelled) setFrameSrc(`http://127.0.0.1:${access.port}/`);
      if (!cancelled) setScheme(currentScheme());
    })().catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : String(cause)); cancelNavigationProgress(); } });
    return () => { cancelled = true; };
  }, [attempt]);

  // A theme switch reloads the editor in the other palette (its project is kept in the editor's own storage).
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(current => current && currentScheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  // Closing the tab tells the server at once; otherwise presence lapses 45 s after the last poll.
  useEffect(() => {
    const close = () => { navigator.sendBeacon?.("/api/video-studio", new Blob([JSON.stringify({ action: "close" })], { type: "application/json" })); };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ source: "breadboard", ...message }, "*");
  }, []);

  const runInEditor = useCallback(async (call: Call): Promise<Outcome> => {
    await ready.current!.promise;
    let files: File[] | undefined;
    if (call.name === "__breadboard_import") {
      const items = (call.args.items as { url: string; filename: string }[] | undefined) ?? [];
      let last = 0;
      try {
        files = await Promise.all(items.map(item => fileFrom(item.url, item.filename, (loaded, total) => {
          if (Date.now() - last < 250) return;
          last = Date.now();
          setLoadingMedia(`Loading the video into the editor… ${total ? `${Math.floor(loaded / total * 100)}% of ${gigabytes(total)}` : gigabytes(loaded)}`);
        })));
      } finally { setLoadingMedia(null); }
    }
    return new Promise<Outcome>(resolve => {
      const timer = window.setTimeout(() => { pending.current.delete(call.id); resolve({ error: "The editor did not answer." }); }, 10 * 60_000);
      pending.current.set(call.id, outcome => { window.clearTimeout(timer); resolve(outcome); });
      send({ type: "call", id: call.id, name: call.name, args: call.args, files });
    });
  }, [send]);

  // Messages from the editor frame: its tools, call answers and downloaded exports.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; id?: string; tools?: unknown[]; result?: unknown; error?: string; filename?: string; blob?: Blob } | null;
      if (data?.source !== "timeline-studio") return;
      if (data.type === "ready") send({ type: "list" });
      if (data.type === "tools" && Array.isArray(data.tools)) {
        void post("/api/video-studio", { action: "tools", tools: data.tools }).catch(() => {});
        if (data.tools.length) { setEditorReady(true); ready.current!.resolve(); }
      }
      if (data.type === "library-pick" && typeof (data as { url?: unknown }).url === "string") {
        const pick = data as { url: string; filename?: string };
        // Only Breadboard's own media addresses are fetched.
        if (/^\/api\/gardens\/[^/]+\/(media|files)\//.test(pick.url)) {
          void runInEditor({ id: `pick-${Date.now()}`, name: "__breadboard_import", args: { items: [{ url: pick.url, filename: pick.filename ?? "" }] } })
            .then(outcome => { if (outcome.error) setError(outcome.error); });
        }
      }
      if (data.type === "result" && data.id) {
        pending.current.get(data.id)?.(typeof data.error === "string" ? { error: data.error } : { result: data.result });
        pending.current.delete(data.id);
      }
      if (data.type === "download" && data.blob instanceof Blob && VIDEO_FILE.test(data.filename ?? "")) {
        void fetch(`/api/video-studio/exports?filename=${encodeURIComponent(data.filename!)}`, { method: "POST", body: data.blob })
          .then(response => response.ok ? response.json() : null)
          .then((json: { exportId?: string } | null) => { if (json?.exportId) setLastExport(json.exportId); })
          .catch(() => {});
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, runInEditor]);

  // My assets lists the Garden's videos, recordings and images first, then every other Garden's.
  const libraryGarden = spacesFile?.gardenId ?? garden?.slug ?? "";
  useEffect(() => {
    if (!editorReady) return;
    const controller = new AbortController();
    fetch(`/api/video-studio/library?${new URLSearchParams({ garden: libraryGarden })}`, { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((body: { items?: { garden: string }[] } | null) => {
        if (body?.items) send({ type: "library", items: body.items.map(item => ({ ...item, here: item.garden === libraryGarden })) });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [editorReady, libraryGarden, send]);

  // Bread's calls: the server queues them, this page runs them in the editor and answers.
  useEffect(() => {
    if (!frameSrc) return;
    const controller = new AbortController();
    (async () => {
      while (!controller.signal.aborted) {
        try {
          // Each poll also says which video this page was opened on, so Bread knows what "this video" is.
          const query = spacesFile ? `?${new URLSearchParams({ garden: spacesFile.gardenId, file: spacesFile.fileId ?? "", title: spacesFile.name.replace(/\.[^.]+$/, "") })}`
            : source ? `?${new URLSearchParams({ artifact: source.id, conversation: source.conversationId })}` : "";
          const response = await fetch(`/api/video-studio/bridge${query}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
          const { calls } = await response.json() as { calls: Call[] };
          for (const call of calls) {
            void runInEditor(call)
              .catch(cause => ({ error: cause instanceof Error ? cause.message : String(cause) }))
              .then(outcome => post("/api/video-studio/bridge", { id: call.id, ...outcome }).catch(() => {}));
          }
        } catch {
          if (!controller.signal.aborted) await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();
    return () => controller.abort();
  }, [frameSrc, runInEditor, source, spacesFile]);

  /**
   * Imports media into My assets and, when the timeline is still empty, puts it on the timeline, so the video
   * the editor was opened on is the one being edited.
   */
  const openOnTimeline = useCallback(async (items: { url: string; filename: string }[]) => {
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const outcome = await runInEditor({ id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, args });
      if (outcome.error) throw new Error(outcome.error);
      return outcome.result as { ok?: boolean; error?: { code?: string; message?: string } } & Record<string, unknown>;
    };
    const assets = async () => ((await tool("timeline_assets_inspect", { limit: 100 })).items as { assetId: string; type: string; status: string }[] | undefined) ?? [];
    const before = new Set((await assets()).map(asset => asset.assetId));
    await tool("__breadboard_import", { items });
    // The editor reads the file's length and size first; a long recording takes a while.
    for (let tries = 0; tries < 600; tries++) {
      const fresh = (await assets()).find(asset => !before.has(asset.assetId) && asset.status === "ready");
      if (fresh) {
        if (fresh.type === "audio") return;
        const project = await tool("timeline_project_inspect");
        if (!project.ok || ((project.tracks as { visuals?: number } | undefined)?.visuals ?? 0) > 0) return;
        const preview = await tool("timeline_edit_preview", { stateToken: project.stateToken, summary: "Put the opened video on the timeline",
          operations: [{ type: "asset.insert", assetId: fresh.assetId, clipId: `opened-${fresh.assetId}`.slice(0, 120), track: "visuals", atIndex: 0 }] });
        if (preview.error?.code === "EDITOR_BUSY" || preview.error?.code === "STALE_STATE") { await pause(500); continue; }
        if (!preview.ok) throw new Error(preview.error?.message ?? "The video could not be put on the timeline.");
        const applied = await tool("timeline_edit_apply", { previewId: preview.previewId });
        if (!applied.ok) throw new Error(applied.error?.message ?? "The video could not be put on the timeline.");
        return;
      }
      await pause(500);
    }
  }, [runInEditor]);

  // A Spaces video goes straight onto the timeline, once per tab session.
  useEffect(() => {
    if (!editorReady || !gardenFile?.fileId) return;
    const key = `bb-video-studio-import:${gardenFile.fileId}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* import anyway */ }
    openOnTimeline([{ url: `/api/gardens/${encodeURIComponent(gardenFile.gardenId)}/files/${encodeURIComponent(gardenFile.fileId)}/content`, filename: gardenFile.name }])
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [editorReady, gardenFile, openOnTimeline]);

  useEffect(() => {
    if (!editorReady || !importUrl) return;
    const key = `bb-video-studio-import:${importUrl}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* import anyway */ }
    openOnTimeline([{ url: importUrl, filename: gardenFile?.name ?? "Recording.mp4" }])
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [editorReady, gardenFile, importUrl, openOnTimeline]);

  // A video opened from a chat goes straight onto the timeline, once per tab session.
  useEffect(() => {
    if (!editorReady || !source) return;
    const key = `bb-video-studio-import:${source.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* import anyway */ }
    openOnTimeline([{ url: `/api/video-studio/media?artifact=${encodeURIComponent(source.id)}`, filename: "" }])
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [editorReady, source, openOnTimeline]);

  // Every export saves itself: into Spaces (a new version of the file), or as a new version of the chat video.
  const savedExport = useRef<string | null>(null);
  useEffect(() => {
    if (!lastExport || savedExport.current === lastExport) return;
    savedExport.current = lastExport;
    if (spacesFile) void saveToSpaces(lastExport);
    else if (source?.kind === "video") void saveVersion(lastExport);
  });

  async function saveToSpaces(exportId: string) {
    if (!spacesFile) return;
    setSave({ state: "saving" });
    try {
      const { file } = await post("/api/video-studio", { action: "save-garden", exportId, gardenId: spacesFile.gardenId, fileId: spacesFile.fileId, title: spacesFile.name.replace(/\.[^.]+$/, "") }) as unknown as { file: { id: string; name: string } };
      setSpacesFile(current => current && { ...current, fileId: file.id, name: file.name });
      setSave({ state: "saved" });
    } catch (cause) {
      setSave({ state: "idle", error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  async function saveVersion(exportId: string) {
    if (!source) return;
    setSave({ state: "saving" });
    try {
      await post("/api/video-studio", { action: "save", exportId, artifactId: source.id });
      setSave({ state: "saved" });
    } catch (cause) {
      setSave({ state: "idle", error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  const title = spacesFile?.name ?? source?.title ?? "";

  return (
    <SpacesShell showFlowers={showFlowers} garden={garden} pageKey={spacesFile?.fileId ? `file:${spacesFile.fileId}` : undefined} trail={["Video", title]} actions={<>
      {save.error && <span role="alert" className={styles.error}>{save.error}</span>}
      {loadingMedia && <span role="status" className={own.loading}>{loadingMedia}</span>}
      <div className={own.makers}>
        <button type="button" className={own.secondary} aria-expanded={makersOpen} aria-haspopup="menu" onClick={() => setMakersOpen(open => !open)}
          title="Make new shots with the 2D and 3D video makers">
          <Clapperboard size={15} />Make a shot
        </button>
        {makersOpen && (
          <ul role="menu" className={own.menu} onKeyDown={event => { if (event.key === "Escape") setMakersOpen(false); }}>
            {MAKERS.map(maker => (
              <li key={maker.label} role="none">
                <button type="button" role="menuitem" autoFocus={maker === MAKERS[0]} onClick={() => {
                  setMakersOpen(false);
                  // Bread in the corner gets the prompt ready to send.
                  window.dispatchEvent(new CustomEvent("sb:assistant-prefill", { detail: { text: maker.text } }));
                }}>
                  <span>{maker.label}</span><small>{maker.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {save.state !== "idle" && <span role="status" className={own.loading}>{save.state === "saving" ? "Saving export…" : <><Check size={13} /> Export saved{spacesFile ? " to Spaces" : " as a new version"}</>}</span>}
    </>}>
      {error ? (
        <p role="alert" className={styles.failure}>
          {error} <button type="button" onClick={() => { setError(null); setAttempt(n => n + 1); }}>Try again</button>
        </p>
      ) : null}
      {frameSrc && scheme ? (
        <iframe ref={frame} className={styles.frame} src={`${frameSrc}?theme=${scheme ?? "dark"}`} title="Video editor" onLoad={cancelNavigationProgress}
          allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera; cross-origin-isolated" />
      ) : !error ? <div className={styles.frame} /> : null}
    </SpacesShell>
  );
}
