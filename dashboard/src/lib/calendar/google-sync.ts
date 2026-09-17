// Google expands recurrence so moved/cancelled instances and rules unsupported
// by our local recurrence editor are displayed exactly as Google returns them.
import { CalendarError, type CalendarStore, type IngestEventInput } from "./store.ts";
import { addDays, endOfDay, parseDate, startOfDay } from "./wallclock.ts";

type RecordValue = Record<string, unknown>;
export interface GoogleSyncRange { from: string; to: string }
export interface GoogleSyncResult { connected: boolean; synced: number; error: string | null }
export interface GoogleSyncDeps {
  accounts: () => Promise<{ connectionId: string; slug: string }[]>;
  get: (accountId: string, path: string, query: Record<string, string>) => Promise<unknown>;
}

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

export function googleSyncRange(from?: string | null, to?: string | null, now = new Date()): GoogleSyncRange {
  const today = now.toISOString().slice(0, 10);
  const first = from?.slice(0, 10) ?? addDays(startOfDay(today), -90).slice(0, 10);
  const last = to?.slice(0, 10) ?? addDays(startOfDay(today), 366).slice(0, 10);
  if (!parseDate(first) || !parseDate(last) || last < first ||
      Date.parse(last) - Date.parse(first) > 500 * 86_400_000) {
    throw new CalendarError(400, "Choose a valid calendar date range of at most 500 days.");
  }
  return { from: startOfDay(first), to: endOfDay(last) };
}

function wallTime(value: unknown, timeZone: string): string {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CalendarError(502, "Google Calendar returned an invalid event time.");
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function googleEventInput(value: unknown, calendarId: number, timeZone: string): IngestEventInput | null {
  const event = record(value);
  if (event.status === "cancelled") return null;
  if (typeof event.id !== "string" || !event.id) throw new CalendarError(502, "Google Calendar returned an event without an ID.");
  const start = record(event.start);
  const end = record(event.end);
  const allDay = typeof start.date === "string";
  if (allDay && (!parseDate(start.date) || !parseDate(end.date))) {
    throw new CalendarError(502, "Google Calendar returned an invalid all-day event.");
  }
  const startsAt = allDay ? startOfDay(start.date as string) : wallTime(start.dateTime, timeZone);
  const endsAt = allDay
    ? endOfDay(addDays(startOfDay(end.date as string), -1))
    : wallTime(end.dateTime, timeZone);
  return {
    calendarId,
    // iCalUID is shared by every instance of a series; Google's id is not.
    uid: `google:${event.id}`,
    title: (typeof event.summary === "string" && event.summary.trim() ? event.summary.trim() : "Busy").slice(0, 200),
    description: typeof event.description === "string" ? event.description.slice(0, 10_000) : null,
    location: typeof event.location === "string" ? event.location.slice(0, 300) : null,
    startsAt, endsAt, allDay, recurrence: null,
  };
}

async function pages(deps: GoogleSyncDeps, accountId: string, path: string, query: Record<string, string>): Promise<unknown[]> {
  const items: unknown[] = [];
  const tokens = new Set<string>();
  let pageToken = "";
  do {
    const payload = record(await deps.get(accountId, path, { ...query, ...(pageToken ? { pageToken } : {}) }));
    if (payload.error || (payload.items !== undefined && !Array.isArray(payload.items))) {
      throw new CalendarError(502, "Google Calendar returned an invalid response. Try updating again.");
    }
    // Empty collections can omit items; a non-Google envelope must never clear events.
    if (payload.kind !== "calendar#events" && payload.kind !== "calendar#calendarList") {
      throw new CalendarError(502, "Google Calendar returned an unexpected response. Try updating again.");
    }
    items.push(...(payload.items as unknown[] ?? []));
    if (items.length > 10_000) throw new CalendarError(409, "There are too many Google events in this date range. Choose a shorter range.");
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
    if (pageToken && (tokens.has(pageToken) || tokens.size >= 100)) {
      throw new CalendarError(502, "Google Calendar did not finish listing events. Try updating again.");
    }
    tokens.add(pageToken);
  } while (pageToken);
  return items;
}

export async function syncGoogleCalendars(
  store: CalendarStore, userId: number, range: GoogleSyncRange, deps: GoogleSyncDeps,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Promise<GoogleSyncResult> {
  const result: GoogleSyncResult = { connected: false, synced: 0, error: null };
  const stamp = () => new Date().toISOString();
  try {
    const accounts = (await deps.accounts()).filter((account) => account.slug === "google-calendar");
    result.connected = accounts.length > 0;
    for (const calendar of store.listCalendars(userId)) {
      if (calendar.googleAccountId && !accounts.some((account) => account.connectionId === calendar.googleAccountId)) {
        store.markCalendarSynced(userId, calendar.id, calendar.lastSyncedAt ?? stamp(), "Google Calendar is disconnected. Reconnect it in Connections to update these events.");
      }
    }
    for (const account of accounts) {
      const calendars = await pages(deps, account.connectionId, "/calendar/v3/users/me/calendarList", { maxResults: "250" });
      for (const value of calendars) {
        const remote = record(value);
        if (remote.deleted || typeof remote.id !== "string" || remote.accessRole === "freeBusyReader" || remote.accessRole === "none") continue;
        const calendar = store.ensureGoogleCalendar(userId, account.connectionId, remote.id, {
          name: String(remote.summaryOverride || remote.summary || "Google Calendar").slice(0, 80),
          color: typeof remote.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(remote.backgroundColor) ? remote.backgroundColor : undefined,
          visible: remote.hidden !== true && remote.selected !== false,
        });
        try {
          const events = await pages(deps, account.connectionId, `/calendar/v3/calendars/${encodeURIComponent(remote.id)}/events`, {
            // One day of padding covers every UTC offset; only the requested wall-clock
            // range is replaced locally. Never delete events outside a fetched range.
            timeMin: `${addDays(range.from, -1).slice(0, 10)}T00:00:00Z`,
            timeMax: `${addDays(range.to, 2).slice(0, 10)}T00:00:00Z`,
            singleEvents: "true", maxResults: "2500", timeZone,
          });
          const inputs = events.map((event) => googleEventInput(event, calendar.id, timeZone))
            .filter((event): event is IngestEventInput => Boolean(event && event.startsAt <= range.to && event.endsAt >= range.from));
          store.ingestEvents(userId, calendar.id, inputs, { replaceRange: range });
          store.markCalendarSynced(userId, calendar.id, stamp(), null);
          result.synced += 1;
        } catch (error) {
          const message = error instanceof CalendarError ? error.message : "Google Calendar could not update. Try again or reconnect it in Connections.";
          store.markCalendarSynced(userId, calendar.id, calendar.lastSyncedAt ?? stamp(), message);
          result.error = message;
        }
      }
    }
  } catch (error) {
    result.error = error instanceof CalendarError ? error.message : "Google Calendar could not update. Try again or reconnect it in Connections.";
    for (const calendar of store.listCalendars(userId).filter((item) => item.googleCalendarId)) {
      store.markCalendarSynced(userId, calendar.id, calendar.lastSyncedAt ?? stamp(), result.error);
    }
  }
  return result;
}
