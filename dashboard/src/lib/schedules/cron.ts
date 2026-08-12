// Standard 5-field cron parsing and "next occurrence" arithmetic.
//
// Breadboard runs its own scheduler in-process (see ./scheduler.ts) rather than
// depending on a platform cron, so this module is dependency-free and framework-
// free: it is pure date arithmetic over local server time and can be unit-tested
// directly. Fields follow Vixie cron semantics, including the rule that a
// restricted day-of-month and a restricted day-of-week match as a union.

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** Vixie cron: DOM and DOW are a union only when both are restricted. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

/** Longest supported gap between occurrences (Feb 29 on a leap year). */
const MAX_DAYS_AHEAD = 1_500;

export const MAX_CRON_EXPRESSION_LENGTH = 120;

function fieldValue(
  token: string,
  min: number,
  max: number,
  names: string[],
  fieldName: string,
): number {
  const named = names.indexOf(token.toLowerCase());
  const value = named >= 0 ? named + (fieldName === "month" ? 1 : 0) : Number(token);
  if (!Number.isInteger(value)) {
    throw new CronError(`The ${fieldName} field has an invalid value "${token}".`);
  }
  if (value < min || value > max) {
    throw new CronError(`The ${fieldName} field must be between ${min} and ${max}.`);
  }
  return value;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  fieldName: string,
  names: string[] = [],
): { values: number[]; restricted: boolean } {
  const field = raw.trim();
  if (!field) throw new CronError(`The ${fieldName} field is missing.`);

  const values = new Set<number>();
  let restricted = false;

  for (const part of field.split(",")) {
    const piece = part.trim();
    if (!piece) throw new CronError(`The ${fieldName} field has an empty entry.`);

    const [rangePart, stepPart, ...rest] = piece.split("/");
    if (rest.length > 0) {
      throw new CronError(`The ${fieldName} field has more than one step in "${piece}".`);
    }
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) {
        throw new CronError(`The ${fieldName} field has an invalid step "${stepPart}".`);
      }
      if (step > 1) restricted = true;
    }

    let start: number;
    let end: number;
    if (rangePart === "*" || rangePart === "?") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-");
      start = fieldValue(from, min, max, names, fieldName);
      end = fieldValue(to, min, max, names, fieldName);
      if (end < start) {
        throw new CronError(`The ${fieldName} field has a reversed range "${rangePart}".`);
      }
      restricted = true;
    } else {
      start = fieldValue(rangePart, min, max, names, fieldName);
      end = stepPart === undefined ? start : max;
      restricted = true;
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  if (values.size === 0) throw new CronError(`The ${fieldName} field matches nothing.`);
  return { values: [...values].sort((a, b) => a - b), restricted };
}

/** Parse a 5-field cron expression (or a `@daily`-style alias). */
export function parseCronExpression(expression: string): CronFields {
  const raw = String(expression ?? "").trim();
  if (!raw) throw new CronError("A schedule is required.");
  if (raw.length > MAX_CRON_EXPRESSION_LENGTH) {
    throw new CronError("This schedule expression is too long.");
  }

  const normalized = ALIASES[raw.toLowerCase()] ?? raw;
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(
      "A schedule needs five fields: minute, hour, day of month, month, and day of week.",
    );
  }

  const minutes = parseField(parts[0], 0, 59, "minute");
  const hours = parseField(parts[1], 0, 23, "hour");
  const daysOfMonth = parseField(parts[2], 1, 31, "day of month");
  const months = parseField(parts[3], 1, 12, "month", MONTH_NAMES);
  const daysOfWeek = parseField(parts[4], 0, 7, "day of week", DAY_NAMES);

  return {
    minutes: minutes.values,
    hours: hours.values,
    daysOfMonth: daysOfMonth.values,
    months: months.values,
    // Cron accepts both 0 and 7 for Sunday; normalize to 0 for matching.
    daysOfWeek: [...new Set(daysOfWeek.values.map((day) => (day === 7 ? 0 : day)))].sort(
      (a, b) => a - b,
    ),
    dayOfMonthRestricted: daysOfMonth.restricted,
    dayOfWeekRestricted: daysOfWeek.restricted,
  };
}

/** True when the expression parses; never throws. */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

function matchesDate(fields: CronFields, date: Date): boolean {
  if (!fields.months.includes(date.getMonth() + 1)) return false;
  const dayOfMonth = fields.daysOfMonth.includes(date.getDate());
  const dayOfWeek = fields.daysOfWeek.includes(date.getDay());
  if (fields.dayOfMonthRestricted && fields.dayOfWeekRestricted) {
    return dayOfMonth || dayOfWeek;
  }
  return dayOfMonth && dayOfWeek;
}

