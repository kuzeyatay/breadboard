import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { parseCalendar } from "@/lib/calendar/ics.ts";
import { fetchSubscriptionIcs } from "@/lib/calendar/subscription.ts";
import { CalendarError } from "@/lib/calendar/store.ts";
import { nowStamp } from "@/lib/calendar/wallclock.ts";

export const dynamic = "force-dynamic";

/**
 * Subscribe to a remote ICS/webcal/CalDAV calendar.
 *
 * The feed is fetched before the calendar is created, so a typo'd address fails
 * with the reason rather than leaving an empty, permanently broken calendar in
 * the sidebar.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new CalendarError(400, "Paste the calendar's address.");

    const ics = await fetchSubscriptionIcs(url);
    const parsed = parseCalendar(ics);

    const name =
      (typeof body.name === "string" && body.name.trim()) ||
      parsed.calendarName ||
      "Subscribed calendar";

    const store = getCalendarStore();
    const calendar = store.createCalendar(userId, {
      name,
      color: typeof body.color === "string" ? body.color : undefined,
      sourceUrl: url,
      readOnly: true,
    });

    const counts = store.ingestEvents(
      userId,
      calendar.id,
      parsed.events.map((event) => ({ ...event, calendarId: calendar.id })),
      { replace: true },
    );
    const synced = store.markCalendarSynced(userId, calendar.id, nowStamp(), null);

    return NextResponse.json(
      { calendar: synced, ...counts, warnings: parsed.warnings },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
