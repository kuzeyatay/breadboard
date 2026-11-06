import "server-only";

import { ApiError } from "../hermes/route-core.ts";
import { invalidateSpotifyPlaybackEngine, spotifyPlaybackEngineStatus } from "./playback-engine.ts";
import { reconnectSpotifyPlaybackRuntime } from "./runtime-service.ts";

const reconnecting = new Map<number, Promise<string>>();

async function replacementDevice(userId: number, rejectedDeviceId: string): Promise<string> {
  const pending = reconnecting.get(userId);
  if (pending) return pending;
  const operation = (async () => {
    const current = await spotifyPlaybackEngineStatus(userId);
    if (current.ready && current.deviceId && current.deviceId !== rejectedDeviceId) return current.deviceId;
    invalidateSpotifyPlaybackEngine(userId, rejectedDeviceId);
    return reconnectSpotifyPlaybackRuntime(userId, rejectedDeviceId);
  })();
  reconnecting.set(userId, operation);
  try {
    return await operation;
  } finally {
    if (reconnecting.get(userId) === operation) reconnecting.delete(userId);
  }
}

/** Only an explicit absent-device rejection proves the command did not run. */
export async function withSpotifyPlaybackRecovery<T>(
  userId: number,
  deviceId: string,
  command: (deviceId: string) => Promise<T>,
): Promise<{ deviceId: string; result: T }> {
  try {
    return { deviceId, result: await command(deviceId) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "spotify_device_unavailable") throw error;
  }
  const replacement = await replacementDevice(userId, deviceId);
  // The SDK can announce readiness before Spotify's command API sees it.
  for (const delay of [0, 300, 700]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return { deviceId: replacement, result: await command(replacement) };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "spotify_device_unavailable") throw error;
      if (delay === 700) {
        invalidateSpotifyPlaybackEngine(userId, replacement);
        throw error;
      }
    }
  }
  throw new Error("Spotify playback recovery exhausted.");
}
