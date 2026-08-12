import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";

export const dynamic = "force-dynamic";

/** The user's calendars, seeding "Personal" on first visit. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({
      calendars: getCalendarStore().listCalendarsEnsuringDefault(userId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    const calendar = getCalendarStore().createCalendar(userId, {
      name: typeof body.name === "string" ? body.name : "",
      color: typeof body.color === "string" ? body.color : undefined,
      visible: body.visible !== false,
    });

    return NextResponse.json({ calendar }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
