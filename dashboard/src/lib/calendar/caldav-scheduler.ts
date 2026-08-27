// The in-process tick that keeps synced calendars synced.
//
// Modelled on ../review/scheduler.ts, and started from the same place
// (src/instrumentation-node.ts), because Breadboard's Next.js server is the only
// long-lived process — there is no platform cron to lean on.
//
// The rule is "come round often enough to be useful, rarely enough to be
// polite, and back off when a server keeps saying no":
//
//   nothing pending, all well   → every SYNC_INTERVAL_MS (15 minutes)
//   something waiting to go out → within PENDING_INTERVAL_MS (a minute)
//   the last attempt failed     → double the wait per failure, up to 6 hours
//
// The middle case is the one that matters to a person: a calendar you edited
// here is visibly wrong on your phone until it leaves, whereas a calendar that
// is only waiting to hear about someone else's change is not wrong, just old.
//
// Deciding *whether* it is time is all this file does. What a sync means lives
// in ./caldav-sync.ts, and the decision is a pure function (`nextAttemptIn`)
// so it can be tested without a clock, a server or a database.

import { nowStamp } from "./wallclock.ts";
import type { SyncableCalendar } from "./types.ts";

/** How often a calendar with nothing pending is re-checked. */
export const SYNC_INTERVAL_MS = 15 * 60_000;

/** How soon a calendar with local changes waiting is re-checked. */
export const PENDING_INTERVAL_MS = 60_000;

/** However many times a server has refused us, stop waiting longer than this. */
export const MAX_BACKOFF_MS = 6 * 60 * 60_000;

function configuredInterval(): number {
  const raw = Number(process.env.BREADBOARD_CALDAV_SYNC_INTERVAL_MS);
  // A floor rather than trust: a misconfigured interval of "1" would turn this
  // into a denial-of-service against the user's own calendar server.
  return Number.isFinite(raw) && raw >= PENDING_INTERVAL_MS ? raw : SYNC_INTERVAL_MS;
}

/**
 * How long after `lastSyncedAt` this calendar should next be tried, in ms.
 *
 * Failures double the wait — one failure waits twice the interval, two wait
 * four times — because the failures that persist are the ones a person has to
 * fix (a revoked app password, a server that moved), and retrying those every
 * few minutes helps nobody and looks like an attack from the server's side.
 */
export function nextAttemptIn(
  calendar: Pick<SyncableCalendar, "failures">,
  options: { pending: boolean; interval?: number },
): number {
  const interval = options.interval ?? SYNC_INTERVAL_MS;
  if (calendar.failures > 0) {
    return Math.min(interval * 2 ** Math.min(calendar.failures, 10), MAX_BACKOFF_MS);
  }
  return options.pending ? Math.min(PENDING_INTERVAL_MS, interval) : interval;
}

/**
 * Whether this calendar is due.
 *
 * A calendar that has never synced is always due: it was just connected, or the
 * process died before its first exchange, and either way waiting a quarter of an
 * hour to find that out is the wrong answer.
 */
export function isDue(
  calendar: SyncableCalendar,
  options: { pending: boolean; now: number; interval?: number },
): boolean {
  if (!calendar.lastSyncedAt) return true;
  const last = new Date(calendar.lastSyncedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return options.now - last >= nextAttemptIn(calendar, options);
}

export interface CaldavTickResult {
  considered: number;
  synced: number;
  failed: number;
  /** Held by another process, or by this one's previous tick. */
  leased: number;
}

export interface CaldavTickOptions {
  now?: Date;
  interval?: number;
  /** Injected by the tests; production reads the real modules. */
  deps?: {
    store: CaldavSchedulerStore;
    readSecret: (userId: number, calendarId: number) => { username: string; password: string } | null;
    sync: (
      userId: number,
      calendarId: number,
      account: { url: string; username: string; password: string },
    ) => Promise<unknown>;
  };
}

/** The slice of CalendarStore this scheduler needs. Keeps the tests honest. */
export interface CaldavSchedulerStore {
  listSyncableCalendars(): SyncableCalendar[];
  hasPendingRemoteWork(userId: number, calendarId: number): boolean;
  markCaldavSynced(
    userId: number,
    calendarId: number,
    result: { syncedAt: string; ctag?: string | null; error?: string | null },
  ): unknown;
}

async function realDeps(): Promise<NonNullable<CaldavTickOptions["deps"]>> {
  // Loaded lazily so booting the server never pulls the sync stack — and the
  // node crypto the vault needs — in through instrumentation.
  const [{ getCalendarStore }, { readCaldavSecret }, { syncCaldavCalendar }] = await Promise.all([
    import("./instance.ts"),
    import("./caldav-credentials.ts"),
    import("./caldav-sync.ts"),
  ]);
  const store = getCalendarStore();
  return {
    store,
    readSecret: readCaldavSecret,
    sync: (userId, calendarId, account) =>
      syncCaldavCalendar(store, userId, calendarId, account),
  };
}

/** A refusal because someone else holds the calendar's sync lease. */
function busy(error: unknown): boolean {
  return (
    error instanceof Error && (error as Error & { status?: number }).status === 409
  );
}

/** Run one pass over every bound calendar on the machine. */
export async function runDueCaldavSyncs(
  options: CaldavTickOptions = {},
): Promise<CaldavTickResult> {
  const deps = options.deps ?? (await realDeps());
  const now = options.now ?? new Date();
  const interval = options.interval ?? configuredInterval();
  const result: CaldavTickResult = { considered: 0, synced: 0, failed: 0, leased: 0 };

  for (const calendar of deps.store.listSyncableCalendars()) {
    const pending = deps.store.hasPendingRemoteWork(calendar.userId, calendar.calendarId);
    if (!isDue(calendar, { pending, now: now.getTime(), interval })) continue;
    result.considered += 1;

    // Reading the password can fail outright — an unusable vault key refuses
    // every calendar at once — so it is caught here rather than allowed to
    // abandon the rest of the pass on the first row it reaches.
    let secret: { username: string; password: string } | null = null;
    let unreadable: string | null = null;
    try {
      secret = deps.readSecret(calendar.userId, calendar.calendarId);
    } catch (error) {
      unreadable = error instanceof Error ? error.message : "That calendar's password could not be read.";
    }

    if (!secret) {
      // Nothing to authenticate with — the vault key changed, or the row was
      // removed. Recorded like any other failure so the panel says so and the
      // backoff stops this being asked again every minute.
      deps.store.markCaldavSynced(calendar.userId, calendar.calendarId, {
        syncedAt: nowStamp(now),
        error: unreadable ?? "That calendar's password is missing. Connect it again.",
      });
      result.failed += 1;
      continue;
    }

    try {
      await deps.sync(calendar.userId, calendar.calendarId, {
        url: calendar.url,
        username: secret.username || calendar.username || "",
        password: secret.password,
      });
      result.synced += 1;
    } catch (error) {
      // The lease is taken inside the sync itself, so a calendar someone is
      // already syncing — a person on the profile page, the other process
      // sharing this database — reports itself busy rather than failed. It is
      // being handled; there is nothing here to retry or count against it.
      if (busy(error)) {
        result.leased += 1;
        continue;
      }
      // Otherwise syncCaldavCalendar has already written the reason onto the
      // calendar, which is what the panel shows; one unreachable server must
      // not stop the others in this pass.
      result.failed += 1;
    }
  }

  return result;
}
