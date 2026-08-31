// Calendar reminders on the phone: twenty minutes before an event and again
// when it starts, on whichever messaging link is enabled.
//
// This is the calendar's only push. Everything else about it is pull — you
// open Plan and look — which is fine at a desk and useless on the way to a
// meeting. The two messaging links (WhatsApp, Telegram) already know how to
// reach the owner's own phone and nothing else, so a reminder rides that path
// and inherits its one rule: it goes to the linked account, never anywhere
// a model or a payload could name.
//
// Three things are decided here, and the first two are pure so they can be
// tested without a clock, a database or a bot token:
//
//   1. `dueReminders` — which occurrences owe a reminder at this wall-clock
//      minute. "Twenty minutes before" and "now" are moments, and a background
//      tick lands somewhere after each of them, so a reminder is due from its
//      moment until `LATE_TOLERANCE_MINUTES` later. Past that it is dropped: a
//      laptop that wakes from a night's sleep must not send yesterday's day in
//      one burst, and a "starts in 20 minutes" that arrives after the meeting
//      began is worse than none.
//   2. `formatReminderMessage` — the text, written for a phone screen.
//   3. `CalendarReminderLedger` — which reminders have already gone, so the
//      minute-by-minute tick (and the other process sharing this database)
//      cannot send one twice. Delivery is what marks the ledger; a send that
//      fails stays unmarked and is retried on the next tick while the moment
//      is still within tolerance.
//
// The tick itself, `runCalendarReminders`, is scheduled by the native Runtime
// V2 engine ("calendar-reminders" in native/runtime-cli/src/service_engine.rs)
// and reached through dashboard/scripts/runtime-v2-background-executor.mjs,
// the same way CalDAV syncing and scheduled chats are.

import type DatabaseType from "better-sqlite3";

import { formatShortDate, formatTimeRange } from "./format.ts";
import type { CalendarOccurrence } from "./types.ts";
import {
  addMinutes,
  dateOf,
  minutesBetween,
  nowStamp,
  parseStamp,
  timeOf,
} from "./wallclock.ts";

type Db = DatabaseType.Database;

/** How far ahead of an event the first reminder goes. */
export const LEAD_MINUTES = 20;

/**
 * How long after its moment a reminder may still be sent. Longer than one
 * tick, so a slow or skipped tick loses nothing; far shorter than a night, so
 * a machine that was asleep does not replay it.
 */
export const LATE_TOLERANCE_MINUTES = 10;

/** Ledger rows older than this are pruned; nothing that old can still be due. */
export const LEDGER_RETENTION_DAYS = 7;

export type ReminderKind = "lead" | "start";

