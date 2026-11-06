/** Keep the preview's controls visible while its content is being fetched. */
export default function ArtifactPreviewLoading({ label = "Loading preview…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-3 text-sm text-[var(--ink-muted)]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 motion-safe:animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" opacity="0.2" />
        <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
