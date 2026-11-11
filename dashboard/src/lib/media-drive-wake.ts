import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { getVideoTranscriptionStore } from "./scriberr/instance";

/**
 * Recordings kept at their original path often sit on an external drive that
 * spins down when idle. The first read after that waits for the platters: a
 * plain directory listing of such a drive took 4.6 s, and so did the first
 * video opened in Breadboard.
 *
 * Opening a garden that has such recordings (or playing one) reads one byte
 * from one of them in the background, and keeps doing so every two minutes
 * for the next half hour, so the drive is turning when a video is clicked and
 * does not fall asleep again while the garden is in use. Half an hour after
 * the last garden open or playback it is left alone and may sleep. Nothing
 * waits on any of this, and a missing drive or file is simply ignored.
 */
const TOUCH_INTERVAL_MS = 2 * 60_000;
const KEEP_AWAKE_MS = 30 * 60_000;
/** media path -> keep touching it until this time */
const awake = new Map<string, number>();
const lastLookup = new Map<number, number>();
let timer: ReturnType<typeof setInterval> | undefined;

function touch(mediaPath: string): void {
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

/** Start (or extend) the keep-awake window for the drive holding this file. */
export function keepMediaDriveAwake(mediaPath: string): void {
  const fresh = !awake.has(mediaPath);
  awake.set(mediaPath, Date.now() + KEEP_AWAKE_MS);
  while (awake.size > 16) awake.delete(awake.keys().next().value!);
  if (fresh) touch(mediaPath);
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const [file, until] of awake) {
      if (until <= now) awake.delete(file);
      else touch(file);
    }
    if (awake.size === 0 && timer) { clearInterval(timer); timer = undefined; }
  }, TOUCH_INTERVAL_MS);
  timer.unref?.();
}

/** A garden was opened: if it has recordings at their original path, wake their drive. */
export function wakeGardenMediaDrive(clusterId: number, userId: number): void {
  const now = Date.now();
  // The job lookup is a database read; a burst of opens shares one.
  if (now - (lastLookup.get(clusterId) ?? 0) < 10_000) return;
  lastLookup.set(clusterId, now);
  if (lastLookup.size > 64) lastLookup.delete(lastLookup.keys().next().value!);
  try {
    const mediaPath = getVideoTranscriptionStore()
      .listJobsForCluster(clusterId, { limit: 20 })
      .find((job) => job.mediaOriginPath && job.userId === userId)?.mediaOriginPath;
    if (mediaPath) keepMediaDriveAwake(mediaPath);
  } catch {
    // No recordings store: nothing to wake.
  }
}
