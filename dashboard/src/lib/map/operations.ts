// Map operations: the one path from an untrusted argument to a stored result.
//
// Both callers land here — the Hermes `map_*` tools and the browser's own map
// UI — which is what makes "Hermes and MapLibre use the same resolved places"
// structurally true rather than a convention. Each operation validates its
// arguments, resolves handles against Breadboard's geographic state, calls the
// shared map service, writes the structured result back into that state, and
// returns a compact view of the very same records.
//
// Two rules are enforced here rather than asked for in a prompt:
//
//   * A place is named by an id Breadboard already resolved, or by a handle
//     Breadboard resolves. There is no argument anywhere in `map_route` or
//     `map_nearby` that accepts a place name or a coordinate pair, so a model
//     cannot route between two places it merely remembers.
//   * A search that returns several plausible places resolves nothing. The
//     result says so, and the caller has to ask.

import { CURRENT_LOCATION_MAX_AGE_MS } from "../current-location.ts";
import { POI_CATEGORY_IDS } from "./categories.ts";
import { resolveMapConfig } from "./config.ts";
import { MAP_EMPTY_MESSAGES, MapServiceError } from "./errors.ts";
import { formatDistance, formatDuration } from "./format.ts";
import { pointPlaceId } from "./identity.ts";
import {
  mapNearby,
  mapPlaceDetails,
  mapReverse,
  mapRoute,
  mapSearch,
  mapProviders,
  type MapProviders,
} from "./service.ts";
import {
  mapNearbyArgsSchema,
  mapPlaceDetailsArgsSchema,
  mapReverseArgsSchema,
  mapRouteArgsSchema,
  mapSearchArgsSchema,
  type PlaceReference,
} from "./schemas.ts";
import {
  readGeographicContext,
  recordNearbyResults,
  recordRoute,
  recordSearchResults,
  recordSelectedPlace,
  rememberPlaces,
  mutateGeographicContext,
  type GeographicContextKey,
} from "./store.ts";
import type DatabaseType from "better-sqlite3";
import {
  placesForIds,
  type GeographicContext,
  type MapPlace,
  type MapRoute,
  type TravelMode,
} from "./types.ts";
import {
  automaticTravelMode,
  automaticWalkingRouteIsTooLong,
} from "./travel-mode.ts";

export const MAP_OPERATIONS = [
  "map_search",
  "map_reverse",
  "map_route",
  "map_nearby",
  "map_place_details",
  "map_get_current_location",
  "map_get_viewport",
  "map_get_selected_place",
] as const;

export type MapOperation = (typeof MAP_OPERATIONS)[number];

export function isMapOperation(value: unknown): value is MapOperation {
  return (
    typeof value === "string" &&
    (MAP_OPERATIONS as readonly string[]).includes(value)
  );
}

/** A place summary sized for a context window: identity, not geometry. */
export interface PlaceSummary {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  category?: string;
  address?: MapPlace["address"];
  source: string;
  provenance: MapPlace["provenance"];
}

export function summarizePlace(place: MapPlace): PlaceSummary {
  return {
    id: place.id,
    name: place.name,
    displayName: place.displayName,
    lat: place.lat,
    lon: place.lon,
    ...(place.category ? { category: place.category } : {}),
    ...(place.address ? { address: place.address } : {}),
    source: place.source,
    provenance: place.provenance,
  };
}

function invalid(message: string): MapServiceError {
  return new MapServiceError("map_invalid_arguments", message, { status: 400 });
}

function parseArgs<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
  args: unknown,
): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success || parsed.data === undefined) {
    const issues =
      parsed.error && typeof parsed.error === "object" && "issues" in parsed.error
        ? (parsed.error as { issues: { path: (string | number)[]; message: string }[] })
            .issues.map((issue) =>
              `${issue.path.join(".") || "arguments"}: ${issue.message}`,
            )
            .slice(0, 6)
            .join("; ")
        : "the arguments were not valid";
    throw invalid(`Rejected map arguments — ${issues}.`);
  }
  return parsed.data;
}

/**
 * A verified point that is not an OSM object: the device's own fix, or the
 * centre of the map the user is looking at. Both are facts Breadboard holds,
 * so they may anchor a query — but they are marked `synthesizedId` and carry
 * Breadboard as their provider, never OpenStreetMap.
 */
