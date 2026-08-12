import { NextResponse } from "next/server";

import { getClimateIndicators } from "@/lib/worldmonitor/climate";
import { getHazards } from "@/lib/worldmonitor/hazards";
import type { ClimateSnapshot } from "@/lib/worldmonitor/types";
import { fetchHubWeather, hubsByIds, MAX_WEATHER_HUBS } from "@/lib/worldmonitor/weather";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * The measured picture: global climate indicators, live hazard alerts, and
 * current conditions plus local time at the hubs the caller has on screen.
 *
 * `?hubs=kyiv,cairo,…` names hubs by id only. They are resolved against the
 * shipped catalog, so a caller can choose which of the monitor's places to
 * read — never which coordinates the server fetches.
 *
 * The three sources are independent and so are their failures: whichever
 * answered is returned, and whichever did not is named in `notes` rather than
 * turning the whole panel into an error.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const url = new URL(request.url);

    const requestedHubs = (url.searchParams.get("hubs") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_WEATHER_HUBS * 2);
    const hubs = hubsByIds(requestedHubs);

    const notes: string[] = [];

    const [indicators, hazards, weather] = await Promise.all([
      getClimateIndicators(),
      getHazards(),
      fetchHubWeather(hubs).catch((error: unknown) => {
        notes.push(`Open-Meteo: ${error instanceof Error ? error.message : "unavailable"}`);
        return [];
      }),
    ]);

    if (hazards.note) notes.push(hazards.note);

    const snapshot: ClimateSnapshot = {
      indicators: indicators.indicators,
      weather,
      hazards: hazards.hazards,
      notes: [...indicators.notes, ...notes],
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(snapshot);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
