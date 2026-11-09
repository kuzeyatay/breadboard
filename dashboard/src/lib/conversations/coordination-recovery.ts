import type Database from "better-sqlite3";

const RECOVERY_PATH = "/api/internal/chat-coordination-recovery";

/** Hand off persisted conversation work through the server's route boundary. Instrumentation
 * must not import the entire turn/tool pipeline (or trace its runtime data as
 * program assets). Only an unfinished outbox or team starts this finite retry. */
export async function recoverPendingChatMessages(db: Database.Database): Promise<void> {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_agent_messages'").get();
  const pending = exists && db.prepare("SELECT 1 FROM chat_agent_messages WHERE status IN ('queued','dispatching','running') LIMIT 1").get();
  const teamsExist = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'swarm_runs'").get();
  const pendingTeam = teamsExist && db.prepare("SELECT 1 FROM swarm_runs WHERE status NOT IN ('completed','cancelled','failed') LIMIT 1").get();
  if (!pending && !pendingTeam) return;
  await requestChatRecovery();
}

export async function requestChatRecovery(options: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<void> {
  const env = options.env ?? process.env;
  const secret = env.BREADBOARD_HERMES_TOOL_SECRET?.trim() || env.HERMES_TOOL_SECRET?.trim();
  if (!secret) throw new Error("Chat recovery service authentication is not configured.");
  const base = new URL(env.BREADBOARD_INTERNAL_URL?.trim() || `http://127.0.0.1:${env.PORT || "3000"}`);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) {
    throw new Error("Chat recovery requires the local dashboard URL.");
  }
  // Not `new URL(path, base)`: Turbopack's tracer reads that as an asset
  // reference and traces the whole dashboard (db, artifacts) into instrumentation.
  const url = `${base.origin}${RECOVERY_PATH}`;
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + Math.min(30_000, Math.max(1, options.timeoutMs ?? 30_000));
  do {
    let response: Response | undefined;
    try {
      response = await fetcher(url, { method: "POST", redirect: "error",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now()))),
      });
    } catch { /* The startup listener may not be ready yet. */ }
    if (response) {
      const accepted = response.status === 202;
      await response.body?.cancel();
      if (accepted) return;
      // An unavailable/compiling route can become ready. Bad credentials or a
      // rejected request cannot: keep the queue durable without retrying them.
      if (![404, 408, 429, 500, 502, 503, 504].includes(response.status)) break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)));
  } while (Date.now() < deadline);
  throw new Error("Chat recovery was deferred because the local dashboard did not accept the handoff.");
}
