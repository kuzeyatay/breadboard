import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { resolveGBrainConfig } from "@/lib/gbrain/config.ts";
import { GBrainClient } from "@/lib/gbrain/client.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { loadClusterBySlug, getSyncState, getOrCreateSourceMapping } from "@/lib/gbrain/mapping.ts";
import { readSupervisedServiceSnapshot } from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";

// Authenticated GBrain product-signal endpoint. Returns configured/healthy/
// degraded/unavailable/disabled + (optionally) per-garden sync state. Never
// exposes the secret, adapter URL internals, absolute paths, or internal ids.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const config = resolveGBrainConfig();
    const url = new URL(request.url);
    const gardenSlug = url.searchParams.get("gardenId");

    if (config.mode === "disabled") {
      return NextResponse.json({ state: "disabled", mode: null, embeddingsAvailable: false });
    }

    const lifecycle = await readSupervisedServiceSnapshot("gbrain");
    if (
      lifecycle &&
      (lifecycle.state === "pending" ||
        lifecycle.state === "starting" ||
        lifecycle.state === "stopped" ||
        lifecycle.state === "available-but-stopped")
    ) {
      return NextResponse.json({
        state: "available-but-stopped",
        backend: null,
        mode: null,
        embeddingsAvailable: false,
        indexed: null,
        sync: null,
      });
    }

    const health = await new GBrainClient(config).health();
    let sync: Record<string, unknown> | null = null;
    if (gardenSlug) {
      const access = authorizeGardenAccess(userId, gardenSlug);
      if (access.isOwner) {
        const cluster = loadClusterBySlug(gardenSlug);
        if (cluster) {
          const mapping = getOrCreateSourceMapping(cluster.id, cluster.slug);
          const state = getSyncState(mapping.sourceId);
          if (state) {
            // Return only safe fields — never source_id or content_root.
            sync = {
              status: state.status,
              lastSyncedAt: state.last_synced_at,
              pagesIndexed: state.pages_indexed,
              chunksIndexed: state.chunks_indexed,
              mode: state.mode,
              error: state.error ? String(state.error).slice(0, 200) : null,
            };
          }
        }
      }
    }

    const state =
      health.status === "unavailable"
        ? "unavailable"
        : !health.embeddingsAvailable || health.mode === "lexical_degraded"
          ? "degraded"
          : "healthy";

    return NextResponse.json({
      state,
      // Truthful backend identity so the UI never labels the fake store as GBrain.
      backend: health.backend,
      mode: health.mode,
      embeddingsAvailable: health.embeddingsAvailable,
      indexed: { sources: health.sources, pages: health.pages, chunks: health.chunks },
      sync,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