export const REMINDER_CHANNELS = ["whatsapp", "telegram"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export interface DueReminder {
  kind: ReminderKind;
  occurrence: CalendarOccurrence;
  /** The wall-clock minute this reminder was meant for. */
  dueAt: string;
}

/** The integration is on unless a deployment explicitly turns it off. */
export function calendarRemindersEnabled(): boolean {
  return (
    (process.env.BREADBOARD_CALENDAR_REMINDERS_ENABLED ?? "").trim().toLowerCase() !==
    "false"
  );
}

/**
 * The wall-clock window a tick has to read from the calendar so that every
 * occurrence which could owe a reminder now is in it: an event whose start is
 * up to `LEAD_MINUTES` ahead, or up to `LATE_TOLERANCE_MINUTES` behind.
 */
export function reminderWindow(now: string): { from: string; to: string } {
  return {
    from: addMinutes(now, -LATE_TOLERANCE_MINUTES),
    to: addMinutes(now, LEAD_MINUTES),
  };
}

/**
 * Which reminders are owed at `now`, oldest moment first.
 *
 * An all-day event gets only its start notice. Its "twenty minutes before"
 * would be 23:40 the previous evening about something that is not yet today,
 * which is a wake-up, not a reminder.
 */
export function dueReminders(
  occurrences: readonly CalendarOccurrence[],
  now: string,
): DueReminder[] {
  if (!parseStamp(now)) return [];
  const due: DueReminder[] = [];

  for (const occurrence of occurrences) {
    if (!parseStamp(occurrence.start)) continue;
    const untilStart = minutesBetween(now, occurrence.start);

    // Started: at the start minute, or within tolerance after it.
    if (untilStart <= 0 && -untilStart <= LATE_TOLERANCE_MINUTES) {
      due.push({ kind: "start", occurrence, dueAt: occurrence.start });
      continue;
    }

    // Ahead: within the lead window, but only if the moment the lead notice was
    // meant for is not so far behind that "in 20 minutes" would be a lie.
    if (
      !occurrence.allDay &&
      untilStart > 0 &&
      untilStart <= LEAD_MINUTES &&
      LEAD_MINUTES - untilStart <= LATE_TOLERANCE_MINUTES
    ) {
      due.push({
        kind: "lead",
        occurrence,
        dueAt: addMinutes(occurrence.start, -LEAD_MINUTES),
      });
    }
  }

  return due.sort((left, right) =>
    left.dueAt === right.dueAt
      ? left.occurrence.start.localeCompare(right.occurrence.start)
      : left.dueAt.localeCompare(right.dueAt),
  );
}

function whenLine(occurrence: CalendarOccurrence, today: string): string {
  const startDate = dateOf(occurrence.start);
  const endDate = dateOf(occurrence.end);
  if (occurrence.allDay) {
    return startDate === endDate
      ? "All day"
      : `All day · until ${formatShortDate(endDate)}`;
  }
  const time = formatTimeRange(occurrence.start, occurrence.end);
  if (startDate === endDate) {
    return startDate === today ? time : `${formatShortDate(startDate)} ${time}`;
  }
  // Spans midnight: say when it ends, or the range reads as a typo.
  return `${timeOf(occurrence.start)} – ${formatShortDate(endDate)} ${timeOf(occurrence.end)}`;
}

function headline(reminder: DueReminder): string {
  const title = reminder.occurrence.title.trim() || "Untitled event";
  if (reminder.kind === "lead") return `⏰ In ${LEAD_MINUTES} minutes: ${title}`;
  return reminder.occurrence.allDay ? `📅 Today: ${title}` : `▶️ Starting now: ${title}`;
}

/**
 * One phone message for every reminder owed this minute. Several events at
 * 09:00 become one message, not five — a burst of near-identical messages is
 * what gets a messaging account restricted, and it reads worse besides. No
 * markdown: neither app renders it and WhatsApp shows the asterisks.
 */
export function formatReminderMessage(
  reminders: readonly DueReminder[],
  now: string,
): string {
  const today = dateOf(now);
  return reminders
    .map((reminder) => {
      const lines = [headline(reminder), whenLine(reminder.occurrence, today)];
      const location = reminder.occurrence.location?.trim();
      if (location) lines.push(`📍 ${location}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

// ---------------------------------------------------------------- the ledger

export function ensureCalendarReminderSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_reminder_deliveries (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      channel        TEXT    NOT NULL CHECK (channel IN ('whatsapp','telegram')),
      occurrence_key TEXT    NOT NULL,
      kind           TEXT    NOT NULL CHECK (kind IN ('lead','start')),
      due_at         TEXT    NOT NULL,
      sent_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_reminder_deliveries_once
      ON calendar_reminder_deliveries(user_id, channel, occurrence_key, kind);

    CREATE INDEX IF NOT EXISTS idx_calendar_reminder_deliveries_sent
      ON calendar_reminder_deliveries(sent_at);
  `);
}

/**
 * Remembers which reminders have been delivered.
 *
 * Keyed by occurrence, not event: a weekly meeting owes a fresh pair every
 * week, and an event moved to a new time owes a fresh pair at the new time —
 * both of which change the occurrence key (`${eventId}@${start}`), and neither
 * of which changes the event id.
 */
export class CalendarReminderLedger {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureCalendarReminderSchema(db);
  }

  /** The reminders in `candidates` that have not yet gone to this channel. */
  unsent(userId: number, channel: ReminderChannel, candidates: readonly DueReminder[]): DueReminder[] {
    if (candidates.length === 0) return [];
    const seen = this.db.prepare(
      `SELECT 1 FROM calendar_reminder_deliveries
        WHERE user_id = ? AND channel = ? AND occurrence_key = ? AND kind = ?`,
    );
    return candidates.filter(
      (reminder) =>
        seen.get(userId, channel, reminder.occurrence.key, reminder.kind) === undefined,
    );
  }

  /**
   * Record a delivery. Called only after the send succeeded: a reminder whose
   * send failed must stay unsent so the next tick tries again.
   */
  markSent(userId: number, channel: ReminderChannel, reminders: readonly DueReminder[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO calendar_reminder_deliveries
         (user_id, channel, occurrence_key, kind, due_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const all = this.db.transaction((rows: readonly DueReminder[]) => {
      for (const reminder of rows) {
        insert.run(userId, channel, reminder.occurrence.key, reminder.kind, reminder.dueAt);
      }
    });
    all(reminders);
  }

  /** Drop rows too old to matter. Returns how many went. */
  prune(retentionDays = LEDGER_RETENTION_DAYS): number {
    const result = this.db
      .prepare(
        `DELETE FROM calendar_reminder_deliveries
          WHERE sent_at < datetime('now', ?)`,
      )
      .run(`-${Math.max(1, Math.trunc(retentionDays))} days`);
    return result.changes;
  }
}

// ------------------------------------------------------------------ the tick

/** A messaging link that is switched on and linked to somebody's account. */
export interface ReminderRecipient {
  channel: ReminderChannel;
  userId: number;
}

export interface CalendarReminderDeps {
  /** Every enabled, linked messaging channel and whose account it belongs to. */
  recipients: () => Promise<ReminderRecipient[]>;
  occurrences: (userId: number, from: string, to: string) => CalendarOccurrence[];
  ledger: Pick<CalendarReminderLedger, "unsent" | "markSent" | "prune">;
  send: (recipient: ReminderRecipient, text: string) => Promise<void>;
}

export interface CalendarReminderTickResult {
  /** Channels that were enabled and linked this tick. */
  recipients: number;
  /** Individual reminders delivered (a message may carry several). */
  delivered: number;
  /** Messages that could not be sent; their reminders stay unsent. */
  failed: number;
  /** Set when a whole channel could not be consulted. */
  errors: string[];
}

export interface CalendarReminderTickOptions {
  now?: Date;
  /** Injected by the tests; production reads the real modules. */
  deps?: CalendarReminderDeps;
}

async function realDeps(): Promise<CalendarReminderDeps> {
  // Loaded lazily so nothing here is pulled in by a process that only wanted
  // the pure functions — and so a tick that cannot load the messaging stack
  // fails as a tick, not as a boot.
  const [
    { getCalendarStore },
    dbModule,
    { whatsAppFeatureEnabled },
    { telegramFeatureEnabled },
    { hasBotToken },
    { sendOwnerText },
  ] = await Promise.all([
    import("./instance.ts"),
    import("../db.ts"),
    import("../whatsapp/config.ts"),
    import("../telegram/config.ts"),
    import("../telegram/credentials.ts"),
    import("../hermes/messaging-service.ts"),
  ]);
  const store = getCalendarStore();
  const ledger = new CalendarReminderLedger(dbModule.default);

  return {
    recipients: async () => {
      const recipients: ReminderRecipient[] = [];
      if (whatsAppFeatureEnabled()) {
        const { getWhatsAppStore } = await import("../whatsapp/instance.ts");
        const settings = getWhatsAppStore().settings();
        if (settings.ownerUserId !== null && settings.linkedNumber) {
          recipients.push({ channel: "whatsapp", userId: settings.ownerUserId });
        }
      }
      if (telegramFeatureEnabled() && hasBotToken()) {
        const { getTelegramStore } = await import("../telegram/instance.ts");
        const settings = getTelegramStore().settings();
        if (settings.ownerUserId !== null && settings.botId) {
          recipients.push({ channel: "telegram", userId: settings.ownerUserId });
        }
      }
      return recipients;
    },
    occurrences: (userId, from, to) => store.occurrencesInRange(userId, from, to),
    ledger,
    send: async (recipient, text) => {
      await sendOwnerText({
        channel: recipient.channel,
        userId: recipient.userId,
        text,
        kind: "reminder",
      });
    },
  };
}

/**
 * One pass: for every enabled messaging link, send the owner whatever their
 * calendar owes them this minute.
 *
 * The recipients are the *channels*, not the users: each link is owned by one
 * account, and that account's calendar is the one read. An account with both
 * links gets both messages — that is what "enabled" means, and the ledger keeps
 * the two channels apart so neither doubles up on its own.
 */
export async function runCalendarReminders(
  options: CalendarReminderTickOptions = {},
): Promise<CalendarReminderTickResult> {
  const result: CalendarReminderTickResult = {
    recipients: 0,
    delivered: 0,
    failed: 0,
    errors: [],
  };
  if (!calendarRemindersEnabled()) return result;

  const deps = options.deps ?? (await realDeps());
  const now = nowStamp(options.now ?? new Date());
  const window = reminderWindow(now);

  let recipients: ReminderRecipient[];
  try {
    recipients = await deps.recipients();
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : "The messaging links could not be read.",
    );
    return result;
  }
  result.recipients = recipients.length;
  if (recipients.length === 0) return result;

  // The same account behind both links reads its calendar once.
  const dueByUser = new Map<number, DueReminder[]>();
  for (const recipient of recipients) {
    if (dueByUser.has(recipient.userId)) continue;
    try {
      const occurrences = deps.occurrences(recipient.userId, window.from, window.to);
      dueByUser.set(recipient.userId, dueReminders(occurrences, now));
    } catch (error) {
      dueByUser.set(recipient.userId, []);
      result.errors.push(
        error instanceof Error ? error.message : "The calendar could not be read.",
      );
    }
  }

  for (const recipient of recipients) {
    const owed = deps.ledger.unsent(
      recipient.userId,
      recipient.channel,
      dueByUser.get(recipient.userId) ?? [],
    );
    if (owed.length === 0) continue;
    try {
      await deps.send(recipient, formatReminderMessage(owed, now));
    } catch (error) {
      // Not marked: the next tick tries again while the moment is still
      // within tolerance. One channel being down must not silence the other.
      result.failed += 1;
      result.errors.push(
        `${recipient.channel}: ${error instanceof Error ? error.message : "the message could not be sent"}`,
      );
      continue;
    }
    deps.ledger.markSent(recipient.userId, recipient.channel, owed);
    result.delivered += owed.length;
  }

  try {
    deps.ledger.prune();
  } catch {
    // Housekeeping; a failure here changes nothing about what was sent.
  }

  return result;
}
