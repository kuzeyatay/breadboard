import { createHash } from "node:crypto";
import { CalendarError, type CalendarStore } from "./store.ts";
import type { CalendarEvent } from "./types.ts";
import { addDays, parseStamp } from "./wallclock.ts";
import { takeOccurrenceStarts } from "./recurrence.ts";

export const GOOGLE_EXPORT_BATCH_SIZE = 25;
export interface GoogleExportOptions {
  calendarId: string;
  sourceCalendarIds?: number[];
  eventIds?: number[];
  timeZone: string;
  afterEventId: number;
  throughEventId?: number;
}
type Json = Record<string, unknown>;
export interface GoogleExportClient {
  request: (method: "GET" | "POST", path: string, body?: Json) => Promise<{ status: number; data: unknown }>;
}
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

export function readGoogleExportOptions(value: unknown): GoogleExportOptions {
  const args = object(value);
  const allowed = new Set(["calendarId", "sourceCalendarIds", "eventIds", "timeZone", "afterEventId", "throughEventId"]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new CalendarError(400, `Unknown calendar export argument: ${key}.`);
  const ids = (key: string): number[] | undefined => {
    if (args[key] === undefined) return undefined;
    const values = args[key];
    if (!Array.isArray(values) || !values.length || values.length > 10_000 ||
        values.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
      throw new CalendarError(400, `${key} must be a non-empty list of positive event or calendar IDs.`);
    }
    return [...new Set(values as number[])];
  };
  const integer = (key: string): number | undefined => {
    if (args[key] === undefined) return undefined;
    if (typeof args[key] !== "number" || !Number.isSafeInteger(args[key]) || args[key] < 0) {
      throw new CalendarError(400, `${key} must be a non-negative integer.`);
    }
    return args[key] as number;
  };
  const calendarId = args.calendarId ?? "primary";
  const timeZone = args.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof calendarId !== "string" || !calendarId.trim() || calendarId.length > 1000) throw new CalendarError(400, "Choose a Google destination calendar.");
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 100) throw new CalendarError(400, "Choose an IANA time zone.");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { throw new CalendarError(400, "Choose a valid IANA time zone, such as Europe/Amsterdam."); }
  return { calendarId: calendarId.trim(), timeZone, sourceCalendarIds: ids("sourceCalendarIds"), eventIds: ids("eventIds"),
    afterEventId: integer("afterEventId") ?? 0, throughEventId: integer("throughEventId") };
}

function selection(store: CalendarStore, userId: number, options: GoogleExportOptions) {
  const calendars = store.listCalendars(userId);
  for (const id of options.sourceCalendarIds ?? []) store.getCalendar(userId, id);
  const requested = options.eventIds ? store.listEventsByIds(userId, options.eventIds) : null;
  if (requested && requested.length !== options.eventIds!.length) throw new CalendarError(404, "One of the selected events does not exist in your calendar.");
  // A Google mirror is already in Google; copying it back causes a feedback loop.
  const sources = calendars.filter((calendar) => !calendar.googleCalendarId &&
    (!options.sourceCalendarIds || options.sourceCalendarIds.includes(calendar.id)));
  const sourceIds = new Set(sources.map((calendar) => calendar.id));
  const all = sources.length ? store.listEventsForExport(userId, sources.map((calendar) => calendar.id)) : [];
  const requestedIds = requested ? new Set(requested.map((event) => event.id)) : null;
  const events = all.filter((event) => sourceIds.has(event.calendarId) && (!requestedIds || requestedIds.has(event.id) ||
    (event.parentEventId !== null && requestedIds.has(event.parentEventId))))
    .sort((a, b) => a.id - b.id);
  const throughEventId = options.throughEventId ?? events.reduce((max, event) => Math.max(max, event.id), 0);
  return { sources, all, throughEventId, events: events.filter((event) => event.id <= throughEventId),
    skippedGoogleCalendars: calendars.filter((calendar) => calendar.googleCalendarId &&
      (!options.sourceCalendarIds || options.sourceCalendarIds.includes(calendar.id))).length };
}

/** Convert the inclusive local recurrence cutoff to Google's required UTC UNTIL. */
function utcUntil(stamp: string, timeZone: string): string {
  const parsed = parseStamp(stamp);
  if (!parsed) throw new CalendarError(400, "The event has an invalid recurrence end.");
  const target = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    if (represented === target) return new Date(instant).toISOString().replace(/[-:]/g, "").replace(".000", "");
    instant += target - represented;
  }
  throw new CalendarError(400, "The recurrence end does not exist in this time zone.");
}

