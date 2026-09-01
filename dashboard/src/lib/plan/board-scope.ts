// Date windows for the Plan board.
//
// The board keeps undated work visible in every scope: it is the project's
// backlog, not work that belongs to some other period. Dated work is filtered
// against the selected day, month or year.

import {
  addDays,
  dateOf,
  endOfMonth,
  startOfDay,
  startOfMonth,
} from "../calendar/wallclock.ts";

export const PLAN_BOARD_SCOPES = ["all", "day", "month", "year"] as const;

export type PlanBoardScope = (typeof PLAN_BOARD_SCOPES)[number];

export interface PlanBoardDateRange {
  /** Inclusive wall-clock date, "YYYY-MM-DD". */
  from: string;
  /** Inclusive wall-clock date, "YYYY-MM-DD". */
  to: string;
}

export function isPlanBoardScope(value: unknown): value is PlanBoardScope {
  return (
    typeof value === "string" &&
    (PLAN_BOARD_SCOPES as readonly string[]).includes(value)
  );
}

export function rangeForBoardScope(
  scope: PlanBoardScope,
  anchor: string,
): PlanBoardDateRange | null {
  switch (scope) {
    case "day":
      return { from: anchor, to: anchor };
    case "month":
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case "year": {
      const year = anchor.slice(0, 4);
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "all":
    default:
      return null;
  }
}

/** Whether a card belongs in a board window. Undated backlog always remains. */
export function taskMatchesBoardScope(
  dueDate: string | null,
  scope: PlanBoardScope,
  anchor: string,
): boolean {
  if (!dueDate || scope === "all") return true;
  const range = rangeForBoardScope(scope, anchor);
  return range !== null && dueDate >= range.from && dueDate <= range.to;
}

/** Previous/next navigation moves by the selected board window. */
export function shiftBoardScopeAnchor(
  scope: PlanBoardScope,
  anchor: string,
  direction: -1 | 1,
): string {
  if (scope === "day") {
    return dateOf(addDays(startOfDay(anchor), direction));
  }

  if (scope === "month") {
    const year = Number(anchor.slice(0, 4));
    const month = Number(anchor.slice(5, 7));
    const total = year * 12 + (month - 1) + direction;
    const nextYear = Math.floor(total / 12);
    const nextMonth = (total % 12) + 1;
    return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  }

  if (scope === "year") {
    const year = Number(anchor.slice(0, 4)) + direction;
    return `${String(year).padStart(4, "0")}-01-01`;
  }

  return anchor;
}
