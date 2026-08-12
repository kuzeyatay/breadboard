// iCalendar (RFC 5545) serialisation and parsing.
//
// Hand-rolled rather than pulled from npm: the dashboard has no ical dependency,
// and the subset Breadboard stores — VEVENT with a single RRULE, EXDATE,
// RECURRENCE-ID, ORGANIZER and ATTENDEE — is small enough to own outright and
// test exhaustively.
//
// **Times are floating.** Breadboard stores timezone-free wall clocks, and
// RFC 5545 has an exact match for that: a DATE-TIME with no `Z` and no TZID is
// "floating" local time. Exporting that way means 09:00 here is 09:00 in the
// importing client, which is what a personal calendar means by 09:00.
//
// On import:
// - a floating time is taken as-is;
// - a UTC time (`Z`) is converted into the running machine's local wall clock,
//   because an absolute instant has to be pinned to *some* wall to be shown;
// - a TZID time is taken as-is and reported as a warning — resolving arbitrary
//   zone names needs a tz database this app does not carry.

import type {
  Attendee,
  AttendeeRole,
  AttendeeStatus,
  CalendarEvent,
  CalendarEventInput,
  RecurrenceFrequency,
  RecurrenceRule,
} from "./types.ts";
import {
  addDays,
  dateOf,
  endOfDay,
  formatStamp,
  parseStamp,
  startOfDay,
  timeOf,
} from "./wallclock.ts";

const CRLF = "\r\n";
const PRODID = "-//Breadboard//Calendar//EN";

/** Cap on a single import, so a hostile or runaway file cannot fill the store. */
export const MAX_IMPORT_EVENTS = 5_000;

export type IcsMethod = "PUBLISH" | "REQUEST" | "CANCEL";

// ------------------------------------------------------------------ serialise

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold to 75 octets per RFC 5545 §3.1. Counting is by UTF-8 byte, not by
 * character, and a continuation must not split a multi-byte sequence.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off until `end` sits on a character boundary (0b10xxxxxx is a
    // continuation byte).
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // Continuation lines carry a leading space.
  }

  return parts.join(`${CRLF} `);
}

function stampToIcs(stamp: string, allDay: boolean): string {
  const date = dateOf(stamp).replace(/-/g, "");
  if (allDay) return date;
  return `${date}T${timeOf(stamp).replace(":", "")}00`;
}

