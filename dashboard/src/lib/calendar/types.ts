// Shared calendar types. Imported by the SQLite store, the route handlers and
// the browser views alike, so nothing here may reach for node or next APIs.

export type RecurrenceFrequency =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly";

export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return (
    typeof value === "string" &&
    (RECURRENCE_FREQUENCIES as readonly string[]).includes(value)
  );
}

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Every `interval` days/weeks/months/years. Always >= 1. */
  interval: number;
  /** Inclusive last date ("YYYY-MM-DD"), or null for "forever". */
  until: string | null;
  /** Total number of occurrences, or null for "forever". */
  count: number | null;
}

export const NO_RECURRENCE: RecurrenceRule = {
  frequency: "none",
  interval: 1,
  until: null,
  count: null,
};

export type AttendeeRole = "required" | "optional" | "chair";
export type AttendeeStatus = "needs-action" | "accepted" | "declined" | "tentative";

export const ATTENDEE_ROLES: readonly AttendeeRole[] = ["required", "optional", "chair"];
export const ATTENDEE_STATUSES: readonly AttendeeStatus[] = [
  "needs-action",
  "accepted",
  "declined",
  "tentative",
];

export interface Attendee {
  email: string;
  name: string | null;
  role: AttendeeRole;
  status: AttendeeStatus;
}

export interface CalendarEvent {
  id: number;
  calendarId: number;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** Wall-clock stamp, "YYYY-MM-DDTHH:MM". All-day events start at 00:00. */
  startsAt: string;
  /** Inclusive end. All-day events end at 23:59 on their last day. */
  endsAt: string;
  recurrence: RecurrenceRule;
  /**
   * Set when this row overrides one occurrence of a recurring master ("edit
   * just this one"). The row is otherwise an ordinary non-recurring event.
   */
  parentEventId: number | null;
  /** The original start of the occurrence this row replaces. */
  recurrenceId: string | null;
  /** Occurrence starts deleted from this master. iCalendar's EXDATE. */
  excludedDates: string[];
  /** iCalendar UID — stable across export, import and subscription refresh. */
  uid: string;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: Attendee[];
  createdAt: string;
  updatedAt: string;
}

/** Which occurrences an edit or a delete applies to. */
export type SeriesScope = "instance" | "following" | "series";

export const SERIES_SCOPES: readonly SeriesScope[] = ["instance", "following", "series"];

export function isSeriesScope(value: unknown): value is SeriesScope {
  return typeof value === "string" && (SERIES_SCOPES as readonly string[]).includes(value);
}

/**
 * One materialised instance of an event. A non-recurring event yields exactly
 * one; the views never deal with recurrence rules directly.
 */
export interface CalendarOccurrence {
  /** Stable per instance: `${eventId}@${start}` — safe as a React key. */
  key: string;
  /** The row whose fields this instance shows: the override, or the master. */
  eventId: number;
  /** The recurring master this belongs to, or null for a one-off event. */
  seriesId: number | null;
  /** This instance's original start within the series. Null for one-offs. */
  recurrenceId: string | null;
  /** True when a per-instance edit replaced this occurrence. */
  isOverride: boolean;
  calendarId: number;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  start: string;
  end: string;
  /** True when this instance came from a recurrence rule. */
  recurring: boolean;
  /** How many people are invited — the grid shows a marker, not the list. */
  attendeeCount: number;
  /** Instances of a subscribed calendar cannot be edited or dragged. */
  readOnly: boolean;
}

export interface CalendarEventInput {
  calendarId: number;
  title: string;
  description?: string | null;
  location?: string | null;
  allDay?: boolean;
  startsAt: string;
  endsAt: string;
  recurrence?: Partial<RecurrenceRule> | null;
  attendees?: Partial<Attendee>[] | null;
  organizerEmail?: string | null;
  organizerName?: string | null;
  /** Supplied only by import and subscription refresh; otherwise generated. */
  uid?: string | null;
}

export type CalendarEventPatch = Partial<CalendarEventInput>;

export interface CalendarCollectionInput {
  name: string;
  color?: string;
  visible?: boolean;
  sourceUrl?: string | null;
  readOnly?: boolean;
}

export type CalendarCollectionPatch = Partial<CalendarCollectionInput>;

/** A named, coloured set of events — Nextcloud's "calendar" in the sidebar. */
export interface CalendarCollection {
  id: number;
  name: string;
  color: string;
  visible: boolean;
  sortOrder: number;
  /** Set when this calendar mirrors a remote ICS/CalDAV URL. */
  sourceUrl: string | null;
  readOnly: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  /**
   * Set when this calendar is bound to a CalDAV collection it can also write
   * back to. `sourceUrl` means "a copy of someone else's ICS"; this means "the
   * same calendar, on a server, in both directions".
   */
  caldavUrl: string | null;
  /** The account the binding authenticates as. Shown; never the password. */
  caldavUsername: string | null;
  createdAt: string;
}

/** What the sync layer needs to talk to a bound collection. */
export interface CaldavBinding {
  calendarId: number;
  url: string;
  username: string | null;
  /** Collection tag as of the last successful sync, or null if never synced. */
  ctag: string | null;
}

/**
 * A bound calendar as the background poller sees it: which account it belongs
 * to, when it last spoke to its server, and how that went.
 */
export interface SyncableCalendar {
  userId: number;
  calendarId: number;
  name: string;
  url: string;
  username: string | null;
  lastSyncedAt: string | null;
  /** Consecutive failures. Drives the backoff; zero once a sync succeeds. */
  failures: number;
  /** ISO instant a sync currently in flight holds this calendar until. */
  leaseUntil: string | null;
}

/** One local event that owes the server a copy. */
export interface PendingPush {
  /** The master event. Overrides are pushed as part of it, never on their own. */
  event: CalendarEvent;
  /**
   * Per-instance edits of `event`. RFC 5545 puts a series and its overrides in
   * one resource under one UID, so they are written together or not at all.
   */
  overrides: CalendarEvent[];
  /** Where it already lives on the server, or null when it has never been sent. */
  href: string | null;
  /** The version this push is based on; sent as If-Match. */
  etag: string | null;
}

/** An event deleted locally whose remote copy has not been removed yet. */
export interface RemoteTombstone {
  id: number;
  href: string;
  etag: string | null;
}
