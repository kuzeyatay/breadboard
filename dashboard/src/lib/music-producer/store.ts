import db from "../db.ts";
export interface MusicLaunch {
  id: string;
  user_id: number;
  conversation_public_id: string;
  client_message_id: string;
  runtime_job_id: string | null;
  task: string;
  request_json: string | null;
  provider_receipt: string | null;
  collection_state: string;
  provider_state: string;
  artifact_id: string | null;
  artifact_version: number | null;
  summary: string;
  launch_json: string;
  provider_json: string;
  context_json: string | null;
  created_at: number;
  attempts: number;
}
let ready = false;
function schema() {
  if (ready)
    return;
  db.exec(`CREATE TABLE IF NOT EXISTS music_producer_launches (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, conversation_public_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL, runtime_job_id TEXT, task TEXT NOT NULL,
    request_json TEXT, provider_receipt TEXT, collection_state TEXT NOT NULL DEFAULT 'queued',
    provider_state TEXT NOT NULL DEFAULT 'not-submitted', artifact_id TEXT, artifact_version INTEGER,
    summary TEXT NOT NULL DEFAULT '', launch_json TEXT NOT NULL DEFAULT '{}', provider_json TEXT NOT NULL DEFAULT '{}',
    context_json TEXT, created_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, conversation_public_id, client_message_id)
  )`);
  const columns = db.prepare("PRAGMA table_info(music_producer_launches)").all() as Array<{
    name: string;
  }>;
  for (const [name, definition] of Object.entries({ launch_json: "TEXT NOT NULL DEFAULT '{}'", provider_json: "TEXT NOT NULL DEFAULT '{}'", context_json: "TEXT", created_at: "INTEGER NOT NULL DEFAULT 0", attempts: "INTEGER NOT NULL DEFAULT 0" })) {
    if (!columns.some(column => column.name === name))
      db.exec(`ALTER TABLE music_producer_launches ADD COLUMN ${name} ${definition}`);
  }
  ready = true;
  recoverMusicArtifactRuns();
}
/** Release provenance-only locks left by music launch failures before this fix. */
export function recoverMusicArtifactRuns(): void {
  schema();
  db.prepare(`
    UPDATE hermes_runs AS run
    SET status = CASE
          WHEN EXISTS (SELECT 1 FROM hermes_artifacts artifact WHERE artifact.originating_run_id = run.id)
          THEN 'completed' ELSE 'error' END,
        finished_at = ?
    WHERE run.status = 'active' AND EXISTS (
      SELECT 1 FROM music_producer_launches launch
      JOIN conversations conversation ON conversation.public_id = launch.conversation_public_id
        AND conversation.user_id = launch.user_id
      JOIN hermes_runtime_sessions session ON session.conversation_id = conversation.id
      WHERE launch.collection_state IN ('completed', 'failed', 'aborted', 'uncertain')
        AND session.id = run.runtime_session_id
        AND run.id = json_extract(CASE WHEN json_valid(launch.context_json) THEN launch.context_json ELSE '{}' END, '$.runId')
        AND run.runtime_session_id = json_extract(CASE WHEN json_valid(launch.context_json) THEN launch.context_json ELSE '{}' END, '$.runtimeSessionId')
    )
  `).run(new Date().toISOString());
}
export function musicLaunch(userId: number, id: string): MusicLaunch {
  schema();
  const row = db.prepare("SELECT * FROM music_producer_launches WHERE id = ? AND user_id = ?").get(id, userId) as MusicLaunch | undefined;
  if (!row)
    throw new Error("run_not_found");
  return row;
}
export function createMusicLaunch(input: {
  id: string;
  userId: number;
  conversationPublicId: string;
  clientMessageId: string;
  task: string;
  launchJson?: string;
}): boolean {
  schema();
  return db.prepare("INSERT OR IGNORE INTO music_producer_launches (id,user_id,conversation_public_id,client_message_id,task,launch_json,created_at) VALUES (?,?,?,?,?,?,?)").run(input.id, input.userId, input.conversationPublicId, input.clientMessageId, input.task, input.launchJson ?? '{}', Date.now()).changes === 1;
}
export function updateMusicLaunch(userId: number, id: string, values: Partial<Pick<MusicLaunch, "runtime_job_id" | "request_json" | "provider_receipt" | "collection_state" | "provider_state" | "artifact_id" | "artifact_version" | "summary" | "launch_json" | "provider_json" | "context_json" | "created_at" | "attempts">>) {
  const keys = Object.keys(values);
  const allowed = ["runtime_job_id", "request_json", "provider_receipt", "collection_state", "provider_state", "artifact_id", "artifact_version", "summary", "launch_json", "provider_json", "context_json", "created_at", "attempts"];
  if (!keys.length || keys.some(key => !allowed.includes(key)))
    throw new Error("invalid_music_state_update");
  schema();
  db.prepare(`UPDATE music_producer_launches SET ${keys.map(key => `${key} = ?`).join(",")} WHERE id = ? AND user_id = ?`).run(...Object.values(values), id, userId);
}