/**
 * The first occurrence strictly after `from`, in local server time. Seconds are
 * always zero: cron's resolution is a minute and the scheduler ticks faster than
 * that, so a job fires in the minute it becomes due.
 */
export function nextCronOccurrence(
  expression: string | CronFields,
  from: Date = new Date(),
): Date {
  const fields = typeof expression === "string" ? parseCronExpression(expression) : expression;
  if (Number.isNaN(from.getTime())) {
    throw new CronError("The reference time is invalid.");
  }

  // Strictly after `from`, at minute resolution.
  const earliest = new Date(from.getTime());
  earliest.setSeconds(0, 0);
  earliest.setMinutes(earliest.getMinutes() + 1);

  for (let offset = 0; offset < MAX_DAYS_AHEAD; offset += 1) {
    const day = new Date(
      earliest.getFullYear(),
      earliest.getMonth(),
      earliest.getDate() + offset,
    );
    if (!matchesDate(fields, day)) continue;

    for (const hour of fields.hours) {
      for (const minute of fields.minutes) {
        const candidate = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          hour,
          minute,
          0,
          0,
        );
        if (candidate.getTime() >= earliest.getTime()) return candidate;
      }
    }
  }

  throw new CronError("This schedule has no upcoming run in the next four years.");
}

function isEveryValue(values: number[], min: number, max: number): boolean {
  return values.length === max - min + 1;
}

function timeLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function stepOf(values: number[], min: number, max: number): number | null {
  if (values.length < 2 || values[0] !== min) return null;
  const step = values[1] - values[0];
  if (step < 2) return null;
  const expected: number[] = [];
  for (let value = min; value <= max; value += step) expected.push(value);
  return expected.length === values.length && expected.every((value, index) => value === values[index])
    ? step
    : null;
}

/** A short, human-readable summary such as "Every weekday at 09:00". */
export function describeCronExpression(expression: string): string {
  let fields: CronFields;
  try {
    fields = parseCronExpression(expression);
  } catch {
    return "Invalid schedule";
  }

  const everyMinute = isEveryValue(fields.minutes, 0, 59);
  const everyHour = isEveryValue(fields.hours, 0, 23);
  const everyMonth = isEveryValue(fields.months, 1, 12);
  const everyDayOfMonth = !fields.dayOfMonthRestricted;
  const everyDayOfWeek = !fields.dayOfWeekRestricted;

  let cadence: string;
  if (everyMinute && everyHour) {
    cadence = "Every minute";
  } else if (everyMinute) {
    cadence = `Every minute of ${joinLabels(fields.hours.map((hour) => `${String(hour).padStart(2, "0")}:00`))}`;
  } else {
    const minuteStep = everyHour ? stepOf(fields.minutes, 0, 59) : null;
    const hourStep = stepOf(fields.hours, 0, 23);
    if (minuteStep) {
      cadence = `Every ${minuteStep} minutes`;
    } else if (everyHour && fields.minutes.length === 1) {
      cadence = `Every hour at :${String(fields.minutes[0]).padStart(2, "0")}`;
    } else if (everyHour) {
      cadence = `Every hour at ${joinLabels(fields.minutes.map((minute) => `:${String(minute).padStart(2, "0")}`))}`;
    } else if (hourStep && fields.minutes.length === 1) {
      cadence = `Every ${hourStep} hours at :${String(fields.minutes[0]).padStart(2, "0")}`;
    } else {
      const times: string[] = [];
      for (const hour of fields.hours) {
        for (const minute of fields.minutes) times.push(timeLabel(hour, minute));
        if (times.length > 4) break;
      }
      cadence =
        times.length > 4
          ? `At ${times.slice(0, 4).join(", ")}, and more`
          : `At ${joinLabels(times)}`;
    }
  }

  const dayParts: string[] = [];
  if (!everyDayOfWeek) {
    const days = fields.daysOfWeek;
    const isWeekdays = days.length === 5 && days.every((day) => day >= 1 && day <= 5);
    const isWeekend = days.length === 2 && days.includes(0) && days.includes(6);
    if (isWeekdays) dayParts.push("on weekdays");
    else if (isWeekend) dayParts.push("at weekends");
    else dayParts.push(`on ${joinLabels(days.map((day) => DAY_LABELS[day]))}`);
  }
  if (!everyDayOfMonth) {
    dayParts.push(`on day ${joinLabels(fields.daysOfMonth.map(String))} of the month`);
  }
  if (!everyMonth) {
    dayParts.push(`in ${joinLabels(fields.months.map((month) => MONTH_LABELS[month - 1]))}`);
  }

  if (dayParts.length === 0) {
    const daily = !everyMinute && !everyHour ? " every day" : "";
    return `${cadence}${daily}`;
  }
  return `${cadence} ${dayParts.join(", ")}`;
}
