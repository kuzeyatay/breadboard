import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { refreshGoogleCalendars } from "@/lib/calendar/google-service.ts";

export const dynamic = "force-dynamic";

/** The user's calendars, seeding "Personal" on first visit. */
export async function GET() {
  try {
    const userId = await requireUserId();
    // The list is local; a Google refresh goes over the network (5.5 s seen)
    // and the dashboard waited for it on every open. Wait briefly, then answer
    // with what is stored while the refresh finishes and caches its result.
    const refresh = refreshGoogleCalendars(userId);
    refresh.catch(() => { /* Reported by the next request that waits for it. */ });
    const sync = await Promise.race([
      refresh,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
    ]);
    return NextResponse.json({
      calendars: getCalendarStore().listCalendarsEnsuringDefault(userId),
      syncError: sync?.error ?? null,
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
