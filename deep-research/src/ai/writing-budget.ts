/** Long-form writing needs a separate deadline from one search/extraction step. */
export function writingTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.DEEP_RESEARCH_WRITING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1_000, Math.min(30 * 60_000, Math.floor(configured)))
    : 15 * 60_000;
}

export function writingSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(writingTimeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
