import type Database from "better-sqlite3";
import type { SwarmAuthority } from "./types.ts";
import { SwarmError } from "./types.ts";

/** Resolve the real originating assistant for a runtime-owned team artifact.
 * Rechecked inside publication so Stop fences facades as well as child chats. */
export function swarmRuntimeArtifactOwner(input: { userId: number; requestId: string; conversationPublicId: string; agentId: string }, db: Database.Database) {
  const row = db.prepare(`SELECT a.id AS attempt_id,a.status,r.id AS run_id,r.status AS team_status,r.authority_json,
    c.id AS conversation_id,c.user_id,c.public_id
    FROM swarm_attempts a JOIN swarm_runs r ON r.id=a.run_id
    JOIN swarm_tasks t ON t.run_id=a.run_id AND t.task_key=a.task_key AND t.active_attempt_id=a.id
    JOIN conversations c ON c.id=r.conversation_id AND c.user_id=r.user_id
    WHERE a.request_id=? AND r.user_id=? AND c.public_id=? AND c.archived_at IS NULL
      AND json_extract(t.spec_json,'$.executor.kind')='runtime' AND json_extract(t.spec_json,'$.executor.id')=?`)
    .get(input.requestId,input.userId,input.conversationPublicId,input.agentId) as {
      attempt_id: string; status: string; run_id: string; team_status: string; authority_json: string;
      conversation_id: number; user_id: number; public_id: string } | undefined;
  if (!row || !["starting", "running", "verifying"].includes(row.status) ||
    !["running", "paused", "verifying", "budget_limited", "awaiting_input"].includes(row.team_status)) {
    throw new SwarmError("swarm_artifact_scope", "This assignment can no longer publish an artifact.", 409);
  }
  const authority = JSON.parse(row.authority_json) as SwarmAuthority;
  if (authority.userId !== input.userId || authority.conversationId !== row.conversation_id ||
    authority.conversationPublicId !== input.conversationPublicId) throw new SwarmError("swarm_artifact_scope", "Invalid team artifact owner.", 403);
  const origin = db.prepare("SELECT id FROM conversation_messages WHERE conversation_id=? AND client_message_id=? AND role='assistant'")
    .get(row.conversation_id,authority.originClientMessageId) as {id: number} | undefined;
  if (!origin) throw new SwarmError("swarm_artifact_scope", "The team's originating assistant message is unavailable.", 409);
  return { runId: row.run_id, attemptId: row.attempt_id, assistantMessageId: origin.id };
}

interface ArtifactOwner { userId: number; conversationId: number; runtimeSessionId: number; hermesSessionId: string;
  clusterId: number | null; runId: string; assistantMessageId: number | null; surface: "dashboard_terminal" | "garden_chat";
  metadata?: Record<string, unknown> }

/** Worker files are published into the requesting chat. Keep the real worker
 * identity as provenance, while the ordinary artifact store still validates
 * ownership, bytes, versions and rendering. No personal memory is created. */
export function swarmArtifactOwner<T extends ArtifactOwner>(input: T, db: Database.Database): T {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='swarm_worker_chats' AND type='table'").get()) return input;
  const assignment = db.prepare(`SELECT a.id AS attempt_id,a.status,r.id AS run_id,r.authority_json,r.status AS team_status
    FROM swarm_worker_chats w JOIN swarm_attempts a ON a.id=w.attempt_id JOIN swarm_runs r ON r.id=a.run_id
    WHERE w.conversation_id=?`).get(input.conversationId) as {
      attempt_id: string; status: string; run_id: string; authority_json: string; team_status: string } | undefined;
  if (!assignment) return input;
  const authority = JSON.parse(assignment.authority_json) as SwarmAuthority;
  const owner = db.prepare(`SELECT c.user_id,c.surface,c.default_garden_id,s.external_session_id,s.hermes_session_id
    FROM conversations c JOIN hermes_runtime_sessions s ON s.conversation_id=c.id AND s.id=? WHERE c.id=? AND c.archived_at IS NULL`)
    .get(authority.runtimeSessionId, authority.conversationId) as { user_id: number; surface: ArtifactOwner["surface"]; default_garden_id: number | null; external_session_id: string | null; hermes_session_id: string | null } | undefined;
  const worker = db.prepare("SELECT 1 FROM hermes_runtime_sessions WHERE id=? AND user_id=? AND conversation_id=?")
    .get(input.runtimeSessionId, input.userId, input.conversationId);
  if (!owner || !worker || authority.userId !== input.userId || owner.user_id !== input.userId ||
    !["starting", "running", "verifying"].includes(assignment.status) || ["cancelling", "cancelled", "failed"].includes(assignment.team_status)) {
    throw new SwarmError("swarm_artifact_scope", "This assignment can no longer publish an artifact.", 409);
  }
  const origin = db.prepare("SELECT id FROM conversation_messages WHERE conversation_id=? AND client_message_id=? AND role='assistant'")
    .get(authority.conversationId, authority.originClientMessageId) as { id: number } | undefined;
  return { ...input, conversationId: authority.conversationId, runtimeSessionId: authority.runtimeSessionId,
    hermesSessionId: owner.external_session_id ?? owner.hermes_session_id ?? input.hermesSessionId,
    clusterId: owner.surface === "garden_chat" ? owner.default_garden_id : null, surface: owner.surface,
    runId: authority.sourceRunId, assistantMessageId: origin?.id ?? null,
    metadata: { ...input.metadata, swarm: { runId: assignment.run_id, attemptId: assignment.attempt_id,
      workerConversationId: input.conversationId, workerRuntimeSessionId: input.runtimeSessionId, workerRunId: input.runId } } };
}
