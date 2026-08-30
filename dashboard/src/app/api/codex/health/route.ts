import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { runCodexProbeViaRuntime } from "@/lib/runtime-v2/codex-probe-job.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const gardenSlug = new URL(request.url).searchParams.get("gardenSlug");
    const availability = await runCodexProbeViaRuntime({ userId, signal: request.signal });
    let repository: { gardenSlug: string; name: string } | null = null;
    let repositoryError: string | null = null;
    try {
      const connected = resolveConnectedRepository(userId, gardenSlug);
      repository = { gardenSlug: connected.gardenSlug, name: connected.name };
    } catch (error) {
      repositoryError = error instanceof Error ? error.message : "repository_unavailable";
    }
    return NextResponse.json({
      ok: true,
      available: availability.available && Boolean(repository),
      installed: availability.installed,
      version: availability.version ?? null,
      reason: availability.reason ?? repositoryError,
      repository,
    });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
