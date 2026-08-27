import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { voxDirectorCheckpoint } from "@/lib/agent-settings/defaults.ts";
import { getSpeechSettings } from "@/lib/speech/settings.ts";
import { inspectVoxDirectorRuntimeHealth } from "@/lib/runtime-v2/cinema-agent-job.ts";
import { VOX_DIRECTOR_AGENT_ID } from "@/lib/vox-director/identity.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_MS = 15_000;
const MAX_CACHED_USERS = 128;
const cached = new Map<number, { at: number; body: Record<string, unknown> }>();

function pruneCache(now: number): void {
  for (const [userId, entry] of cached) {
    if (now - entry.at >= CACHE_MS) cached.delete(userId);
  }
  while (cached.size >= MAX_CACHED_USERS) {
    const oldest = cached.keys().next().value as number | undefined;
    if (oldest === undefined) break;
    cached.delete(oldest);
  }
}

/**
 * Whether a production can actually run, and what it would lose if it did.
 *
 * Three states, and the distinction is the point of the endpoint. `ready` means
 * every piece of the intended path is present. `degraded` means the film will
 * be made but not as asked — no ComfyUI, so the posters are title cards.
 * `unavailable` means no film comes out at all: no clone, no Python, no ffmpeg,
 * or no voice, since a narrated explainer with no narrator is not a film.
 *
 * A cloned directory being present is never on its own a reason to call this
 * healthy; `resolveVoxDirectorRoot` requires the scripts the run really
 * executes, and every other line here is a live probe.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const now = Date.now();
    pruneCache(now);
    const prior = cached.get(userId);
    if (prior && now - prior.at < CACHE_MS) {
      return NextResponse.json(prior.body);
    }

    const { baseURL } = resolveChatmockBaseUrl(request);
    const settings = agentSettingsFor(userId, VOX_DIRECTOR_AGENT_ID);
    const configuredCheckpoint = voxDirectorCheckpoint(settings);
    let voiceProfileId: string | null = null;
    try {
      voiceProfileId = getSpeechSettings(userId).profileId;
    } catch {
      voiceProfileId = null;
    }
    const body = await inspectVoxDirectorRuntimeHealth({
      userId,
      baseUrl: baseURL,
      checkpoint: configuredCheckpoint,
      voiceProfileId,
    });
    cached.set(userId, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
