import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { refreshSubscription } from "@/lib/calendar/subscription.ts";
import { CalendarError } from "@/lib/calendar/store.ts";

export const dynamic = "force-dynamic";

/** Re-download a subscribed calendar and replace its events with the feed's. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ calendarId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = Number((await params).calendarId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CalendarError(400, "That calendar id is not valid.");
    }

    const store = getCalendarStore();
    const result = await refreshSubscription(store, userId, id);

    return NextResponse.json({ calendar: store.getCalendar(userId, id), ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