function pointPlace(input: {
  lat: number;
  lon: number;
  name: string;
  provider: string;
  retrievedAt: string;
}): MapPlace {
  return {
    id: pointPlaceId(input.lat, input.lon),
    name: input.name,
    displayName: input.name,
    lat: input.lat,
    lon: input.lon,
    source: "breadboard",
    provenance: { provider: input.provider, retrievedAt: input.retrievedAt },
    synthesizedId: true,
  };
}

const REFERENCE_LABELS: Record<PlaceReference, string> = {
  there: 'the place "there" refers to',
  selected: "the selected place",
  current_location: "the current location",
  origin: "the active route's origin",
  destination: "the active route's destination",
  viewport_center: "the centre of the visible map",
};

export interface ResolvedPlaceRef {
  place: MapPlace;
  /** How it was named, for the audit record and the failure message. */
  via: "placeId" | PlaceReference;
}

/**
 * Turn a handle into a record Breadboard already holds. Never performs a
 * geocode: if nothing in state answers the handle, the caller is told to
 * resolve it explicitly rather than handed a best guess.
 */
export function resolvePlaceRef(
  context: GeographicContext,
  ref: { placeId?: string; reference?: PlaceReference },
): ResolvedPlaceRef {
  if (ref.placeId) {
    const place = context.places[ref.placeId];
    if (!place) {
      throw new MapServiceError(
        "map_unknown_place",
        `No place with id ${ref.placeId} has been resolved in this conversation. Resolve it with map_search first.`,
        { status: 400 },
      );
    }
    return { place, via: "placeId" };
  }
  const reference = ref.reference;
  if (!reference) throw invalid("Give a placeId or a reference.");

  const unresolved = () =>
    new MapServiceError(
      "map_unresolved_reference",
      `Breadboard has no record of ${REFERENCE_LABELS[reference]}. Ask the user which place they mean, or resolve it with map_search.`,
      { status: 400 },
    );

  if (reference === "current_location") {
    const location = context.currentLocation;
    if (!location) throw unresolved();
    const resolved = location.placeId ? context.places[location.placeId] : null;
    return {
      place:
        resolved ??
        pointPlace({
          lat: location.lat,
          lon: location.lon,
          name: "Current location",
          provider: `Breadboard/${location.source}-location`,
          retrievedAt: location.capturedAt ?? context.updatedAt,
        }),
      via: reference,
    };
  }
  if (reference === "viewport_center") {
    const viewport = context.viewport;
    if (!viewport) throw unresolved();
    return {
      place: pointPlace({
        lat: viewport.center.lat,
        lon: viewport.center.lon,
        name: "Centre of the visible map",
        provider: "Breadboard/map-viewport",
        retrievedAt: context.updatedAt,
      }),
      via: reference,
    };
  }

  const id =
    reference === "selected"
      ? context.selectedPlaceId
      : reference === "there"
        ? (context.conversationalReferences.there ?? context.selectedPlaceId)
        : context.conversationalReferences[reference];
  const place = id ? context.places[id] : undefined;
  if (!place) throw unresolved();
  return { place, via: reference };
}

export interface MapOperationOutcome {
  operation: MapOperation;
  data: Record<string, unknown>;
  /** Present when the operation changed Breadboard's geographic state. */
  context?: GeographicContext;
}

