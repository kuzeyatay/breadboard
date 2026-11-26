"use client";

import BreadboardLoader from "../breadboard-loader";

/** Keep the preview's controls visible while its content is being fetched. */
export default function ArtifactPreviewLoading({ label = "Loading preview…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-3 text-sm text-[var(--ink-muted)]">
      <BreadboardLoader className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
