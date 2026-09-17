import type { AgentLaunchRequestPayload } from "@/lib/hermes/agent-launch.ts";

export type AgentLaunchScopeKey = string | number | null;

interface LaunchSession {
  id: number;
  isOwn?: boolean;
  messages: readonly { role: string; clientMessageId?: string }[];
}

/**
 * Resolve delegation from its parent turn, never from the selected chat. An
 * ambiguous or unavailable parent must not manufacture a user request elsewhere.
 */
export function originatingAgentLaunchSession<T extends LaunchSession>(
  sessions: readonly T[],
  request: Pick<AgentLaunchRequestPayload, "originClientMessageId">,
): T | null {
  const origin = request.originClientMessageId?.trim();
  if (!origin) return null;
  const owners = sessions.filter((session) =>
    session.isOwn !== false && session.messages.some((message) =>
      message.role === "assistant" && message.clientMessageId === origin,
    ),
  );
  return owners.length === 1 ? owners[0] : null;
}
