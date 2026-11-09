/** Prepare the same durable conversation while voice opens. The normal send
 * path remains authoritative and never waits for this optional warmup. */
export async function prepareVoiceConversation(
  ensureConversation: () => Promise<string>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const id = await ensureConversation();
  signal.throwIfAborted();
  const response = await fetch(`/api/hermes/sessions/${encodeURIComponent(id)}/events?surface=dashboard_terminal&prepareVoice=1`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), cache: 'no-store',
  });
  // Opening this authenticated stream creates the runtime. No message is sent,
  // and the normal turn opens its own viewer when it needs one.
  await response.body?.cancel();
  if (!response.ok) throw new Error('Voice conversation preparation failed.');
}
