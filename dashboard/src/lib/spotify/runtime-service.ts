import "server-only";

import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
} from "../supervisor-control.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type SpotifyPlaybackRuntimeStatus = {
  status: "starting" | "unavailable";
  error: string | null;
};

type ServiceEndpoint = {
  origin: string;
  token: string;
};

type ServiceEnvelope = {
  ok?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
};

export class SpotifyPlaybackRuntimeError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message = "Breadboard could not start its protected-audio browser.",
  ) {
    super(message);
    this.name = "SpotifyPlaybackRuntimeError";
    this.code = code;
  }
}

export function spotifyPlaybackRuntimeManaged(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED?.trim() === "1" &&
    isRuntimeV2ServiceControlConfigured(env)
  );
}

function endpoint(env: NodeJS.ProcessEnv): ServiceEndpoint {
  if (!spotifyPlaybackRuntimeManaged(env)) {
    throw new SpotifyPlaybackRuntimeError(
      "runtime_unavailable",
      "Breadboard's protected-audio player is unavailable.",
    );
  }
  const raw = env.BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_URL?.trim();
  const token = env.BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN?.trim();
  if (!raw || !token) {
    throw new SpotifyPlaybackRuntimeError("invalid_runtime_configuration");
  }
  const tokenBytes = Buffer.from(token, "utf8");
  if (
    tokenBytes.byteLength < MIN_TOKEN_BYTES ||
    tokenBytes.byteLength > MAX_TOKEN_BYTES ||
    !tokenBytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) {
    throw new SpotifyPlaybackRuntimeError("invalid_runtime_configuration");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SpotifyPlaybackRuntimeError("invalid_runtime_configuration");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new SpotifyPlaybackRuntimeError("invalid_runtime_configuration");
  }
  return { origin: url.origin, token };
}

function positiveUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Spotify playback user scope is invalid.");
  }
  return value;
}

export function spotifyPlaybackViewId(value: unknown): string {
  const viewId = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(viewId)) {
    throw new TypeError("Spotify playback view identity is invalid.");
  }
  return viewId;
}

function engineTicket(value: string): string {
  const ticket = typeof value === "string" ? value.trim() : "";
  if (
    Buffer.byteLength(ticket, "utf8") > 4_096 ||
    !/^[A-Za-z0-9_-]{20,4096}\.[A-Za-z0-9_-]{20,128}$/u.test(ticket)
  ) {
    throw new TypeError("Spotify playback engine ticket is invalid.");
  }
  return ticket;
}

async function readEnvelope(response: Response): Promise<ServiceEnvelope> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SpotifyPlaybackRuntimeError("invalid_response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) {
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid envelope");
    }
    return parsed as ServiceEnvelope;
  } catch {
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
}

async function request(
  route: "/v1/ensure" | "/v1/release" | "/v1/status",
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const target = endpoint(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${target.origin}${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.ok !== true || !Object.hasOwn(envelope, "result")) {
      const code =
        typeof envelope.error?.code === "string"
          ? envelope.error.code.slice(0, 64)
          : "service_request_failed";
      const message =
        typeof envelope.error?.message === "string"
          ? envelope.error.message.slice(0, 200)
          : undefined;
      throw new SpotifyPlaybackRuntimeError(code, message);
    }
    return envelope.result;
  } catch (error) {
    if (error instanceof SpotifyPlaybackRuntimeError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpotifyPlaybackRuntimeError("timeout");
    }
    throw new SpotifyPlaybackRuntimeError("unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function parseStatus(value: unknown): SpotifyPlaybackRuntimeStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
  const status = (value as { status?: unknown }).status;
  const error = (value as { error?: unknown }).error;
  if (
    (status !== "starting" && status !== "unavailable") ||
    (error !== null && typeof error !== "string") ||
    (typeof error === "string" && Buffer.byteLength(error, "utf8") > 512)
  ) {
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
  return { status, error };
}

export async function ensureSpotifyPlaybackRuntimeSession(input: {
  userId: number;
  viewId: string;
  ticket: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SpotifyPlaybackRuntimeStatus> {
  const result = await request(
    "/v1/ensure",
    {
      userId: positiveUserId(input.userId),
      viewId: spotifyPlaybackViewId(input.viewId),
      ticket: engineTicket(input.ticket),
    },
    input.env ?? process.env,
  );
  return parseStatus(result);
}

export async function releaseSpotifyPlaybackRuntimeSession(input: {
  userId: number;
  viewId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const result = await request(
    "/v1/release",
    {
      userId: positiveUserId(input.userId),
      viewId: spotifyPlaybackViewId(input.viewId),
    },
    input.env ?? process.env,
  );
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    (result as { released?: unknown }).released !== true
  ) {
    throw new SpotifyPlaybackRuntimeError("invalid_response");
  }
}

export async function readSpotifyPlaybackRuntimeStatus(
  userId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpotifyPlaybackRuntimeStatus> {
  positiveUserId(userId);
  if (!spotifyPlaybackRuntimeManaged(env)) {
    return {
      status: "unavailable",
      error: "Breadboard's protected-audio player is unavailable.",
    };
  }
  let snapshot;
  try {
    snapshot = await readSupervisedServiceSnapshot("spotify-playback", env);
  } catch {
    return {
      status: "unavailable",
      error: "Breadboard's protected-audio player is unavailable.",
    };
  }
  if (!snapshot) {
    return {
      status: "unavailable",
      error: "Breadboard's protected-audio player is unavailable.",
    };
  }
  if (
    snapshot.state === "installation-unavailable" ||
    snapshot.state === "failed" ||
    snapshot.state === "resource-blocked"
  ) {
    return {
      status: "unavailable",
      error:
        snapshot.state === "resource-blocked"
          ? "Breadboard does not have enough memory headroom to start Spotify playback."
          : "Breadboard could not start its protected-audio browser.",
    };
  }
  if (
    snapshot.state === "pending" ||
    snapshot.state === "starting" ||
    snapshot.state === "stopping" ||
    snapshot.state === "stopped" ||
    snapshot.state === "available-but-stopped"
  ) {
    return { status: "starting", error: null };
  }
  try {
    return parseStatus(
      await request("/v1/status", { userId: positiveUserId(userId) }, env),
    );
  } catch (error) {
    return {
      status: "unavailable",
      error:
        error instanceof SpotifyPlaybackRuntimeError
          ? error.message
          : "Breadboard could not start its protected-audio browser.",
    };
  }
}
