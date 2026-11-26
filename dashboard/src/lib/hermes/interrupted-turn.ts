import db from "../db.ts";
import type { RuntimeRunRow } from "./run-store.ts";

// Runs that only read or reason leave nothing on disk to inspect. Sending such
// a turn to "inspect the preserved files, artifacts and command/job status"
// made a pure-reasoning goal (P vs NP, 2026-11-26) spend 4 minutes and 738k
// tokens scanning folders, then report "this chat's workspace is empty" as if
// the chat were lost. Ask for that check only when the failed run changed
// something, and always carry forward the plan it had stated.
// Bookkeeping, reads and permission prompts. A command that ran, an MCP call or
// an artifact that was created or revised all count as changing something.
const READ_ONLY_RUN_EVENT = /^(?:goal_mode\.|run\.|session\.|message\.|conversation\.|task\.|watch\.|skill\.opened$|artifact\.tool\.artifact_(?:search|list|get|read)$|artifact\.required_missing$|connected_app\.tools_discovered$|terminal\.command_(?:authorized|permission_requested|denied)$)/;

export function interruptedTurnNote(
  run: Pick<RuntimeRunRow, "id" | "runtime_session_id" | "started_at" | "finished_at">,
  clientMessageId: string | undefined,
  conversationId: number,
  database: Pick<typeof db, "prepare"> = db,
): string {
  const events = database.prepare(`SELECT event_type FROM hermes_audit_events WHERE json_extract(payload, '$.runId')=?`)
    .all(run.id) as Array<{ event_type: string }>;
  // Workspace events carry no run id, so match them by session and time.
  const wroteFiles = database.prepare(`SELECT 1 FROM hermes_audit_events WHERE runtime_session_id=?
    AND event_type='workspace.tool_completed' AND json_extract(payload, '$.write') IN (1, 'true')
    AND julianday(created_at) BETWEEN julianday(?) AND julianday(COALESCE(?, 'now')) LIMIT 1`)
    .get(run.runtime_session_id, run.started_at, run.finished_at ?? null);
  const changedSomething = Boolean(wroteFiles) || events.some(event => !READ_ONLY_RUN_EVENT.test(event.event_type));
  const reply = clientMessageId
    ? database.prepare(`SELECT json_extract(metadata, '$.progressNotes') notes FROM conversation_messages
        WHERE conversation_id=? AND client_message_id=? AND role='assistant' ORDER BY id DESC LIMIT 1`)
        .get(conversationId, clientMessageId) as { notes: string | null } | undefined
    : undefined;
  let plan = "";
  try {
    const notes: unknown = JSON.parse(reply?.notes ?? "[]");
    if (Array.isArray(notes)) {
      plan = String(notes.filter(note => typeof note === "string" && note.trim()).at(-1) ?? "").trim();
    }
  } catch { /* no saved plan */ }
  const lastPlan = plan ? ` Its last stated plan was: "${plan.slice(0, 600)}"` : "";
  return changedSomething
    ? "The previous runtime turn was interrupted after it had run commands or saved work. Inspect what it saved (files, artifacts, command or job status) before doing more. Resume from verified progress; do not repeat a completed experiment, download, publication or other side effect merely because its response was interrupted." + lastPlan
    : "The previous runtime turn was interrupted before it saved anything: it ran no commands and wrote no files, so there is nothing on disk to inspect and nothing is missing. This conversation's earlier answers are the record of progress; continue from them." + lastPlan;
}
