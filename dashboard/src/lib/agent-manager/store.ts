import db from "../db.ts";

export interface AgentManagerSetupRecord { agent_id: string; action_id: string; request_id: string; job_id: string | null; created_at: number }
function schema() {
  db.exec("CREATE TABLE IF NOT EXISTS agent_manager_setup (user_id INTEGER NOT NULL, agent_id TEXT NOT NULL, action_id TEXT NOT NULL, request_id TEXT NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,agent_id))");
}
export function managerSetup(userId: number, agentId: string): AgentManagerSetupRecord | undefined {
  schema();
  return db.prepare("SELECT agent_id,action_id,request_id,job_id,created_at FROM agent_manager_setup WHERE user_id=? AND agent_id=?").get(userId, agentId) as AgentManagerSetupRecord | undefined;
}
export function managerSetups(userId: number): AgentManagerSetupRecord[] {
  schema();
  return db.prepare("SELECT agent_id,action_id,request_id,job_id,created_at FROM agent_manager_setup WHERE user_id=?").all(userId) as AgentManagerSetupRecord[];
}
export function claimManagerSetup(userId: number, agentId: string, actionId: string, observed: string | null, requestId: string): AgentManagerSetupRecord {
  schema();
  return db.transaction(() => {
    const current = managerSetup(userId, agentId);
    if ((current?.request_id ?? null) !== observed || (current && !current.job_id && Date.now() - current.created_at < 120000)) return current!;
    db.prepare("INSERT INTO agent_manager_setup (user_id,agent_id,action_id,request_id,job_id,created_at) VALUES (?,?,?,?,NULL,?) ON CONFLICT(user_id,agent_id) DO UPDATE SET action_id=excluded.action_id,request_id=excluded.request_id,job_id=NULL,created_at=excluded.created_at").run(userId, agentId, actionId, requestId, Date.now());
    return managerSetup(userId, agentId)!;
  })();
}
export function saveManagerJob(userId: number, agentId: string, requestId: string, jobId: string): void {
  schema();
  db.prepare("UPDATE agent_manager_setup SET job_id=? WHERE user_id=? AND agent_id=? AND request_id=?").run(jobId, userId, agentId, requestId);
}
