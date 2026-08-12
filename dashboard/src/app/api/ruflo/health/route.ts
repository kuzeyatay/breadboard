import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";
import { runtimeAvailability } from "@/lib/ruflo/runtime.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const gardenSlug = new URL(request.url).searchParams.get("gardenSlug");
    const availability = runtimeAvailability();
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
      source: availability.source ?? null,
      executor: availability.executor ?? null,
      reason: availability.reason ?? repositoryError,
      repository,
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
