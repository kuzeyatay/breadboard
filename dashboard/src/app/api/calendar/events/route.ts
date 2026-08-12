import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { readEventPatch } from "@/lib/calendar/payload.ts";
import { CalendarError } from "@/lib/calendar/store.ts";
import type { CalendarEventInput } from "@/lib/calendar/types.ts";

export const dynamic = "force-dynamic";

/**
 * Every occurrence touching `?from=…&to=…` (inclusive wall-clock stamps or bare
 * dates), plus the master events behind them so the editor can open an instance
 * without a second round trip. `?calendarIds=1,2` narrows to visible calendars.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      throw new CalendarError(400, "A `from` and `to` range is required.");
    }

    const calendarIds = (url.searchParams.get("calendarIds") ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    const store = getCalendarStore();
    const occurrences = store.occurrencesInRange(userId, from, to, { calendarIds });
    const events = store.listEventsByIds(
      userId,
      occurrences.map((occurrence) => occurrence.eventId),
    );

    return NextResponse.json({ occurrences, events });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    // The store rejects a payload missing any required field, so the cast only
    // shapes the type — it does not skip validation.
    const event = getCalendarStore().createEvent(
      userId,
      readEventPatch(body) as CalendarEventInput,
    );

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
