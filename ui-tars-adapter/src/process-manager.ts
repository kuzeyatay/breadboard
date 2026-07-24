// Browser process ownership + cleanup.
//
// The adapter tracks exactly which OS processes it launched (per run) in a
// durable registry file under the data dir, so it can (a) kill them on abort /
// shutdown and (b) reap orphans on startup when ownership is provable (the pid
// we recorded is still alive AND was recorded by us).

import fs from "node:fs";
import path from "node:path";

interface OwnedProcess {
  runId: string;
  pid: number;
  profileDir: string;
  startedAt: string;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = not found; EPERM = exists but not ours (still "alive").
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function killPid(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export class ProcessManager {
  private registryPath: string;
  private owned = new Map<string, OwnedProcess>(); // runId -> process

  constructor(sessionsDir: string) {
    this.registryPath = path.join(sessionsDir, "owned-processes.json");
    fs.mkdirSync(sessionsDir, { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.registryPath, "utf8");
      const arr = JSON.parse(raw) as OwnedProcess[];
      for (const p of arr) this.owned.set(p.runId, p);
    } catch {
      // no registry yet
    }
  }

  private persist(): void {
    const arr = [...this.owned.values()];
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify(arr), "utf8");
    } catch {
      // best effort — never throw from bookkeeping
    }
  }

  /** Record a launched browser process as owned by a run. */
  register(runId: string, pid: number, profileDir: string): void {
    this.owned.set(runId, { runId, pid, profileDir, startedAt: new Date().toISOString() });
    this.persist();
  }

  ownedPid(runId: string): number | undefined {
    return this.owned.get(runId)?.pid;
  }

  /** Kill the browser owned by a run and forget it. Also removes its profile. */
  killRun(runId: string): void {
    const proc = this.owned.get(runId);
    if (!proc) return;
    if (isAlive(proc.pid)) killPid(proc.pid);
    this.owned.delete(runId);
    this.persist();
    // Remove the isolated profile directory (best effort).
    try {
      fs.rmSync(proc.profileDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  /**
   * On startup, reap any recorded process that is still alive (proven-owned
   * orphan from a crash) and clear the registry.
   */
  reapOrphans(): number {
    let reaped = 0;
    for (const proc of this.owned.values()) {
      if (isAlive(proc.pid)) {
        killPid(proc.pid);
        reaped += 1;
      }
      try {
        fs.rmSync(proc.profileDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    this.owned.clear();
    this.persist();
    return reaped;
  }

  /** Kill everything we own — for graceful/forced adapter shutdown. */
  killAll(): void {
    for (const proc of [...this.owned.values()]) this.killRun(proc.runId);
  }
}
