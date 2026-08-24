import "server-only";

import fs from "node:fs";
import path from "node:path";
import { RouteError } from "@/lib/server-auth";
import {
  acquireServiceLease,
  releaseSupervisorLease,
  type SupervisorLease,
} from "@/lib/supervisor-control";
import { parseStartupStatus, type VoiceboxStartupStatus } from "./startup-status";

const DEFAULT_VOICEBOX_URL = "http://127.0.0.1:17493";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type { VoiceboxStartupStatus };

export function voiceboxStartupStatus(): VoiceboxStartupStatus | null {
  const statusPath =
    process.env.VOICEBOX_STATUS_PATH?.trim() ||
    path.resolve(process.cwd(), "..", ".runtime", "voicebox", "startup-status.json");
  try {
    return parseStartupStatus(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return null;
  }
}

export function voiceboxBaseUrl(): string {
  const raw = process.env.VOICEBOX_BASE_URL?.trim() || DEFAULT_VOICEBOX_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RouteError(503, "Voicebox is misconfigured: VOICEBOX_BASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new RouteError(503, "Voicebox must use a private loopback HTTP address.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function detailMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return detailMessage(record.detail) || detailMessage(record.error);
}

export async function voiceboxFetch(
  pathname: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  if (!pathname.startsWith("/")) throw new RouteError(500, "Invalid Voicebox request path.");
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let lease: SupervisorLease | null = null;
  try {
    if (pathname !== "/health") {
      lease = await acquireServiceLease("voicebox", "speech-operation");
    }
    const response = await fetch(`${voiceboxBaseUrl()}${pathname}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!lease || !response.body) {
      await releaseSupervisorLease(lease);
      lease = null;
      return response;
    }
    const heldLease = lease;
    lease = null;
    const reader = response.body.getReader();
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await releaseSupervisorLease(heldLease);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const next = await reader.read();
          if (next.done) {
            await release();
            stream.close();
          } else {
            stream.enqueue(next.value);
          }
        } catch (error) {
          await release();
          stream.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          await release();
        }
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    await releaseSupervisorLease(lease);
    lease = null;
    if (error instanceof RouteError) throw error;
    const timedOut =
      error instanceof Error && error.name === "AbortError" && !callerSignal?.aborted;
    throw new RouteError(
      503,
      timedOut
        ? "Voicebox took too long to respond. It may still be loading a speech model."
        : "Voicebox is not ready yet. Breadboard starts it with the other local services.",
    );
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function voiceboxJson<T>(
  pathname: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const response = await voiceboxFetch(pathname, init, timeoutMs);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RouteError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      detailMessage(body) || `Voicebox returned ${response.status}.`,
    );
  }
  return body as T;
}

export function voiceboxResponseError(body: unknown, fallback: string): string {
  return detailMessage(body) || fallback;
}
