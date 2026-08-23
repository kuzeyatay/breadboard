import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { databaseDir } from "../runtime-paths.ts";
import { ApiError } from "../hermes/route-core.ts";

const DEVICE_FRESH_MS = 20_000;
const LAUNCH_COOLDOWN_MS = 20_000;
const TICKET_TTL_MS = 8 * 60 * 60 * 1_000;

type EngineRegistration = {
  deviceId: string;
  updatedAt: number;
};

type EngineLaunch = {
  launchedAt: number;
  error: string | null;
};

type EngineState = {
  registrations: Map<number, EngineRegistration>;
  launches: Map<number, EngineLaunch>;
};

const globalWithSpotifyEngine = globalThis as typeof globalThis & {
  spotifyPlaybackEngineState?: EngineState;
};

const state =
  globalWithSpotifyEngine.spotifyPlaybackEngineState ??
  (globalWithSpotifyEngine.spotifyPlaybackEngineState = {
    registrations: new Map(),
    launches: new Map(),
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

function engineTicket(userId: number): string {
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

export function spotifyPlaybackEngineStatus(userId: number): {
  ready: boolean;
  deviceId: string | null;
  status: "ready" | "starting" | "unavailable";
  error: string | null;
} {
  const registration = state.registrations.get(userId);
  if (registration && Date.now() - registration.updatedAt <= DEVICE_FRESH_MS) {
    return { ready: true, deviceId: registration.deviceId, status: "ready", error: null };
  }
  if (registration) state.registrations.delete(userId);
  const launch = state.launches.get(userId);
  return {
    ready: false,
    deviceId: null,
    status: launch?.error ? "unavailable" : "starting",
    error: launch?.error ?? null,
  };
}

function browserExecutable(): string | null {
  const configured = process.env.BREADBOARD_SPOTIFY_BROWSER_PATH?.trim();
  const candidates = [
    configured,
    process.platform === "win32"
      ? path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "win32"
      ? path.join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "win32"
      ? path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "darwin" ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" : null,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : null,
    process.platform === "linux" ? "/usr/bin/microsoft-edge" : null,
    process.platform === "linux" ? "/usr/bin/google-chrome" : null,
    process.platform === "linux" ? "/usr/bin/chromium" : null,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function safeEngineOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(503, "spotify_engine_unavailable", "Breadboard's browser player is unavailable.");
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password) {
    throw new ApiError(503, "spotify_engine_unavailable", "Breadboard's browser player is unavailable.");
  }
  return url.origin;
}

export function ensureSpotifyPlaybackEngine(userId: number, requestOrigin: string) {
  const current = spotifyPlaybackEngineStatus(userId);
  if (current.ready) return current;
  const recent = state.launches.get(userId);
  if (recent && Date.now() - recent.launchedAt < LAUNCH_COOLDOWN_MS) return current;

  const executable = browserExecutable();
  if (!executable) {
    state.launches.set(userId, {
      launchedAt: Date.now(),
      error: "Microsoft Edge or Google Chrome is required for protected Spotify playback.",
    });
    return spotifyPlaybackEngineStatus(userId);
  }
  const profileDirectory = path.join(databaseDir(), "spotify-browser-player");
  fs.mkdirSync(profileDirectory, { recursive: true });
  const url = new URL("/api/hermes/connections/spotify/engine", safeEngineOrigin(requestOrigin));
  url.searchParams.set("mode", "page");
  url.searchParams.set("ticket", engineTicket(userId));

  state.launches.set(userId, { launchedAt: Date.now(), error: null });
  try {
    const child = spawn(
      executable,
      [
        "--headless=new",
        `--user-data-dir=${profileDirectory}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--autoplay-policy=no-user-gesture-required",
        url.toString(),
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.once("error", () => {
      state.launches.set(userId, {
        launchedAt: Date.now(),
        error: "Breadboard could not start its protected-audio browser.",
      });
    });
    child.unref();
  } catch {
    state.launches.set(userId, {
      launchedAt: Date.now(),
      error: "Breadboard could not start its protected-audio browser.",
    });
  }
  return spotifyPlaybackEngineStatus(userId);
}
