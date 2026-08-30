"use client";

import { useEffect, useRef, useState } from "react";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

const AUTOSAVE_DELAY_MS = 1_200;

interface EditorPayload {
  artifact: PresentedArtifact;
  content?: string;
}

interface VvvebMessage {
  type?: string;
  artifactId?: string;
  html?: string;
}

type SaveStatus =
  | { phase: "loading"; message: string }
  | { phase: "ready"; message: string }
  | { phase: "dirty"; message: string }
  | { phase: "saving"; message: string }
  | { phase: "saved"; message: string }
  | { phase: "error"; message: string };

interface Props {
  artifact: PresentedArtifact;
  onSaved: (artifact: PresentedArtifact) => void;
}

function endpoint(artifact: Pick<PresentedArtifact, "id" | "conversationId">): string {
  const query = new URLSearchParams({ conversationId: artifact.conversationId });
  return `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/edit?${query}`;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") {
    return (value as { error: string }).error;
  }
  return fallback;
}

/** Vvveb stays in a static iframe; the host owns authorization and autosave. */
export default function ArtifactVvvebEditor({ artifact, onSaved }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onSavedRef = useRef(onSaved);
  const retryRef = useRef<() => void>(() => undefined);
  const initialArtifactRef = useRef(artifact);
  if (initialArtifactRef.current.id !== artifact.id) initialArtifactRef.current = artifact;
  const artifactId = artifact.id;
  const conversationId = artifact.conversationId;
  const [status, setStatus] = useState<SaveStatus>({
    phase: "loading",
    message: "Opening visual editor…",
  });

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    const initialArtifact = initialArtifactRef.current;
    let disposed = false;
    let frameReady = false;
    let editorLoaded = false;
    let loadPosted = false;
    let loadedPayload: EditorPayload | null = null;
    let latestArtifact = initialArtifact;
    let pendingHtml: string | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let saving = false;
    const editEndpoint = endpoint({ id: artifactId, conversationId });

    const postToEditor = (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage(
        { ...message, artifactId },
        window.location.origin,
      );
    };

    const maybeLoadEditor = () => {
      if (!frameReady || !loadedPayload || loadPosted || typeof loadedPayload.content !== "string") return;
      loadPosted = true;
      latestArtifact = loadedPayload.artifact;
      postToEditor({
        type: "breadboard:vvveb-load",
        html: loadedPayload.content,
        filename: loadedPayload.artifact.filename,
      });
    };

    const scheduleSave = (delay = AUTOSAVE_DELAY_MS) => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void persistPending(), delay);
    };

    const persistPending = async () => {
      if (disposed || saving || !editorLoaded || pendingHtml === null) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      const html = pendingHtml;
      pendingHtml = null;
      saving = true;
      let failed = false;
      setStatus({ phase: "saving", message: "Saving changes…" });
      postToEditor({ type: "breadboard:vvveb-save-status", status: "saving" });

      try {
        const response = await fetch(editEndpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: latestArtifact.version,
            content: html,
          }),
        });
        const body = await response.json().catch(() => ({})) as {
          artifact?: PresentedArtifact;
          error?: string;
        };
        if (!response.ok || !body.artifact) {
          throw new Error(errorMessage(body, "The page could not be autosaved."));
        }
        latestArtifact = body.artifact;
        if (!disposed) {
          setStatus({
            phase: "saved",
            message: `Saved automatically · version ${body.artifact.version}`,
          });
          onSavedRef.current(body.artifact);
          postToEditor({ type: "breadboard:vvveb-save-status", status: "saved" });
        }
      } catch (saveError) {
        failed = true;
        // A newer edit wins, otherwise retain this exact snapshot for Retry.
        pendingHtml ??= html;
        if (!disposed) {
          setStatus({
            phase: "error",
            message: saveError instanceof Error ? saveError.message : "The page could not be autosaved.",
          });
          postToEditor({ type: "breadboard:vvveb-save-status", status: "error" });
        }
      } finally {
        saving = false;
        if (!failed && pendingHtml !== null && !disposed) scheduleSave(350);
      }
    };

    retryRef.current = () => {
      if (pendingHtml !== null) void persistPending();
    };

    const receive = (event: MessageEvent<VvvebMessage>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow ||
        !event.data ||
        event.data.artifactId !== artifactId
      ) return;

      if (event.data.type === "breadboard:vvveb-ready") {
        frameReady = true;
        maybeLoadEditor();
        return;
      }
      if (event.data.type === "breadboard:vvveb-loaded") {
        editorLoaded = true;
        setStatus({
          phase: "ready",
          message: `Double-click text · click elements for controls · autosaves · version ${latestArtifact.version}`,
        });
        return;
      }
      if (
        (event.data.type === "breadboard:vvveb-change" ||
          event.data.type === "breadboard:vvveb-flush") &&
        typeof event.data.html === "string"
      ) {
        pendingHtml = event.data.html;
        setStatus({ phase: "dirty", message: "Unsaved changes…" });
        postToEditor({ type: "breadboard:vvveb-save-status", status: "dirty" });
        if (event.data.type === "breadboard:vvveb-flush") void persistPending();
        else scheduleSave();
      }
    };

    window.addEventListener("message", receive);
    setStatus({ phase: "loading", message: "Opening visual editor…" });
    void fetch(editEndpoint, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(errorMessage(body, "The visual editor could not open this page."));
        }
        return body as EditorPayload;
      })
      .then((body) => {
        if (disposed) return;
        if (body.artifact?.id !== artifactId || typeof body.content !== "string") {
          throw new Error("The visual editor received an invalid HTML document.");
        }
        loadedPayload = body;
        maybeLoadEditor();
      })
      .catch((loadError) => {
        if (!disposed) {
          setStatus({
            phase: "error",
            message: loadError instanceof Error ? loadError.message : "The visual editor could not open.",
          });
        }
      });

    return () => {
      disposed = true;
      window.removeEventListener("message", receive);
      if (saveTimer) clearTimeout(saveTimer);
      retryRef.current = () => undefined;

      // Closing immediately after a click should not discard a queued change.
      // keepalive lets the bounded request finish while this component retires.
      if (!saving && pendingHtml !== null) {
        void fetch(editEndpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: latestArtifact.version,
            content: pendingHtml,
          }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, [artifactId, conversationId]);

  const frameSource = `/vvveb-editor/index.html?${new URLSearchParams({
    artifactId: artifact.id,
  })}`;
  const statusTone = status.phase === "error"
    ? "text-red-700"
    : status.phase === "saved" || status.phase === "ready"
      ? "text-emerald-700"
      : "text-[var(--ink-muted)]";

  return (
    <div className="flex h-full min-h-[42rem] flex-col overflow-hidden bg-[var(--paper-raised)]" data-vvveb-artifact-editor>
      <div className="flex min-h-9 items-center gap-3 border-b border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-xs">
        <span className="font-medium text-[var(--ink-heading)]">Visual HTML editor</span>
        <span className={`ml-auto ${statusTone}`} role={status.phase === "error" ? "alert" : "status"}>
          {status.message}
        </span>
        {status.phase === "error" ? (
          <button
            type="button"
            onClick={() => retryRef.current()}
            className="neu-button rounded-md px-2 py-1 font-semibold"
          >
            Retry
          </button>
        ) : null}
      </div>
      <iframe
        ref={frameRef}
        src={frameSource}
        title={`Visually edit ${artifact.title}`}
        className="min-h-0 flex-1 border-0 bg-white"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
