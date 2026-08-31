---
name: calendar
description: Read and manage the user's own calendar at /calendar — create real reminders and events, reschedule or edit them, remove them, check availability, find when something happens, inspect attendees, and understand recurring series. Use for "remind me tomorrow", "put this on my calendar", "move my dentist appointment", "cancel that meeting", "what's on my calendar", and "am I free Thursday".
license: MIT
allowed-tools:
  - calendar_list_calendars
  - calendar_agenda
  - calendar_search_events
  - calendar_get_event
  - calendar_create_event
  - calendar_update_event
  - calendar_delete_event
---

# Calendar

The user's own schedule, the same events `/calendar` draws. The tools can read,
create, update and delete events.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - calendar_list_calendars
    - calendar_agenda
    - calendar_search_events
    - calendar_get_event
    - calendar_create_event
    - calendar_update_event
    - calendar_delete_event
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Write when the user asks

Calendar requests are actions, not promises. When the user says "remind me to
submit the form tomorrow", call `calendar_create_event` and put a real event on
tomorrow's date before saying it is saved. When they give no time, create an
all-day event by passing a bare `YYYY-MM-DD` as `startsAt`; do not invent a time.
When they give a time but no duration, omit `endsAt` and the event will default
to 30 minutes. Omit `calendarId` unless the user named a particular calendar.

For changes and deletions, locate the event with `calendar_search_events` or
`calendar_agenda` first and use the returned `eventId`. Only claim a change
after the write tool succeeds. Subscribed ICS calendars are read-only and the
write will explain that; do not work around that protection.

For a recurring series, an omitted `scope` means the whole series. Use
`scope: "instance"` with that occurrence's `recurrenceId` for just one date, or
`scope: "following"` with its `recurrenceId` for that date and later dates. If
the user's wording does not make the intended scope clear, ask before changing
or deleting a series.

## Use the calendar's wall clock

`calendar_agenda` defaults `from` to today and takes `days` for the length of
the window. "What's on this week" is `{days: 7}` with no dates at all. For a
write such as "tomorrow", resolve the date from the runtime's current date and
pass the resulting `YYYY-MM-DD`; never leave the request as a verbal promise.

Times are timezone-free wall clock, `"2026-08-07T09:00"`, exactly as the user
typed them into the grid. Do not convert them, do not append a zone, and do not
render them in some other locale's format. `09:00` means nine in the morning
where the user is, and that is all it means.

Every response carries `today`, so you always know what date the calendar
thinks it is. Use it rather than assuming.

## Agenda or search

`calendar_agenda` when the question is about a period: what's on, is there a
gap, how busy is Thursday. Recurring series arrive already expanded into dated
instances, in the order they happen.

`calendar_search_events` when the question is about a thing: a meeting by name,
everything with a particular person, anywhere a phrase appears. It searches
titles, locations, descriptions and the attendee list — an email address or a
name will find it.

Search has two modes and picking the right one is most of the work:

- Inside a window it returns **dated instances**. "Which of my one-to-ones are
  in August" is fifty answers, one per date, and that is what you want.
- With `allTime: true` it returns **one row per event**, with how it repeats and
  the next date it falls on. "When do I next meet Ana" is one answer, not a wall
  of every past and future standup. Use this whenever the user asks *when*
  something happens rather than *what is on* a period.

`calendar_get_event` for the parts a list entry cannot carry: the full
recurrence rule, each attendee's reply, occurrences deleted from the series, the
organizer, the description in full.

## What the shapes mean

A recurring event is one stored row and many dates. `seriesId` on an instance
points at that row; `recurring: true` marks an instance that came from a rule.
`edited: true` means this one occurrence was changed on its own — a moved or
retitled instance of an otherwise regular series — so it may not match its
siblings. `excludedDates` on the event are occurrences that were deleted from
the series; they are not on the calendar and must not be reported as if they
were.

A `subscribed` calendar mirrors someone else's published ICS. Its events are
real and belong on the agenda, but they come from elsewhere and refresh on their
own — worth mentioning when the user seems to think they own one.

An invisible calendar (`visible: false`) is hidden in the grid but its events
still exist and still appear in these results. If an answer includes something
the user cannot see on screen, say which calendar it is on.

Attendee `status` is what each person replied: `accepted`, `declined`,
`tentative`, or `needs-action` — which means they have not answered, not that
they are coming.

## Answering

Answer the question, then support it. "You're free after 2" beats a table of
the whole day. "Three meetings, the long one is the design review at 14:00"
beats all three listed in full.

Give times plainly (`14:00`, `Thursday 9–10`), name the calendar only when it
matters or when more than one is involved, and mention attendee counts rather
than listing everyone unless asked.

`total` and `returned` differ when a window held more than the limit. Say so
rather than presenting a truncated list as the whole day.

An empty result is an empty calendar for that window — a real answer, and a
useful one. Say the window is clear rather than hedging about whether the query
worked.
