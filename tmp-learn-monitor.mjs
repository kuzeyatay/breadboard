import { DatabaseSync } from "node:sqlite";

const [jobId, gardenId] = process.argv.slice(2);
if (!jobId || !gardenId) {
  throw new Error("Usage: node tmp-learn-monitor.mjs <jobId> <gardenId>");
}

const db = new DatabaseSync("dashboard/db/brain.db", { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const currentJob = db.prepare(`
  SELECT id, garden_id, model, status, mode, current_step, progress_percent,
         error, requires_replan, proposed_learning_map_id,
         active_elapsed_ms, timer_started_at, created_at, updated_at
  FROM learn_jobs
  WHERE id = ? AND garden_id = ?
`);
const latestJob = db.prepare(`
  SELECT id, status, mode, created_at
  FROM learn_jobs
  WHERE garden_id = ?
  ORDER BY rowid DESC
  LIMIT 1
`);
const terminal = new Set([
  "awaiting_confirmation",
  "complete",
  "failed",
  "cancelled",
]);
let previous = "";
let nextHealthAt = 0;

function isTransientSqliteContention(error) {
  return (
    error?.code === "ERR_SQLITE_ERROR" &&
    /database is (?:locked|busy)/i.test(String(error?.message ?? ""))
  );
}

async function readWithBusyRetry(read, label) {
  const retryDelaysMs = [250, 500, 1_000, 2_000, 4_000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return read();
    } catch (error) {
      if (!isTransientSqliteContention(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      const delayMs = retryDelaysMs[attempt];
      console.warn(JSON.stringify({
        at: new Date().toISOString(),
        monitorWarning: "sqlite_read_contention",
        label,
        attempt: attempt + 1,
        retryInMs: delayMs,
      }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

try {
  while (true) {
    const latest = await readWithBusyRetry(
      () => latestJob.get(gardenId),
      "latest_job",
    );
    if (!latest || latest.id !== jobId) {
      throw new Error(
        `Expected ${jobId} to remain latest; found ${latest?.id ?? "none"}`,
      );
    }
    const job = await readWithBusyRetry(
      () => currentJob.get(jobId, gardenId),
      "current_job",
    );
    if (!job) throw new Error(`Learn job ${jobId} disappeared`);
    const signature = JSON.stringify(job);
    if (signature !== previous) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...job }));
      previous = signature;
    }
    if (terminal.has(job.status)) {
      process.exitCode = job.status === "failed" ? 1 : 0;
      break;
    }
    if (Date.now() >= nextHealthAt) {
      const response = await fetch(
        "http://127.0.0.1:8765/v1/settings/model-health",
        { signal: AbortSignal.timeout(5_000) },
      );
      const health = await response.json();
      const availableAccounts = Array.isArray(health.accounts)
        ? health.accounts.filter((account) => account?.available === true).length
        : 0;
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        modelHealth: {
          httpStatus: response.status,
          servingModel: health.servingModel ?? null,
          availableAccounts,
        },
      }));
      nextHealthAt = Date.now() + 60_000;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
} finally {
  db.close();
}
