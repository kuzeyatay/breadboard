const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format a document's persisted ingestion date for the compact source list.
 * Recent uploads benefit from relative time; older uploads use a calendar date
 * so an age can never be mistaken for an enormous word or week count.
 */
export function formatDocumentUploadTime(
  value: string,
  now = Date.now(),
  locale?: string,
): string {
  const uploadedAt = Date.parse(value);
  if (!Number.isFinite(uploadedAt)) return "Upload date unavailable";

  // Treat small clock differences and future-dated legacy records as current
  // instead of presenting a negative age.
  const elapsed = Math.max(0, now - uploadedAt);
  if (elapsed < MINUTE_MS) return "Uploaded just now";
  if (elapsed < HOUR_MS) return `Uploaded ${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `Uploaded ${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < 7 * DAY_MS) return `Uploaded ${Math.floor(elapsed / DAY_MS)}d ago`;

  const uploaded = new Date(uploadedAt);
  const current = new Date(now);
  return `Uploaded ${new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(uploaded.getFullYear() === current.getFullYear()
      ? {}
      : { year: "numeric" }),
  }).format(uploaded)}`;
}

/** Full local timestamp for the abbreviated label's tooltip. */
export function documentUploadTimeTitle(
  value: string,
  locale?: string,
): string | undefined {
  const uploadedAt = Date.parse(value);
  if (!Number.isFinite(uploadedAt)) return undefined;
  return `Uploaded ${new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(uploadedAt))}`;
}
