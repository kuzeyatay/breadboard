// Valhalla routing.
//
// The router's numbers are the answer. Distance and duration are read straight
// off the trip summary and carried unchanged through state, the UI and the
// model's context — nothing in Breadboard recomputes a duration from a distance
// and an assumed walking speed, and nothing rounds before the presentation
// layer. If Valhalla cannot produce a route, that is a failure with a message,
// never a fallback estimate.

import { MapServiceError } from "../errors.ts";
import type { MapRoute, RouteStep, TravelMode } from "../types.ts";
import { requestProviderJson } from "./http.ts";
import { boundsForCoordinates, decodePolyline } from "./polyline.ts";
import type { RouteProviderInput, RoutingProvider } from "./types.ts";

/** Breadboard's travel modes, in Valhalla's own costing vocabulary. */
export const VALHALLA_COSTING: Record<TravelMode, string> = {
  walking: "pedestrian",
  driving: "auto",
  cycling: "bicycle",
};

interface ValhallaManeuver {
  instruction?: string;
  length?: number;
  time?: number;
  begin_shape_index?: number;
}

interface ValhallaLeg {
  shape?: string;
  maneuvers?: ValhallaManeuver[];
  summary?: { length?: number; time?: number };
}

interface ValhallaResponse {
  trip?: {
    legs?: ValhallaLeg[];
    summary?: { length?: number; time?: number };
    units?: string;
    status?: number;
    status_message?: string;
  };
  error?: string;
  error_code?: number;
}

/** Valhalla reports length in the requested units; we always request metres. */
function metresFromLength(value: unknown, units: string | undefined): number | null {
  const length = Number(value);
  if (!Number.isFinite(length)) return null;
  if (units === "kilometers" || units === "km") return length * 1000;
  if (units === "miles" || units === "mi") return length * 1609.344;
  return length;
}

export class ValhallaRouter implements RoutingProvider {
  readonly name = "Valhalla/OpenStreetMap";

  private readonly options: {
    baseUrl: string;
    userAgent: string;
    timeoutMs: number;
  };

  constructor(options: { baseUrl: string; userAgent: string; timeoutMs: number }) {
    this.options = options;
  }

  async route(input: RouteProviderInput): Promise<MapRoute> {
    const body = JSON.stringify({
      locations: [
        { lat: input.origin.lat, lon: input.origin.lon, type: "break" },
        { lat: input.destination.lat, lon: input.destination.lon, type: "break" },
      ],
      costing: VALHALLA_COSTING[input.mode],
      // Metres and seconds throughout, so nothing downstream converts units.
      units: "meters",
      directions_options: {
        units: "meters",
        directions_type: input.includeSteps ? "instructions" : "none",
      },
      id: "breadboard",
    });

    const response = await requestProviderJson<ValhallaResponse>({
      url: `${this.options.baseUrl}/route`,
      provider: this.name,
      failureCode: "map_route_failed",
      failureMessage:
        "I found both locations, but I couldn't calculate a verified route between them.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      method: "POST",
      contentType: "application/json",
      body,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    const trip = response.trip;
    if (!trip || response.error) {
      throw new MapServiceError(
        "map_route_failed",
        "I found both locations, but I couldn't calculate a verified route between them." +
          (response.error ? ` (Valhalla: ${response.error}.)` : ""),
        { provider: this.name },
      );
    }

    const units = trip.units;
    const legs = Array.isArray(trip.legs) ? trip.legs : [];
    const coordinates: [number, number][] = [];
    const steps: RouteStep[] = [];
    for (const leg of legs) {
      if (typeof leg.shape !== "string" || !leg.shape) continue;
      const decoded = decodePolyline(leg.shape, 6);
      const offset = coordinates.length;
      // Legs share their boundary vertex; dropping the duplicate keeps the
      // drawn line continuous without inventing a point.
      const appended = offset > 0 ? decoded.slice(1) : decoded;
      coordinates.push(...appended);
      if (input.includeSteps && Array.isArray(leg.maneuvers)) {
        for (const maneuver of leg.maneuvers) {
          const distance = metresFromLength(maneuver.length, units);
          const duration = Number(maneuver.time);
          steps.push({
            instruction: String(maneuver.instruction ?? "").trim(),
            distanceMeters: distance ?? 0,
            durationSeconds: Number.isFinite(duration) ? duration : 0,
            ...(Number.isFinite(Number(maneuver.begin_shape_index))
              ? {
                  beginShapeIndex:
                    Number(maneuver.begin_shape_index) + (offset > 0 ? offset - 1 : 0),
                }
              : {}),
          });
        }
      }
    }

    const distanceMeters = metresFromLength(trip.summary?.length, units);
    const durationSeconds = Number(trip.summary?.time);
    if (
      distanceMeters === null ||
      !Number.isFinite(durationSeconds) ||
      coordinates.length < 2
    ) {
      throw new MapServiceError(
        "map_route_failed",
        "I found both locations, but I couldn't calculate a verified route between them. " +
          "The router returned an incomplete result.",
        { provider: this.name },
      );
    }

    const bounds = boundsForCoordinates(coordinates)!;
    return {
      id: `route:${input.mode}:${input.origin.id}:${input.destination.id}`,
      origin: input.origin,
      destination: input.destination,
      mode: input.mode,
      distanceMeters,
      durationSeconds,
      geometry: { type: "LineString", coordinates },
      bounds,
      ...(steps.length ? { steps } : {}),
      provenance: {
        provider: this.name,
        retrievedAt: new Date().toISOString(),
      },
    };
  }
}
