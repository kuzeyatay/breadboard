import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { readEventPatch } from "@/lib/calendar/payload.ts";
import { CalendarError } from "@/lib/calendar/store.ts";
import { isSeriesScope, type SeriesScope } from "@/lib/calendar/types.ts";

export const dynamic = "force-dynamic";

function eventId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CalendarError(400, "That event id is not valid.");
  }
  return id;
}

/**
 * Which occurrences the change applies to. Defaults to the whole series, which
 * is what a non-recurring event means and what a client that knows nothing
 * about scopes should get.
 */
function seriesScope(value: unknown): SeriesScope {
  return isSeriesScope(value) ? value : "series";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const userId = await requireUserId();
    const event = getCalendarStore().getEvent(userId, eventId((await params).eventId));
    return NextResponse.json({ event });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = eventId((await params).eventId);
    const body = await readJsonBody(request);

    const event = getCalendarStore().updateEventScoped(userId, {
      eventId: id,
      scope: seriesScope(body.scope),
      recurrenceId: typeof body.recurrenceId === "string" ? body.recurrenceId : null,
      patch: readEventPatch(body),
    });

    return NextResponse.json({ event });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = eventId((await params).eventId);
    const url = new URL(request.url);

    getCalendarStore().deleteEventScoped(userId, {
      eventId: id,
      scope: seriesScope(url.searchParams.get("scope")),
      recurrenceId: url.searchParams.get("recurrenceId"),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
