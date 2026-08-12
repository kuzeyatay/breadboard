// The calendar, addressed by an agent instead of by the grid.
//
// Read-only by construction: nothing here can create, move or delete anything.
// The store's write methods are simply not reachable from this module, so the
// tools that sit on top of it cannot change a user's calendar even by mistake.
//
// Two things it takes care of that the model should not have to:
//
//   * Dates. Events are timezone-free wall-clock strings, and asking a model to
//     do calendar arithmetic on those is how "next Tuesday" becomes the wrong
//     Tuesday. Every range here can be given as a start plus a number of days,
//     defaulting to today, so the common question needs no arithmetic at all.
//   * Recurrence. A weekly standup is one stored row and fifty-two answers to
//     "what's on this month". Search matches the row; the dates come from
//     `occurrencesInRange`, which is the only code that understands the rules.

import { CalendarError, MAX_RANGE_DAYS, type CalendarStore } from "./store.ts";
import type { CalendarEvent, CalendarOccurrence } from "./types.ts";
import { addDays, dateOf, daysBetween, endOfDay, parseDate, parseStamp, startOfDay, todayDate } from "./wallclock.ts";

/** A week is what "what's coming up" almost always means. */
const DEFAULT_WINDOW_DAYS = 7;
/** How far ahead "when does this next happen" is willing to look. */
const NEXT_OCCURRENCE_HORIZON_DAYS = 365;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DESCRIPTION_CHARS = 500;

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function idList(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw
    .map((entry) => Number(typeof entry === "string" ? entry.trim() : entry))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface RangeQuery {
  from?: unknown;
  to?: unknown;
  days?: unknown;
}

export interface ResolvedRange {
  from: string;
  to: string;
  /** True when the caller gave no start and today was used. */
  defaultedToToday: boolean;
}

/**
 * A wall-clock window from whatever the caller gave. `from` accepts a bare date
 * or a full stamp and defaults to today; `to` may be given directly or implied
 * by `days`. "Today" is this machine's date on purpose — the whole calendar is
 * stored in local wall-clock time, so there is no other clock to consult.
 */
export function resolveRange(query: RangeQuery = {}, reference = new Date()): ResolvedRange {
  const rawFrom = typeof query.from === "string" ? query.from.trim() : "";
  const rawTo = typeof query.to === "string" ? query.to.trim() : "";

  let from: string;
  if (!rawFrom) {
    from = startOfDay(todayDate(reference));
  } else if (parseStamp(rawFrom)) {
    from = rawFrom;
  } else if (parseDate(rawFrom)) {
    from = startOfDay(rawFrom);
  } else {
    throw new CalendarError(400, `"${rawFrom}" is not a date. Use 2026-08-07 or 2026-08-07T09:00.`);
  }

  let to: string;
  if (rawTo) {
    if (parseStamp(rawTo)) to = rawTo;
    else if (parseDate(rawTo)) to = endOfDay(rawTo);
    else throw new CalendarError(400, `"${rawTo}" is not a date. Use 2026-08-14 or 2026-08-14T17:00.`);
  } else {
    const days = numberOption(query.days, DEFAULT_WINDOW_DAYS, 1, MAX_RANGE_DAYS);
    to = endOfDay(dateOf(addDays(from, days - 1)));
  }

  if (to < from) throw new CalendarError(400, "The range ends before it starts.");
  if (daysBetween(dateOf(from), dateOf(to)) > MAX_RANGE_DAYS) {
    throw new CalendarError(400, `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  }
  return { from, to, defaultedToToday: !rawFrom };
}

// ── shaping ─────────────────────────────────────────────────────────────────

export interface AgentOccurrence {
  eventId: number;
  /** Set when this instance came from a recurring series. */
  seriesId?: number;
  calendar: string;
  title: string;
  start: string;
  end: string;
  allDay?: true;
  location?: string;
  /** True when a per-instance edit replaced this occurrence. */
  edited?: true;
  recurring?: true;
  attendees?: number;
  description?: string;
}

function shapeOccurrence(
  occurrence: CalendarOccurrence,
  calendarNames: Map<number, string>,
  options: { descriptions: boolean },
): AgentOccurrence {
  const shaped: AgentOccurrence = {
    eventId: occurrence.eventId,
    calendar: calendarNames.get(occurrence.calendarId) ?? `#${occurrence.calendarId}`,
    title: occurrence.title,
    start: occurrence.start,
    end: occurrence.end,
  };
  if (occurrence.seriesId !== null) shaped.seriesId = occurrence.seriesId;
  if (occurrence.allDay) shaped.allDay = true;
  if (occurrence.location) shaped.location = occurrence.location;
  if (occurrence.isOverride) shaped.edited = true;
  if (occurrence.recurring) shaped.recurring = true;
  if (occurrence.attendeeCount > 0) shaped.attendees = occurrence.attendeeCount;
  if (options.descriptions && occurrence.description) {
    shaped.description = truncate(occurrence.description, DESCRIPTION_CHARS);
  }
  return shaped;
}

/** "every 2 weeks until 2026-12-31" — a rule a person can read back. */
export function describeRecurrence(event: CalendarEvent): string {
  const { frequency, interval, until, count } = event.recurrence;
  if (frequency === "none") return "does not repeat";
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[frequency];
  const every = interval === 1 ? `every ${unit}` : `every ${interval} ${unit}s`;
  if (until) return `${every} until ${until}`;
  if (count) return `${every}, ${count} times`;
  return every;
}

function calendarNameMap(store: CalendarStore, userId: number): Map<number, string> {
  return new Map(store.listCalendars(userId).map((calendar) => [calendar.id, calendar.name]));
}

// ── calendars ───────────────────────────────────────────────────────────────

/**
 * The user's calendars. Worth calling before a filtered query, because
 * `calendarIds` everywhere else is written in these ids — and because a
 * subscribed calendar being read-only explains why its events cannot be changed.
 */
export function listCalendars(store: CalendarStore, userId: number) {
  const calendars = store.listCalendars(userId);
  return {
    calendars: calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      /** False when the user has hidden it in the grid; its events still exist. */
      visible: calendar.visible,
      /** True for a mirror of a remote ICS — its events come from elsewhere. */
      subscribed: calendar.readOnly,
      sourceUrl: calendar.sourceUrl,
      lastSyncedAt: calendar.lastSyncedAt,
      syncError: calendar.syncError,
    })),
  };
}

