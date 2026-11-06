/** SQLite's unzoned datetime('now') values are UTC, as are the ISO inbox dates. */
export function notificationTimestamp(value?: string): number {
  if (!value) return 0;
  const normalized = value.trim().replace(" ", "T");
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function notificationTimeLabel(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

