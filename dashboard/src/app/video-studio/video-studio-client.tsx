"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Clapperboard, History } from "lucide-react";
import BackLink from "@/app/components/back-link";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import VideoAssistant from "./video-assistant";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import styles from "../design/design.module.css";
import own from "./video-studio.module.css";

interface Source { id: string; conversationId: string; title: string; kind: string }
interface Call { id: string; name: string; args: Record<string, unknown> }
type Outcome = { result?: unknown; error?: string };

const RAIL_KEY = "bb-video-studio-rail";
const MIN_RAIL = 340, MAX_RAIL = 720;
const VIDEO_FILE = /\.(mp4|webm|mov)$/i;

// Breadboard's code-to-video makers, one tap from the editor: the prompt lands in the video assistant's composer.
const MAKERS: { label: string; hint: string; text: string }[] = [
  { label: "2D title card", hint: "Motion graphics with /video", text: "/video Make a 4-second 2D title card for the video open in Video Studio, titled after what it shows, in a look that fits it. Then import it and put it at the start of the timeline." },
  { label: "2D explainer shot", hint: "Animated diagram or text with /video", text: "/video Make a short 2D animated explainer shot that fits the video open in Video Studio. Then import it and add it to the timeline after the current clip." },
  { label: "3D cinematic shot", hint: "Three.js scene with /film", text: "/film Make a 5-second 3D cinematic opening shot for the video open in Video Studio. Then import it and put it at the start of the timeline." },
  { label: "Lower third", hint: "Name and title overlay with /video", text: "/video Make a 4-second lower third (name and role) for the person in the video open in Video Studio. Then import it and place it as a picture-in-picture overlay near the start." },
];

function stored<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Video Studio did not answer.");
  return json;
}

async function fileFrom(url: string, filename: string): Promise<File> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not read that media.");
  const named = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1];
  const blob = await response.blob();
  return new File([blob], named ? decodeURIComponent(named) : filename || "media", { type: blob.type });
}

