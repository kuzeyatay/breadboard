import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { serializeCalendar } from "@/lib/calendar/ics.ts";
import { nowStamp, todayDate } from "@/lib/calendar/wallclock.ts";

export const dynamic = "force-dynamic";

/**
 * Download calendars as one iCalendar file. `?calendarIds=1,2` narrows the
 * selection; omitting it exports everything the user has.
 *
 * Times are exported floating (no TZID, no Z) because that is exactly how they
 * are stored — see src/lib/calendar/ics.ts.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);

    const calendarIds = (url.searchParams.get("calendarIds") ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    const store = getCalendarStore();
    const calendars = store.listCalendars(userId);
    const selected = calendarIds.length
      ? calendars.filter((calendar) => calendarIds.includes(calendar.id))
      : calendars;

    const events = store.listEventsForExport(userId, calendarIds);
    const name =
      selected.length === 1 ? selected[0].name : `Breadboard (${selected.length} calendars)`;

    const body = serializeCalendar(events, { name, now: nowStamp() });
    const filename = `breadboard-calendar-${todayDate()}.ics`;

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
