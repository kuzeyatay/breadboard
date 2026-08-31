import "server-only";

// Cleaning up what a restart left behind, once per process.
//
// A dashboard that goes down mid-demonstration leaves rows claiming to be
// recording and runs claiming to be driving the machine, and both are lies the
// moment the process that owned them is gone. Nothing else will notice: there is
// no supervisor watching these tables.
//
// So the first request that touches teaching settles them. Recording sessions
// end, live runs stop, and a demonstration that was only part-way through being
// analysed is analysed again -- its recording is on disk and its transcript was
// already written, so resuming costs nothing the user has to sit through twice.

import { teachWarn } from "./redaction.ts";
import { recoverOrphanedRuns } from "./replay.ts";
import { recoverOrphanedSessions } from "./session-manager.ts";

export interface TeachRecoveryResult {
  sessionsClosed: number;
  sessionsResumed: number;
  runsClosed: number;
}

/**
 * Run recovery once for the lifetime of this process.
 *
 * On `globalThis` rather than a module-level flag: Next gives each route bundle
 * its own module instance in development, and recovery that ran per bundle would
 * fight itself over the same rows.
 */
export function ensureTeachRecovery(): TeachRecoveryResult | null {
  const holder = globalThis as typeof globalThis & {
    __breadboardTeachRecovered?: TeachRecoveryResult;
  };
  if (holder.__breadboardTeachRecovered) return holder.__breadboardTeachRecovered;

  try {
    const sessions = recoverOrphanedSessions();
    const runs = recoverOrphanedRuns();
    const result: TeachRecoveryResult = {
      sessionsClosed: sessions.closed,
      sessionsResumed: sessions.resumed,
      runsClosed: runs.closed,
    };
    holder.__breadboardTeachRecovered = result;
    return result;
  } catch (error) {
    // Recovery is housekeeping. A request that cannot clean up after a previous
    // process still has its own work to do, and failing it would make a restart
    // look like a broken feature.
    teachWarn("recovery", "could not settle what a restart left behind", {
      message: (error as Error).message,
    });
    return null;
  }
}
