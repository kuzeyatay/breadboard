import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { caldavVaultConfigured } from "@/lib/calendar/caldav-credentials.ts";

export const dynamic = "force-dynamic";

/**
 * The calendars this account syncs both ways, for the profile panel.
 *
 * `vaultConfigured` is reported alongside them so the panel can say why
 * connecting is unavailable before the user has typed a password, rather than
 * after.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const calendars = getCalendarStore()
      .listCalendars(userId)
      .filter((calendar) => calendar.caldavUrl);

    return NextResponse.json({ calendars, vaultConfigured: caldavVaultConfigured() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