function ruleToRrule(rule: RecurrenceRule): string | null {
  if (rule.frequency === "none") return null;

  const parts = [`FREQ=${rule.frequency.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  else if (rule.until !== null) parts.push(`UNTIL=${stampToIcs(endOfDay(rule.until), false)}`);

  return parts.join(";");
}

function attendeeLine(attendee: Attendee): string {
  const params = [
    `ROLE=${attendee.role === "chair" ? "CHAIR" : attendee.role === "optional" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT"}`,
    `PARTSTAT=${attendee.status.toUpperCase()}`,
    "RSVP=TRUE",
  ];
  if (attendee.name) params.push(`CN=${escapeText(attendee.name)}`);
  return `ATTENDEE;${params.join(";")}:mailto:${attendee.email}`;
}

export interface SerializeOptions {
  /** X-WR-CALNAME, which most clients show as the calendar's name. */
  name?: string;
  method?: IcsMethod;
  /** DTSTAMP for every event. Injected so exports are reproducible in tests. */
  now?: string;
}

export function serializeEvent(event: CalendarEvent, options: SerializeOptions = {}): string[] {
  const lines: string[] = ["BEGIN:VEVENT"];
  const dtstamp = stampToIcs(options.now ?? "1970-01-01T00:00", false);

  lines.push(`UID:${event.uid}`);
  lines.push(`DTSTAMP:${dtstamp}Z`);

  if (event.allDay) {
    // RFC 5545 all-day DTEND is exclusive: a one-day event ends the next day.
    lines.push(`DTSTART;VALUE=DATE:${stampToIcs(event.startsAt, true)}`);
    lines.push(
      `DTEND;VALUE=DATE:${stampToIcs(addDays(startOfDay(event.endsAt), 1), true)}`,
    );
  } else {
    lines.push(`DTSTART:${stampToIcs(event.startsAt, false)}`);
    lines.push(`DTEND:${stampToIcs(event.endsAt, false)}`);
  }

  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);

  const rrule = ruleToRrule(event.recurrence);
  if (rrule) lines.push(`RRULE:${rrule}`);

  if (event.excludedDates.length > 0) {
    lines.push(
      `EXDATE:${event.excludedDates
        .map((date) => stampToIcs(date, event.allDay))
        .join(",")}`,
    );
  }

  if (event.recurrenceId) {
    lines.push(`RECURRENCE-ID:${stampToIcs(event.recurrenceId, event.allDay)}`);
  }

  if (event.organizerEmail) {
    const cn = event.organizerName ? `;CN=${escapeText(event.organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }

  for (const attendee of event.attendees) lines.push(attendeeLine(attendee));

  lines.push("END:VEVENT");
  return lines;
}

export function serializeCalendar(
  events: readonly CalendarEvent[],
  options: SerializeOptions = {},
): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN"];
  if (options.method) lines.push(`METHOD:${options.method}`);
  if (options.name) lines.push(`X-WR-CALNAME:${escapeText(options.name)}`);

  for (const event of events) lines.push(...serializeEvent(event, options));
  lines.push("END:VCALENDAR");

  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

// ---------------------------------------------------------------------- parse

function unescapeText(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") {
      out += value[index];
      continue;
    }
    const next = value[index + 1];
    if (next === "n" || next === "N") out += "\n";
    else if (next === undefined) out += "\\";
    else out += next;
    index += 1;
  }
  return out;
}

/** Undo RFC 5545 line folding: a line starting with space or tab continues. */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];

  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }

  return lines;
}

interface ContentLine {
  name: string;
  params: Map<string, string>;
  value: string;
}

function parseContentLine(line: string): ContentLine | null {
  // The value starts at the first colon that is not inside a quoted parameter.
  let colon = -1;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");

  const params = new Map<string, string>();
  for (const part of paramParts) {
    const equals = part.indexOf("=");
    if (equals === -1) continue;
    params.set(
      part.slice(0, equals).toUpperCase(),
      part.slice(equals + 1).replace(/^"|"$/g, ""),
    );
  }

  return { name: name.toUpperCase(), params, value };
}

interface ParsedTime {
  stamp: string;
  isDate: boolean;
  /** Set when the value needed an assumption the reader should know about. */
  warning?: string;
}

/**
 * Parse DATE, floating DATE-TIME, or UTC DATE-TIME into a wall-clock stamp.
 * A `Z` value is converted through the running machine's local zone — the one
 * place in the calendar where local time is the right answer, because an
 * absolute instant has to land on some wall to be drawn.
 */
export function parseIcsTime(value: string, params: Map<string, string>): ParsedTime | null {
  const raw = value.trim();

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const stamp = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00`;
    return parseStamp(stamp) ? { stamp, isDate: true } : null;
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
  if (!dateTime) return null;

  const [, year, month, day, hour, minute, , zulu] = dateTime;

  if (zulu) {
    const instant = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)),
    );
    return {
      stamp: formatStamp({
        year: instant.getFullYear(),
        month: instant.getMonth() + 1,
        day: instant.getDate(),
        hour: instant.getHours(),
        minute: instant.getMinutes(),
      }),
      isDate: false,
    };
  }

  const stamp = `${year}-${month}-${day}T${hour}:${minute}`;
  if (!parseStamp(stamp)) return null;

  const tzid = params.get("TZID");
  return {
    stamp,
    isDate: false,
    warning: tzid
      ? `Times in "${tzid}" were read as local time — this calendar has no timezone database.`
      : undefined,
  };
}

function parseRrule(value: string): RecurrenceRule | null {
  const parts = new Map<string, string>();
  for (const chunk of value.split(";")) {
    const equals = chunk.indexOf("=");
    if (equals === -1) continue;
    parts.set(chunk.slice(0, equals).toUpperCase(), chunk.slice(equals + 1));
  }

  const freq = (parts.get("FREQ") ?? "").toLowerCase();
  if (!["daily", "weekly", "monthly", "yearly"].includes(freq)) return null;

  const interval = Number(parts.get("INTERVAL") ?? 1);
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : null;

  let until: string | null = null;
  const rawUntil = parts.get("UNTIL");
  if (rawUntil) {
    const parsed = parseIcsTime(rawUntil, new Map());
    if (parsed) until = dateOf(parsed.stamp);
  }

  return {
    frequency: freq as RecurrenceFrequency,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    until: count !== null ? null : until,
    count: count !== null && Number.isInteger(count) && count > 0 ? count : null,
  };
}

function parseAttendee(line: ContentLine): Attendee | null {
  const email = line.value.replace(/^mailto:/i, "").trim().toLowerCase();
  if (!email) return null;

  const role = (line.params.get("ROLE") ?? "").toUpperCase();
  const partstat = (line.params.get("PARTSTAT") ?? "").toUpperCase();

  const mappedRole: AttendeeRole =
    role === "CHAIR" ? "chair" : role === "OPT-PARTICIPANT" ? "optional" : "required";
  const mappedStatus: AttendeeStatus =
    partstat === "ACCEPTED"
      ? "accepted"
      : partstat === "DECLINED"
        ? "declined"
        : partstat === "TENTATIVE"
          ? "tentative"
          : "needs-action";

  return {
    email,
    name: line.params.get("CN") ? unescapeText(line.params.get("CN") as string) : null,
    role: mappedRole,
    status: mappedStatus,
  };
}

export interface ParsedIcsEvent extends CalendarEventInput {
  /** Occurrence starts carried on EXDATE. */
  excludedDates: string[];
  /** Set when the VEVENT was an override (RECURRENCE-ID). */
  recurrenceId: string | null;
}

export interface ParseResult {
  calendarName: string | null;
  events: ParsedIcsEvent[];
  warnings: string[];
}

