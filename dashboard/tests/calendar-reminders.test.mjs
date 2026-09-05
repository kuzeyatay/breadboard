// Calendar reminders on the phone: which occurrences owe one this minute, what
// the message says, that nothing goes twice, and that the tick is wired into
// the native scheduler the same way CalDAV syncing is.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  CalendarReminderLedger,
  LATE_TOLERANCE_MINUTES,
  LEAD_MINUTES,
  dueReminders,
  formatReminderMessage,
  reminderWindow,
  runCalendarReminders,
} from "../src/lib/calendar/reminders.ts";
import { CalendarStore } from "../src/lib/calendar/store.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const occurrence = (overrides = {}) => ({
  key: `${overrides.eventId ?? 1}@${overrides.start ?? "2026-08-31T09:00"}`,
  eventId: 1,
  seriesId: null,
  recurrenceId: null,
  isOverride: false,
  calendarId: 1,
  title: "Standup",
  description: null,
  location: null,
  allDay: false,
  start: "2026-08-31T09:00",
  end: "2026-08-31T09:30",
  recurring: false,
  attendeeCount: 0,
  readOnly: false,
  ...overrides,
});

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return db;
}

// ------------------------------------------------------------------ due-ness

test("twenty minutes before, and at the start, and at no other minute", () => {
  const event = occurrence();
  const kinds = (now) => dueReminders([event], now).map((reminder) => reminder.kind);

  assert.deepEqual(kinds("2026-08-31T08:39"), [], "a minute early is nothing yet");
  assert.deepEqual(kinds("2026-08-31T08:40"), ["lead"]);
  assert.deepEqual(kinds("2026-08-31T08:45"), ["lead"], "a late tick still owes the lead");
  assert.deepEqual(kinds("2026-08-31T08:59"), [], "too late to say 'in 20 minutes'");
  assert.deepEqual(kinds("2026-08-31T09:00"), ["start"]);
  assert.deepEqual(kinds("2026-08-31T09:05"), ["start"], "a late tick still owes the start");
  assert.deepEqual(kinds("2026-08-31T09:11"), [], "past tolerance it is dropped, not replayed");
  assert.equal(LEAD_MINUTES, 20);
  assert.equal(LATE_TOLERANCE_MINUTES, 10);
});

test("the lead reminder records the minute it was meant for, not the minute it fired", () => {
  const [lead] = dueReminders([occurrence()], "2026-08-31T08:44");
  assert.equal(lead.dueAt, "2026-08-31T08:40");
  const [start] = dueReminders([occurrence()], "2026-08-31T09:03");
  assert.equal(start.dueAt, "2026-08-31T09:00");
});

test("an all-day event is announced once, when its day begins", () => {
  const holiday = occurrence({
    allDay: true,
    start: "2026-09-01T00:00",
    end: "2026-09-01T23:59",
  });
  assert.deepEqual(dueReminders([holiday], "2026-08-31T23:40"), [], "no 23:40 wake-up");
  assert.equal(dueReminders([holiday], "2026-09-01T00:00")[0]?.kind, "start");
});

test("a sleeping machine does not replay the morning", () => {
  const events = [
    occurrence({ eventId: 1, start: "2026-08-31T08:00", end: "2026-08-31T08:30" }),
    occurrence({ eventId: 2, start: "2026-08-31T09:00", end: "2026-08-31T09:30" }),
    occurrence({ eventId: 3, start: "2026-08-31T10:00", end: "2026-08-31T10:30" }),
  ];
  const due = dueReminders(events, "2026-08-31T10:02");
  assert.deepEqual(
    due.map((reminder) => [reminder.occurrence.eventId, reminder.kind]),
    [[3, "start"]],
  );
});

test("reminders are ordered by the moment they were meant for", () => {
  const events = [
    occurrence({ eventId: 2, start: "2026-08-31T09:20", end: "2026-08-31T09:50" }),
    occurrence({ eventId: 1, start: "2026-08-31T09:00", end: "2026-08-31T09:30" }),
  ];
  const due = dueReminders(events, "2026-08-31T09:00");
  assert.deepEqual(
    due.map((reminder) => [reminder.occurrence.eventId, reminder.kind]),
    [[1, "start"], [2, "lead"]],
  );
});

test("the read window covers everything that could be due", () => {
  assert.deepEqual(reminderWindow("2026-08-31T09:00"), {
    from: "2026-08-31T08:50",
    to: "2026-08-31T09:20",
  });
});

// ------------------------------------------------------------------ the text

