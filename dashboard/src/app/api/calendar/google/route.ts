import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { refreshGoogleCalendars } from "@/lib/calendar/google-service.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const result = await refreshGoogleCalendars(userId, { force: new URL(request.url).searchParams.get("force") === "true" });
    return NextResponse.json({ ...result, calendars: getCalendarStore().listCalendars(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
