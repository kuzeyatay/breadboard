# Calendar reminders on your phone

If WhatsApp or Telegram is linked, every event in your calendar sends you two
messages: one twenty minutes before it starts, and one when it starts. Both
links linked means both phones' apps get them.

There is nothing to switch on. The reminders follow the messaging links: link
one in Intelligence → Settings → Messaging and they begin; unlink it and they
stop. A deployment can turn the feature off outright with
`BREADBOARD_CALENDAR_REMINDERS_ENABLED=false`.

```text
native Runtime V2 scheduler      "calendar-reminders", once a minute
        ↓
runtime-v2-background-executor   → lib/calendar/reminders.ts  runCalendarReminders()
        ↓
  which links are on?            WhatsApp: feature on + linked number + owner
                                 Telegram: feature on + bot token + owner
        ↓
  the owner's calendar           occurrencesInRange over a 30-minute window
        ↓
  what is due this minute?       dueReminders()   — pure
  what has already gone?         CalendarReminderLedger (SQLite)
        ↓
  one message per channel        messaging-service.ts  sendOwnerText()
        ↓
your own phone
```

## What arrives

A phone message, not a document: a headline, the time, the place if there is
one. Several events due in the same minute share one message.

```text
⏰ In 20 minutes: Dentist
09:20 – 10:00
📍 Room 4

▶️ Starting now: Standup
09:00 – 09:30
```

An all-day event is announced once, when its day begins (`📅 Today: …`). Its
"twenty minutes before" would be 23:40 the previous evening, which is a
wake-up rather than a reminder, so it is not sent.

## The rules worth knowing

**A reminder is a moment with a grace period.** The tick runs once a minute and
can be late — the machine was busy, or asleep. A reminder is owed from its
moment until ten minutes after (`LATE_TOLERANCE_MINUTES`); past that it is
dropped. That is what stops a laptop that wakes at noon from sending the whole
morning in one burst, and what stops "in 20 minutes" from arriving after the
meeting has begun. A "20 minutes before" that would fire inside the last
minutes before the start is likewise skipped in favour of the start notice.

**Delivery marks the ledger, not the attempt.** `calendar_reminder_deliveries`
records what has actually gone, per account, per channel, per occurrence, per
kind. A send that fails — WhatsApp not connected, Telegram unreachable — leaves
no row, so the next tick tries again while the moment is still within
tolerance. One channel being down never silences the other.

**The ledger is keyed by occurrence, not event.** A weekly meeting owes a fresh
pair every week; an event moved to a new time owes a fresh pair at the new
time. Both change the occurrence key (`eventId@start`); neither changes the
event id. A deleted event simply stops appearing in the window, so nothing is
sent for it.

**The destination is never chosen here.** The reminder goes through the same
`sendOwnerText` path as "send this to my WhatsApp" (see
`docs/SEND_TO_MY_PHONE.md`): the owner's own self-chat on WhatsApp, the
owner's private chat with the bot on Telegram, and no argument by which
anything else could be named. Telegram only has a destination once you have
messaged the bot at least once; until then the tick reports that and retries.

**Times are the calendar's wall clock.** Events are stored as timezone-free
local stamps and the tick compares them with the machine's local time, exactly
as the Plan view draws them.

## Where it lives

- `dashboard/src/lib/calendar/reminders.ts` — the decision (`dueReminders`),
  the text (`formatReminderMessage`), the ledger, and the tick.
- `dashboard/src/lib/hermes/messaging-service.ts` — `sendOwnerText`, the
  attachment-free, rate-slot-free send both reminders and future notices use.
- `dashboard/scripts/runtime-v2-background-executor.mjs` — the
  `calendar-reminders` operation.
- `native/runtime-cli/src/service_engine.rs` — the schedule registration
  (15 s after boot, then every 60 s). Changing it means rebuilding the native
  runtime (`node desktop/scripts/build-runtime-supervisor.mjs`).
- `desktop/runtime-v2/manifests/workers.json` — the background worker's
  `workflow:calendar-reminders` capability.
- `dashboard/tests/calendar-reminders.test.mjs`.