test("the message is written for a phone: one block per reminder, no markdown", () => {
  const now = "2026-08-31T09:00";
  const due = dueReminders(
    [
      occurrence({ eventId: 1, location: "Room 4" }),
      occurrence({
        eventId: 2,
        title: "Dentist",
        start: "2026-08-31T09:20",
        end: "2026-08-31T10:00",
      }),
    ],
    now,
  );
  const text = formatReminderMessage(due, now);
  assert.equal(
    text,
    [
      "▶️ Starting now: Standup",
      "09:00 – 09:30",
      "📍 Room 4",
      "",
      "⏰ In 20 minutes: Dentist",
      "09:20 – 10:00",
    ].join("\n"),
  );
  assert.doesNotMatch(text, /[*#_`]/, "nothing that WhatsApp would show as asterisks");
});

test("an all-day event and an event on another day say so", () => {
  const now = "2026-09-01T00:00";
  const text = formatReminderMessage(
    dueReminders(
      [
        occurrence({
          eventId: 1,
          title: "Conference",
          allDay: true,
          start: "2026-09-01T00:00",
          end: "2026-09-03T23:59",
        }),
        occurrence({
          eventId: 2,
          title: "Night shift",
          start: "2026-09-01T00:00",
          end: "2026-09-02T06:00",
        }),
      ],
      now,
    ),
    now,
  );
  assert.match(text, /📅 Today: Conference\nAll day · until Thu 3 Sep/);
  assert.match(text, /▶️ Starting now: Night shift\n00:00 – Wed 2 Sep 06:00/);
});

test("an untitled event still reads as one", () => {
  const now = "2026-08-31T09:00";
  const text = formatReminderMessage(dueReminders([occurrence({ title: "  " })], now), now);
  assert.match(text, /^▶️ Starting now: Untitled event/);
});

// ---------------------------------------------------------------- the ledger

test("a reminder goes once per channel; a send that failed is not recorded", () => {
  const ledger = new CalendarReminderLedger(createDb());
  const due = dueReminders([occurrence()], "2026-08-31T08:40");

  assert.equal(ledger.unsent(1, "whatsapp", due).length, 1);
  ledger.markSent(1, "whatsapp", due);
  assert.equal(ledger.unsent(1, "whatsapp", due).length, 0, "not twice on WhatsApp");
  assert.equal(ledger.unsent(1, "telegram", due).length, 1, "Telegram is its own ledger");
  assert.equal(ledger.unsent(2, "whatsapp", due).length, 1, "and so is another account");

  // Marking twice is harmless (two processes share this database).
  ledger.markSent(1, "whatsapp", due);
  assert.equal(ledger.unsent(1, "whatsapp", due).length, 0);
});

test("the lead and the start of one occurrence are two different debts", () => {
  const ledger = new CalendarReminderLedger(createDb());
  ledger.markSent(1, "telegram", dueReminders([occurrence()], "2026-08-31T08:40"));
  const start = dueReminders([occurrence()], "2026-08-31T09:00");
  assert.equal(ledger.unsent(1, "telegram", start).length, 1);
});

test("a moved event owes new reminders; the ledger prunes what is too old to matter", () => {
  const db = createDb();
  const ledger = new CalendarReminderLedger(db);
  ledger.markSent(1, "whatsapp", dueReminders([occurrence()], "2026-08-31T09:00"));

  const moved = occurrence({ start: "2026-08-31T11:00", end: "2026-08-31T11:30" });
  assert.equal(ledger.unsent(1, "whatsapp", dueReminders([moved], "2026-08-31T11:00")).length, 1);

  db.prepare(
    "UPDATE calendar_reminder_deliveries SET sent_at = datetime('now', '-9 days')",
  ).run();
  assert.equal(ledger.prune(), 1);
  assert.equal(ledger.prune(), 0);
});

// ------------------------------------------------------------------ the tick

function fakeDeps(overrides = {}) {
  const db = createDb();
  const store = new CalendarStore(db);
  const [calendar] = store.listCalendarsEnsuringDefault(1);
  store.createEvent(1, {
    calendarId: calendar.id,
    title: "Standup",
    startsAt: "2026-08-31T09:00",
    endsAt: "2026-08-31T09:30",
    recurrence: { frequency: "daily" },
  });
  const sent = [];
  return {
    sent,
    store,
    deps: {
      recipients: async () => [
        { channel: "whatsapp", userId: 1 },
        { channel: "telegram", userId: 1 },
      ],
      occurrences: (userId, from, to) => store.occurrencesInRange(userId, from, to),
      ledger: new CalendarReminderLedger(db),
      send: async (recipient, text) => {
        sent.push({ channel: recipient.channel, text });
      },
      ...overrides,
    },
  };
}

// The tick reads the machine's wall clock, so the tests hand it a Date built
// in local time for the minute they mean.
const at = (stamp) => {
  const [date, time] = stamp.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
};

test("every enabled channel gets one message per tick, and a repeat tick sends nothing", async () => {
  const { deps, sent } = fakeDeps();

  const first = await runCalendarReminders({ now: at("2026-08-31T08:40"), deps });
  assert.equal(first.recipients, 2);
  assert.equal(first.delivered, 2, "one lead reminder on each channel");
  assert.deepEqual(sent.map((message) => message.channel), ["whatsapp", "telegram"]);
  assert.match(sent[0].text, /⏰ In 20 minutes: Standup/);

  const again = await runCalendarReminders({ now: at("2026-08-31T08:41"), deps });
  assert.equal(again.delivered, 0);
  assert.equal(sent.length, 2);

  const start = await runCalendarReminders({ now: at("2026-08-31T09:00"), deps });
  assert.equal(start.delivered, 2);
  assert.match(sent[2].text, /▶️ Starting now: Standup/);

  // A recurring event owes the next day's pair afresh.
  const tomorrow = await runCalendarReminders({ now: at("2026-09-01T08:40"), deps });
  assert.equal(tomorrow.delivered, 2);
});

test("a channel that cannot send keeps its reminders for the next tick", async () => {
  const { deps, sent } = fakeDeps();
  let telegramDown = true;
  deps.send = async (recipient, text) => {
    if (recipient.channel === "telegram" && telegramDown) {
      throw new Error("Telegram refused the message.");
    }
    sent.push({ channel: recipient.channel, text });
  };

  const first = await runCalendarReminders({ now: at("2026-08-31T09:00"), deps });
  assert.equal(first.delivered, 1);
  assert.equal(first.failed, 1);
  assert.match(first.errors[0], /^telegram: Telegram refused/);

  telegramDown = false;
  const second = await runCalendarReminders({ now: at("2026-08-31T09:02"), deps });
  assert.equal(second.delivered, 1, "Telegram catches up");
  assert.deepEqual(sent.map((message) => message.channel), ["whatsapp", "telegram"]);
});

test("no enabled channel means the calendar is not even read", async () => {
  let reads = 0;
  const { deps } = fakeDeps({
    recipients: async () => [],
    occurrences: () => {
      reads += 1;
      return [];
    },
  });
  const result = await runCalendarReminders({ now: at("2026-08-31T09:00"), deps });
  assert.equal(result.recipients, 0);
  assert.equal(reads, 0);
});

test("the kill switch turns the tick into a no-op", async () => {
  const { deps, sent } = fakeDeps();
  process.env.BREADBOARD_CALENDAR_REMINDERS_ENABLED = "false";
  try {
    const result = await runCalendarReminders({ now: at("2026-08-31T09:00"), deps });
    assert.equal(result.recipients, 0);
    assert.equal(sent.length, 0);
  } finally {
    delete process.env.BREADBOARD_CALENDAR_REMINDERS_ENABLED;
  }
});

// ----------------------------------------------------------------- the wiring

test("reminders run in a native-scheduled worker, once a minute", () => {
  const executor = source("../scripts/runtime-v2-background-executor.mjs");
  assert.match(executor, /"calendar-reminders",/);
  assert.match(executor, /case "calendar-reminders"/);
  assert.match(executor, /lib\/calendar\/reminders\.ts/);
  assert.match(executor, /await runCalendarReminders\(\)/);

  const engine = source("../../native/runtime-cli/src/service_engine.rs");
  assert.match(engine, /RuntimeScheduleRegistration::fixed\("calendar-reminders", 15_000, 60_000\)/);
  assert.match(engine, /\| "calendar-reminders"/, "the occurrence payload accepts it");

  const workers = JSON.parse(source("../../desktop/runtime-v2/manifests/workers.json"));
  const background = workers.workers.find((worker) => worker.kind === "background-task-node");
  assert.ok(background, "the background worker is declared");
  assert.ok(background.capabilityIds.includes("workflow:calendar-reminders"));
});

test("the destination is the owner's own thread and nothing a caller can choose", () => {
  const reminders = source("../src/lib/calendar/reminders.ts");
  assert.match(reminders, /sendOwnerText\(\{[\s\S]*channel: recipient\.channel,[\s\S]*kind: "reminder"/);
  assert.doesNotMatch(reminders, /chatId|chat_id|recipientNumber|sendMessage\(|sendRuntimeWhatsApp/);

  const service = source("../src/lib/hermes/messaging-service.ts");
  assert.match(service, /export async function sendOwnerText/);
  assert.match(service, /deliverWhatsApp\(input\.userId, text, null\)/);
  assert.match(service, /deliverTelegram\(input\.userId, text, null\)/);
  assert.match(service, /recordDeliveredOwnerMessage\(\{/);
  assert.match(service, /appendConversationAssistantMessage\(\{/);
  assert.match(service, /store\.bindConversation\(input\.target\.chatId, conversation\.id\)/);
});
