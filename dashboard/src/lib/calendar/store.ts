// SQLite-backed calendar persistence.
//
// A plain class over an injected database handle (matching
// src/lib/schedules/store.ts) so it can be unit tested against an in-memory
// database. It owns every write to `calendar_collections` / `calendar_events` /
// `calendar_event_attendees` and is the only place that turns stored rules into
// dated occurrences.
//
// A recurring series is one master row plus, optionally, override rows that
// replace a single occurrence and an EXDATE list of occurrences deleted from
// it. Everything that edits a series goes through `updateEventScoped` /
// `deleteEventScoped`, which are the only methods that understand that shape;
// `createEvent` / `updateEvent` / `deleteEvent` stay single-row operations
// because src/lib/socials-manager/calendar-bridge.ts drives them directly.

import { randomUUID } from "node:crypto";
import type DatabaseType from "better-sqlite3";

import { ensureCalendarSchema } from "./schema.ts";
import {
  DEFAULT_CALENDAR_COLOR,
  nextCalendarColor,
  normalizeCalendarColor,
} from "./palette.ts";
import { countOccurrencesBefore, expandOccurrences } from "./recurrence.ts";
import {
  isRecurrenceFrequency,
  NO_RECURRENCE,
  type Attendee,
  type AttendeeRole,
  type AttendeeStatus,
  type CalendarCollection,
  type CalendarCollectionInput,
  type CalendarCollectionPatch,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventPatch,
  type CalendarOccurrence,
  type RecurrenceRule,
  type SeriesScope,
} from "./types.ts";
import {
  addDays,
  addMinutes,
  dateOf,
  daysBetween,
  endOfDay,
  minutesBetween,
  parseDate,
  parseStamp,
  startOfDay,
} from "./wallclock.ts";

type Db = DatabaseType.Database;

export const MAX_CALENDARS_PER_USER = 24;
export const MAX_EVENTS_PER_USER = 10_000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_LOCATION_LENGTH = 300;
export const MAX_DESCRIPTION_LENGTH = 10_000;
export const MAX_CALENDAR_NAME_LENGTH = 80;
export const MAX_RECURRENCE_COUNT = 500;
export const MAX_RECURRENCE_INTERVAL = 365;
export const MAX_ATTENDEES_PER_EVENT = 100;
export const MAX_EXCLUSIONS_PER_SERIES = 500;

/** Widest window a single request may ask for, in days. A year view needs 366. */
export const MAX_RANGE_DAYS = 400;

export const DEFAULT_CALENDAR_NAME = "Personal";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CalendarError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CalendarError";
    this.status = status;
  }
}

interface CalendarCollectionRow {
  id: number;
  user_id: number;
  name: string;
  color: string;
  visible: number;
  sort_order: number;
  source_url: string | null;
  read_only: number;
  last_synced_at: string | null;
  sync_error: string | null;
  created_at: string;
}

interface CalendarEventRow {
  id: number;
  user_id: number;
  calendar_id: number;
  title: string;
  description: string | null;
  location: string | null;
  all_day: number;
  starts_at: string;
  ends_at: string;
  recurrence: string;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
  parent_event_id: number | null;
  recurrence_id: string | null;
  excluded_dates: string | null;
  uid: string | null;
  organizer_email: string | null;
  organizer_name: string | null;
  created_at: string;
  updated_at: string;
}

interface AttendeeRow {
  event_id: number;
  email: string;
  name: string | null;
  role: AttendeeRole;
  status: AttendeeStatus;
}

function presentCollection(row: CalendarCollectionRow): CalendarCollection {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    visible: row.visible !== 0,
    sortOrder: row.sort_order,
    sourceUrl: row.source_url,
    readOnly: row.read_only !== 0,
    lastSyncedAt: row.last_synced_at,
    syncError: row.sync_error,
    createdAt: row.created_at,
  };
}

/** Tolerant of a hand-edited or half-written column: a bad list reads as empty. */
function parseExcludedDates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && !!parseStamp(value));
  } catch {
    return [];
  }
}

