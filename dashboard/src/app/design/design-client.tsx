"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Save, Send } from "lucide-react";
import SpacesShell, { type SpacesGarden } from "@/app/spaces/spaces-shell";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import styles from "./design.module.css";

interface SourceArtifact { id: string; conversationId: string; title: string }
/** A Spaces design: a Garden image that Design opens as layers and saves back as its next version. */
export interface DesignGardenFile { gardenId: string; fileId: string; name: string }

const DESIGN_PATH = /\/design\/([0-9a-f-]{36})/i;

/** Breadboard's current theme, read live so the framed editor matches whichever theme is on. */
function currentTheme() {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  return {
    bg: token("--paper-bg"), surface: token("--paper-surface"), raised: token("--paper-raised"), strong: token("--paper-strong"),
    ink: token("--ink"), muted: token("--ink-muted"), line: token("--line"), lineStrong: token("--line-strong"),
    accent: token("--botanical"), accentHover: token("--botanical-hover"),
    font: getComputedStyle(document.body).fontFamily, scheme: document.documentElement.dataset.theme === "dark" || root.colorScheme.includes("dark") ? "dark" : "light",
  };
}

async function call(body: Record<string, unknown>) {
  const response = await fetch("/api/doory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Design did not answer.");
  return json;
}

export default function DesignClient({ artifact, gardenFile = null, initialDesign, showFlowers, garden }: {
  artifact: SourceArtifact | null; gardenFile?: DesignGardenFile | null; initialDesign: string | null; showFlowers: boolean; garden: SpacesGarden | null;
}) {
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [designId, setDesignId] = useState<string | null>(initialDesign);
  const [designTitle, setDesignTitle] = useState<string | null>(gardenFile?.name ?? artifact?.title ?? null);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved"; error?: string }>({ state: "idle" });
  const frame = useRef<HTMLIFrameElement>(null);

  // Start Doory (first use installs it), bring the chat image in, then frame the editor signed in.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    startNavigationProgress();
    (async () => {
      const response = await fetch("/api/doory", { cache: "no-store" });
      const access = await response.json().catch(() => ({})) as { port?: number; ticket?: string; error?: string };
      if (!response.ok || !access.port || !access.ticket) throw new Error(access.error ?? "Design could not start.");
      let start = initialDesign;
      if (!start && gardenFile) start = String((await call({ action: "import-garden", gardenId: gardenFile.gardenId, fileId: gardenFile.fileId })).designId);
      if (!start && artifact) {
        const key = `bb-design-import:${artifact.id}`;
        start = sessionStorage.getItem(key);
        if (!start) {
          start = String((await call({ action: "import", artifactId: artifact.id, conversationId: artifact.conversationId })).designId);
          sessionStorage.setItem(key, start);
        }
      }
      if (cancelled) return;
      const next = start ? `/design/${start}` : "/dashboard";
      setDesignId(start);
      setFrameSrc(`${location.protocol}//${location.hostname}:${access.port}/__breadboard/open?ticket=${encodeURIComponent(access.ticket)}&next=${encodeURIComponent(next)}`);
    })().catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : String(cause)); cancelNavigationProgress(); } });
    return () => { cancelled = true; };
  }, [artifact, gardenFile, initialDesign, attempt]);

  // The editor reports where it is; the open design is what Bread edits when asked about "this".
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: string; href?: string; title?: string } | null;
      if (data?.source !== "doory" || typeof data.href !== "string") return;
      const id = DESIGN_PATH.exec(data.href)?.[1] ?? null;
      setDesignId(id);
      setDesignTitle(gardenFile?.name ?? (id && data.title && data.title !== "Design" ? data.title : null));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    void call({ action: "focus", designId }).catch(() => {});
    setSave({ state: "idle" });
  }, [designId]);
  useEffect(() => () => { void call({ action: "focus", designId: null }).catch(() => {}); }, []);

  // The editor wears Breadboard's theme, and follows it when the theme changes.
  const sendTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ source: "breadboard-theme", theme: currentTheme() }, "*");
  }, []);
  useEffect(() => {
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sendTheme);
    return () => { observer.disconnect(); media.removeEventListener("change", sendTheme); };
  }, [sendTheme]);

  async function saveToSpaces() {
    if (!gardenFile || !designId) return;
    setSave({ state: "saving" });
    try {
      await call({ action: "save-garden", designId, gardenId: gardenFile.gardenId, fileId: gardenFile.fileId });
      setSave({ state: "saved" });
    } catch (cause) {
      setSave({ state: "idle", error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  async function saveToChat() {
    if (!artifact || !designId) return;
    setSave({ state: "saving" });
    try {
      await call({ action: "save", designId, artifactId: artifact.id, conversationId: artifact.conversationId });
      setSave({ state: "saved" });
    } catch (cause) {
      setSave({ state: "idle", error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  return (
    <SpacesShell showFlowers={showFlowers} garden={garden} pageKey={gardenFile ? `file:${gardenFile.fileId}` : undefined} trail={["Design", designTitle ?? ""]} actions={<>
      {save.error && <span role="alert" className={styles.error}>{save.error}</span>}
      {gardenFile && (
        <button type="button" className={styles.primary} disabled={!designId || save.state === "saving"} onClick={() => void saveToSpaces()}
          title={`Save the design into ${gardenFile.name} as a new version`}>
          {save.state === "saved" ? <Check size={15} /> : <Save size={15} />}
          {save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved" : "Save"}
        </button>
      )}
      {artifact && (
        <button type="button" className={styles.primary} disabled={!designId || save.state === "saving"} onClick={() => void saveToChat()}
          title="Add the current design to the chat as a new version of this image">
          {save.state === "saved" ? <Check size={15} /> : <Send size={15} />}
          {save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved to chat" : "Save to chat"}
        </button>
      )}
    </>}>
      {error ? (
        <p role="alert" className={styles.failure}>
          {error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button>
        </p>
      ) : frameSrc ? (
        <iframe ref={frame} className={styles.frame} src={frameSrc} title="Design editor" onLoad={() => { sendTheme(); cancelNavigationProgress(); }}
          allow="clipboard-read; clipboard-write; fullscreen" />
      ) : <div className={styles.frame} />}
    </SpacesShell>
  );
}
