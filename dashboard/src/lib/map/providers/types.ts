// Provider interfaces.
//
// Breadboard is not coupled to any one public API: the service layer only ever
// talks to these four shapes, so a self-hosted Photon, a different router, or a
// private POI database is a constructor swap rather than a rewrite.

import type {
  MapPlace,
  MapPlaceDetails,
  MapRoute,
  TravelMode,
} from "../types.ts";

export interface GeocodeSearchInput {
  query: string;
  near?: { lat: number; lon: number };
  limit: number;
  language?: string;
  signal?: AbortSignal;
}

export interface GeocodeReverseInput {
  lat: number;
  lon: number;
  language?: string;
  signal?: AbortSignal;
}

export interface GeocodingProvider {
  readonly name: string;
  search(input: GeocodeSearchInput): Promise<MapPlace[]>;
  reverse(input: GeocodeReverseInput): Promise<MapPlace | null>;
}

export interface RouteProviderInput {
  origin: MapPlace;
  destination: MapPlace;
  mode: TravelMode;
  includeSteps: boolean;
  signal?: AbortSignal;
}

export interface RoutingProvider {
  readonly name: string;
  route(input: RouteProviderInput): Promise<MapRoute>;
}

export interface NearbyProviderInput {
  center: { lat: number; lon: number };
  /** Overpass tag selectors, ORed. Empty means "any named feature". */
  selectors: readonly string[];
  /** Free-text name filter, applied to the returned objects. */
  query?: string;
  radiusMeters: number;
  limit: number;
  signal?: AbortSignal;
}

export interface POIProvider {
  readonly name: string;
  nearby(input: NearbyProviderInput): Promise<MapPlace[]>;
}

export interface PlaceDetailsProvider {
  readonly name: string;
  details(placeId: string, signal?: AbortSignal): Promise<MapPlaceDetails | null>;
}
