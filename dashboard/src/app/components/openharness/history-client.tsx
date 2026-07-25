// Chat-history controls shared by the surfaces that render a Recents list
// (garden chat and the dashboard terminal). Breadboard owns the durable
// transcript, so deleting is a plain server call — the browser never addresses
// the agent runtime directly.

export interface DeleteChatResult {
  deleted: boolean;
  error?: string;
}

export async function deleteChatSession(
  sessionId: string,
): Promise<DeleteChatResult> {
  try {
    const response = await fetch(
      `/api/openharness/sessions/${encodeURIComponent(sessionId)}`,
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
