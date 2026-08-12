import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { serializeCalendar } from "@/lib/calendar/ics.ts";
import { CalendarError } from "@/lib/calendar/store.ts";
import { ATTENDEE_STATUSES, type AttendeeStatus } from "@/lib/calendar/types.ts";
import { nowStamp } from "@/lib/calendar/wallclock.ts";

export const dynamic = "force-dynamic";

function eventId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CalendarError(400, "That event id is not valid.");
  }
  return id;
}

/**
 * The invitation for an event as a `METHOD:REQUEST` iCalendar document — the
 * attachment every mail client understands as "add this to your calendar".
 *
 * Breadboard has no mail transport, so it does not send anything: this is the
 * file to attach or the text to paste. RSVPs come back through PATCH below.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const userId = await requireUserId();
    const event = getCalendarStore().getEvent(userId, eventId((await params).eventId));

    const filename = `${event.title.replace(/[^\w.-]+/g, "-").slice(0, 60) || "invite"}.ics`;
    const body = serializeCalendar([event], { method: "REQUEST", now: nowStamp() });

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8; method=REQUEST",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Record one attendee's RSVP. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = eventId((await params).eventId);
    const body = await readJsonBody(request);

    const email = typeof body.email === "string" ? body.email : "";
    if (!email.trim()) throw new CalendarError(400, "Which attendee is replying?");

    const status = body.status as AttendeeStatus;
    if (!ATTENDEE_STATUSES.includes(status)) {
      throw new CalendarError(400, "That is not a reply this calendar understands.");
    }

    return NextResponse.json({
      event: getCalendarStore().setAttendeeStatus(userId, id, email, status),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
