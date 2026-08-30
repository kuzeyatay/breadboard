// Scope repair for a launch recovered while its tab snapshot is painting.

export type AgentLaunchScopeKey = string | number | null;

export interface AgentLaunchScopedValue {
  scopeKey: AgentLaunchScopeKey;
}

/**
 * Claim values recovered one paint before their authoritative conversation id.
 * Values that already have an owner never move between conversations.
 */
export function claimUnscopedAgentLaunchRequests<
  T extends AgentLaunchScopedValue,
>(queue: T[], scopeKey: AgentLaunchScopeKey): T[] {
  if (scopeKey === null || !queue.some((item) => item.scopeKey === null)) {
    return queue;
  }
  return queue.map((item) =>
    item.scopeKey === null ? { ...item, scopeKey } : item,
  );
}
