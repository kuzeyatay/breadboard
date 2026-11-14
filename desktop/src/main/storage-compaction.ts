import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readStorageCompaction, writeStorageCompaction } from "../shared/storage-compaction";

export interface CompactionHost {
  dataRoot: string; appRoot: string; runtimeRoot: string; binDir: string;
  idle(): boolean;
  quiesce(): Promise<{ workers: number; leases: number }>;
  resume(): Promise<void>;
  stop(): Promise<boolean>;
  restart(): Promise<void>;
}

/** A separately requested maintenance window. Services are stopped before the
 * native exclusive-generation owner can touch any database. */
export async function runRequestedStorageCompaction(host: CompactionHost): Promise<void> {
  const state = readStorageCompaction(host.dataRoot);
  if (!state || state.phase === "complete" || (state.retryAfter ?? 0) > Date.now() || !host.idle()) return;
  const defer = (detail: string) => writeStorageCompaction(host.dataRoot, { ...state, phase: "deferred", detail, retryAfter: Date.now() + 3_600_000 });
  const volume = await fs.promises.statfs(host.dataRoot);
  if (volume.bavail * volume.bsize < 2 * 1024 ** 3) { defer("Waiting for at least 2 GiB free, plus room for a verified database replacement."); return; }
  let stopped = false, quiesced = false;
  try {
    const quiet = await host.quiesce(); quiesced = true;
    if (quiet.workers || quiet.leases || !host.idle()) { defer("Waiting for active work and recovery leases to finish."); return; }
    writeStorageCompaction(host.dataRoot, { ...state, phase: "running", retryAfter: undefined });
    stopped = await host.stop();
    if (!stopped) throw new Error("The runtime has not exited; databases were left untouched.");
    const result = await new Promise<{ bytesReleased: number; deferred: string[] }>((resolve, reject) => {
      const child = spawn(path.join(host.binDir, "breadboard-runtime.exe"), ["--storage-compact", host.dataRoot, host.appRoot, host.runtimeRoot],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", failure = "", interrupted = false;
      const abort = () => { interrupted = true; child.kill(); };
      const idle = setInterval(() => { if (!host.idle()) abort(); }, 250);
      const timeout = setTimeout(abort, 30 * 60_000);
      child.stdout.on("data", chunk => { output += chunk; if (output.length > 64 * 1024) abort(); });
      child.stderr.on("data", chunk => { failure = (failure + chunk).slice(-4096); });
      const clear = () => { clearInterval(idle); clearTimeout(timeout); };
      child.once("error", error => { clear(); reject(error); });
      child.once("close", code => {
        clear();
        if (interrupted) { reject(new Error("Compaction interrupted; the recoverable swap will be checked on restart.")); return; }
        if (code !== 0) { reject(new Error(failure || "Compaction did not complete.")); return; }
        try {
          const value = JSON.parse(output);
          if (!Number.isSafeInteger(value.bytesReleased) || !Array.isArray(value.deferred)) throw new Error("Invalid compaction receipt");
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    writeStorageCompaction(host.dataRoot, { ...state, phase: result.deferred.length ? "deferred" : "complete",
      bytesReleased: result.bytesReleased, finishedAt: Date.now(), detail: result.deferred.join("; ").slice(0, 3000), retryAfter: Date.now() + 3_600_000 });
  } catch (error) { defer(error instanceof Error ? error.message : "Compaction deferred."); }
  finally { if (stopped) await host.restart(); else if (quiesced) await host.resume(); }
}
