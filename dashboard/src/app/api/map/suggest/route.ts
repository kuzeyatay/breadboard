import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { isMapEnabled, resolveMapConfig } from "@/lib/map/config.ts";
import { MapServiceError } from "@/lib/map/errors.ts";
import { mapSearch } from "@/lib/map/service.ts";
import { mapSearchArgsSchema } from "@/lib/map/schemas.ts";
import { summarizePlace } from "@/lib/map/operations.ts";
import { resolveMapScope } from "@/lib/map/request-scope.ts";
import {
  mutateGeographicContext,
  readGeographicContext,
  rememberPlaces,
} from "@/lib/map/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Autocomplete for the map's search box.
 *
 * Separate from `/api/map/query` because typing is not asking: a keystroke must
 * not select a place, replace the conversation's last search, or move what
 * "there" refers to. What it does do is remember the candidates it returned, so
 * the id the user then clicks is one Breadboard has already resolved rather
 * than a description the browser hands back.
 *
 * Photon serves this path (see lib/map/service.ts) precisely so the public
 * Nominatim instance is never queried at keystroke rate.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    if (!isMapEnabled()) {
      throw new ApiError(503, "map_disabled", "Breadboard's map services are disabled.");
    }
    const body = await readJsonBody(request, 8 * 1024);
    const scope = resolveMapScope({
      userId,
      conversationPublicId:
        typeof body.conversation === "string" ? body.conversation : null,
      standalone: body.standalone === true,
    });
    const context = readGeographicContext(scope);
    const parsed = mapSearchArgsSchema.safeParse({
      query: typeof body.query === "string" ? body.query : "",
      limit: 8,
      ...(body.useViewport === true ? { useViewport: true } : {}),
    });
    if (!parsed.success) {
      throw new ApiError(400, "map_invalid_query", "The search query was not valid.");
    }
    const near =
      parsed.data.useViewport && context.viewport
        ? context.viewport.center
        : undefined;
    const result = await mapSearch({
      query: parsed.data.query,
      ...(near ? { near } : {}),
      limit: 8,
    });
    if (result.places.length) {
      mutateGeographicContext(scope, (current) =>
        rememberPlaces(current, result.places),
      );
    }
    return NextResponse.json({
      query: result.query,
      places: result.places.map(summarizePlace),
      provenance: result.provenance,
      attribution: resolveMapConfig().geocoderUrl,
    });
  } catch (error) {
    if (error instanceof MapServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
