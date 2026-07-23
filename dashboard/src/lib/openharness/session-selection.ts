export interface RestorableAgentSession {
  id?: unknown;
  gardenId?: unknown;
  pageSlug?: unknown;
  activeDirectory?: unknown;
  filesystemMode?: unknown;
  messages?: unknown;
  activeRun?: unknown;
}

export interface AgentSessionScope {
  gardenSlug?: string;
  pageSlug?: string;
}

/**
 * Select a durable conversation only when it belongs to the surface context
 * currently on screen. In particular, a Garden chat must never restore a
 * conversation from another garden just because it was the last chat opened.
 */
export function selectRestorableAgentSession<T extends RestorableAgentSession>(
  sessions: T[],
  preferredId: string | null,
  scope?: AgentSessionScope,
): (T & { id: string }) | null {
  const matching = sessions.filter(
    (candidate): candidate is T & { id: string } =>
      typeof candidate.id === "string" &&
      candidate.id.startsWith("conv_") &&
      (!scope?.gardenSlug || candidate.gardenId === scope.gardenSlug) &&
      (!scope?.pageSlug || candidate.pageSlug === scope.pageSlug),
  );

  return (
    matching.find((candidate) => candidate.id === preferredId) ??
    matching[0] ??
    null
  );
}
