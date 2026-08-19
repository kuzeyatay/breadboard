import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { storeCaldavSecret } from "@/lib/calendar/caldav-credentials.ts";
import { discoverCalendars } from "@/lib/calendar/caldav-client.ts";
import { syncCaldavCalendar } from "@/lib/calendar/caldav-sync.ts";
import { CalendarError } from "@/lib/calendar/store.ts";

export const dynamic = "force-dynamic";

/**
 * Bind a calendar to a CalDAV collection and run the first sync.
 *
 * The collection is looked up again rather than trusted from the request: the
 * href the client sends came from a discovery response, and re-deriving it with
 * the same credentials is what stops this route from being a way to point the
 * server at an arbitrary URL and have it authenticate there.
 *
 * With no `calendarId`, a new local calendar is created for the collection.
 * With one, an existing calendar is bound — and everything already in it is
 * uploaded on that first sync, which is how you put a calendar you have been
 * keeping locally onto a server without retyping it.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    const url = typeof body.url === "string" ? body.url.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const collectionHref =
      typeof body.collectionHref === "string" ? body.collectionHref.trim() : "";

    if (!url || !username || !password) {
      throw new CalendarError(400, "The server address, username and password are all needed.");
    }
    if (!collectionHref) throw new CalendarError(400, "Choose which calendar to sync.");

    const account = { url, username, password };
    const available = await discoverCalendars(account);
    const collection = available.find((candidate) => candidate.href === collectionHref);
    if (!collection) {
      throw new CalendarError(404, "That calendar is no longer offered by the server.");
    }
    if (collection.readOnly) {
      throw new CalendarError(
        409,
        `The server only lets this account read "${collection.name}". Subscribe to it instead — that is the read-only half, and it works.`,
      );
    }

    const store = getCalendarStore();
    const requestedId = body.calendarId === undefined ? null : Number(body.calendarId);
    if (requestedId !== null && (!Number.isInteger(requestedId) || requestedId <= 0)) {
      throw new CalendarError(400, "That calendar id is not valid.");
    }

    const calendar =
      requestedId === null
        ? store.createCalendar(userId, {
            name: typeof body.name === "string" && body.name.trim() ? body.name : collection.name,
            color: typeof body.color === "string" ? body.color : collection.color ?? undefined,
          })
        : store.getCalendar(userId, requestedId);

    if (calendar.caldavUrl && calendar.caldavUrl !== collection.href) {
      throw new CalendarError(409, `"${calendar.name}" already syncs with another server.`);
    }

    // The secret is stored before the first sync so that a sync which fails
    // halfway leaves a calendar that can be retried, not one that has to be
    // set up again from the beginning.
    storeCaldavSecret(userId, calendar.id, { username, password });
    const bound = store.bindCaldav(userId, calendar.id, {
      url: collection.href,
      username,
      ctag: null,
    });

    // The background poller treats a calendar that has never synced as due, so
    // it can reach this one between the bind above and the sync below. That is
    // the sync happening, not the connection failing, so it is reported as a
    // connection with nothing exchanged *yet* rather than as an error.
    let result;
    try {
      result = await syncCaldavCalendar(store, userId, bound.id, account);
    } catch (error) {
      if (!(error instanceof CalendarError) || error.status !== 409) throw error;
      result = {
        pulled: { created: 0, updated: 0, removed: 0 },
        pushed: { uploaded: 0, deleted: 0 },
        conflicts: 0,
        unchanged: true,
        warnings: ["Its first sync was already running; it will finish on its own."],
      };
    }

    return NextResponse.json(
      { calendar: store.getCalendar(userId, bound.id), ...result },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
