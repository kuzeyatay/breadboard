export const CHAT_TIME_SEPARATOR_INTERVAL_MS = 60 * 60 * 1_000;

export interface TimestampedChatMessage {
  createdAt?: string;
}

function parsedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const normalized =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sameLocalDay(left: number, right: number): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function localDayDifference(timestamp: number, now: number): number {
  const date = new Date(timestamp);
  const current = new Date(now);
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const currentStart = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  ).getTime();
  return Math.round((currentStart - dateStart) / (24 * 60 * 60 * 1_000));
}

export function formatChatTimeSeparator(
  timestamp: number,
  now = Date.now(),
  locale?: string,
): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const dayDifference = localDayDifference(timestamp, now);

  if (dayDifference === 0) return `Today ${time}`;
  if (dayDifference === 1) return `Yesterday ${time}`;
  if (dayDifference > 1 && dayDifference < 7) {
    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: "long",
    }).format(date);
    return `${weekday} ${time}`;
  }

  const calendarDate = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== current.getFullYear()
      ? { year: "numeric" }
      : {}),
  }).format(date);
  return `${calendarDate} ${time}`;
}

/**
 * Place a timestamp before the first timestamped message, at every local date
 * boundary, and at least once per hour of transcript time. The interval is
 * measured from the last separator rather than the immediately previous
 * message so a busy conversation still receives hourly markers.
 */
export function chatTimeSeparatorLabels(
  messages: readonly TimestampedChatMessage[],
  now = Date.now(),
  locale?: string,
): Array<string | null> {
  let lastSeparatorAt: number | null = null;

  return messages.map((message) => {
    const timestamp = parsedTimestamp(message.createdAt);
    if (timestamp === null) return null;

    const shouldShow =
      lastSeparatorAt === null ||
      (timestamp > lastSeparatorAt &&
        (!sameLocalDay(timestamp, lastSeparatorAt) ||
          timestamp - lastSeparatorAt >= CHAT_TIME_SEPARATOR_INTERVAL_MS));
    if (!shouldShow) return null;

    lastSeparatorAt = timestamp;
    return formatChatTimeSeparator(timestamp, now, locale);
  });
}
