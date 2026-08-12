import fs from "node:fs";
import path from "node:path";

/**
 * The Voicebox setup status protocol.
 *
 * Settings can only see this one file while a multi-gigabyte install runs, so
 * every writer must heartbeat and record its pid: that is what lets a reader
 * tell "still downloading torch" from "was killed an hour ago". Owning it here
 * keeps the launcher and the installer honest about the same contract.
 */

/** Phases that are an outcome; their timestamp is meant to stand still. */
export const SETTLED_PHASES = new Set([
  "ready",
  "installed",
  "error",
  "stopped",
  "interrupted",
]);

export const HEARTBEAT_MS = 5_000;

const RENAME_RETRIES = 3;
const RENAME_BACKOFF_MS = 50;
const TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY", "ENOENT"]);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function createStatusWriter(statusPath, seed = {}) {
  const state = {
    phase: "preparing",
    message: "",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    ...seed,
  };
  let heartbeat = null;

  function persist() {
    state.updatedAt = new Date().toISOString();
    const payload = JSON.stringify(state);
    // A status update is never worth failing an install over: OneDrive and
    // antivirus scanners hold the destination open just long enough to make
    // the atomic rename fail, and the next heartbeat carries the same state
    // anyway.
    try {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      const temporary = `${statusPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, payload, "utf8");
      for (let attempt = 0; attempt <= RENAME_RETRIES; attempt += 1) {
        try {
          fs.renameSync(temporary, statusPath);
          return;
        } catch (error) {
          const transient = TRANSIENT_CODES.has(error?.code);
          if (!transient || attempt === RENAME_RETRIES) {
            fs.rmSync(temporary, { force: true });
            fs.writeFileSync(statusPath, payload, "utf8");
            return;
          }
          sleep(RENAME_BACKOFF_MS);
        }
      }
    } catch {
      // Reported again on the next heartbeat.
    }
  }

  function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(persist, HEARTBEAT_MS);
    heartbeat.unref();
  }

  function stopHeartbeat() {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }

  /** Set the phase; heartbeat while it is work, stand still once it is done. */
  function write(phase, message, extra = {}) {
    Object.assign(state, { phase, message }, extra);
    persist();
    if (SETTLED_PHASES.has(phase)) stopHeartbeat();
    else startHeartbeat();
  }

  return { state, persist, write, startHeartbeat, stopHeartbeat };
}
