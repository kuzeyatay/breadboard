// The shared map service.
//
// One implementation of search / reverse / route / nearby / details, used by
// Breadboard's map UI and by the Hermes map tools alike. That sharing is the
// point: the coordinates the map draws and the coordinates the model describes
// are the same records from the same call, so a screen and an answer cannot
// disagree.
//
// Nothing here consults a language model, and nothing here fills a gap. A
// provider that fails raises MapServiceError; a provider that returns nothing
// returns nothing.

import { findCategory, POI_CATEGORY_IDS } from "./categories.ts";
import { resolveMapConfig, type MapConfig } from "./config.ts";
import { MapServiceError } from "./errors.ts";
import { dedupePlaces } from "./identity.ts";
import { NominatimGeocoder } from "./providers/nominatim.ts";
import { OverpassPOIProvider } from "./providers/overpass.ts";
import { assertHttpEndpoint, PhotonGeocoder } from "./providers/photon.ts";
import { ValhallaRouter } from "./providers/valhalla.ts";
import type {
  GeocodingProvider,
  PlaceDetailsProvider,
  POIProvider,
  RoutingProvider,
} from "./providers/types.ts";
import type {
  MapPlace,
  MapPlaceDetails,
  MapRoute,
  TravelMode,
} from "./types.ts";

export interface MapProviders {
  geocoder: GeocodingProvider;
  reverseGeocoder: GeocodingProvider;
  router: RoutingProvider;
  poi: POIProvider;
  details: PlaceDetailsProvider;
}

/**
 * Build the default provider set from configuration.
 *
 * Photon does forward search because it is built for autocomplete; Nominatim
 * does reverse and details because it is the one that answers by OSM object id.
 * Both are swappable — every caller depends on the interfaces, not these.
 */
export function defaultMapProviders(
  config: MapConfig = resolveMapConfig(),
): MapProviders {
  assertHttpEndpoint(config.geocoderUrl, "MAP_GEOCODER_URL");
  assertHttpEndpoint(config.reverseGeocoderUrl, "MAP_REVERSE_GEOCODER_URL");
  assertHttpEndpoint(config.routerUrl, "MAP_ROUTER_URL");
  assertHttpEndpoint(config.overpassUrl, "MAP_OVERPASS_URL");
  const photon = new PhotonGeocoder({
    baseUrl: config.geocoderUrl,
    userAgent: config.userAgent,
    timeoutMs: config.requestTimeoutMs,
  });
  const nominatim = new NominatimGeocoder({
    baseUrl: config.reverseGeocoderUrl,
    userAgent: config.userAgent,
    timeoutMs: config.requestTimeoutMs,
  });
  return {
    geocoder: photon,
    reverseGeocoder: nominatim,
    router: new ValhallaRouter({
      baseUrl: config.routerUrl,
      userAgent: config.userAgent,
      timeoutMs: config.routerTimeoutMs,
    }),
    poi: new OverpassPOIProvider({
      endpoint: config.overpassUrl,
      userAgent: config.userAgent,
      timeoutMs: config.overpassTimeoutMs,
    }),
    details: nominatim,
  };
}

let cachedProviders: MapProviders | null = null;

export function mapProviders(): MapProviders {
  cachedProviders ??= defaultMapProviders();
  return cachedProviders;
}

/** Test seam: swap the provider set, and restore it by passing null. */
export function setMapProviders(providers: MapProviders | null): void {
  cachedProviders = providers;
}

function requireEnabled(config: MapConfig): void {
  if (!config.enabled) {
    throw new MapServiceError(
      "map_disabled",
      "Breadboard's map services are disabled in this installation.",
      { status: 503 },
    );
  }
}

export interface MapSearchResult {
  query: string;
  places: MapPlace[];
  /** True when more than one plausible place came back and none is selected. */
  ambiguous: boolean;
  provenance: { provider: string; retrievedAt: string };
}

export async function mapSearch(
  input: {
    query: string;
    near?: { lat: number; lon: number };
    limit?: number;
    language?: string;
    signal?: AbortSignal;
  },
  providers: MapProviders = mapProviders(),
  config: MapConfig = resolveMapConfig(),
): Promise<MapSearchResult> {
  requireEnabled(config);
  const limit = input.limit ?? 8;
  const places = dedupePlaces(
    await providers.geocoder.search({
      query: input.query,
      ...(input.near ? { near: input.near } : {}),
      limit,
      ...(input.language ? { language: input.language } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  ).slice(0, limit);
  return {
    query: input.query,
    places,
    ambiguous: places.length > 1,
    provenance: {
      provider: providers.geocoder.name,
      retrievedAt: places[0]?.provenance.retrievedAt ?? new Date().toISOString(),
    },
  };
}

export async function mapReverse(
  input: { lat: number; lon: number; signal?: AbortSignal },
  providers: MapProviders = mapProviders(),
  config: MapConfig = resolveMapConfig(),
): Promise<MapPlace | null> {
  requireEnabled(config);
  return providers.reverseGeocoder.reverse({
    lat: input.lat,
    lon: input.lon,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function mapRoute(
  input: {
    origin: MapPlace;
    destination: MapPlace;
    mode: TravelMode;
    includeSteps?: boolean;
    signal?: AbortSignal;
  },
  providers: MapProviders = mapProviders(),
  config: MapConfig = resolveMapConfig(),
): Promise<MapRoute> {
  requireEnabled(config);
  return providers.router.route({
    origin: input.origin,
    destination: input.destination,
    mode: input.mode,
    includeSteps: input.includeSteps === true,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export interface MapNearbyResult {
  center: { lat: number; lon: number };
  category?: string;
  query?: string;
  radiusMeters: number;
  places: MapPlace[];
  provenance: { provider: string; retrievedAt: string };
}

export async function mapNearby(
  input: {
    center: { lat: number; lon: number };
    category?: string;
    query?: string;
    radiusMeters: number;
    limit?: number;
    signal?: AbortSignal;
  },
  providers: MapProviders = mapProviders(),
  config: MapConfig = resolveMapConfig(),
): Promise<MapNearbyResult> {
  requireEnabled(config);
  const category = input.category ? findCategory(input.category) : null;
  if (input.category && !category) {
    throw new MapServiceError(
      "map_invalid_arguments",
      `Unknown category "${input.category}". Use one of: ${POI_CATEGORY_IDS.join(", ")}.`,
      { status: 400 },
    );
  }
  if (!category && !input.query) {
    throw new MapServiceError(
      "map_invalid_arguments",
      "Give a category or a query so the map data can be filtered.",
      { status: 400 },
    );
  }
  const places = await providers.poi.nearby({
    center: input.center,
    selectors: category?.selectors ?? [],
    ...(input.query ? { query: input.query } : {}),
    radiusMeters: input.radiusMeters,
    limit: input.limit ?? 12,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return {
    center: input.center,
    ...(category ? { category: category.id } : {}),
    ...(input.query ? { query: input.query } : {}),
    radiusMeters: input.radiusMeters,
    places,
    provenance: {
      provider: providers.poi.name,
      retrievedAt: places[0]?.provenance.retrievedAt ?? new Date().toISOString(),
    },
  };
}

export async function mapPlaceDetails(
  placeId: string,
  providers: MapProviders = mapProviders(),
  config: MapConfig = resolveMapConfig(),
  signal?: AbortSignal,
): Promise<MapPlaceDetails | null> {
  requireEnabled(config);
  return providers.details.details(placeId, signal);
}
