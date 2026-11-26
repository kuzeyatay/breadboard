/**
 * SQL condition for a pending reply that still holds its chat. A reply is live
 * while its chat has an active run (a question or approval keeps the run
 * active while it waits), or while it changed recently (dispatch is starting,
 * or live progress is still being written).
 *
 * A pending row with neither is an orphan from a crash or restart. Five chats
 * held one for days to two months, and each silently blocked automatic
 * recovery and Goal continuation in that chat for good.
 */
export function livePendingReplySql(alias: string): string {
  return `${alias}.status = 'pending' AND (
    julianday(${alias}.updated_at) > julianday('now', '-30 minutes')
    OR EXISTS (
      SELECT 1 FROM hermes_runs live_run
      JOIN hermes_runtime_sessions live_session ON live_session.id = live_run.runtime_session_id
      WHERE live_session.conversation_id = ${alias}.conversation_id AND live_run.status = 'active'
    )
  )`;
}
