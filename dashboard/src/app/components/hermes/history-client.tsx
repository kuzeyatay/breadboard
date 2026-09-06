import BreadboardLoader from "@/app/components/breadboard-loader";
import {
  clearHermesSessionDeleting,
  markHermesSessionDeleting,
} from "@/lib/hermes/session-client";

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

/**
 * Delete one chat.
 *
 * Callers do not wait for this to decide what the rail shows: the route stops
 * the chat's runtime turn, its terminal command and any agent run it launched
 * before it removes the rows, and each of those is a round trip of its own, so
 * a delete can take seconds. The row leaves on the click and this runs behind
 * it. Marking the id keeps a history poll that overlaps the request from
 * listing the chat that is on its way out.
 */
export async function deleteChatSession(
  sessionId: string,
): Promise<DeleteChatResult> {
  markHermesSessionDeleting(sessionId);
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
  } finally {
    // Whether it worked or not, the id stops being hidden: a chat that was
    // deleted is gone from the server's answer anyway, and one that survived
    // has to be listed again so the rail can show it back.
    clearHermesSessionDeleting(sessionId);
  }
}

export function SpinnerIcon({
  className = "h-3.5 w-3.5",
}: {
  className?: string;
}) {
  return <BreadboardLoader className={className} />;
}

export function ActiveChatIcon({
  label,
  className = "h-3.5 w-3.5",
  onStop,
  stopping = false,
}: {
  label: string;
  className?: string;
  onStop?: () => void;
  stopping?: boolean;
}) {
  if (onStop) {
    const chatLabel = label.replace(/\s+is running$/u, "");
    const actionLabel = stopping ? `Stopping ${chatLabel}` : `Stop ${chatLabel}`;
    return (
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        aria-label={actionLabel}
        aria-busy={stopping}
        title={actionLabel}
        className="group/active-chat relative inline-flex shrink-0 items-center justify-center rounded-full text-[var(--botanical)] transition-transform duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:cursor-wait disabled:opacity-55"
      >
        {stopping ? (
          <SpinnerIcon className={className} />
        ) : (
          <>
            {/* A running row should read as loading at a glance. The stop mark
                replaces the spinner only when somebody points at or focuses
                the control; permanently stacking both made this tiny icon look
                like a stray green rectangle inside a circle. */}
            <SpinnerIcon
              className={`${className} transition-opacity duration-150 group-hover/active-chat:opacity-20 group-focus-visible/active-chat:opacity-20`}
            />
            <span
              className="absolute h-1.5 w-1.5 rounded-[1.5px] bg-current opacity-0 transition-opacity duration-150 group-hover/active-chat:opacity-100 group-focus-visible/active-chat:opacity-100"
              aria-hidden
            />
          </>
        )}
      </button>
    );
  }
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

// The run finished while the user was elsewhere and nobody has read it yet.
// It takes the spinner's place on the row, so one spot carries the whole life
// of a run: spinning, then waiting to be read, then nothing. The palette's one
// saturated green, because this is a "there is something here", never a
// warning — the sage it used to use read as decoration on the tan dock bar.
export function UnreadChatDot({
  label,
  className = "h-2 w-2",
  multiple = false,
}: {
  label: string;
  className?: string;
  multiple?: boolean;
}) {
  if (multiple) {
    return (
      <span
        role="status"
        aria-label={label}
        title={label}
        className="inline-flex shrink-0 items-center gap-1.5"
      >
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden
            className={`inline-block shrink-0 rounded-full bg-[var(--signal-live)] shadow-[0_0_0_1px_var(--signal-live-ring)] ${className}`}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`inline-block shrink-0 rounded-full bg-[var(--signal-live)] shadow-[0_0_0_1px_var(--signal-live-ring)] ${className}`}
    />
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
      className="flex items-center justify-center px-2 py-6 text-gray-600"
    >
      <SpinnerIcon className="h-3.5 w-3.5" />
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
