import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { isMapEnabled } from "@/lib/map/config.ts";
import { MapServiceError } from "@/lib/map/errors.ts";
import { executeMapOperation, isMapOperation } from "@/lib/map/operations.ts";
import { resolveMapScope } from "@/lib/map/request-scope.ts";
import { readGeographicContext } from "@/lib/map/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The map UI's own lookups — the search box, a click on the map, a POI filter,
 * a route the user asked for by pressing a button.
 *
 * It runs the same `executeMapOperation` the Hermes tool route runs, against the
 * same geographic state, with the same validation. That is deliberate: a place
 * the user found by typing and a place the model found by calling a tool are
 * the same record with the same id, so a follow-up question about "that one"
 * resolves identically whichever way it got there.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    if (!isMapEnabled()) {
      throw new ApiError(503, "map_disabled", "Breadboard's map services are disabled.");
    }
    const body = await readJsonBody(request, 64 * 1024);
    const operation = typeof body.operation === "string" ? body.operation : "";
    if (!isMapOperation(operation)) {
      throw new ApiError(400, "map_unknown_operation", "Unknown map operation.");
    }
    const scope = resolveMapScope({
      userId,
      conversationPublicId:
        typeof body.conversation === "string" ? body.conversation : null,
      standalone: body.standalone === true,
    });
    const outcome = await executeMapOperation(
      operation,
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? body.args
        : {},
      scope,
    );
    return NextResponse.json({
      operation: outcome.operation,
      data: outcome.data,
      // The full context comes back with every operation so the UI never has to
      // reconstruct a route or a marker set from the compact tool view.
      context: outcome.context ?? readGeographicContext(scope),
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