export function googleExportEventId(userId: number, event: CalendarEvent): string {
  const identity = [userId, event.calendarId, event.uid || event.id, event.recurrenceId ?? "master"];
  // Google's event IDs accept base32hex; a hex digest is a valid subset.
  return `bb${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

export function googleExportBody(userId: number, event: CalendarEvent, all: readonly CalendarEvent[], timeZone: string): Json {
  const temporal = (stamp: string, end = false) => event.allDay
    ? { date: (end ? addDays(stamp, 1) : stamp).slice(0, 10) }
    : { dateTime: `${stamp}:00`, timeZone };
  const body: Json = {
    id: googleExportEventId(userId, event), summary: event.title,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    start: temporal(event.startsAt), end: temporal(event.endsAt, true),
    extendedProperties: { private: { breadboardSource: googleExportEventId(userId, event) } },
  };
  // Copying a schedule does not send fresh invitations to its attendees.
  if (!event.parentEventId && event.recurrence.frequency !== "none") {
    const rule = [`FREQ=${event.recurrence.frequency.toUpperCase()}`, `INTERVAL=${event.recurrence.interval}`];
    if (event.recurrence.count) rule.push(`COUNT=${event.recurrence.until
      ? takeOccurrenceStarts(event.startsAt, event.recurrence, event.recurrence.count).length
      : event.recurrence.count}`);
    else if (event.recurrence.until) rule.push(`UNTIL=${event.allDay
      ? event.recurrence.until.replace(/-/g, "") : utcUntil(`${event.recurrence.until}T23:59`, timeZone)}`);
    const recurrence = [`RRULE:${rule.join(";")}`];
    // Overrides are exported as standalone replacements; exclude their original
    // slots from the master so a moved occurrence never appears twice.
    const exclusions = [...new Set([...event.excludedDates,
      ...all.filter((item) => item.parentEventId === event.id && item.recurrenceId).map((item) => item.recurrenceId!)])];
    if (exclusions.length) recurrence.push(event.allDay
      ? `EXDATE;VALUE=DATE:${exclusions.map((stamp) => stamp.slice(0, 10).replace(/-/g, "")).join(",")}`
      : `EXDATE;TZID=${timeZone}:${exclusions.map((stamp) => `${stamp.replace(/[-:]/g, "")}00`).join(",")}`);
    body.recurrence = recurrence;
  }
  return body;
}

async function destination(client: GoogleExportClient, calendarId: string) {
  const response = await client.request("GET", `/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`);
  const data = object(response.data);
  if (response.status !== 200 || typeof data.id !== "string" || !["owner", "writer"].includes(String(data.accessRole))) {
    throw new CalendarError(409, "Choose a writable Google calendar. List your Google calendars to find its ID.");
  }
  return { id: data.id, name: String(data.summaryOverride || data.summary || "Google Calendar") };
}

export async function previewGoogleCalendarExport(store: CalendarStore, userId: number, options: GoogleExportOptions, client: GoogleExportClient) {
  const selected = selection(store, userId, options);
  const target = await destination(client, options.calendarId);
  // Validate every event before a bulk write starts, including recurrence dates.
  for (const event of selected.events) googleExportBody(userId, event, selected.all, options.timeZone);
  return { destination: target, timeZone: options.timeZone, totalEvents: selected.events.length,
    calendars: selected.sources.map((calendar) => ({ id: calendar.id, name: calendar.name,
      events: selected.events.filter((event) => event.calendarId === calendar.id).length })),
    skippedGoogleCalendars: selected.skippedGoogleCalendars,
    includesPastEvents: true, preservesRecurrence: true, sendsInvitations: false,
    exportArgs: { ...options, calendarId: target.id, afterEventId: 0, throughEventId: selected.throughEventId } };
}

/** One bounded batch; the model continues with nextArgs until complete is true. */
export async function exportGoogleCalendarEvents(store: CalendarStore, userId: number, options: GoogleExportOptions, client: GoogleExportClient) {
  const selected = selection(store, userId, options);
  const target = await destination(client, options.calendarId);
  const pending = selected.events.filter((event) => event.id > options.afterEventId);
  let afterEventId = options.afterEventId, created = 0, alreadyPresent = 0;
  const failures: { eventId: number; message: string }[] = [];
  const started = Date.now();
  for (const event of pending.slice(0, GOOGLE_EXPORT_BATCH_SIZE)) {
    if (Date.now() - started > 20_000) break;
    try {
      const body = googleExportBody(userId, event, selected.all, options.timeZone);
      const path = `/calendar/v3/calendars/${encodeURIComponent(target.id)}/events`;
      const response = await client.request("POST", path, body);
      let confirmed = object(response.data);
      if (response.status === 409) {
        const existing = await client.request("GET", `${path}/${body.id}`);
        confirmed = object(existing.data);
        const source = object(object(confirmed.extendedProperties).private).breadboardSource;
        if (existing.status !== 200 || confirmed.status === "cancelled" || source !== body.id || confirmed.id !== body.id) {
          throw new CalendarError(409, "A previous Google copy could not be verified. Check the destination event before retrying.");
        }
        alreadyPresent++;
      } else {
        if (response.status === 401 || response.status === 403) {
          throw new CalendarError(403, "Google Calendar denied this write. Reconnect it with permission to manage events, then resume this batch.");
        }
        if (response.status < 200 || response.status >= 300 || confirmed.id !== body.id) {
          throw new CalendarError(502, "Google did not confirm this event was created. Retry this batch safely; existing copies will be skipped.");
        }
        created++;
      }
      afterEventId = event.id;
    } catch (error) {
      failures.push({ eventId: event.id, message: error instanceof CalendarError ? error.message : "Google Calendar could not complete this event. Retry the batch to resume safely." });
      break; // Never advance the cursor past an unconfirmed write.
    }
  }
  const remaining = pending.filter((event) => event.id > afterEventId).length;
  return { destination: target, created, alreadyPresent, remaining, failures,
    totalEvents: selected.events.length, skippedGoogleCalendars: selected.skippedGoogleCalendars,
    complete: remaining === 0 && failures.length === 0,
    nextArgs: remaining ? { ...options, calendarId: target.id, afterEventId, throughEventId: selected.throughEventId } : null };
}
