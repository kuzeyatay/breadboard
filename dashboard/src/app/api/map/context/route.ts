import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { POI_CATEGORIES } from "@/lib/map/categories.ts";
import { resolveMapConfig } from "@/lib/map/config.ts";
import { MapServiceError } from "@/lib/map/errors.ts";
import { mapCurrentLocationSchema, mapViewportSchema } from "@/lib/map/schemas.ts";
import { resolveMapScope } from "@/lib/map/request-scope.ts";
import {
  readGeographicContext,
  recordCurrentLocation,
  recordSelectedPlace,
  recordViewport,
  clearActiveRoute,
} from "@/lib/map/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Breadboard's geographic state, read by the map UI.
 *
 * This is the only thing MapLibre draws from. It is the same row the `map_*`
 * tools write, so the marker under the user's cursor and the place the model is
 * describing are one record — there is no path here that parses anything out of
 * an assistant message.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const scope = resolveMapScope({
      userId,
      conversationPublicId: url.searchParams.get("conversation"),
      standalone: url.searchParams.get("standalone") === "1",
    });
    const config = resolveMapConfig();
    return NextResponse.json({
      enabled: config.enabled,
      styleUrl: config.styleUrl,
      categories: POI_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
      })),
      conversationPublicId: scope.conversationPublicId,
      context: readGeographicContext(scope),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * User actions on the map: pan/zoom, a device fix, selecting an already-resolved
 * place, clearing the route. Every one of these is a fact about what the user is
 * doing, which is why they may write state — none of them asserts geography.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const scope = resolveMapScope({
      userId,
      conversationPublicId:
        typeof body.conversation === "string" ? body.conversation : null,
      standalone: body.standalone === true,
    });
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "viewport") {
      const parsed = mapViewportSchema.safeParse(body.viewport);
      if (!parsed.success) {
        throw new ApiError(400, "map_invalid_viewport", "The viewport was not valid.");
      }
      return NextResponse.json({ context: recordViewport(scope, parsed.data) });
    }

    if (action === "current_location") {
      const parsed = mapCurrentLocationSchema.safeParse(body.location);
      if (!parsed.success) {
        throw new ApiError(400, "map_invalid_location", "The location was not valid.");
      }
      return NextResponse.json({
        context: recordCurrentLocation(scope, {
          ...parsed.data,
          capturedAt: new Date().toISOString(),
        }),
      });
    }

    if (action === "select") {
      const placeId = typeof body.placeId === "string" ? body.placeId : "";
      const context = readGeographicContext(scope);
      const place = context.places[placeId];
      if (!place) {
        // Selection names a place Breadboard already resolved. There is no
        // branch here that accepts a place description and creates a record.
        throw new MapServiceError(
          "map_unknown_place",
          "That place has not been resolved in this conversation.",
          { status: 400 },
        );
      }
      return NextResponse.json({ context: recordSelectedPlace(scope, place) });
    }

    if (action === "clear_route") {
      return NextResponse.json({ context: clearActiveRoute(scope) });
    }

    throw new ApiError(400, "map_unknown_action", "Unknown map action.");
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
