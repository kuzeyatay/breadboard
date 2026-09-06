import "server-only";

import { randomUUID } from "node:crypto";
import { ApiError } from "../hermes/route-core.ts";
import { issueSpotifyPlaybackEngineTicket, spotifyPlaybackEngineStatus } from "./playback-engine.ts";
import { releaseSpotifyPlaybackViewLease, renewSpotifyPlaybackViewLease } from "./view-lease.ts";
import { activateSpotifyPhonePlayback, spotifyPhonePlaybackDevice } from "./service.ts";
import type { SpotifyConnectDevice } from "./devices.ts";

export type SpotifyPlaybackTarget = "inline" | "phone";

/** Omission means Breadboard, regardless of which other Connect devices exist. */
export function spotifyPlaybackTarget(value: unknown): SpotifyPlaybackTarget {
  if (value === undefined || value === "inline") return "inline";
  if (value === "phone") return "phone";
  throw new ApiError(400, "invalid_spotify_target", "Choose Breadboard or phone for Spotify playback.");
}

export async function spotifyTargetDevice(
  userId: number,
  target: SpotifyPlaybackTarget,
): Promise<SpotifyConnectDevice | null> {
  if (target === "phone") return spotifyPhonePlaybackDevice(userId);
  const engine = await spotifyPlaybackEngineStatus(userId);
  return engine.ready && engine.deviceId
    ? { id: engine.deviceId, name: "Breadboard", type: "computer", isActive: false, isRestricted: false }
    : null;
}

/** Acquire the local player before sending a command; never infer a phone target. */
export async function withSpotifyPlaybackDevice<T>(
  userId: number,
  target: SpotifyPlaybackTarget,
  operation: (device: SpotifyConnectDevice) => Promise<T>,
  handoffToInlineView = false,
): Promise<T> {
  if (target === "phone") {
    const phone = await spotifyPhonePlaybackDevice(userId);
    if (!phone) {
      throw new ApiError(409, "spotify_phone_unavailable", "Spotify is not currently available on your phone. Open Spotify on the phone and try again.");
    }
    const device = await activateSpotifyPhonePlayback({ userId, device: phone, play: false });
    return operation(device);
  }

  const viewId = randomUUID();
  try {
    await renewSpotifyPlaybackViewLease({ userId, viewId, ticket: issueSpotifyPlaybackEngineTicket(userId) });
    let engine = await spotifyPlaybackEngineStatus(userId);
    for (let attempt = 0; attempt < 40 && !engine.ready && engine.status !== "unavailable"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      engine = await spotifyPlaybackEngineStatus(userId);
    }
    if (!engine.ready || !engine.deviceId) {
      throw new ApiError(503, "spotify_engine_unavailable", engine.error || "Breadboard's Spotify player could not start. Try playback again.");
    }
    const result = await operation({
      id: engine.deviceId, name: "Breadboard", type: "computer", isActive: false, isRestricted: false,
    });
    if (!handoffToInlineView) {
      await releaseSpotifyPlaybackViewLease({ userId, viewId });
    }
    // A new play request keeps the bounded lease until its existing TTL
    // expires; the inline view takes over once the assistant finishes.
    return result;
  } catch (error) {
    await releaseSpotifyPlaybackViewLease({ userId, viewId }).catch(() => undefined);
    throw error;
  }
}
