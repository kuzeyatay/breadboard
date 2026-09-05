import { NextResponse } from "next/server";

import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { currentLocationLabel } from "@/lib/current-location-label.ts";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { MapServiceError } from "@/lib/map/errors.ts";
import { mapReverse } from "@/lib/map/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function coordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < minimum || value > maximum) return null;
  return Math.round(value * 100) / 100;
}

/** A human-readable name for an already-consented, coarse device location. */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = await readJsonBody(request, 2 * 1024);
    const latitude = coordinate(body.latitude, -90, 90);
    const longitude = coordinate(body.longitude, -180, 180);
    if (latitude === null || longitude === null) {
      return NextResponse.json(
        { error: "A valid coarse location is required." },
        { status: 400 },
      );
    }

    const place = await mapReverse({
      lat: latitude,
      lon: longitude,
      language: "en",
      signal: request.signal,
    });
    return NextResponse.json(
      { label: currentLocationLabel(place) },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch (error) {
    if (error instanceof MapServiceError) {
      return NextResponse.json(
        { error: "The location name is temporarily unavailable." },
        { status: error.status },
      );
    }
    return routeErrorResponse(error);
  }
}