function presentEvent(row: CalendarEventRow, attendees: Attendee[] = []): CalendarEvent {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    title: row.title,
    description: row.description,
    location: row.location,
    allDay: row.all_day !== 0,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    recurrence: {
      frequency: isRecurrenceFrequency(row.recurrence) ? row.recurrence : "none",
      interval: row.recurrence_interval > 0 ? row.recurrence_interval : 1,
      until: row.recurrence_until,
      count: row.recurrence_count,
    },
    parentEventId: row.parent_event_id,
    recurrenceId: row.recurrence_id,
    excludedDates: parseExcludedDates(row.excluded_dates),
    uid: row.uid ?? `${row.id}@breadboard`,
    organizerEmail: row.organizer_email,
    organizerName: row.organizer_name,
    attendees,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new CalendarError(400, `${field} is required.`);
  if (text.length > max) {
    throw new CalendarError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > max) {
    throw new CalendarError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function requireStamp(value: unknown, field: string): string {
  if (typeof value === "string" && parseStamp(value)) return value.trim();
  // A bare date is accepted so an all-day payload can send "2026-08-01".
  if (typeof value === "string" && parseDate(value)) return `${value.trim()}T00:00`;
  throw new CalendarError(400, `${field} must look like 2026-08-01T09:00.`);
}

function normalizeAttendees(input: unknown): Attendee[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) throw new CalendarError(400, "Attendees must be a list.");
  if (input.length > MAX_ATTENDEES_PER_EVENT) {
    throw new CalendarError(400, `An event can have at most ${MAX_ATTENDEES_PER_EVENT} attendees.`);
  }

  const seen = new Set<string>();
  const attendees: Attendee[] = [];

  for (const raw of input) {
    const candidate = (raw ?? {}) as Partial<Attendee>;
    const email = typeof candidate.email === "string" ? candidate.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (!EMAIL_PATTERN.test(email)) {
      throw new CalendarError(400, `"${email}" is not an email address.`);
    }
    if (seen.has(email)) continue; // The same person invited twice is one invitation.
    seen.add(email);

    const role: AttendeeRole =
      candidate.role === "optional" || candidate.role === "chair" ? candidate.role : "required";
    const status: AttendeeStatus =
      candidate.status === "accepted" ||
      candidate.status === "declined" ||
      candidate.status === "tentative"
        ? candidate.status
        : "needs-action";

    attendees.push({
      email,
      name: optionalText(candidate.name, "Attendee name", 200),
      role,
      status,
    });
  }

  return attendees;
}

function normalizeRecurrence(
  input: Partial<RecurrenceRule> | null | undefined,
  start: string,
): RecurrenceRule {
  if (!input || !input.frequency || input.frequency === "none") return { ...NO_RECURRENCE };
  if (!isRecurrenceFrequency(input.frequency)) {
    throw new CalendarError(400, "That repeat frequency is not supported.");
  }

  const interval = Number(input.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) {
    throw new CalendarError(
      400,
      `Repeat interval must be a whole number between 1 and ${MAX_RECURRENCE_INTERVAL}.`,
    );
  }

  let count: number | null = null;
  if (input.count !== null && input.count !== undefined) {
    const parsed = Number(input.count);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RECURRENCE_COUNT) {
      throw new CalendarError(
        400,
        `Repeat count must be a whole number between 1 and ${MAX_RECURRENCE_COUNT}.`,
      );
    }
    count = parsed;
  }

  let until: string | null = null;
  if (input.until !== null && input.until !== undefined && input.until !== "") {
    if (!parseDate(input.until)) {
      throw new CalendarError(400, "Repeat end date must look like 2026-12-31.");
    }
    until = String(input.until).trim();
    if (until < dateOf(start)) {
      throw new CalendarError(400, "Repeat end date cannot be before the event starts.");
    }
  }

  // COUNT and UNTIL are mutually exclusive in RFC 5545; a count wins because it
  // is the more specific answer to "how many".
  if (count !== null) until = null;

  return { frequency: input.frequency, interval, until, count };
}

export interface ScopedEventUpdate {
  /** The row backing the occurrence being edited: an override, or the master. */
  eventId: number;
  scope: SeriesScope;
  /** The occurrence's original start. Required for "instance" and "following". */
  recurrenceId?: string | null;
  patch: CalendarEventPatch;
}

export interface ScopedEventDelete {
  eventId: number;
  scope: SeriesScope;
  recurrenceId?: string | null;
}

/** An event as it arrives from an ICS file or a subscription refresh. */
export interface IngestEventInput extends CalendarEventInput {
  excludedDates?: string[];
  /** Set when the VEVENT carried a RECURRENCE-ID, i.e. it overrides one instance. */
  recurrenceId?: string | null;
}

