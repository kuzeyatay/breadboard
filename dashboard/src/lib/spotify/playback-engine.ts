import "server-only";

import crypto from "node:crypto";
import { ApiError } from "../hermes/route-core.ts";
import { readSpotifyPlaybackRuntimeStatus } from "./runtime-service.ts";

const DEVICE_FRESH_MS = 20_000;
const TICKET_TTL_MS = 8 * 60 * 60 * 1_000;

type EngineRegistration = {
  deviceId: string;
  updatedAt: number;
};

type EngineState = {
  registrations: Map<number, EngineRegistration>;
};

const globalWithSpotifyEngine = globalThis as typeof globalThis & {
  spotifyPlaybackEngineState?: EngineState;
};

const state =
  globalWithSpotifyEngine.spotifyPlaybackEngineState ??
  (globalWithSpotifyEngine.spotifyPlaybackEngineState = {
    registrations: new Map(),
  });

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new ApiError(
      503,
      "spotify_engine_unavailable",
      "Breadboard's browser player is temporarily unavailable.",
    );
  }
  return secret;
}

function signature(payload: string): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update("breadboard-spotify-playback-engine\0")
    .update(payload)
    .digest("base64url");
}

export function issueSpotifyPlaybackEngineTicket(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Spotify playback user scope is invalid.");
  }
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      expiresAt: Date.now() + TICKET_TTL_MS,
      nonce: crypto.randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifySpotifyEngineTicket(ticket: string): number {
  const [payload, provided, ...extra] = ticket.split(".");
  if (!payload || !provided || extra.length) {
    throw new ApiError(403, "invalid_spotify_engine_ticket", "The browser player link is invalid.");
  }
  const expected = signature(payload);
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (
    providedBytes.length !== expectedBytes.length ||
    !crypto.timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new ApiError(403, "invalid_spotify_engine_ticket", "The browser player link is invalid.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(403, "invalid_spotify_engine_ticket", "The browser player link is invalid.");
  }
  const record = decoded as { userId?: unknown; expiresAt?: unknown };
  const userId = Number(record.userId);
  const expiresAt = Number(record.expiresAt);
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new ApiError(403, "expired_spotify_engine_ticket", "The browser player link expired.");
  }
  return userId;
}

function playbackDeviceId(value: unknown): string {
  const deviceId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(deviceId)) {
    throw new ApiError(400, "invalid_spotify_device", "The browser player device is invalid.");
  }
  return deviceId;
}

export function registerSpotifyPlaybackEngine(input: {
  ticket: string;
  deviceId: unknown;
}): void {
  const userId = verifySpotifyEngineTicket(input.ticket);
  state.registrations.set(userId, {
    deviceId: playbackDeviceId(input.deviceId),
    updatedAt: Date.now(),
  });
}

export async function spotifyPlaybackEngineStatus(userId: number): Promise<{
  ready: boolean;
  deviceId: string | null;
  status: "ready" | "starting" | "unavailable";
  error: string | null;
}> {
  const registration = state.registrations.get(userId);
  if (registration && Date.now() - registration.updatedAt <= DEVICE_FRESH_MS) {
    return { ready: true, deviceId: registration.deviceId, status: "ready", error: null };
  }
  if (registration) state.registrations.delete(userId);
  const runtime = await readSpotifyPlaybackRuntimeStatus(userId);
  return {
    ready: false,
    deviceId: null,
    status: runtime.status,
    error: runtime.error,
  };
}
