import db from "../db.ts";
function schema() {
  db.exec("CREATE TABLE IF NOT EXISTS music_producer_setup (user_id INTEGER PRIMARY KEY, request_id TEXT NOT NULL, job_id TEXT, created_at INTEGER NOT NULL DEFAULT 0)");
  const columns = db.prepare("PRAGMA table_info(music_producer_setup)").all() as Array<{
    name: string;
  }>;
  if (!columns.some(column => column.name === "created_at"))
    db.exec("ALTER TABLE music_producer_setup ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0");
}
export function musicSetup(userId: number) {
  schema();
  return db.prepare("SELECT request_id, job_id, created_at FROM music_producer_setup WHERE user_id = ?").get(userId) as {
    request_id: string;
    job_id: string | null;
    created_at: number;
  } | undefined;
}
export function saveMusicSetup(userId: number, requestId: string, jobId: string | null) {
  schema();
  if (jobId)
    db.prepare("UPDATE music_producer_setup SET job_id=? WHERE user_id=? AND request_id=?").run(jobId, userId, requestId);
  else
    db.prepare("INSERT INTO music_producer_setup (user_id,request_id,job_id,created_at) VALUES (?,?,NULL,?) ON CONFLICT(user_id) DO UPDATE SET request_id=excluded.request_id, job_id=NULL, created_at=excluded.created_at").run(userId, requestId, Date.now());
}
/** Racing setup clicks converge on one native idempotency key. */
export function claimMusicSetup(userId: number, observedRequestId: string | null, requestId: string) {
  schema();
  return db.transaction(() => {
    const current = musicSetup(userId);
    if ((current?.request_id ?? null) !== observedRequestId)
      return current!.request_id;
    if (current && !current.job_id && Date.now() - current.created_at < 120000)
      return current.request_id;
    saveMusicSetup(userId, requestId, null);
    return requestId;
  })();
}