export default function VideoStudioClient({ source, showFlowers }: { source: Source | null; showFlowers: boolean }) {
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rail, setRail] = useState({ open: true, width: 440 });
  const [resizing, setResizing] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved"; error?: string }>({ state: "idle" });
  const [makersOpen, setMakersOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const prefillHandled = useCallback(() => setPrefill(null), []);
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, (outcome: Outcome) => void>());
  const ready = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!ready.current) { let resolve!: () => void; ready.current = { promise: new Promise<void>(r => { resolve = r; }), resolve }; }

  useEffect(() => setRail(stored(RAIL_KEY, { open: true, width: 440 })), []);
  const updateRail = useCallback((next: { open: boolean; width: number }) => {
    setRail(next);
    try { localStorage.setItem(RAIL_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  }, []);

  // Start the editor's server (a source checkout builds it on first use), then frame it.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    startNavigationProgress();
    (async () => {
      const response = await fetch("/api/video-studio", { cache: "no-store" });
      const access = await response.json().catch(() => ({})) as { port?: number; error?: string };
      if (!response.ok || !access.port) throw new Error(access.error ?? "Video Studio could not start.");
      if (!cancelled) setFrameSrc(`http://127.0.0.1:${access.port}/`);
    })().catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : String(cause)); cancelNavigationProgress(); } });
    return () => { cancelled = true; };
  }, [attempt]);

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
      files = await Promise.all(items.map(item => fileFrom(item.url, item.filename)));
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
      if (data.type === "result" && data.id) {
        pending.current.get(data.id)?.(typeof data.error === "string" ? { error: data.error } : { result: data.result });
        pending.current.delete(data.id);
      }
      if (data.type === "download" && data.blob instanceof Blob && VIDEO_FILE.test(data.filename ?? "")) {
        void fetch(`/api/video-studio/exports?filename=${encodeURIComponent(data.filename!)}`, { method: "POST", body: data.blob })
          .then(response => response.ok ? response.json() : null)
          .then((json: { exportId?: string } | null) => { if (json?.exportId) { setLastExport(json.exportId); setSave({ state: "idle" }); } })
          .catch(() => {});
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);

  // Bread's calls: the server queues them, this page runs them in the editor and answers.
  useEffect(() => {
    if (!frameSrc) return;
    const controller = new AbortController();
    (async () => {
      while (!controller.signal.aborted) {
        try {
          // Each poll also says which video this page was opened on, so Bread knows what "this video" is.
          const query = source ? `?${new URLSearchParams({ artifact: source.id, conversation: source.conversationId })}` : "";
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
  }, [frameSrc, runInEditor, source]);

  // A video opened from a chat goes straight into My assets, once per tab session.
  useEffect(() => {
    if (!editorReady || !source) return;
    const key = `bb-video-studio-import:${source.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* import anyway */ }
    void runInEditor({ id: `import-${Date.now()}`, name: "__breadboard_import", args: { items: [{ url: `/api/video-studio/media?artifact=${encodeURIComponent(source.id)}`, filename: "" }] } })
      .then(outcome => { if (outcome.error) setError(outcome.error); });
  }, [editorReady, source, runInEditor]);

  async function saveVersion() {
    if (!source || !lastExport) return;
    setSave({ state: "saving" });
    try {
      await post("/api/video-studio", { action: "save", exportId: lastExport, artifactId: source.id });
      setSave({ state: "saved" });
    } catch (cause) {
      setSave({ state: "idle", error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const left = event.currentTarget.parentElement!.getBoundingClientRect().left;
    let width = rail.width;
    setResizing(true);
    const move = (e: PointerEvent) => {
      width = Math.round(Math.min(MAX_RAIL, Math.max(MIN_RAIL, e.clientX - left)));
      setRail({ open: true, width });
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      updateRail({ open: true, width });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  const canSaveVersion = source?.kind === "video";

  return (
    <div className={styles.shell} data-resizing={resizing || undefined}>
      <header className={`breadboard-flower-navbar ${styles.navbar}`}>
        <NavbarFlowerWind showFlowers={showFlowers} />
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <BackLink fallbackHref="/new-tab" fallbackLabel="Back to home" />
          <span aria-hidden="true">/</span>
          <strong>Video</strong>
          {source && <><span aria-hidden="true">/</span><span className={styles.crumbTitle} title={source.title}>{source.title}</span></>}
        </nav>
        <div className={styles.actions}>
          {save.error && <span role="alert" className={styles.error}>{save.error}</span>}
          <div className={own.makers}>
            <button type="button" className={own.secondary} aria-expanded={makersOpen} aria-haspopup="menu" onClick={() => setMakersOpen(open => !open)}
              title="Make new shots with Breadboard's 2D and 3D video makers">
              <Clapperboard size={15} />Make a shot
            </button>
            {makersOpen && (
              <ul role="menu" className={own.menu} onKeyDown={event => { if (event.key === "Escape") setMakersOpen(false); }}>
                {MAKERS.map(maker => (
                  <li key={maker.label} role="none">
                    <button type="button" role="menuitem" autoFocus={maker === MAKERS[0]} onClick={() => {
                      setMakersOpen(false);
                      setPrefill(maker.text);
                    }}>
                      <span>{maker.label}</span><small>{maker.hint}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canSaveVersion && (
            <button type="button" className={styles.primary} disabled={!lastExport || save.state === "saving"} onClick={() => void saveVersion()}
              title={lastExport ? "Add the last export to the chat as a new version of this video" : "Export the video first (Export in the editor), then save it here"}>
              {save.state === "saved" ? <Check size={15} /> : <History size={15} />}
              {save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved as new version" : "Save as new version"}
            </button>
          )}
        </div>
      </header>
      <div className={styles.body}>
      <aside className={styles.rail} style={{ width: rail.width }} aria-label="Video assistant">
        <div className={styles.railInner}>
          <VideoAssistant source={source ? { id: source.id, title: source.title } : null} prefill={prefill} onPrefillHandled={prefillHandled} />
        </div>
        <div className={styles.resize} role="separator" aria-orientation="vertical" aria-label="Resize video assistant" onPointerDown={startResize} />
      </aside>
      <main className={styles.stage}>
        {error ? (
          <p role="alert" className={styles.failure}>
            {error} <button type="button" onClick={() => { setError(null); setAttempt(n => n + 1); }}>Try again</button>
          </p>
        ) : null}
        {frameSrc ? (
          <iframe ref={frame} className={styles.frame} src={frameSrc} title="Video editor" onLoad={cancelNavigationProgress}
            allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera; cross-origin-isolated" />
        ) : !error ? <div className={styles.frame} /> : null}
      </main>
      </div>
    </div>
  );
}
