// Chat-history controls shared by the surfaces that render a Recents list
// (garden chat and the dashboard terminal). Breadboard owns the durable
// transcript, so deleting is a plain server call — the browser never addresses
// the agent runtime directly.

export interface DeleteChatResult {
  deleted: boolean;
  error?: string;
}

interface HistoryMessageActivity {
  role?: unknown;
  externalAgentOutcome?: unknown;
}

export function chatSessionIsActive(
  activeRun: unknown,
  messages: HistoryMessageActivity[],
): boolean {
  return (
    Boolean(activeRun) ||
    // Launch metadata is stored on both halves of an external-agent turn, but
    // only the assistant message receives its terminal outcome. The user
    // prompt therefore cannot be used as the authoritative activity state.
    messages.some(
      (message) =>
        message.role === "assistant" &&
        message.externalAgentOutcome === "running",
    )
  );
}

export async function deleteChatSession(
  sessionId: string,
): Promise<DeleteChatResult> {
  try {
    const response = await fetch(
      `/api/hermes/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    if (response.ok) return { deleted: true };
    const body = await response.json().catch(() => ({}));
    return {
      deleted: false,
      error:
        typeof body.error === "string"
          ? body.error
          : "This chat could not be deleted.",
    };
  } catch {
    return { deleted: false, error: "This chat could not be deleted." };
  }
}

export function SpinnerIcon({
  className = "h-3.5 w-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="2.25"
        opacity="0.22"
      />
      <path
        d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ActiveChatIcon({
  label,
  className = "h-3.5 w-3.5",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center justify-center text-[var(--botanical)]"
    >
      <SpinnerIcon className={className} />
    </span>
  );
}

// Placeholder for a Recents list whose first fetch is still in flight. An empty
// list and an unloaded one look identical otherwise, so "No chats yet" would
// flash on every mount for someone who does have chats.
export function ChatHistoryLoading({ label = "Loading chats" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-gray-600"
    >
      <SpinnerIcon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

export function TrashIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}
