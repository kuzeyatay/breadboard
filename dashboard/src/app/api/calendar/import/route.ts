import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { parseCalendar } from "@/lib/calendar/ics.ts";
import { MAX_SUBSCRIPTION_BYTES } from "@/lib/calendar/subscription.ts";
import { CalendarError } from "@/lib/calendar/store.ts";

export const dynamic = "force-dynamic";

/**
 * Import an ICS file into a calendar.
 *
 * The body is JSON (`{ calendarId, ics }`) rather than multipart: the browser
 * reads the file with FileReader anyway, and JSON keeps this route on the same
 * validated `readJsonBody` path as the rest of the API. The default 256 KB
 * limit is lifted here — a year of exported meetings is comfortably larger.
 *
 * Events are matched on UID, so importing the same file twice updates instead
 * of duplicating.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, MAX_SUBSCRIPTION_BYTES);

    const calendarId = Number(body.calendarId);
    if (!Number.isInteger(calendarId) || calendarId <= 0) {
      throw new CalendarError(400, "Pick a calendar to import into.");
    }

    const ics = typeof body.ics === "string" ? body.ics : "";
    if (!ics.trim()) throw new CalendarError(400, "That file was empty.");
    if (!/BEGIN:VCALENDAR/i.test(ics)) {
      throw new CalendarError(422, "That does not look like an iCalendar (.ics) file.");
    }

    const store = getCalendarStore();
    // Refuse before parsing: importing into a subscription would be undone by
    // the next refresh.
    const calendar = store.getCalendar(userId, calendarId);
    if (calendar.readOnly) {
      throw new CalendarError(409, `"${calendar.name}" is subscribed and cannot be imported into.`);
    }

    const parsed = parseCalendar(ics, calendarId);
    if (parsed.events.length === 0) {
      throw new CalendarError(422, "No events were found in that file.");
    }

    const counts = store.ingestEvents(userId, calendarId, parsed.events);

    return NextResponse.json({
      ...counts,
      warnings: parsed.warnings,
      calendarName: parsed.calendarName,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
