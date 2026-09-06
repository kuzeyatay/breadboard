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
  return (
    <div className="assistant-response-notice" role="status">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <p>{title}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="assistant-response-notice-retry">Retry</button>
        ) : null}
      </div>
      {detail?.trim() ? (
        <details className="assistant-response-notice-details">
          <summary>Details</summary>
          <pre>{detail.trim()}</pre>
        </details>
      ) : null}
    </div>
  );
}
