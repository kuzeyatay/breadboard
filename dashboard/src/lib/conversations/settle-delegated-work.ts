/**
 * Seal delegated runs that finished while nobody watched and, for one opened
 * chat, start the hand-back no open tab was there to start. Loaded lazily and
 * never allowed to fail a transcript load.
 */
export async function settleDelegatedWork(
  userId: number,
  conversationId: number,
  opened: boolean,
): Promise<void> {
  try {
    const { reconcileOuterAgentConversation } = await import("../runtime-v2/outer-agent-conversation.ts");
    await reconcileOuterAgentConversation(userId, conversationId);
    if (!opened) return;
    const { continueDelegatedHandBack } = await import("./delegated-hand-back-runner.ts");
    void continueDelegatedHandBack(conversationId, { minAgeMs: 2 * 60_000 }).catch(() => false);
  } catch {
    // The runtime may be down; the background sweep retries.
  }
}
