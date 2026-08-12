// The join between the Socials Manager and Breadboard's own calendar.
//
// A scheduled post does not get a private Postiz-shaped calendar. It gets a real
// row in `calendar_events`, inside a dedicated "Social" collection, so it shows
// up in the month/week/agenda views next to everything else the user has on that
// day — and moving it there moves the post.
//
// Both stores are injected rather than imported as singletons so this module can
// be unit tested against one in-memory database holding both schemas.

import type { CalendarStore } from "../calendar/store.ts";
import { addMinutes } from "../calendar/wallclock.ts";
import { findSocialsManagerProvider } from "./providers.ts";
import type { SocialsManagerStore } from "./store.ts";
import { SocialsManagerError } from "./store.ts";
import type { SocialsManagerPost } from "./types.ts";

/** The collection scheduled posts live in. Created on first schedule. */
export const SOCIAL_CALENDAR_NAME = "Social";

/**
 * Botanical green, matching the calendar's own default palette family rather
 * than introducing a brand colour the rest of the app does not use.
 */
export const SOCIAL_CALENDAR_COLOR = "#4f6f68";

/** How long a post occupies in the grid. A post is a moment, but a zero-length
 * event is invisible in a week view, so it gets a readable block. */
const POST_BLOCK_MINUTES = 15;

export interface SocialsManagerCalendarStores {
  socialsManager: SocialsManagerStore;
  calendar: CalendarStore;
}

/** Find the user's Social calendar, creating it the first time it is needed. */
export function ensureSocialCalendar(
  stores: SocialsManagerCalendarStores,
  userId: number,
): number {
  const existing = stores.calendar
    .listCalendars(userId)
    .find((calendar) => calendar.name === SOCIAL_CALENDAR_NAME);
  if (existing) return existing.id;

  return stores.calendar.createCalendar(userId, {
    name: SOCIAL_CALENDAR_NAME,
    color: SOCIAL_CALENDAR_COLOR,
    visible: true,
  }).id;
}

function eventTitle(post: SocialsManagerPost): string {
  const provider = findSocialsManagerProvider(post.providerId);
  const network = provider?.name ?? post.providerId;
  const firstLine = post.content.split("\n").find((line) => line.trim()) ?? "";
  const summary = firstLine.trim().slice(0, 60);
  return summary ? `${network}: ${summary}` : `${network} post`;
}

/**
 * Put a post on the calendar at `at`, or move the event it already owns.
 * Returns the post with `calendarEventId` and `scheduledAt` settled.
 */
export function schedulePost(
  stores: SocialsManagerCalendarStores,
  userId: number,
  postId: number,
  at: string,
): SocialsManagerPost {
  const post = stores.socialsManager.getPost(userId, postId);
  if (post.status === "published") {
    throw new SocialsManagerError(409, "That post has already been published.");
  }

  const updated = stores.socialsManager.updatePost(userId, postId, {
    scheduledAt: at,
    status: "scheduled",
  });

  const provider = findSocialsManagerProvider(updated.providerId);
  const payload = {
    title: eventTitle(updated),
    description: updated.content,
    location: provider?.name ?? updated.providerId,
    allDay: false,
    startsAt: at,
    endsAt: addMinutes(at, POST_BLOCK_MINUTES),
  };

  // A stale id (the user deleted the event in the calendar) must not fail the
  // reschedule — fall through and create a fresh one.
  if (updated.calendarEventId !== null) {
    try {
      stores.calendar.updateEvent(userId, updated.calendarEventId, payload);
      return updated;
    } catch {
      stores.socialsManager.setCalendarEventId(userId, postId, null);
    }
  }

  const event = stores.calendar.createEvent(userId, {
    calendarId: ensureSocialCalendar(stores, userId),
    ...payload,
  });
  return stores.socialsManager.setCalendarEventId(userId, postId, event.id);
}

/** Take a post off the calendar, returning it to a draft. */
export function unschedulePost(
  stores: SocialsManagerCalendarStores,
  userId: number,
  postId: number,
): SocialsManagerPost {
  const post = stores.socialsManager.getPost(userId, postId);
  if (post.calendarEventId !== null) {
    try {
      stores.calendar.deleteEvent(userId, post.calendarEventId);
    } catch {
      // Already gone from the calendar; clearing the link below is enough.
    }
    stores.socialsManager.setCalendarEventId(userId, postId, null);
  }
  return stores.socialsManager.updatePost(userId, postId, {
    scheduledAt: null,
    status: "draft",
  });
}

/** Drop a post and the calendar slot it occupied, in that order. */
export function deletePostWithEvent(
  stores: SocialsManagerCalendarStores,
  userId: number,
  postId: number,
): void {
  const post = stores.socialsManager.getPost(userId, postId);
  if (post.calendarEventId !== null) {
    try {
      stores.calendar.deleteEvent(userId, post.calendarEventId);
    } catch {
      // The calendar entry was already removed by hand.
    }
  }
  stores.socialsManager.deletePost(userId, postId);
}

/**
 * Pull the post's schedule back in line with its calendar event, so dragging the
 * event in the calendar reschedules the post. Returns the post when it moved,
 * or null when nothing needed to change.
 *
 * A *deleted* event never reaches this function — the foreign key nulls the link
 * first, which is what reconcileOrphanedSchedules is for.
 */
export function syncPostFromCalendar(
  stores: SocialsManagerCalendarStores,
  userId: number,
  eventId: number,
): SocialsManagerPost | null {
  const post = stores.socialsManager.findByCalendarEventId(userId, eventId);
  if (!post || post.status === "published") return null;

  let startsAt: string;
  try {
    startsAt = stores.calendar.getEvent(userId, eventId).startsAt;
  } catch {
    return null;
  }

  if (startsAt === post.scheduledAt) return null;
  return stores.socialsManager.updatePost(userId, post.id, {
    scheduledAt: startsAt,
    status: "scheduled",
  });
}

/**
 * Return every post whose calendar slot was deleted to a draft. Deleting an
 * event in the calendar is how a user unschedules a post from that side, and
 * without this the post would stay "scheduled" forever with nothing backing it.
 */
export function reconcileOrphanedSchedules(
  stores: SocialsManagerCalendarStores,
  userId: number,
): SocialsManagerPost[] {
  return stores.socialsManager
    .listOrphanedScheduledPosts(userId)
    .map((post) =>
      stores.socialsManager.updatePost(userId, post.id, {
        scheduledAt: null,
        status: "draft",
      }),
    );
}
