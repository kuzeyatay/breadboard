// One way in to "get me the file for this link".
//
// Two callers need it and neither should wait for the other: the editor, when a
// turn asks for a linked video to be changed, and the turn service, when the
// Watch skill is about to be asked what is in one. Both go through here so that
// a video is fetched once — not once per caller, and not twice when the same
// link is mentioned in two chats at the same moment.
//
// The in-flight map is what makes that true. The durable half is still the blob
// and its index entry; this only prevents two downloads racing to produce them.

import { downloadVideoSource, type DownloadProgress } from "./download.ts";
import { lookupVideoSource } from "./store.ts";
import type { VideoSource } from "./identity.ts";
import type { StoredVideoBlob } from "../conversations/video-blob-store.ts";

export interface ResolvedVideo {
  blob: StoredVideoBlob;
  title: string;
  /** True when nothing was downloaded because the video was already here. */
  cached: boolean;
}

const globalPending = globalThis as typeof globalThis & {
  __breadboardVideoSourcePending?: Map<string, Promise<ResolvedVideo>>;
};
const pending = globalPending.__breadboardVideoSourcePending ?? new Map<string, Promise<ResolvedVideo>>();
globalPending.__breadboardVideoSourcePending = pending;

/**
 * The stored file for a link, downloading it if this is the first time.
 *
 * `onProgress` only fires for the caller that actually starts the download; one
 * that joins an in-flight fetch waits without narrating it, because it has no
 * claim on the other caller's progress.
 */
export function ensureVideoSource(input: {
  userId: number;
  source: VideoSource;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<ResolvedVideo> {
  const cached = lookupVideoSource(input.userId, input.source.key);
  if (cached) {
    return Promise.resolve({
      blob: cached.blob,
      title: cached.entry.title,
      cached: true,
    });
  }

  const lock = `${input.userId}:${input.source.key}`;
  const inFlight = pending.get(lock);
  if (inFlight) return inFlight;

  const started = downloadVideoSource({
    userId: input.userId,
    source: input.source,
    onProgress: input.onProgress,
    signal: input.signal,
  })
    .then((result) => ({ blob: result.blob, title: result.title, cached: false }))
    .finally(() => {
      pending.delete(lock);
    });

  pending.set(lock, started);
  return started;
}

/**
 * The stored file for a link, but only if it is already here.
 *
 * For callers that must not block — a turn that would rather hand the raw URL
 * to a skill than hold the whole conversation while a download runs.
 */
export function cachedVideoSource(userId: number, source: VideoSource): ResolvedVideo | null {
  const cached = lookupVideoSource(userId, source.key);
  return cached ? { blob: cached.blob, title: cached.entry.title, cached: true } : null;
}
