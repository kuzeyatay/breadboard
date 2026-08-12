// Subscribing to a remote calendar.
//
// This is the read-only half of CalDAV interoperability: most CalDAV servers,
// and every webcal/Google/Outlook "secret address", serve the collection as a
// plain ICS document over GET. Fetching and re-ingesting that is enough to see
// someone else's calendar next to your own.
//
// Two-way CalDAV sync — PROPFIND discovery, ctag/etag polling, PUT and DELETE
// back to the server — is deliberately **not** implemented: it needs server
// credentials and a real server to test against, and half of it silently
// losing writes would be worse than not having it.

import { normalizeSubscriptionUrl, parseCalendar } from "./ics.ts";
import { CalendarError, type CalendarStore } from "./store.ts";
import { nowStamp } from "./wallclock.ts";

/** Ceiling on a downloaded calendar. A year of a busy calendar is ~1 MB. */
export const MAX_SUBSCRIPTION_BYTES = 8 * 1024 * 1024;

/** Remote calendars should not be able to hang a request indefinitely. */
export const SUBSCRIPTION_TIMEOUT_MS = 20_000;

export interface SubscriptionResult {
  created: number;
  updated: number;
  removed: number;
  warnings: string[];
}

export async function fetchSubscriptionIcs(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let url: URL;
  try {
    url = normalizeSubscriptionUrl(rawUrl);
  } catch (error) {
    throw new CalendarError(400, error instanceof Error ? error.message : "Bad URL");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBSCRIPTION_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url.toString(), {
      headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new CalendarError(
        502,
        `That calendar answered ${response.status}. Check the address is still valid.`,
      );
    }

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_SUBSCRIPTION_BYTES) {
      throw new CalendarError(413, "That calendar is too large to subscribe to.");
    }

    const text = await response.text();
    if (text.length > MAX_SUBSCRIPTION_BYTES) {
      throw new CalendarError(413, "That calendar is too large to subscribe to.");
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new CalendarError(422, "That address did not return an iCalendar feed.");
    }

    return text;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CalendarError(504, "That calendar took too long to answer.");
    }
    throw new CalendarError(502, "Could not reach that calendar.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-download a subscribed calendar and replace its contents. `replace` is the
 * point: an event deleted upstream has to disappear here too, and there is no
 * delete feed to read — absence from the document is the deletion.
 */
export async function refreshSubscription(
  store: CalendarStore,
  userId: number,
  calendarId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscriptionResult> {
  const calendar = store.getCalendar(userId, calendarId);
  if (!calendar.sourceUrl) {
    throw new CalendarError(400, `"${calendar.name}" is not a subscribed calendar.`);
  }

  try {
    const ics = await fetchSubscriptionIcs(calendar.sourceUrl, fetchImpl);
    const parsed = parseCalendar(ics, calendarId);
    const counts = store.ingestEvents(userId, calendarId, parsed.events, { replace: true });
    store.markCalendarSynced(userId, calendarId, nowStamp(), null);
    return { ...counts, warnings: parsed.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    // The failure is recorded on the calendar so the sidebar can show it
    // without the user having to press refresh again to find out.
    store.markCalendarSynced(userId, calendarId, nowStamp(), message.slice(0, 300));
    throw error;
  }
}
