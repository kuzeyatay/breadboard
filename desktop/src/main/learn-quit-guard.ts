import * as fs from "node:fs";
import * as path from "node:path";

/** Gardens a Learn run holds right now. Its lock stays valid while the worker
 * process lives (heartbeats can be minutes apart), so a live PID or a recent
 * heartbeat both count. */
export function activeLearnGardens(dataRoot: string, now = Date.now()): string[] {
  const contentDir = path.join(dataRoot, "quartz", "content");
  let names: string[];
  try {
    names = fs.readdirSync(contentDir);
  } catch {
    return [];
  }
  const gardens: string[] = [];
  for (const name of names) {
    const match = /^\.(.+)\.learn-build\.lock\.json$/.exec(name);
    if (!match) continue;
    try {
      const lock = JSON.parse(fs.readFileSync(path.join(contentDir, name), "utf8")) as {
        heartbeatAt?: string;
        processId?: number;
      };
      let alive = false;
      if (Number.isSafeInteger(lock.processId) && Number(lock.processId) > 0) {
        try {
          process.kill(Number(lock.processId), 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive || now - Date.parse(lock.heartbeatAt ?? "") < 10 * 60_000) gardens.push(match[1]!);
    } catch {
      // A lock caught mid-write is not proof of a run.
    }
  }
  return gardens;
}
