import { createHash } from "node:crypto";
import { MusicRecognitionError } from "./errors.ts";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function musicRecognitionDeviceKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "";
  const device = request.headers.get("x-breadboard-device-id")?.trim() ?? "";
  const agent = request.headers.get("user-agent")?.slice(0, 300) ?? "";
  return createHash("sha256").update(`${device}|${forwarded}|${agent}`).digest("hex").slice(0, 24);
}

export function consumeMusicRecognitionRateLimit(
  key: string,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): void {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 8;
  const windowMs = options.windowMs ?? 60_000;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
    const error = new MusicRecognitionError(
      "music_recognition_rate_limited",
      `Too many music recognition requests. Try again in ${retryAfter} seconds.`,
      429,
    ) as MusicRecognitionError & { retryAfter?: number };
    error.retryAfter = retryAfter;
    throw error;
  } else {
    current.count += 1;
  }

  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
}

export function resetMusicRecognitionRateLimitsForTests(): void {
  buckets.clear();
}
