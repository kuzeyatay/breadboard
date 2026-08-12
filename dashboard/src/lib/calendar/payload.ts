// Request-body → event patch mapping, shared by the create and update routes.
//
// This layer only decides which fields the client *meant* to set (absent keys
// stay absent so a PATCH does not blank a field it never mentioned). All value
// validation — lengths, date shapes, ordering, ownership — belongs to the store,
// so a create and an update cannot drift apart.

import type { Attendee, CalendarEventPatch, RecurrenceRule } from "./types.ts";

type Body = Record<string, unknown>;

/**
 * Shape-only: role, status and the email itself are validated by the store, so
 * a create and an update cannot disagree about what a valid attendee is.
 */
function readAttendees(value: unknown): Partial<Attendee>[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;

  return value
    .filter((entry): entry is Body => !!entry && typeof entry === "object")
    .map((entry) => ({
      email: typeof entry.email === "string" ? entry.email : "",
      name: typeof entry.name === "string" ? entry.name : null,
      role: entry.role as Attendee["role"],
      status: entry.status as Attendee["status"],
    }));
}

function readRecurrence(value: unknown): Partial<RecurrenceRule> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;

  const raw = value as Body;
  const rule: Partial<RecurrenceRule> = {};

  if (typeof raw.frequency === "string") {
    rule.frequency = raw.frequency as RecurrenceRule["frequency"];
  }
  if (raw.interval !== undefined && raw.interval !== null) {
    rule.interval = Number(raw.interval);
  }
  if (raw.until === null || raw.until === "") {
    rule.until = null;
  } else if (typeof raw.until === "string") {
    rule.until = raw.until;
  }
  if (raw.count === null || raw.count === "") {
    rule.count = null;
  } else if (raw.count !== undefined) {
    rule.count = Number(raw.count);
  }

  return rule;
}

export function readEventPatch(body: Body): CalendarEventPatch {
  const patch: CalendarEventPatch = {};

  if (body.calendarId !== undefined) patch.calendarId = Number(body.calendarId);
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string" || body.description === null) {
    patch.description = body.description as string | null;
  }
  if (typeof body.location === "string" || body.location === null) {
    patch.location = body.location as string | null;
  }
  if (typeof body.allDay === "boolean") patch.allDay = body.allDay;
  if (typeof body.startsAt === "string") patch.startsAt = body.startsAt;
  if (typeof body.endsAt === "string") patch.endsAt = body.endsAt;
  if ("recurrence" in body) patch.recurrence = readRecurrence(body.recurrence);
  if ("attendees" in body) patch.attendees = readAttendees(body.attendees);
  if (typeof body.organizerEmail === "string" || body.organizerEmail === null) {
    patch.organizerEmail = body.organizerEmail as string | null;
  }
  if (typeof body.organizerName === "string" || body.organizerName === null) {
    patch.organizerName = body.organizerName as string | null;
  }

  return patch;
}