/**
 * Parse a VCALENDAR into event inputs. Unparseable VEVENTs are skipped with a
 * warning rather than failing the whole file — a single bad row in a year of
 * exported meetings should not cost the import.
 */
export function parseCalendar(text: string, calendarId = 0): ParseResult {
  const lines = unfoldLines(text);
  const events: ParsedIcsEvent[] = [];
  const warnings = new Set<string>();
  let calendarName: string | null = null;

  let current: ContentLine[] | null = null;
  let depth = 0;

  for (const raw of lines) {
    const line = parseContentLine(raw);
    if (!line) continue;

    if (line.name === "BEGIN" && line.value.toUpperCase() === "VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (line.name === "END" && line.value.toUpperCase() === "VEVENT") {
      if (current) {
        const parsed = buildEvent(current, calendarId, warnings);
        if (parsed) events.push(parsed);
        else warnings.add("An event without a usable start date was skipped.");
      }
      current = null;
      if (events.length >= MAX_IMPORT_EVENTS) {
        warnings.add(`Only the first ${MAX_IMPORT_EVENTS} events were imported.`);
        break;
      }
      continue;
    }

    if (current) {
      // Skip nested components (VALARM), whose properties are not ours.
      if (line.name === "BEGIN") depth += 1;
      else if (line.name === "END") depth = Math.max(0, depth - 1);
      else if (depth === 0) current.push(line);
      continue;
    }

    if (line.name === "X-WR-CALNAME") calendarName = unescapeText(line.value);
  }

  return { calendarName, events, warnings: [...warnings] };
}

function buildEvent(
  lines: readonly ContentLine[],
  calendarId: number,
  warnings: Set<string>,
): ParsedIcsEvent | null {
  const find = (name: string) => lines.find((line) => line.name === name);

  const dtstartLine = find("DTSTART");
  if (!dtstartLine) return null;
  const dtstart = parseIcsTime(dtstartLine.value, dtstartLine.params);
  if (!dtstart) return null;
  if (dtstart.warning) warnings.add(dtstart.warning);

  const allDay =
    dtstart.isDate || (dtstartLine.params.get("VALUE") ?? "").toUpperCase() === "DATE";

  const dtendLine = find("DTEND");
  const dtend = dtendLine ? parseIcsTime(dtendLine.value, dtendLine.params) : null;
  if (dtend?.warning) warnings.add(dtend.warning);

  let endsAt: string;
  if (allDay) {
    // DTEND is exclusive for DATE values: step back a day to the inclusive end.
    const exclusive = dtend?.stamp ?? addDays(startOfDay(dtstart.stamp), 1);
    const inclusive = addDays(startOfDay(exclusive), -1);
    endsAt = endOfDay(inclusive < dtstart.stamp ? dtstart.stamp : inclusive);
  } else {
    endsAt = dtend?.stamp ?? dtstart.stamp;
  }

  const rruleLine = find("RRULE");
  const recurrence = rruleLine ? parseRrule(rruleLine.value) : null;
  if (rruleLine && !recurrence) {
    warnings.add("A repeat rule used features this calendar does not support and was dropped.");
  }

  const excludedDates: string[] = [];
  for (const line of lines.filter((candidate) => candidate.name === "EXDATE")) {
    for (const chunk of line.value.split(",")) {
      const parsed = parseIcsTime(chunk, line.params);
      if (parsed) excludedDates.push(allDay ? startOfDay(parsed.stamp) : parsed.stamp);
    }
  }

  const recurrenceIdLine = find("RECURRENCE-ID");
  const recurrenceId = recurrenceIdLine
    ? (parseIcsTime(recurrenceIdLine.value, recurrenceIdLine.params)?.stamp ?? null)
    : null;

  const organizerLine = find("ORGANIZER");
  const attendees = lines
    .filter((line) => line.name === "ATTENDEE")
    .map(parseAttendee)
    .filter((attendee): attendee is Attendee => attendee !== null);

  return {
    calendarId,
    uid: find("UID")?.value?.trim() || null,
    title: unescapeText(find("SUMMARY")?.value ?? "").trim() || "(no title)",
    description: unescapeText(find("DESCRIPTION")?.value ?? "").trim() || null,
    location: unescapeText(find("LOCATION")?.value ?? "").trim() || null,
    allDay,
    startsAt: allDay ? startOfDay(dtstart.stamp) : dtstart.stamp,
    endsAt,
    recurrence,
    attendees,
    organizerEmail:
      organizerLine?.value.replace(/^mailto:/i, "").trim().toLowerCase() || null,
    organizerName: organizerLine?.params.get("CN")
      ? unescapeText(organizerLine.params.get("CN") as string)
      : null,
    excludedDates,
    recurrenceId,
  };
}

/** `webcal://` is a bookmarking scheme for an https ICS URL. */
export function normalizeSubscriptionUrl(input: string): URL {
  const trimmed = input.trim();
  const swapped = trimmed.replace(/^webcal:\/\//i, "https://");

  let url: URL;
  try {
    url = new URL(swapped);
  } catch {
    throw new Error("That does not look like a URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) and webcal calendar URLs are supported.");
  }

  return url;
}
