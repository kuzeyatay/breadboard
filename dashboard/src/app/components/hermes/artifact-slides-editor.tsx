"use client";

import { useEffect, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import ArtifactPreviewSurface from "./artifact-preview-surface";

interface ArtifactSlidesEditorProps {
  artifact: PresentedArtifact;
  onSaved?: (artifact: PresentedArtifact) => void;
}

function currentTheme(): "light" | "dark" {
  try {
    return localStorage.getItem("breadboard:theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const closeSession = (session: string) => {
  void fetch(`/api/office/sessions/${encodeURIComponent(session)}`, { method: "DELETE", keepalive: true });
};

/**
 * A .pptx artifact edited in GenOffice Slides: the same live editor session
 * Spaces opens for a presentation, with each save filed as a new artifact
 * version instead of a new Garden version.
 */
export default function ArtifactSlidesEditor({ artifact, onSaved }: ArtifactSlidesEditorProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [src, setSrc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ artifact, onSaved });
  latest.current = { artifact, onSaved };

  // One session per opened artifact: the versions its own saves create must
  // not restart the editor underneath the user.
  useEffect(() => {
    let session = "";
    let cancelled = false;
    setError(null);
    setSrc("");
    void fetch(`/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/office-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: artifact.conversationId, theme: currentTheme() }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { session?: string; url?: string; error?: string };
        if (!response.ok || !body.session || !body.url) throw new Error(body.error ?? "The Slides editor could not start.");
        session = body.session;
        if (cancelled) closeSession(session);
        else setSrc(body.url);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The Slides editor could not start.");
      });
    return () => {
      cancelled = true;
      if (session) closeSession(session);
    };
  }, [artifact.id, artifact.conversationId, attempt]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      const data = (event.data ?? {}) as { type?: string; file?: PresentedArtifact; error?: unknown };
      if (data.type === "breadboard:office-saved" && data.file?.id === latest.current.artifact.id) {
        latest.current.onSaved?.(data.file);
      }
      if (data.type === "breadboard:office-error" || data.type === "breadboard:office-ended") {
        setError(String(data.error || "The editor session ended. Reopen the presentation to keep editing."));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const theme = (event: StorageEvent) => {
      if (event.key === "breadboard:theme") {
        frame.current?.contentWindow?.postMessage({ type: "breadboard:theme", theme: event.newValue }, location.origin);
      }
    };
    window.addEventListener("storage", theme);
    return () => window.removeEventListener("storage", theme);
  }, []);

  return (
    <div className="flex h-full min-h-[42rem] flex-col overflow-hidden bg-[var(--background)]" data-artifact-slides-editor="">
      {error ? (
        <p role="alert" className="flex items-center gap-2 p-3 text-sm text-[var(--ink-muted)]">
          {error}
          <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </p>
      ) : null}
      {src ? (
        <ArtifactPreviewSurface key={src}>{(ready, failed) => (
          <iframe
            ref={frame}
            src={src}
            onLoad={ready}
            onError={failed}
            title={`Edit ${artifact.title}`}
            className="h-full min-h-[42rem] w-full flex-1 border-0 bg-[var(--background)]"
            allow="clipboard-read; clipboard-write; fullscreen"
            allowFullScreen
          />
        )}</ArtifactPreviewSurface>
      ) : null}
    </div>
  );
}