export async function executeMapOperation(
  operation: MapOperation,
  args: unknown,
  key: GeographicContextKey,
  options: {
    providers?: MapProviders;
    signal?: AbortSignal;
    /** Test seam: run against an in-memory geographic-state database. */
    database?: DatabaseType.Database;
  } = {},
): Promise<MapOperationOutcome> {
  const config = resolveMapConfig();
  const providers = options.providers ?? mapProviders();
  const database = options.database;

  switch (operation) {
    case "map_search": {
      const input = parseArgs(mapSearchArgsSchema, args);
      const context = readGeographicContext(key, database);
      const near =
        input.near ??
        (input.useViewport && context.viewport
          ? context.viewport.center
          : undefined);
      const result = await mapSearch(
        {
          query: input.query,
          ...(near ? { near } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        providers,
        config,
      );
      const nextContext = recordSearchResults(
        key,
        { query: input.query, places: result.places },
        database,
      );
      return {
        operation,
        data: {
          query: result.query,
          resultCount: result.places.length,
          places: result.places.map(summarizePlace),
          ambiguous: result.ambiguous,
          selectedPlaceId: nextContext.selectedPlaceId ?? null,
          ...(result.places.length === 0
            ? {
                empty: true,
                message: MAP_EMPTY_MESSAGES.search,
              }
            : {}),
          ...(result.ambiguous
            ? {
                message:
                  "Several places match. Ask the user which one they mean, then use its placeId — do not pick one.",
              }
            : {}),
          provenance: result.provenance,
        },
        context: nextContext,
      };
    }

    case "map_reverse": {
      const input = parseArgs(mapReverseArgsSchema, args);
      const place = await mapReverse(
        {
          lat: input.lat,
          lon: input.lon,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        providers,
        config,
      );
      if (!place) {
        return {
          operation,
          data: {
            empty: true,
            message: MAP_EMPTY_MESSAGES.reverse,
            provenance: {
              provider: providers.reverseGeocoder.name,
              retrievedAt: new Date().toISOString(),
            },
          },
        };
      }
      const nextContext =
        input.select === false
          ? mutateGeographicContext(
              key,
              (context) => rememberPlaces(context, [place]),
              database,
            )
          : recordSelectedPlace(key, place, database);
      return {
        operation,
        data: { place: summarizePlace(place), provenance: place.provenance },
        context: nextContext,
      };
    }

    case "map_route": {
      const input = parseArgs(mapRouteArgsSchema, args);
      const context = readGeographicContext(key, database);
      const origin = resolvePlaceRef(context, input.origin);
      const destination = resolvePlaceRef(context, input.destination);
      if (origin.place.id === destination.place.id) {
        throw invalid("The origin and the destination are the same place.");
      }
      const automatic = input.mode === "auto";
      const initialMode: TravelMode = input.mode === "auto"
        ? automaticTravelMode(origin.place, destination.place)
        : input.mode;
      const requestRoute = (mode: TravelMode) =>
        mapRoute(
          {
            origin: origin.place,
            destination: destination.place,
            mode,
            includeSteps: input.includeSteps === true,
            ...(options.signal ? { signal: options.signal } : {}),
          },
          providers,
          config,
        );

      let route: MapRoute;
      try {
        route = await requestRoute(initialMode);
      } catch (error) {
        // In Auto, a short point-to-point distance may hide a body of water or
        // pedestrian restriction. If walking cannot route it, try a verified
        // driving route instead. Explicit Walking never falls back silently.
        if (!automatic || initialMode !== "walking") throw error;
        route = await requestRoute("driving");
      }
      if (automaticWalkingRouteIsTooLong(input.mode, route)) {
        route = await requestRoute("driving");
      }
      const nextContext = recordRoute(key, route, database);
      return {
        operation,
        data: {
          routeId: route.id,
          mode: route.mode,
          origin: summarizePlace(route.origin),
          destination: summarizePlace(route.destination),
          // The router's own numbers, plus the phrases Breadboard formatted
          // from them. Quote these; do not convert or re-estimate.
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          distanceText: formatDistance(route.distanceMeters),
          durationText: formatDuration(route.durationSeconds),
          ...(route.steps
            ? {
                steps: route.steps.map((step) => ({
                  instruction: step.instruction,
                  distanceMeters: step.distanceMeters,
                  durationSeconds: step.durationSeconds,
                })),
              }
            : {}),
          // Geometry stays in Breadboard's state, where MapLibre reads it. It
          // is not sent to the model, and the model never supplies one.
          geometryPointCount: route.geometry.coordinates.length,
          drawnOnMap: true,
          provenance: route.provenance,
        },
        context: nextContext,
      };
    }

    case "map_nearby": {
      const input = parseArgs(mapNearbyArgsSchema, args);
      const context = readGeographicContext(key, database);
      const center = resolvePlaceRef(context, input.center);
      const result = await mapNearby(
        {
          center: { lat: center.place.lat, lon: center.place.lon },
          ...(input.category ? { category: input.category } : {}),
          ...(input.query ? { query: input.query } : {}),
          radiusMeters: input.radiusMeters,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        providers,
        config,
      );
      const nextContext = recordNearbyResults(
        key,
        { center: center.place, places: result.places },
        database,
      );
      return {
        operation,
        data: {
          center: summarizePlace(center.place),
          centerResolvedVia: center.via,
          ...(result.category ? { category: result.category } : {}),
          ...(result.query ? { query: result.query } : {}),
          radiusMeters: result.radiusMeters,
          resultCount: result.places.length,
          places: result.places.map(summarizePlace),
          ...(result.places.length === 0
            ? {
                empty: true,
                message: `${MAP_EMPTY_MESSAGES.nearby} Say so; do not supply one from memory.`,
              }
            : {}),
          provenance: result.provenance,
        },
        context: nextContext,
      };
    }

    case "map_place_details": {
      const input = parseArgs(mapPlaceDetailsArgsSchema, args);
      const details = await mapPlaceDetails(
        input.placeId,
        providers,
        config,
        options.signal,
      );
      if (!details) {
        return {
          operation,
          data: {
            placeId: input.placeId,
            empty: true,
            message:
              "The available map data holds no record for that place id.",
          },
        };
      }
      const nextContext = mutateGeographicContext(
        key,
        (context) => rememberPlaces(context, [details]),
        database,
      );
      return {
        operation,
        data: {
          place: summarizePlace(details),
          openingHours: details.openingHours ?? null,
          website: details.website ?? null,
          phone: details.phone ?? null,
          brand: details.brand ?? null,
          operator: details.operator ?? null,
          cuisine: details.cuisine ?? null,
          wheelchair: details.wheelchair ?? null,
          parking: details.parking ?? null,
          osmTags: details.osmTags ?? {},
          // Named explicitly so absence is a stated fact rather than a gap the
          // model is tempted to close.
          missingFields: details.missingFields,
          ...(details.missingFields.length
            ? {
                message: `OpenStreetMap records nothing for: ${details.missingFields.join(", ")}. Say the information is not recorded rather than supplying it.`,
              }
            : {}),
          provenance: details.provenance,
        },
        context: nextContext,
      };
    }

    case "map_get_current_location": {
      const context = readGeographicContext(key, database);
      const location = context.currentLocation;
      if (!location) {
        return {
          operation,
          data: {
            available: false,
            message:
              "Breadboard has no current location for this user. Ask them where they are, or ask them to enable location.",
          },
        };
      }
      const place = location.placeId ? context.places[location.placeId] : undefined;
      // A day-old fix is reported as one. Silently treating it as current is how
      // "the nearest pharmacy" ends up being near where the user was yesterday.
      const capturedMs = location.capturedAt ? Date.parse(location.capturedAt) : Number.NaN;
      const stale =
        Number.isFinite(capturedMs) && Date.now() - capturedMs > CURRENT_LOCATION_MAX_AGE_MS;
      return {
        operation,
        data: {
          available: true,
          lat: location.lat,
          lon: location.lon,
          accuracyMeters: location.accuracyMeters ?? null,
          source: location.source,
          capturedAt: location.capturedAt ?? null,
          stale,
          ...(stale
            ? {
                message:
                  "This fix is over a day old. Confirm where the user is before treating it as their current position.",
              }
            : {}),
          ...(place ? { place: summarizePlace(place) } : {}),
          reference: "current_location",
        },
      };
    }

    case "map_get_viewport": {
      const context = readGeographicContext(key, database);
      if (!context.viewport) {
        return {
          operation,
          data: {
            available: false,
            message: "The map is not open, so there is no visible region to use.",
          },
        };
      }
      return {
        operation,
        data: {
          available: true,
          ...context.viewport,
          reference: "viewport_center",
        },
      };
    }

    case "map_get_selected_place": {
      const context = readGeographicContext(key, database);
      const selected = context.selectedPlaceId
        ? context.places[context.selectedPlaceId]
        : undefined;
      const route = context.activeRoute;
      return {
        operation,
        data: {
          ...(selected
            ? { selectedPlace: summarizePlace(selected) }
            : { selectedPlace: null }),
          conversationalReferences: context.conversationalReferences,
          ...(route
            ? {
                activeRoute: {
                  routeId: route.id,
                  mode: route.mode,
                  origin: summarizePlace(route.origin),
                  destination: summarizePlace(route.destination),
                  distanceMeters: route.distanceMeters,
                  durationSeconds: route.durationSeconds,
                  distanceText: formatDistance(route.distanceMeters),
                  durationText: formatDuration(route.durationSeconds),
                  provenance: route.provenance,
                },
              }
            : { activeRoute: null }),
          nearbyPlaces: placesForIds(context, context.nearbyPlaceIds).map(summarizePlace),
          lastSearch: context.lastSearchQuery
            ? {
                query: context.lastSearchQuery,
                places: placesForIds(context, context.lastSearchPlaceIds).map(
                  summarizePlace,
                ),
              }
            : null,
          categories: POI_CATEGORY_IDS,
        },
      };
    }
  }
}
