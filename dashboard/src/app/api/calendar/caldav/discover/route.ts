import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { discoverCalendars } from "@/lib/calendar/caldav-client.ts";
import { caldavVaultConfigured } from "@/lib/calendar/caldav-credentials.ts";
import { CalendarError } from "@/lib/calendar/store.ts";

export const dynamic = "force-dynamic";

/**
 * Ask a CalDAV server what calendars an account can see.
 *
 * Nothing is stored: this is the step that turns one address and a password
 * into a list to choose from, and the password is only kept once the user has
 * picked a calendar (`../connect`). Failing here therefore costs the user a
 * retry and nothing else.
 */
export async function POST(request: Request) {
  try {
    // Nothing here is per-user, but discovery makes an authenticated outbound
    // request on the server's behalf, so it stays behind a session.
    await requireUserId();

    const body = await readJsonBody(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!url) throw new CalendarError(400, "Paste your calendar server's address.");
    if (!username || !password) {
      throw new CalendarError(400, "A CalDAV server needs a username and a password.");
    }
    if (!caldavVaultConfigured()) {
      throw new CalendarError(
        503,
        "Set NEXTAUTH_SECRET (or BREADBOARD_CALENDAR_VAULT_KEY) before connecting a calendar — there is nowhere safe to keep the password until you do.",
      );
    }

    const calendars = await discoverCalendars({ url, username, password });
    if (!calendars.length) {
      throw new CalendarError(
        404,
        "That server answered, but reported no calendars for this account.",
      );
    }

    return NextResponse.json({ calendars });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
