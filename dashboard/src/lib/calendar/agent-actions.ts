// Calendar writes initiated by Hermes.
//
// The route that calls these functions has already pinned the request to an
// authenticated Breadboard session and supplies that session's user id. This
// layer keeps the model-facing conveniences out of the core store: a missing
// calendar means "the first writable one", a date without a time means an
// all-day event, and a timed event without an end gets a useful default length.
// The CalendarStore remains the final authority for ownership, validation,
// recurrence semantics and subscribed-calendar write protection.

import { readEventPatch } from "./payload.ts";
import {
  CalendarError,
  type CalendarStore,
  type ScopedEventDelete,
  type ScopedEventUpdate,
} from "./store.ts";
import { isSeriesScope, type CalendarEventInput, type SeriesScope } from "./types.ts";
import { addMinutes, minutesBetween, parseDate, parseStamp } from "./wallclock.ts";

/** A reminder with a time but no duration occupies one half-hour slot. */
export const DEFAULT_AGENT_EVENT_MINUTES = 30;

function eventId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CalendarError(400, "eventId is required.");
  }
  return id;
}

function scope(value: unknown): SeriesScope {
  if (value === undefined || value === null || value === "") return "series";
  if (!isSeriesScope(value)) {
    throw new CalendarError(400, "scope must be instance, following, or series.");
  }
  return value;
}

function recurrenceId(value: unknown, selectedScope: SeriesScope): string | null {
  const recurrence = typeof value === "string" ? value.trim() : "";
  if (selectedScope === "series") return recurrence && parseStamp(recurrence) ? recurrence : null;
  if (!parseStamp(recurrence)) {
    throw new CalendarError(
      400,
      "recurrenceId is required when changing one occurrence or this and following.",
    );
  }
  return recurrence;
}

function defaultCalendarId(store: CalendarStore, userId: number): number {
  const calendar = store
    .listCalendarsEnsuringDefault(userId)
    .find((candidate) => !candidate.readOnly);
  if (!calendar) {
    throw new CalendarError(
      409,
      "There is no writable calendar. Add a local or CalDAV calendar first.",
    );
  }
  return calendar.id;
}

export function createCalendarEvent(
  store: CalendarStore,
  userId: number,
  args: Record<string, unknown>,
) {
  const input = readEventPatch(args);
  const rawStart = input.startsAt;

  if (input.calendarId === undefined) {
    input.calendarId = defaultCalendarId(store, userId);
  }
  const targetCalendar = store.getCalendar(userId, input.calendarId);
  if (targetCalendar.readOnly) {
    throw new CalendarError(
      409,
      `"${targetCalendar.name}" is subscribed and cannot be edited.`,
    );
  }

  // A bare date is the natural representation of "remind me tomorrow" when
  // no time was supplied. Put a real all-day event on that date rather than
  // inventing a time or merely promising a reminder in prose.
  if (input.allDay === undefined && parseDate(rawStart)) {
    input.allDay = true;
  }

  if (input.endsAt === undefined) {
    if (typeof rawStart === "string" && parseDate(rawStart)) {
      input.endsAt = rawStart;
    } else if (typeof rawStart === "string" && parseStamp(rawStart)) {
      input.endsAt = addMinutes(rawStart, DEFAULT_AGENT_EVENT_MINUTES);
    }
  }

  const event = store.createEvent(userId, input as CalendarEventInput);
  return {
    created: true as const,
    event,
    calendar: { id: targetCalendar.id, name: targetCalendar.name },
  };
}

export function updateCalendarEvent(
  store: CalendarStore,
  userId: number,
  args: Record<string, unknown>,
) {
  const id = eventId(args.eventId);
  const selectedScope = scope(args.scope);
  const current = store.getEvent(userId, id);
  const patch = readEventPatch(args);

  // "Move it to 15:00" should preserve the duration. Requiring the model to
  // repeat an unchanged end is brittle and commonly turns a move into an
  // invalid negative-duration event.
  if (patch.startsAt !== undefined && patch.endsAt === undefined) {
    const normalizedStart = parseDate(patch.startsAt)
      ? `${patch.startsAt.trim()}T00:00`
      : patch.startsAt;
    if (parseStamp(normalizedStart)) {
      patch.endsAt = addMinutes(
        normalizedStart,
        Math.max(0, minutesBetween(current.startsAt, current.endsAt)),
      );
    }
  }

  const request: ScopedEventUpdate = {
    eventId: id,
    scope: selectedScope,
    recurrenceId: recurrenceId(args.recurrenceId, selectedScope),
    patch,
  };
  const event = store.updateEventScoped(userId, request);
  return { updated: true as const, event };
}

export function deleteCalendarEvent(
  store: CalendarStore,
  userId: number,
  args: Record<string, unknown>,
) {
  const id = eventId(args.eventId);
  const selectedScope = scope(args.scope);
  const request: ScopedEventDelete = {
    eventId: id,
    scope: selectedScope,
    recurrenceId: recurrenceId(args.recurrenceId, selectedScope),
  };
  store.deleteEventScoped(userId, request);
  return {
    deleted: true as const,
    eventId: id,
    scope: selectedScope,
    recurrenceId: request.recurrenceId,
  };
}