export class CalendarStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureCalendarSchema(db);
  }

  // ---------------------------------------------------------------- calendars

  listCalendars(userId: number): CalendarCollection[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM calendar_collections
          WHERE user_id = ?
          ORDER BY sort_order ASC, id ASC`,
      )
      .all(userId) as CalendarCollectionRow[];
    return rows.map(presentCollection);
  }

  /**
   * Calendars for a user, seeding "Personal" the first time they open the app.
   * Nextcloud does the same on account creation; doing it lazily keeps the
   * calendar out of the signup path.
   */
  listCalendarsEnsuringDefault(userId: number): CalendarCollection[] {
    const existing = this.listCalendars(userId);
    if (existing.length > 0) return existing;

    this.db
      .prepare(
        `INSERT INTO calendar_collections (user_id, name, color, visible, sort_order)
         VALUES (?, ?, ?, 1, 0)`,
      )
      .run(userId, DEFAULT_CALENDAR_NAME, DEFAULT_CALENDAR_COLOR);

    return this.listCalendars(userId);
  }

  getCalendar(userId: number, calendarId: number): CalendarCollection {
    const row = this.db
      .prepare(`SELECT * FROM calendar_collections WHERE id = ? AND user_id = ?`)
      .get(calendarId, userId) as CalendarCollectionRow | undefined;
    if (!row) throw new CalendarError(404, "That calendar does not exist.");
    return presentCollection(row);
  }

  /**
   * A subscribed calendar is a mirror of someone else's ICS: writing to it
   * would be silently undone by the next refresh, so it is refused up front.
   */
  private requireWritableCalendar(userId: number, calendarId: number): CalendarCollection {
    const calendar = this.getCalendar(userId, calendarId);
    if (calendar.readOnly) {
      throw new CalendarError(409, `"${calendar.name}" is subscribed and cannot be edited.`);
    }
    return calendar;
  }

  createCalendar(userId: number, input: CalendarCollectionInput): CalendarCollection {
    const existing = this.listCalendars(userId);
    if (existing.length >= MAX_CALENDARS_PER_USER) {
      throw new CalendarError(
        409,
        `You can keep up to ${MAX_CALENDARS_PER_USER} calendars.`,
      );
    }

    const name = requireText(input.name, "Calendar name", MAX_CALENDAR_NAME_LENGTH);
    const color = input.color
      ? normalizeCalendarColor(input.color)
      : nextCalendarColor(existing.map((calendar) => calendar.color));
    const sortOrder = existing.reduce((max, cal) => Math.max(max, cal.sortOrder), -1) + 1;

    const result = this.db
      .prepare(
        `INSERT INTO calendar_collections
           (user_id, name, color, visible, sort_order, source_url, read_only)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        name,
        color,
        input.visible === false ? 0 : 1,
        sortOrder,
        input.sourceUrl ?? null,
        input.readOnly ? 1 : 0,
      );

    return this.getCalendar(userId, Number(result.lastInsertRowid));
  }

  updateCalendar(
    userId: number,
    calendarId: number,
    patch: CalendarCollectionPatch,
  ): CalendarCollection {
    const current = this.getCalendar(userId, calendarId);

    const name =
      patch.name === undefined
        ? current.name
        : requireText(patch.name, "Calendar name", MAX_CALENDAR_NAME_LENGTH);
    const color =
      patch.color === undefined ? current.color : normalizeCalendarColor(patch.color);
    const visible = patch.visible === undefined ? current.visible : patch.visible !== false;

    this.db
      .prepare(
        `UPDATE calendar_collections
            SET name = ?, color = ?, visible = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(name, color, visible ? 1 : 0, calendarId, userId);

    return this.getCalendar(userId, calendarId);
  }

  /** Record the outcome of a subscription refresh. */
  markCalendarSynced(
    userId: number,
    calendarId: number,
    syncedAt: string,
    error: string | null,
  ): CalendarCollection {
    this.getCalendar(userId, calendarId);
    this.db
      .prepare(
        `UPDATE calendar_collections
            SET last_synced_at = ?, sync_error = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(syncedAt, error, calendarId, userId);
    return this.getCalendar(userId, calendarId);
  }

  /**
   * Delete a calendar and its events. The last calendar is protected: without
   * one there is nowhere to put a new event, and the UI would dead-end.
   */
  deleteCalendar(userId: number, calendarId: number): void {
    this.getCalendar(userId, calendarId);
    if (this.listCalendars(userId).length <= 1) {
      throw new CalendarError(409, "You need at least one calendar.");
    }
    this.db
      .prepare(`DELETE FROM calendar_collections WHERE id = ? AND user_id = ?`)
      .run(calendarId, userId);
  }

  // ------------------------------------------------------------------- events

  private eventRow(userId: number, eventId: number): CalendarEventRow {
    const row = this.db
      .prepare(`SELECT * FROM calendar_events WHERE id = ? AND user_id = ?`)
      .get(eventId, userId) as CalendarEventRow | undefined;
    if (!row) throw new CalendarError(404, "That event does not exist.");
    return row;
  }

  private attendeesFor(eventIds: readonly number[]): Map<number, Attendee[]> {
    const byEvent = new Map<number, Attendee[]>();
    if (eventIds.length === 0) return byEvent;

    const unique = [...new Set(eventIds)];
    const placeholders = unique.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT event_id, email, name, role, status
           FROM calendar_event_attendees
          WHERE event_id IN (${placeholders})
          ORDER BY id ASC`,
      )
      .all(...unique) as AttendeeRow[];

    for (const row of rows) {
      const list = byEvent.get(row.event_id);
      const attendee: Attendee = {
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
      };
      if (list) list.push(attendee);
      else byEvent.set(row.event_id, [attendee]);
    }

    return byEvent;
  }

  private writeAttendees(eventId: number, attendees: readonly Attendee[]): void {
    this.db.prepare(`DELETE FROM calendar_event_attendees WHERE event_id = ?`).run(eventId);
    if (attendees.length === 0) return;

    const insert = this.db.prepare(
      `INSERT INTO calendar_event_attendees (event_id, email, name, role, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const attendee of attendees) {
      insert.run(eventId, attendee.email, attendee.name, attendee.role, attendee.status);
    }
  }

  getEvent(userId: number, eventId: number): CalendarEvent {
    const row = this.eventRow(userId, eventId);
    return presentEvent(row, this.attendeesFor([row.id]).get(row.id) ?? []);
  }

  createEvent(userId: number, input: CalendarEventInput): CalendarEvent {
    const total = this.db
      .prepare(`SELECT COUNT(*) AS total FROM calendar_events WHERE user_id = ?`)
      .get(userId) as { total: number };
    if (total.total >= MAX_EVENTS_PER_USER) {
      throw new CalendarError(409, `You can keep up to ${MAX_EVENTS_PER_USER} events.`);
    }

    const fields = this.normalizeEventFields(userId, input, null);
    const eventId = this.insertEventRow(userId, {
      ...fields,
      uid: typeof input.uid === "string" && input.uid.trim() ? input.uid.trim() : randomUUID(),
      parentEventId: null,
      recurrenceId: null,
      excludedDates: [],
    });

    return this.getEvent(userId, eventId);
  }

  updateEvent(userId: number, eventId: number, patch: CalendarEventPatch): CalendarEvent {
    const row = this.eventRow(userId, eventId);
    const current = presentEvent(row, this.attendeesFor([row.id]).get(row.id) ?? []);
    this.requireWritableCalendar(userId, current.calendarId);

    const fields = this.normalizeEventFields(userId, patch, current);

    this.db
      .prepare(
        `UPDATE calendar_events
            SET calendar_id = ?, title = ?, description = ?, location = ?,
                all_day = ?, starts_at = ?, ends_at = ?, recurrence = ?,
                recurrence_interval = ?, recurrence_until = ?, recurrence_count = ?,
                organizer_email = ?, organizer_name = ?,
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(
        fields.calendarId,
        fields.title,
        fields.description,
        fields.location,
        fields.allDay ? 1 : 0,
        fields.startsAt,
        fields.endsAt,
        fields.recurrence.frequency,
        fields.recurrence.interval,
        fields.recurrence.until,
        fields.recurrence.count,
        fields.organizerEmail,
        fields.organizerName,
        eventId,
        userId,
      );

    if (patch.attendees !== undefined) this.writeAttendees(eventId, fields.attendees);

    return this.getEvent(userId, eventId);
  }

  deleteEvent(userId: number, eventId: number): void {
    const row = this.eventRow(userId, eventId);
    this.requireWritableCalendar(userId, row.calendar_id);
    this.db
      .prepare(`DELETE FROM calendar_events WHERE id = ? AND user_id = ?`)
      .run(eventId, userId);
  }

  private insertEventRow(
    userId: number,
    fields: ReturnType<CalendarStore["normalizeEventFields"]> & {
      uid: string;
      parentEventId: number | null;
      recurrenceId: string | null;
      excludedDates: string[];
    },
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO calendar_events (
           user_id, calendar_id, title, description, location, all_day,
           starts_at, ends_at, recurrence, recurrence_interval,
           recurrence_until, recurrence_count, parent_event_id, recurrence_id,
           excluded_dates, uid, organizer_email, organizer_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        fields.calendarId,
        fields.title,
        fields.description,
        fields.location,
        fields.allDay ? 1 : 0,
        fields.startsAt,
        fields.endsAt,
        fields.recurrence.frequency,
        fields.recurrence.interval,
        fields.recurrence.until,
        fields.recurrence.count,
        fields.parentEventId,
        fields.recurrenceId,
        fields.excludedDates.length > 0 ? JSON.stringify(fields.excludedDates) : null,
        fields.uid,
        fields.organizerEmail,
        fields.organizerName,
      );

    const eventId = Number(result.lastInsertRowid);
    this.writeAttendees(eventId, fields.attendees);
    return eventId;
  }

  /**
   * Validate a create payload, or a patch layered over the current row. All-day
   * events are snapped to whole days here so every consumer — grid layout,
   * recurrence, agenda grouping — can assume 00:00/23:59 without re-checking.
   */
  private normalizeEventFields(
    userId: number,
    input: CalendarEventPatch,
    current: CalendarEvent | null,
  ) {
    const calendarId =
      input.calendarId === undefined ? current?.calendarId : Number(input.calendarId);
    if (!Number.isInteger(calendarId) || (calendarId as number) <= 0) {
      throw new CalendarError(400, "Pick a calendar for this event.");
    }
    // Proves the calendar exists *and* belongs to this user.
    this.getCalendar(userId, calendarId as number);

    const title =
      input.title === undefined && current
        ? current.title
        : requireText(input.title, "Event title", MAX_TITLE_LENGTH);

    const description =
      input.description === undefined && current
        ? current.description
        : optionalText(input.description, "Description", MAX_DESCRIPTION_LENGTH);

    const location =
      input.location === undefined && current
        ? current.location
        : optionalText(input.location, "Location", MAX_LOCATION_LENGTH);

    const allDay =
      input.allDay === undefined ? (current?.allDay ?? false) : input.allDay === true;

    let startsAt =
      input.startsAt === undefined && current
        ? current.startsAt
        : requireStamp(input.startsAt, "Start");
    let endsAt =
      input.endsAt === undefined && current
        ? current.endsAt
        : requireStamp(input.endsAt, "End");

    if (allDay) {
      startsAt = startOfDay(startsAt);
      endsAt = endOfDay(endsAt);
    }

    if (endsAt < startsAt) {
      throw new CalendarError(400, "An event cannot end before it starts.");
    }

    const recurrence =
      input.recurrence === undefined && current
        ? current.recurrence
        : normalizeRecurrence(input.recurrence, startsAt);

    // Re-validate a carried-over rule against a moved start date.
    const safeRecurrence = normalizeRecurrence(recurrence, startsAt);

    const attendees =
      input.attendees === undefined && current
        ? current.attendees
        : normalizeAttendees(input.attendees);

    const organizerEmail =
      input.organizerEmail === undefined && current
        ? current.organizerEmail
        : optionalText(input.organizerEmail, "Organizer email", 320);
    if (organizerEmail && !EMAIL_PATTERN.test(organizerEmail)) {
      throw new CalendarError(400, `"${organizerEmail}" is not an email address.`);
    }

    const organizerName =
      input.organizerName === undefined && current
        ? current.organizerName
        : optionalText(input.organizerName, "Organizer name", 200);

    return {
      calendarId: calendarId as number,
      title,
      description,
      location,
      allDay,
      startsAt,
      endsAt,
      recurrence: safeRecurrence,
      attendees,
      organizerEmail,
      organizerName,
    };
  }

  // ------------------------------------------------------------ series scopes

  /** The master row behind an occurrence: the row itself, or its parent. */
  private masterRow(userId: number, eventId: number): CalendarEventRow {
    const row = this.eventRow(userId, eventId);
    return row.parent_event_id ? this.eventRow(userId, row.parent_event_id) : row;
  }

  private overridesOf(userId: number, masterId: number): CalendarEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM calendar_events
          WHERE user_id = ? AND parent_event_id = ?
          ORDER BY recurrence_id ASC`,
      )
      .all(userId, masterId) as CalendarEventRow[];
  }

  private writeExclusions(eventId: number, exclusions: readonly string[]): void {
    const unique = [...new Set(exclusions)].sort().slice(0, MAX_EXCLUSIONS_PER_SERIES);
    this.db
      .prepare(
        `UPDATE calendar_events
            SET excluded_dates = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(unique.length > 0 ? JSON.stringify(unique) : null, eventId);
  }

  private writeRule(eventId: number, rule: RecurrenceRule): void {
    this.db
      .prepare(
        `UPDATE calendar_events
            SET recurrence = ?, recurrence_interval = ?, recurrence_until = ?,
                recurrence_count = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(rule.frequency, rule.interval, rule.until, rule.count, eventId);
  }

  /**
   * Truncate a master so it stops before `boundary`, returning how many
   * instances it keeps. A COUNT is divided rather than dropped, so the two
   * halves of a split series still add up to the original.
   */
  private truncateSeriesBefore(master: CalendarEventRow, boundary: string): number {
    const event = presentEvent(master);
    const kept = countOccurrencesBefore(event.startsAt, event.recurrence, boundary);
    if (kept === 0) return 0;

    this.writeRule(master.id, {
      ...event.recurrence,
      count: event.recurrence.count !== null ? kept : null,
      until:
        event.recurrence.count !== null
          ? null
          : dateOf(addDays(startOfDay(boundary), -1)),
    });

    this.writeExclusions(
      master.id,
      parseExcludedDates(master.excluded_dates).filter((date) => date < boundary),
    );

    return kept;
  }

  /**
   * Edit one occurrence, this-and-following, or the whole series.
   *
   * Changing a series' timing or its rule drops the per-instance overrides and
   * exclusions attached to it: they are pinned to occurrence starts that no
   * longer exist, and silently re-anchoring them would move events the user
   * never touched.
   */
  updateEventScoped(userId: number, request: ScopedEventUpdate): CalendarEvent {
    const row = this.eventRow(userId, request.eventId);
    this.requireWritableCalendar(userId, row.calendar_id);

    const master = this.masterRow(userId, request.eventId);
    const masterEvent = presentEvent(master);
    const isSeries = masterEvent.recurrence.frequency !== "none";

    // A one-off event has nothing to scope.
    if (!isSeries) return this.updateEvent(userId, row.id, request.patch);

    const recurrenceId = request.recurrenceId ?? row.recurrence_id ?? masterEvent.startsAt;
    if (!parseStamp(recurrenceId)) {
      throw new CalendarError(400, "That occurrence is not identified.");
    }

    if (request.scope === "series") {
      const before = { ...masterEvent };
      const updated = this.updateEvent(userId, master.id, request.patch);

      const retimed =
        updated.startsAt !== before.startsAt ||
        updated.endsAt !== before.endsAt ||
        updated.recurrence.frequency !== before.recurrence.frequency ||
        updated.recurrence.interval !== before.recurrence.interval ||
        updated.recurrence.until !== before.recurrence.until ||
        updated.recurrence.count !== before.recurrence.count;

      if (retimed) {
        this.db
          .prepare(`DELETE FROM calendar_events WHERE user_id = ? AND parent_event_id = ?`)
          .run(userId, master.id);
        this.writeExclusions(master.id, []);
      }

      return this.getEvent(userId, master.id);
    }

    if (request.scope === "instance") {
      // Already an override: it is an ordinary row, so patch it in place.
      if (row.parent_event_id) return this.updateEvent(userId, row.id, request.patch);

      const duration = Math.max(0, minutesBetween(masterEvent.startsAt, masterEvent.endsAt));
      const seed: CalendarEventInput = {
        calendarId: masterEvent.calendarId,
        title: masterEvent.title,
        description: masterEvent.description,
        location: masterEvent.location,
        allDay: masterEvent.allDay,
        startsAt: recurrenceId,
        endsAt: addMinutes(recurrenceId, duration),
        organizerEmail: masterEvent.organizerEmail,
        organizerName: masterEvent.organizerName,
        attendees: this.attendeesFor([master.id]).get(master.id) ?? [],
      };

      const fields = this.normalizeEventFields(
        userId,
        // The override never repeats: it *is* the one occurrence.
        { ...seed, ...request.patch, recurrence: null },
        null,
      );

      const overrideId = this.insertEventRow(userId, {
        ...fields,
        // RFC 5545: an override shares its master's UID and is told apart by
        // RECURRENCE-ID.
        uid: masterEvent.uid,
        parentEventId: master.id,
        recurrenceId,
        excludedDates: [],
      });

      return this.getEvent(userId, overrideId);
    }

    // scope === "following"
    if (recurrenceId <= masterEvent.startsAt) {
      // Splitting at the very first instance would leave an empty first half.
      return this.updateEventScoped(userId, { ...request, scope: "series" });
    }

    const keptBefore = this.truncateSeriesBefore(master, recurrenceId);
    if (keptBefore === 0) {
      return this.updateEventScoped(userId, { ...request, scope: "series" });
    }

    const duration = Math.max(0, minutesBetween(masterEvent.startsAt, masterEvent.endsAt));
    const remainingCount =
      masterEvent.recurrence.count !== null
        ? Math.max(1, masterEvent.recurrence.count - keptBefore)
        : null;

    const seed: CalendarEventInput = {
      calendarId: masterEvent.calendarId,
      title: masterEvent.title,
      description: masterEvent.description,
      location: masterEvent.location,
      allDay: masterEvent.allDay,
      startsAt: recurrenceId,
      endsAt: addMinutes(recurrenceId, duration),
      organizerEmail: masterEvent.organizerEmail,
      organizerName: masterEvent.organizerName,
      attendees: this.attendeesFor([master.id]).get(master.id) ?? [],
      recurrence: {
        ...masterEvent.recurrence,
        count: remainingCount,
        until: remainingCount !== null ? null : masterEvent.recurrence.until,
      },
    };

    const fields = this.normalizeEventFields(userId, { ...seed, ...request.patch }, null);

    // The tail is a new series, so it takes a new UID; overrides and exclusions
    // at or after the split point move with it.
    const tailId = this.insertEventRow(userId, {
      ...fields,
      uid: randomUUID(),
      parentEventId: null,
      recurrenceId: null,
      excludedDates: parseExcludedDates(master.excluded_dates).filter(
        (date) => date >= recurrenceId,
      ),
    });

    const tailUid = this.eventRow(userId, tailId).uid;
    this.db
      .prepare(
        `UPDATE calendar_events
            SET parent_event_id = ?, uid = ?, updated_at = datetime('now')
          WHERE user_id = ? AND parent_event_id = ? AND recurrence_id >= ?`,
      )
      .run(tailId, tailUid, userId, master.id, recurrenceId);

    return this.getEvent(userId, tailId);
  }

  /** Delete one occurrence, this-and-following, or the whole series. */
  deleteEventScoped(userId: number, request: ScopedEventDelete): void {
    const row = this.eventRow(userId, request.eventId);
    this.requireWritableCalendar(userId, row.calendar_id);

    const master = this.masterRow(userId, request.eventId);
    const masterEvent = presentEvent(master);

    if (masterEvent.recurrence.frequency === "none") {
      this.deleteEvent(userId, row.id);
      return;
    }

    const recurrenceId = request.recurrenceId ?? row.recurrence_id ?? masterEvent.startsAt;
    if (!parseStamp(recurrenceId)) {
      throw new CalendarError(400, "That occurrence is not identified.");
    }

    if (request.scope === "series") {
      // Overrides cascade through parent_event_id.
      this.db
        .prepare(`DELETE FROM calendar_events WHERE id = ? AND user_id = ?`)
        .run(master.id, userId);
      return;
    }

    if (request.scope === "instance") {
      this.db
        .prepare(
          `DELETE FROM calendar_events
            WHERE user_id = ? AND parent_event_id = ? AND recurrence_id = ?`,
        )
        .run(userId, master.id, recurrenceId);
      this.writeExclusions(master.id, [
        ...parseExcludedDates(master.excluded_dates),
        recurrenceId,
      ]);
      return;
    }

    // scope === "following"
    const kept = this.truncateSeriesBefore(master, recurrenceId);
    if (kept === 0) {
      this.db
        .prepare(`DELETE FROM calendar_events WHERE id = ? AND user_id = ?`)
        .run(master.id, userId);
      return;
    }

    this.db
      .prepare(
        `DELETE FROM calendar_events
          WHERE user_id = ? AND parent_event_id = ? AND recurrence_id >= ?`,
      )
      .run(userId, master.id, recurrenceId);
  }

  /** Set one attendee's RSVP without touching the rest of the event. */
  setAttendeeStatus(
    userId: number,
    eventId: number,
    email: string,
    status: AttendeeStatus,
  ): CalendarEvent {
    const row = this.eventRow(userId, eventId);
    this.requireWritableCalendar(userId, row.calendar_id);

    const normalized = email.trim().toLowerCase();
    const result = this.db
      .prepare(
        `UPDATE calendar_event_attendees SET status = ? WHERE event_id = ? AND email = ?`,
      )
      .run(status, eventId, normalized);
    if (result.changes === 0) {
      throw new CalendarError(404, `${normalized} is not invited to this event.`);
    }

    return this.getEvent(userId, eventId);
  }

  // -------------------------------------------------------------- occurrences

  listEvents(userId: number): CalendarEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM calendar_events WHERE user_id = ? ORDER BY starts_at ASC`)
      .all(userId) as CalendarEventRow[];
    const attendees = this.attendeesFor(rows.map((row) => row.id));
    return rows.map((row) => presentEvent(row, attendees.get(row.id) ?? []));
  }

  /** Every event in the given calendars — masters and overrides — for export. */
  listEventsForExport(userId: number, calendarIds: readonly number[]): CalendarEvent[] {
    if (calendarIds.length === 0) return this.listEvents(userId);

    const placeholders = calendarIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM calendar_events
          WHERE user_id = ? AND calendar_id IN (${placeholders})
          ORDER BY starts_at ASC, id ASC`,
      )
      .all(userId, ...calendarIds) as CalendarEventRow[];
    const attendees = this.attendeesFor(rows.map((row) => row.id));
    return rows.map((row) => presentEvent(row, attendees.get(row.id) ?? []));
  }

  /**
   * The master records behind a set of occurrences, so opening the editor on an
   * instance never needs a second round trip.
   */
  listEventsByIds(userId: number, ids: readonly number[]): CalendarEvent[] {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    if (unique.length === 0) return [];

    const placeholders = unique.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM calendar_events
          WHERE user_id = ? AND id IN (${placeholders})
          ORDER BY starts_at ASC`,
      )
      .all(userId, ...unique) as CalendarEventRow[];
    const attendees = this.attendeesFor(rows.map((row) => row.id));
    return rows.map((row) => presentEvent(row, attendees.get(row.id) ?? []));
  }

  /**
   * Free-text search over the stored events: title, location, description and
   * the attendee list. Attendees live in their own table, which is why this is
   * a store method rather than a filter over `listEvents`.
   *
   * It searches *events*, not their expanded instances — a weekly standup is
   * one hit, not fifty-two — and so deliberately takes no date range. A caller
   * that wants the dates a hit lands on intersects these ids with
   * `occurrencesInRange`, which is the only thing that knows about recurrence.
   */
  searchEvents(
    userId: number,
    options: { query?: string; calendarIds?: readonly number[]; limit?: number } = {},
  ): CalendarEvent[] {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 1, 1), 500);
    const clauses = ["user_id = ?"];
    const params: (string | number)[] = [userId];

    const query = typeof options.query === "string" ? options.query.trim() : "";
    if (query) {
      // Escaped, so a literal % or _ the user typed stays a literal instead of
      // silently becoming a wildcard that matches the whole calendar.
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(
        `(title LIKE ? ESCAPE '\\'
           OR IFNULL(location, '') LIKE ? ESCAPE '\\'
           OR IFNULL(description, '') LIKE ? ESCAPE '\\'
           OR id IN (SELECT event_id FROM calendar_event_attendees
                      WHERE email LIKE ? ESCAPE '\\'
                         OR IFNULL(name, '') LIKE ? ESCAPE '\\'))`,
      );
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    const calendarIds = (options.calendarIds ?? []).filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (calendarIds.length > 0) {
      clauses.push(`calendar_id IN (${calendarIds.map(() => "?").join(",")})`);
      params.push(...calendarIds);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM calendar_events
          WHERE ${clauses.join(" AND ")}
          ORDER BY starts_at DESC, id DESC
          LIMIT ?`,
      )
      .all(...params, limit) as CalendarEventRow[];
    const attendees = this.attendeesFor(rows.map((row) => row.id));
    return rows.map((row) => presentEvent(row, attendees.get(row.id) ?? []));
  }

  /**
   * Every instance touching [from, to] — both ends inclusive, both wall-clock
   * stamps. Masters are expanded, EXDATEs removed, and per-instance overrides
   * substituted for the occurrences they replace.
   */
  occurrencesInRange(
    userId: number,
    from: string,
    to: string,
    options: { calendarIds?: readonly number[] } = {},
  ): CalendarOccurrence[] {
    const windowFrom = parseStamp(from) ? from : startOfDay(String(from));
    const windowTo = parseStamp(to) ? to : endOfDay(String(to));
    if (!parseStamp(windowFrom) || !parseStamp(windowTo)) {
      throw new CalendarError(400, "The requested range is not a valid date range.");
    }
    if (windowTo < windowFrom) {
      throw new CalendarError(400, "The range ends before it starts.");
    }
    // Bound the work a single request can ask for: a daily rule expanded over a
    // decade would otherwise be a cheap way to stall the process.
    if (daysBetween(dateOf(windowFrom), dateOf(windowTo)) > MAX_RANGE_DAYS) {
      throw new CalendarError(400, `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
    }

    const readOnlyCalendars = new Set(
      this.listCalendars(userId)
        .filter((calendar) => calendar.readOnly)
        .map((calendar) => calendar.id),
    );

    const masters = this.db
      .prepare(
        `SELECT * FROM calendar_events
          WHERE user_id = ?
            AND parent_event_id IS NULL
            AND starts_at <= ?
            AND (
              (recurrence = 'none' AND ends_at >= ?)
              OR (recurrence != 'none'
                  AND (recurrence_until IS NULL OR recurrence_until >= ?))
            )
          ORDER BY starts_at ASC`,
      )
      .all(userId, windowTo, windowFrom, dateOf(windowFrom)) as CalendarEventRow[];

    // Overrides are few, so all of them are loaded: one is needed to suppress
    // its base occurrence even when the edit moved it outside this window.
    const overrides = this.db
      .prepare(
        `SELECT * FROM calendar_events
          WHERE user_id = ? AND parent_event_id IS NOT NULL`,
      )
      .all(userId) as CalendarEventRow[];

    const overridden = new Set(
      overrides.map((row) => `${row.parent_event_id}@${row.recurrence_id}`),
    );

    const allowed =
      options.calendarIds && options.calendarIds.length > 0
        ? new Set(options.calendarIds)
        : null;

    const attendeeCounts = this.attendeeCounts([
      ...masters.map((row) => row.id),
      ...overrides.map((row) => row.id),
    ]);

    const occurrences: CalendarOccurrence[] = [];

    for (const row of masters) {
      if (allowed && !allowed.has(row.calendar_id)) continue;
      const event = presentEvent(row);
      const recurring = event.recurrence.frequency !== "none";
      const excluded = new Set(event.excludedDates);

      for (const instance of expandOccurrences(
        event.startsAt,
        event.endsAt,
        event.recurrence,
        { from: windowFrom, to: windowTo },
      )) {
        if (recurring) {
          if (excluded.has(instance.start)) continue;
          if (overridden.has(`${event.id}@${instance.start}`)) continue;
        }

        occurrences.push({
          key: `${event.id}@${instance.start}`,
          eventId: event.id,
          seriesId: recurring ? event.id : null,
          recurrenceId: recurring ? instance.start : null,
          isOverride: false,
          calendarId: event.calendarId,
          title: event.title,
          description: event.description,
          location: event.location,
          allDay: event.allDay,
          start: instance.start,
          end: instance.end,
          recurring,
          attendeeCount: attendeeCounts.get(event.id) ?? 0,
          readOnly: readOnlyCalendars.has(event.calendarId),
        });
      }
    }

    for (const row of overrides) {
      if (allowed && !allowed.has(row.calendar_id)) continue;
      if (row.starts_at > windowTo || row.ends_at < windowFrom) continue;
      const event = presentEvent(row);

      occurrences.push({
        key: `${event.id}@${event.startsAt}`,
        eventId: event.id,
        seriesId: event.parentEventId,
        recurrenceId: event.recurrenceId,
        isOverride: true,
        calendarId: event.calendarId,
        title: event.title,
        description: event.description,
        location: event.location,
        allDay: event.allDay,
        start: event.startsAt,
        end: event.endsAt,
        recurring: true,
        attendeeCount: attendeeCounts.get(event.id) ?? 0,
        readOnly: readOnlyCalendars.has(event.calendarId),
      });
    }

    occurrences.sort((a, b) => {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      // Longer events first so a multi-day banner sits above the short ones.
      if (a.end !== b.end) return a.end > b.end ? -1 : 1;
      return a.eventId - b.eventId;
    });

    return occurrences;
  }

  private attendeeCounts(eventIds: readonly number[]): Map<number, number> {
    const counts = new Map<number, number>();
    const unique = [...new Set(eventIds)];
    if (unique.length === 0) return counts;

    const placeholders = unique.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT event_id, COUNT(*) AS total
           FROM calendar_event_attendees
          WHERE event_id IN (${placeholders})
          GROUP BY event_id`,
      )
      .all(...unique) as { event_id: number; total: number }[];

    for (const row of rows) counts.set(row.event_id, row.total);
    return counts;
  }

  // ------------------------------------------------------------ bulk ingestion

  /**
   * Insert or update events by UID. Import uses it so a second import of the
   * same file updates rather than duplicates; subscription refresh uses it with
   * `replace` so events deleted upstream disappear here too.
   *
   * Masters are written first, then overrides: RFC 5545 gives an override the
   * *same* UID as its master and tells them apart by RECURRENCE-ID, so matching
   * on UID alone would let an override overwrite the series it belongs to.
   */
  ingestEvents(
    userId: number,
    calendarId: number,
    events: readonly IngestEventInput[],
    options: { replace?: boolean } = {},
  ): { created: number; updated: number; removed: number } {
    this.getCalendar(userId, calendarId);

    const existing = this.db
      .prepare(
        `SELECT id, uid, parent_event_id, recurrence_id
           FROM calendar_events WHERE user_id = ? AND calendar_id = ?`,
      )
      .all(userId, calendarId) as {
      id: number;
      uid: string | null;
      parent_event_id: number | null;
      recurrence_id: string | null;
    }[];

    const masterByUid = new Map(
      existing
        .filter((row) => row.parent_event_id === null && row.uid)
        .map((row) => [row.uid as string, row.id]),
    );
    const overrideByKey = new Map(
      existing
        .filter((row) => row.parent_event_id !== null)
        .map((row) => [`${row.uid}@${row.recurrence_id}`, row.id]),
    );

    let created = 0;
    let updated = 0;
    const seen = new Set<number>();

    const upsert = (
      input: IngestEventInput,
      existingId: number | undefined,
      parentEventId: number | null,
      uid: string,
    ): number => {
      const excludedDates = (input.excludedDates ?? []).filter((date) => !!parseStamp(date));

      if (existingId) {
        // Deliberately not updateEvent(): the calendar may be read-only (a
        // subscription), and refreshing it is how a read-only calendar changes.
        const current = this.getEvent(userId, existingId);
        const fields = this.normalizeEventFields(userId, { ...input, calendarId }, current);
        this.db
          .prepare(
            `UPDATE calendar_events
                SET title = ?, description = ?, location = ?, all_day = ?,
                    starts_at = ?, ends_at = ?, recurrence = ?,
                    recurrence_interval = ?, recurrence_until = ?,
                    recurrence_count = ?, organizer_email = ?, organizer_name = ?,
                    excluded_dates = ?, updated_at = datetime('now')
              WHERE id = ? AND user_id = ?`,
          )
          .run(
            fields.title,
            fields.description,
            fields.location,
            fields.allDay ? 1 : 0,
            fields.startsAt,
            fields.endsAt,
            fields.recurrence.frequency,
            fields.recurrence.interval,
            fields.recurrence.until,
            fields.recurrence.count,
            fields.organizerEmail,
            fields.organizerName,
            excludedDates.length > 0 ? JSON.stringify(excludedDates) : null,
            existingId,
            userId,
          );
        this.writeAttendees(existingId, fields.attendees);
        seen.add(existingId);
        updated += 1;
        return existingId;
      }

      const fields = this.normalizeEventFields(userId, { ...input, calendarId }, null);
      const id = this.insertEventRow(userId, {
        ...fields,
        uid,
        parentEventId,
        recurrenceId: input.recurrenceId ?? null,
        excludedDates,
      });
      seen.add(id);
      created += 1;
      return id;
    };

    const apply = this.db.transaction(() => {
      for (const input of events) {
        if (input.recurrenceId) continue;
        const uid =
          typeof input.uid === "string" && input.uid.trim() ? input.uid.trim() : randomUUID();
        const id = upsert(input, masterByUid.get(uid), null, uid);
        masterByUid.set(uid, id);
      }

      for (const input of events) {
        if (!input.recurrenceId) continue;
        const uid = typeof input.uid === "string" && input.uid.trim() ? input.uid.trim() : "";
        const parentId = uid ? masterByUid.get(uid) : undefined;

        // An override whose series is not in the file has nothing to attach to,
        // so it is kept as an ordinary standalone event rather than dropped.
        if (!parentId) {
          upsert({ ...input, recurrenceId: null }, undefined, null, uid || randomUUID());
          continue;
        }

        upsert(
          { ...input, recurrence: null },
          overrideByKey.get(`${uid}@${input.recurrenceId}`),
          parentId,
          uid,
        );
      }
    });

    apply();

    let removed = 0;
    if (options.replace) {
      const stale = existing.filter((row) => !seen.has(row.id)).map((row) => row.id);
      if (stale.length > 0) {
        const placeholders = stale.map(() => "?").join(",");
        this.db
          .prepare(
            `DELETE FROM calendar_events WHERE user_id = ? AND id IN (${placeholders})`,
          )
          .run(userId, ...stale);
        // Not `changes`: deleting a master cascades its overrides, so the
        // statement under-reports how many events actually went away.
        removed = stale.length;
      }
    }

    return { created, updated, removed };
  }
}
