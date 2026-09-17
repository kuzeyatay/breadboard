export interface DisplayUsageLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_in_seconds?: number;
}

export type UsageLimitWindowKey =
  | "primary"
  | "secondary"
  | "five-hour"
  | "reserve"
  | "reserve-secondary";

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

/**
 * Keep the five-hour allowance visible without inventing usage data when the
 * upstream snapshot reports only a longer window.
 */
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
      key: "five-hour",
      label: "5-hour limit",
      window: { window_minutes: 5 * 60 },
      reported: false,
    },
    ...rows,
  ];
}

export interface DisplayUsageLimitReserve {
  model?: string | null;
  active?: boolean;
  limit_reached?: boolean;
  primary?: DisplayUsageLimitWindow;
  secondary?: DisplayUsageLimitWindow;
}

/** "GPT-5.6 Luna" from `gpt-5.6-luna`; the pool is named after its model. */
export function usageReserveModelLabel(model: string | null | undefined): string {
  const slug = (model ?? "").trim();
  if (!slug) return "Reserve";
  const match = /^gpt-([0-9.]+)-([a-z]+)$/i.exec(slug);
  if (match) {
    const [, version, name] = match;
    return `GPT-${version} ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
  return slug;
}

/**
 * The reserve pool's windows as rows beneath the plan's own. Only OpenAI's
 * report carries a reserve; a header snapshot yields no rows here.
 */
export function usageReserveRows(payload: {
  reserve?: DisplayUsageLimitReserve | null;
}): DisplayUsageLimitRow[] {
  const reserve = payload.reserve;
  if (!reserve) return [];
  const name = usageReserveModelLabel(reserve.model);
  const rows: DisplayUsageLimitRow[] = [];
  if (reserve.primary) {
    rows.push({
      key: "reserve",
      label: `${name} reserve · ${usageLimitWindowLabel(reserve.primary, "limit").toLowerCase()}`,
      window: reserve.primary,
      reported: true,
    });
  }
  if (reserve.secondary) {
    rows.push({
      key: "reserve-secondary",
      label: `${name} reserve · ${usageLimitWindowLabel(reserve.secondary, "limit").toLowerCase()}`,
      window: reserve.secondary,
      reported: true,
    });
  }
  return rows;
}
