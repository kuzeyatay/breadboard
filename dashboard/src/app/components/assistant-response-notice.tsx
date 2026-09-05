"use client";

/** A recoverable response state. Diagnostics stay available without becoming
 * answer prose or acquiring copy, speech, and feedback controls. */
export default function AssistantResponseNotice({
  kind = "failed",
  detail,
  onRetry,
}: {
  kind?: "failed" | "empty" | "aborted";
  detail?: string | null;
  onRetry?: () => void;
}) {
  const title = kind === "empty"
    ? "No response was returned"
    : kind === "aborted"
      ? "Response stopped"
      : "Couldn’t finish this response";
  const description = kind === "empty"
    ? "The request ended before an answer arrived."
    : kind === "aborted"
      ? "You can retry when you’re ready."
      : "The request stopped before it finished.";
  return (
    <div className="assistant-response-notice" role="status">
      <div className="flex min-w-0 items-start gap-3">
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 6v4.5M10 13v.5" strokeLinecap="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5 text-[var(--ink-heading)]">{title}</p>
          <p className="mt-1 text-sm leading-5 text-[var(--ink-muted)]">{description}</p>
          {detail?.trim() ? (
            <details className="assistant-response-notice-details">
              <summary>Details</summary>
              <pre>{detail.trim()}</pre>
            </details>
          ) : null}
        </div>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="assistant-response-notice-retry">Retry</button>
        ) : null}
      </div>
    </div>
  );
}
