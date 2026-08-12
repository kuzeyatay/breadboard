import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { CalendarError } from "@/lib/calendar/store.ts";
import type { CalendarCollectionPatch } from "@/lib/calendar/types.ts";

export const dynamic = "force-dynamic";

function calendarId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CalendarError(400, "That calendar id is not valid.");
  }
  return id;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ calendarId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = calendarId((await params).calendarId);
    const body = await readJsonBody(request);

    const patch: CalendarCollectionPatch = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.color === "string") patch.color = body.color;
    if (typeof body.visible === "boolean") patch.visible = body.visible;

    return NextResponse.json({
      calendar: getCalendarStore().updateCalendar(userId, id, patch),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ calendarId: string }> },
) {
  try {
    const userId = await requireUserId();
    getCalendarStore().deleteCalendar(userId, calendarId((await params).calendarId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
