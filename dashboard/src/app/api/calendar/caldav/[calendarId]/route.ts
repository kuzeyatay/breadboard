import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import {
  forgetCaldavSecret,
  readCaldavSecret,
} from "@/lib/calendar/caldav-credentials.ts";
import { syncCaldavCalendar } from "@/lib/calendar/caldav-sync.ts";
import { CalendarError } from "@/lib/calendar/store.ts";

export const dynamic = "force-dynamic";

function calendarId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CalendarError(400, "That calendar id is not valid.");
  }
  return id;
}

/** Reconcile this calendar with its server: send local changes, take theirs. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ calendarId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = calendarId((await params).calendarId);

    const store = getCalendarStore();
    const binding = store.getCaldavBinding(userId, id);
    if (!binding) {
      throw new CalendarError(400, "That calendar is not synced with a server.");
    }

    const secret = readCaldavSecret(userId, id);
    if (!secret) {
      throw new CalendarError(401, "That calendar's password is missing. Connect it again.");
    }

    const result = await syncCaldavCalendar(store, userId, id, {
      url: binding.url,
      username: secret.username || binding.username || "",
      password: secret.password,
    });

    return NextResponse.json({ calendar: store.getCalendar(userId, id), ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Stop syncing, keeping the events here.
 *
 * The password is dropped and every local event forgets where it came from, so
 * nothing after this can reach the server — in particular, deleting one of
 * these events afterwards is a local delete and stays local.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ calendarId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = calendarId((await params).calendarId);

    const store = getCalendarStore();
    const calendar = store.unbindCaldav(userId, id);
    forgetCaldavSecret(userId, id);

    return NextResponse.json({ calendar });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