// ── agenda ──────────────────────────────────────────────────────────────────

export interface AgendaQuery extends RangeQuery {
  calendarIds?: unknown;
  limit?: unknown;
  includeDescriptions?: unknown;
}

/**
 * Everything on the calendar between two points, recurrence expanded and
 * per-instance edits substituted, in the order it happens.
 */
export function agenda(
  store: CalendarStore,
  userId: number,
  query: AgendaQuery = {},
  reference = new Date(),
) {
  const range = resolveRange(query, reference);
  const calendarIds = idList(query.calendarIds);
  const limit = numberOption(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const names = calendarNameMap(store, userId);

  const occurrences = store.occurrencesInRange(userId, range.from, range.to, { calendarIds });
  const descriptions = query.includeDescriptions === true;

  return {
    from: range.from,
    to: range.to,
    today: todayDate(reference),
    total: occurrences.length,
    returned: Math.min(occurrences.length, limit),
    occurrences: occurrences
      .slice(0, limit)
      .map((occurrence) => shapeOccurrence(occurrence, names, { descriptions })),
  };
}

// ── search ──────────────────────────────────────────────────────────────────

export interface SearchQuery extends RangeQuery {
  query?: unknown;
  calendarIds?: unknown;
  limit?: unknown;
  includeDescriptions?: unknown;
  /** Search the whole calendar rather than a window. Ignores from/to/days. */
  allTime?: unknown;
}

/**
 * Find events by text — title, location, description or an attendee's name or
 * address — and report the dates they actually land on.
 *
 * Two modes, because they answer different questions. Within a window the hits
 * are *occurrences*: "the standups I have with Ana in August" is fifty answers,
 * one per date. Over all time the hits are *events*: "when do I meet Ana" is one
 * answer with the rule and the next date it fires, not a wall of repeats.
 */
export function searchEvents(
  store: CalendarStore,
  userId: number,
  query: SearchQuery = {},
  reference = new Date(),
) {
  const text = typeof query.query === "string" ? query.query.trim() : "";
  const allTime = query.allTime === true;
  if (!text && !allTime && query.from === undefined && query.to === undefined) {
    throw new CalendarError(400, "Give a search term, a date range, or allTime.");
  }
  const calendarIds = idList(query.calendarIds);
  const limit = numberOption(query.limit, 25, 1, MAX_LIMIT);
  const descriptions = query.includeDescriptions === true;
  const names = calendarNameMap(store, userId);

  // The text match happens in SQL because attendees live in their own table;
  // dates are attached afterwards, from the only code that expands recurrence.
  const matches = store.searchEvents(userId, { query: text, calendarIds, limit: 500 });
  const matchedIds = new Set(matches.map((event) => event.id));

  if (!allTime) {
    const range = resolveRange(query, reference);
    const occurrences = store
      .occurrencesInRange(userId, range.from, range.to, { calendarIds })
      .filter(
        (occurrence) =>
          matchedIds.has(occurrence.eventId) ||
          (occurrence.seriesId !== null && matchedIds.has(occurrence.seriesId)),
      );
    return {
      mode: "occurrences" as const,
      query: text || undefined,
      from: range.from,
      to: range.to,
      total: occurrences.length,
      returned: Math.min(occurrences.length, limit),
      occurrences: occurrences
        .slice(0, limit)
        .map((occurrence) => shapeOccurrence(occurrence, names, { descriptions })),
    };
  }

  // All-time: one row per matching event, dated by its next firing. A single
  // bounded expansion covers every hit, so this stays one extra query.
  const horizon = nextOccurrences(store, userId, reference);
  const events = matches.slice(0, limit).map((event) => ({
    eventId: event.id,
    calendar: names.get(event.calendarId) ?? `#${event.calendarId}`,
    title: event.title,
    start: event.startsAt,
    end: event.endsAt,
    allDay: event.allDay || undefined,
    location: event.location ?? undefined,
    repeats: describeRecurrence(event),
    nextOn: horizon.get(event.id) ?? null,
    attendees: event.attendees.length || undefined,
    description:
      descriptions && event.description ? truncate(event.description, DESCRIPTION_CHARS) : undefined,
  }));

  return {
    mode: "events" as const,
    query: text || undefined,
    total: matches.length,
    returned: events.length,
    /** Null `nextOn` means nothing scheduled within the next year. */
    horizonDays: NEXT_OCCURRENCE_HORIZON_DAYS,
    events,
  };
}

/** First upcoming start per event id, within the horizon. One store query. */
function nextOccurrences(
  store: CalendarStore,
  userId: number,
  reference: Date,
): Map<number, string> {
  const today = todayDate(reference);
  const occurrences = store.occurrencesInRange(
    userId,
    startOfDay(today),
    endOfDay(dateOf(addDays(startOfDay(today), NEXT_OCCURRENCE_HORIZON_DAYS))),
  );
  const next = new Map<number, string>();
  for (const occurrence of occurrences) {
    // Attributed to the series as well as to the row, so a hit on a recurring
    // master is dated by its next instance rather than left null.
    for (const id of [occurrence.eventId, occurrence.seriesId]) {
      if (id === null) continue;
      const current = next.get(id);
      if (!current || occurrence.start < current) next.set(id, occurrence.start);
    }
  }
  return next;
}

// ── one event ───────────────────────────────────────────────────────────────

export interface EventQuery {
  eventId?: unknown;
  upcoming?: unknown;
}

/**
 * Everything stored about one event, including the parts the grid never shows:
 * the recurrence rule in full, the attendee list with each reply, the occurrence
 * dates deleted from the series, and the iCalendar UID.
 */
export function getEvent(
  store: CalendarStore,
  userId: number,
  query: EventQuery = {},
  reference = new Date(),
) {
  const eventId = Number(query.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw new CalendarError(400, "eventId is required.");
  }
  const event = store.getEvent(userId, eventId);
  const names = calendarNameMap(store, userId);
  const wanted = numberOption(query.upcoming, 5, 0, 25);

  let upcoming: string[] = [];
  if (wanted > 0) {
    const today = todayDate(reference);
    upcoming = store
      .occurrencesInRange(
        userId,
        startOfDay(today),
        endOfDay(dateOf(addDays(startOfDay(today), NEXT_OCCURRENCE_HORIZON_DAYS))),
      )
      .filter(
        (occurrence) => occurrence.eventId === event.id || occurrence.seriesId === event.id,
      )
      .slice(0, wanted)
      .map((occurrence) => occurrence.start);
  }

  return {
    event: {
      id: event.id,
      calendar: names.get(event.calendarId) ?? `#${event.calendarId}`,
      calendarId: event.calendarId,
      title: event.title,
      description: event.description,
      location: event.location,
      allDay: event.allDay,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      recurrence: event.recurrence,
      repeats: describeRecurrence(event),
      /** Occurrence starts deleted from the series (iCalendar EXDATE). */
      excludedDates: event.excludedDates,
      /** Set when this row is a per-instance edit of the series it names. */
      parentEventId: event.parentEventId,
      replacesOccurrence: event.recurrenceId,
      organizer: event.organizerEmail
        ? { email: event.organizerEmail, name: event.organizerName }
        : null,
      attendees: event.attendees,
      uid: event.uid,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    },
    upcoming,
    horizonDays: NEXT_OCCURRENCE_HORIZON_DAYS,
  };
}
