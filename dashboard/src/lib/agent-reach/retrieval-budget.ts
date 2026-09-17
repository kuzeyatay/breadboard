/** End retrieval without cancelling the separate final write-up. */
export async function withinRetrievalBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<T | null> {
  const phase = new AbortController();
  const forward = () => phase.abort(parent.reason);
  if (parent.aborted) forward();
  else parent.addEventListener('abort', forward, {once:true});
  const timer = setTimeout(() => phase.abort(new DOMException('The retrieval budget ended.', 'TimeoutError')), Math.max(1, timeoutMs));
  timer.unref?.();
  try {
    return await work(phase.signal);
  } catch (error) {
    if (parent.aborted) throw parent.reason;
    if (phase.signal.aborted) return null;
    throw error;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', forward);
  }
}
