import type Database from "better-sqlite3";
import db from "../db.ts";

interface MemorySaveAuditRow {
  id: number;
  payload: string | null;
  created_at: string;
}

interface RuntimeRunDispatchRow {
  id: string;
  dispatch_json: string;
}

export interface SuccessfulMemorySave {
  auditEventId: number;
  runId: string;
  timestamp: string;
}

function parseSuccessfulMemorySave(
  row: MemorySaveAuditRow,
): SuccessfulMemorySave | null {
  if (!row.payload) return null;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    if (
      payload.saved !== true ||
      typeof payload.runId !== "string" ||
      !payload.runId
    ) {
      return null;
    }
    const parsedTimestamp = Date.parse(
      row.created_at.includes("T")
        ? row.created_at
        : `${row.created_at.replace(" ", "T")}Z`,
    );
    return {
      auditEventId: row.id,
      runId: payload.runId,
      timestamp: Number.isFinite(parsedTimestamp)
        ? new Date(parsedTimestamp).toISOString()
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function successfulMemorySavesForSession(
  runtimeSessionId: number,
  database: Database.Database,
): SuccessfulMemorySave[] {
  const rows = database
    .prepare(
      `SELECT id, payload, created_at
       FROM hermes_audit_events
       WHERE runtime_session_id = ?
         AND event_type = 'memory.tool.save_memory'
       ORDER BY id`,
    )
    .all(runtimeSessionId) as MemorySaveAuditRow[];
  return rows.flatMap((row) => {
    const parsed = parseSuccessfulMemorySave(row);
    return parsed ? [parsed] : [];
  });
}

/**
 * The memory tool endpoint is the authority for whether a durable write
 * succeeded. Runtime tool-progress events are presentation data and can be
 * absent after a reconnect or when the upstream runtime hides tool chrome.
 */
export function listSuccessfulMemorySavesForRun(
  runtimeSessionId: number,
  runId: string,
  database: Database.Database = db,
): SuccessfulMemorySave[] {
  return successfulMemorySavesForSession(runtimeSessionId, database).filter(
    (save) => save.runId === runId,
  );
}

/**
 * Resolve successful memory writes back to their canonical conversation turn
 * so restored transcripts retain the same badge as the live response.
 */
export function memoryUpdatedClientMessageIdsForSession(
  runtimeSessionId: number,
  database: Database.Database = db,
): Set<string> {
  const successfulRunIds = new Set(
    successfulMemorySavesForSession(runtimeSessionId, database).map(
      (save) => save.runId,
    ),
  );
  if (successfulRunIds.size === 0) return new Set();

  const rows = database
    .prepare(
      `SELECT id, dispatch_json
       FROM hermes_runs
       WHERE runtime_session_id = ?`,
    )
    .all(runtimeSessionId) as RuntimeRunDispatchRow[];
  const clientMessageIds = new Set<string>();
  for (const row of rows) {
    if (!successfulRunIds.has(row.id)) continue;
    try {
      const dispatch = JSON.parse(row.dispatch_json) as Record<string, unknown>;
      if (
        typeof dispatch.clientMessageId === "string" &&
        dispatch.clientMessageId
      ) {
        clientMessageIds.add(dispatch.clientMessageId);
      }
    } catch {
      // Ignore malformed legacy run metadata.
    }
  }
  return clientMessageIds;
}
