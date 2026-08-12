import type Database from "better-sqlite3";
import db from "../db.ts";

interface TerminalAuditRow {
  id: number;
  payload: string | null;
  created_at: string;
}

export interface CompletedTerminalCommand {
  auditEventId: number;
  runId: string;
  success: boolean;
  /** First token of the command, the only part the audit trail retains. */
  commandFamily: string | null;
  timestamp: string;
}

function isoTimestamp(value: string): string {
  const parsed = Date.parse(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();
}

function parseCompletedTerminalCommand(
  row: TerminalAuditRow,
): CompletedTerminalCommand | null {
  if (!row.payload) return null;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    if (typeof payload.runId !== "string" || !payload.runId) return null;
    return {
      auditEventId: row.id,
      runId: payload.runId,
      // A command that exited non-zero or hit its ceiling ran, but it did not
      // produce a result anything downstream may treat as established fact.
      success: payload.exitCode === 0 && payload.timedOut !== true,
      commandFamily:
        typeof payload.commandFamily === "string" && payload.commandFamily
          ? payload.commandFamily
          : null,
      timestamp: isoTimestamp(row.created_at),
    };
  } catch {
    return null;
  }
}

/**
 * Terminal commands this run actually finished, according to the server that
 * ran them.
 *
 * Breadboard executes this tool itself: the route authorizes the command, spawns
 * it, and records its exit status. The runtime's own `tool.complete` frame is a
 * separate report of the same fact, and it has been observed missing — every
 * approved command since 2026-07-26 completed with no tool event, which left
 * assistant messages recorded as having used no tools at all. Anything that
 * reasons about what a turn verified (the verification badge, and the resolver
 * that turns "delete them all" into concrete paths) then treats a real,
 * user-approved command as if it never happened. This is the first-party
 * record, so that reasoning no longer depends on the runtime echoing it back.
 */
export function listCompletedTerminalCommandsForRun(
  runtimeSessionId: number,
  runId: string,
  database: Database.Database = db,
): CompletedTerminalCommand[] {
  const rows = database
    .prepare(
      `SELECT id, payload, created_at
       FROM hermes_audit_events
       WHERE runtime_session_id = ?
         AND event_type = 'terminal.command_completed'
       ORDER BY id`,
    )
    .all(runtimeSessionId) as TerminalAuditRow[];
  return rows.flatMap((row) => {
    const parsed = parseCompletedTerminalCommand(row);
    return parsed && parsed.runId === runId ? [parsed] : [];
  });
}
