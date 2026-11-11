import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { getVideoTranscriptionStore } from "./scriberr/instance";

/**
 * Recordings kept at their original path often sit on an external drive that
 * spins down when idle. The first read after that waits for the platters: a
 * plain directory listing of such a drive took 4.6 s, and so did the first
 * video opened in Breadboard. Opening a garden that has such recordings reads
 * one byte from one of them in the background, so the drive is already turning
 * by the time a video is clicked. Nothing waits on it, and a missing drive or
 * file is simply ignored.
 */
const WAKE_INTERVAL_MS = 2 * 60_000;
const lastWake = new Map<number, number>();

export function wakeGardenMediaDrive(clusterId: number, userId: number): void {
  const now = Date.now();
  if (now - (lastWake.get(clusterId) ?? 0) < WAKE_INTERVAL_MS) return;
  lastWake.set(clusterId, now);
  if (lastWake.size > 64) lastWake.delete(lastWake.keys().next().value!);
  let mediaPath: string | null | undefined;
  try {
    mediaPath = getVideoTranscriptionStore()
      .listJobsForCluster(clusterId, { limit: 20 })
      .find((job) => job.mediaOriginPath && job.userId === userId)?.mediaOriginPath;
  } catch {
    return;
  }
  if (!mediaPath) return;
  void (async () => {
    const handle = await fs.promises.open(mediaPath, "r");
    try {
      const { size } = await handle.stat();
      // A byte from somewhere in the file: its start may still be cached in
      // memory, which would answer without touching the disk.
      if (size > 0) await handle.read(Buffer.alloc(1), 0, 1, Math.floor(Math.random() * size));
    } finally {
      await handle.close();
    }
  })().catch(() => undefined);
}
