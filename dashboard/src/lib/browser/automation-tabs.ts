import db from "../db.ts";
import { isAgentBrowserRunFinished } from "../agent-browser/run-manager.ts";

/** Return affirmative terminal records only, scoped to the desktop's account. */
export async function finishedAutomationTabOwners(userId: number, owners: string[]): Promise<string[]> {
  const results = await Promise.all(owners.map(async owner => {
    if (/^job_[0-9a-f]{64}$/.test(owner)) {
      // One unavailable worker must not delay cleanup for other finished tasks.
      return await isAgentBrowserRunFinished(userId, owner).catch(() => false) ? owner : null;
    }
    let identity: unknown;
    try { identity = JSON.parse(owner); } catch { return null; }
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(value => typeof value === "string" && value.length > 0 && value.length <= 256)) return null;
    const [sessionId, runId] = identity as [string, string];
    const run = db.prepare(`SELECT r.status FROM hermes_runs r
      JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
      WHERE r.id = ? AND r.runtime_session_id = ? AND s.user_id = ?`).get(runId, sessionId, userId) as { status: string } | undefined;
    return run && ["completed", "cancelled", "error"].includes(run.status) ? owner : null;
  }));
  return results.filter((owner): owner is string => owner !== null);
}
