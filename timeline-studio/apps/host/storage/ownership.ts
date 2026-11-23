import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HostError } from "../sessions.ts";
import { type ProjectFiles, StorageIOError } from "./files.ts";

const ownerSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: z.string().min(1).max(256),
  instanceId: z.string().uuid(), pid: z.number().int().positive(), startedAt: z.iso.datetime(),
  nonce: z.string().uuid(), released: z.boolean() });
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

export async function claimProject(files: ProjectFiles, projectId: string, instanceId: string, onLost: () => void) {
  await files.mkdir("locks");
  const path = "locks/project-write.lock";
  let expected = "";
  try {
    expected = (await files.read(path, 4096)).toString("utf8");
    const previous = expected.length ? ownerSchema.parse(JSON.parse(expected)) : null;
    if (previous && previous.projectId !== projectId) throw new Error("Owner project mismatch.");
    if (previous && !previous.released && previous.pid !== process.pid) {
      // PID alone never permits takeover: the native kernel lock and exact owner bytes
      // must also match after acquisition. A reused/alive PID is conservatively refused.
      try { process.kill(previous.pid, 0); throw new Error("Owner is still alive."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  } catch (error) {
    if (error instanceof StorageIOError && error.errno !== 2) throw new HostError("PROJECT_OWNER_UNAVAILABLE", 503, "Project ownership could not be verified; retry without rolling back the project.");
    if (!(error instanceof StorageIOError && error.errno === 2)) {
      throw new HostError("PROJECT_WRITE_LOCKED", 409, "The previous project owner cannot be safely released.");
    }
  }
  const owner = ownerSchema.parse({ schemaVersion: 1, projectId, instanceId, pid: process.pid, startedAt,
    nonce: randomUUID(), released: false });
  try {
    return await files.lock(path, { expected, active: JSON.stringify(owner), released: JSON.stringify({ ...owner, released: true }) }, onLost);
  } catch (error) {
    if (error instanceof StorageIOError && ![11, 22, 35, 70, 116].includes(error.errno ?? -1)) throw new HostError("PROJECT_OWNER_UNAVAILABLE", 503, "Project ownership could not be acquired; retry without rolling back the project.");
    throw new HostError("PROJECT_WRITE_LOCKED", 409, "The project is locked or ownership changed during acquisition.");
  }
}
