import db from "../db.ts";
import type { SwarmInvocation } from "./invocation.ts";

/** Freeze validated settings before admission. A retry cannot silently pick up
 * different preferences or issue the same idempotency key with another body. */
export function freezeSwarmRuntimePayload(invocation: SwarmInvocation, payload: unknown): unknown {
  db.exec(`CREATE TABLE IF NOT EXISTS swarm_runtime_payloads (
    request_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL, payload_json TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS swarm_delete_payloads AFTER DELETE ON conversations
      BEGIN DELETE FROM swarm_runtime_payloads WHERE conversation_id=OLD.public_id; END;`);
  // Worker request schemas are exact. Ownership is carried beside the payload,
  // never smuggled in as an extra field a worker validator would reject.
  const normalized = payload;
  db.prepare(`INSERT OR IGNORE INTO swarm_runtime_payloads VALUES (?,?,?,?,?)`).run(
    invocation.requestId, invocation.userId, invocation.agentId, invocation.conversationPublicId, JSON.stringify(normalized));
  const row = db.prepare("SELECT * FROM swarm_runtime_payloads WHERE request_id=?").get(invocation.requestId) as {
    user_id: number; agent_id: string; conversation_id: string; payload_json: string };
  if (row.user_id !== invocation.userId || row.agent_id !== invocation.agentId || row.conversation_id !== invocation.conversationPublicId) {
    throw new Error("Team runtime request belongs to a different scope.");
  }
  return JSON.parse(row.payload_json);
}
