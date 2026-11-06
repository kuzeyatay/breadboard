"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import ArtifactPreviewLoading from "./artifact-preview-loading";

/** Key this by the preview URL so a new file never inherits a loaded state. */
export default function ArtifactPreviewSurface({ children }: {
  children: (ready: () => void, failed: () => void) => ReactNode;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setStatus("error"), 30_000);
    return () => window.clearTimeout(timer);
  }, [status, attempt]);

  return <div className="relative h-full min-h-0" aria-busy={status === "loading"}>
    <Fragment key={attempt}>{children(() => setStatus("ready"), () => setStatus("error"))}</Fragment>
    {status !== "ready" && <div className="absolute inset-x-0 top-0 z-10 bg-[var(--paper-surface)]">
      {status === "loading" ? <ArtifactPreviewLoading /> : <p role="alert" className="flex items-center gap-2 p-3 text-sm text-[var(--ink-muted)]">
        Preview could not be loaded.
        <button type="button" className="underline" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>Retry</button>
      </p>}
    </div>}
  </div>;
}
