"use client";

import { loadingIconMotion } from "../loading-icon-motion";

export function ArtifactLoadingMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      {...loadingIconMotion}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[var(--botanical)] motion-safe:animate-[spin_2s_linear_infinite]"
    >
      <path d="M12 2.5 20.2 16.75H3.8Z" fill="currentColor" fillOpacity=".1" strokeWidth="1.75" />
      <path d="M6.1 12.8h4.3l2-3.5" fill="none" strokeWidth="1.4" />
      <circle cx="12.4" cy="9.3" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Keep the preview's controls visible while its content is being fetched. */
export default function ArtifactPreviewLoading({ label = "Loading preview…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-3 text-sm text-[var(--ink-muted)]">
      <ArtifactLoadingMark />
      <span>{label}</span>
    </div>
  );
}
