const DEFAULT_PDF_SAVE_RETRY_MS = 2_000;
const MAX_PDF_SAVE_RETRY_MS = 30_000;

/** Return a bounded retry delay only for the Garden lease conflict contract. */
export function gardenBusyRetryDelay(
  body: unknown,
  status: number,
): number | null {
  if (
    status !== 409 ||
    !body ||
    typeof body !== "object" ||
    (body as { code?: unknown }).code !== "GARDEN_MUTATION_BUSY" ||
    (body as { retryable?: unknown }).retryable !== true
  ) {
    return null;
  }
  const requested = Number((body as { retryAfterMs?: unknown }).retryAfterMs);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_PDF_SAVE_RETRY_MS)
    : DEFAULT_PDF_SAVE_RETRY_MS;
}
