// Filing the people who appear on your calendar into the address book.
//
// The seam is here rather than inside CalendarStore on purpose: the calendar
// should not know an address book exists, and the address book should not have
// to understand recurrence. Both routes that write an event call this once
// afterwards, and a failure here is swallowed — an address book that could not
// learn a name is not a reason to fail saving the meeting.

import { getContactStore } from "./instance.ts";
import type { SeenPerson } from "./types.ts";
import type { CalendarEvent } from "../calendar/types.ts";

/**
 * Remember everyone on an event: its attendees and, when it came from
 * elsewhere, its organizer. The event's own start is the "seen" stamp, so a
 * meeting scheduled for next month advances the person's last-seen date to
 * next month — the address book is sorted by when you deal with someone, not
 * by when a row happened to be written.
 */
export function rememberEventPeople(userId: number, event: CalendarEvent): void {
  const people: SeenPerson[] = event.attendees.map((attendee) => ({
    email: attendee.email,
    name: attendee.name,
    seenAt: event.startsAt,
  }));

  if (event.organizerEmail) {
    people.push({
      email: event.organizerEmail,
      name: event.organizerName,
      seenAt: event.startsAt,
    });
  }

  if (!people.length) return;

  try {
    getContactStore().rememberPeople(userId, people);
  } catch {
    // Deliberately silent: see the module comment.
  }
}
