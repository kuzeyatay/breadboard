---
name: calendar
description: Read and query the user's own calendar at /calendar — what is on today or any other day, whether they are free, when something next happens, who is invited and who accepted, how a series repeats. Use for "what's on my calendar", "am I free Thursday", "when do I next meet X", "how many meetings this week", "who's coming to the review", "what did I have on last Tuesday".
license: MIT
allowed-tools:
  - calendar_list_calendars
  - calendar_agenda
  - calendar_search_events
  - calendar_get_event
---

# Calendar

The user's own schedule, the same events `/calendar` draws. Four tools, all of
them reads.

breadboard:
  category: prebuilt
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - calendar_list_calendars
    - calendar_agenda
    - calendar_search_events
    - calendar_get_event
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## You can read the calendar, not change it

There is no tool here that creates, moves, reschedules or deletes anything, and
that is deliberate.

When the user asks you to add or change an event, say plainly that you can read
their calendar but not write to it, and that they can make the change at
`/calendar`. Offer the part you *can* do — checking the slot is free, finding
what it would collide with, listing who is on the existing invitation. Do not
look for a way around it: not a terminal command against the database, not an
ICS file for them to import, unless they ask for that themselves.

## Do not do calendar arithmetic yourself

`calendar_agenda` defaults `from` to today and takes `days` for the length of
the window. "What's on this week" is `{days: 7}` with no dates at all, and
"tomorrow" is `{from: "<tomorrow>", days: 1}` only if you are certain of the
date — otherwise ask for the window in days and let the tool anchor it.

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
