import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localChatmockBaseUrl } from "@/lib/chatmock-server";
import { RouteError } from "@/lib/server-auth";

async function bridgeSecret(): Promise<string> {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  await mkdir(home, { recursive: true });
  const file = path.join(home, "breadboard-voice.secret");
  try { await writeFile(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const secret = (await readFile(file, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new RouteError(503, "The local voice bridge secret is invalid.");
  return secret;
}

export async function subscriptionBridge(userId: number, suffix: string, init: RequestInit = {}): Promise<Response> {
  const base = new URL(localChatmockBaseUrl());
  if (!(["127.0.0.1", "localhost", "[::1]"] as string[]).includes(base.hostname) || base.protocol !== "http:") {
    throw new RouteError(503, "Subscription voice currently requires the local Breadboard service.");
  }
  const headers = new Headers(init.headers);
  headers.set("X-Breadboard-Voice-Secret", await bridgeSecret());
  headers.set("X-Breadboard-Voice-Owner", String(userId));
  let response: Response;
  try {
    response = await fetch(new URL(`/breadboard/voice/${suffix}`, base), {
      ...init, headers, cache: "no-store", redirect: "error",
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(50_000)]) : AbortSignal.timeout(50_000),
    });
  } catch {
    throw new RouteError(503, "The subscription voice service is unavailable. Restart Breadboard and try again.");
  }
  if (response.status === 404) throw new RouteError(503, "Restart Breadboard to load the subscription voice service.");
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RouteError(response.status, body?.error || "Subscription voice could not connect.");
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function subscriptionStatus(userId: number) {
  try { return await (await subscriptionBridge(userId, "status")).json() as { configured: boolean; source: "subscription"; error?: string }; }
  catch (error) { return { configured: false, source: "subscription" as const, error: error instanceof Error ? error.message : "Subscription voice is unavailable." }; }
}

export function requireVoiceOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RouteError(403, "Voice requests must come from Breadboard.");
  }
}
