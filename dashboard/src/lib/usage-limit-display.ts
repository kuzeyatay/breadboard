export interface DisplayUsageLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_in_seconds?: number;
}

export type UsageLimitWindowKey =
  | "primary"
  | "secondary"
  | "five-hour-placeholder";

export interface DisplayUsageLimitRow {
  key: UsageLimitWindowKey;
  label: string;
  window: DisplayUsageLimitWindow;
  reported: boolean;
}

function positiveWindowMinutes(window: DisplayUsageLimitWindow): number | null {
  const minutes = Number(window.window_minutes);
  if (!Number.isFinite(minutes)) return null;
  const wholeMinutes = Math.trunc(minutes);
  return wholeMinutes > 0 ? wholeMinutes : null;
}

export function usageLimitWindowLabel(
  window: DisplayUsageLimitWindow,
  fallback: string,
): string {
  const minutes = positiveWindowMinutes(window);
  if (minutes === null) return fallback;
  if (minutes === 24 * 60) return "Daily limit";
  if (minutes === 7 * 24 * 60) return "Weekly limit";
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

export function visibleUsageLimitRows(payload: {
  primary?: DisplayUsageLimitWindow;
  secondary?: DisplayUsageLimitWindow;
}): DisplayUsageLimitRow[] {
  const rows: DisplayUsageLimitRow[] = [
    ...(payload.primary
      ? [
          {
            key: "primary" as const,
            label: usageLimitWindowLabel(payload.primary, "Primary limit"),
            window: payload.primary,
            reported: true,
          },
        ]
      : []),
    ...(payload.secondary
      ? [
          {
            key: "secondary" as const,
            label: usageLimitWindowLabel(payload.secondary, "Secondary limit"),
            window: payload.secondary,
            reported: true,
          },
        ]
      : []),
  ];

  return rows
    .filter(({ window }) => {
      if (window.window_minutes === undefined) return true;
      return positiveWindowMinutes(window) !== null;
    })
    .sort((left, right) => {
      const leftMinutes = positiveWindowMinutes(left.window);
      const rightMinutes = positiveWindowMinutes(right.window);
      if (leftMinutes === null) return rightMinutes === null ? 0 : 1;
      if (rightMinutes === null) return -1;
      return leftMinutes - rightMinutes;
    });
}

export function usageLimitRowsWithFiveHour(payload: {
  primary?: DisplayUsageLimitWindow;
  secondary?: DisplayUsageLimitWindow;
}): DisplayUsageLimitRow[] {
  const rows = visibleUsageLimitRows(payload);
  if (rows.some(({ window }) => positiveWindowMinutes(window) === 5 * 60)) {
    return rows;
  }
  return [
    {
      key: "five-hour-placeholder",
      label: "5-hour limit",
      window: { window_minutes: 5 * 60 },
      reported: false,
    },
    ...rows,
  ];
}
