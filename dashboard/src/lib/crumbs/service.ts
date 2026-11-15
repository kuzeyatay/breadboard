import "server-only";

import db from "@/lib/db";
import { GLOBAL_MODEL_SENTINEL } from "@/lib/ai-models";
import { localChatmockBaseUrl } from "@/lib/chatmock-server";
import { CrumbsError, createCrumbs } from "./core.ts";
import { ensureLocalCrumbsServices } from "./local-services.ts";
import { createBuzzBridge } from "./buzz-bridge.ts";

/** Crumbs AI runs on the user's own fallback model, so it costs the service nothing. */
async function complete(_userId: number, system: string, prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${localChatmockBaseUrl()}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}` },
      body: JSON.stringify({ model: GLOBAL_MODEL_SENTINEL, stream: false, temperature: 0.2, max_completion_tokens: 900,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
    });
  } catch { throw new CrumbsError(503, "Your model did not answer. Try again."); }
  if (!response.ok) throw new CrumbsError(503, "Your model did not answer. Try again.");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const text = String(payload.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) throw new CrumbsError(503, "Your model sent an empty answer. Try again.");
  return text;
}

export const crumbs = createCrumbs({ db, complete, ensureServers: ensureLocalCrumbsServices });
export { CrumbsError };

/** Carries encrypted organizations onto the Organization page. */
export const buzzBridge = createBuzzBridge({ db, crumbs });
const lastRelay = new Map<string, number>();
/**
 * Relay organization messages for one room, or for everything this account
 * belongs to. Throttled, never throws, and waits at most `waitMs` so a slow
 * network cannot hold the Organization page up.
 */
export async function relayOrganizations(userId: number, roomId?: number, options: { waitMs?: number; force?: boolean } = {}): Promise<void> {
  const key = roomId === undefined ? `all:${userId}` : `room:${roomId}`;
  if (!options.force && Date.now() - (lastRelay.get(key) ?? 0) < (roomId === undefined ? 10_000 : 3_000)) return;
  lastRelay.set(key, Date.now());
  const work = (roomId === undefined ? buzzBridge.syncAll(userId) : buzzBridge.syncRoom(userId, roomId)).catch(() => {});
  if (options.waitMs) await Promise.race([work, new Promise(resolve => setTimeout(resolve, options.waitMs))]);
}

export function crumbsErrorResponse(error: unknown): Response | null {
  return error instanceof CrumbsError ? Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } }) : null;
}
