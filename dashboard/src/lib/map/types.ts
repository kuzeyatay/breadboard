// Canonical geographic types.
//
// Everything geographic in Breadboard — the map service, the Hermes map tools,
// the persisted geographic context and the MapLibre UI — speaks exactly these
// shapes. The rule the types exist to enforce is that a place, a route or a POI
// is only ever a record produced by a map provider and carried unchanged: no
// part of the system reconstructs one from prose.

/** Where a record came from, and when it was read. Never dropped downstream. */
export interface MapProvenance {
  /** Human-readable provider identity, e.g. "OpenStreetMap/Overpass". */
  provider: string;
  /** ISO-8601 instant at which Breadboard received the record. */
  retrievedAt: string;
}

export interface MapAddress {
  road?: string;
  houseNumber?: string;
  neighbourhood?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postcode?: string;
}

/** Axis-aligned bounds, in degrees. */
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * One place, as some map provider described it.
 *
 * `id` is a stable source identifier wherever the source has one — the
 * `osm:node:123456` / `osm:way:987654` / `osm:relation:555555` form. Only
 * records with no upstream identity at all fall back to a coordinate-derived
 * id, and those carry `synthesizedId: true` so nothing downstream mistakes one
 * for an OSM object.
 */
export interface MapPlace {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  address?: MapAddress;
  category?: string;
  /** The raw OSM key=value classification, when the provider reported one. */
  osmKey?: string;
  osmValue?: string;
  boundingBox?: MapBounds;
  /** Dataset the record belongs to, e.g. "openstreetmap". */
  source: string;
  provenance: MapProvenance;
  /** True when no upstream identifier existed and the id had to be derived. */
  synthesizedId?: boolean;
}

/** Everything a details lookup found. Absent fields stay absent — never guessed. */
export interface MapPlaceDetails extends MapPlace {
  openingHours?: string;
  website?: string;
  phone?: string;
  brand?: string;
  operator?: string;
  cuisine?: string;
  wheelchair?: string;
  parking?: string;
  /** The untouched tag map from the source, for anything not modelled above. */
  osmTags?: Record<string, string>;
  /** Fields the caller asked about that the source simply does not carry. */
  missingFields: string[];
}

export const TRAVEL_MODES = ["walking", "driving", "cycling"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** A GeoJSON LineString, spelled out so this module needs no GeoJSON types. */
export interface MapLineString {
  type: "LineString";
  /** [lon, lat] pairs, in GeoJSON order. */
  coordinates: [number, number][];
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Index into the route geometry where this step begins. */
  beginShapeIndex?: number;
}

export interface MapRoute {
  id: string;
  origin: MapPlace;
  destination: MapPlace;
  mode: TravelMode;
  /** The router's own distance. Never recomputed from the geometry. */
  distanceMeters: number;
  /** The router's own duration. Never derived from distance and a speed. */
  durationSeconds: number;
  geometry: MapLineString;
  bounds: MapBounds;
  steps?: RouteStep[];
  provenance: MapProvenance;
}

export interface MapViewport {
  center: { lat: number; lon: number };
  bounds: MapBounds;
  zoom: number;
}

export type CurrentLocationSource = "device" | "manual" | "map";

export interface CurrentLocation {
  lat: number;
  lon: number;
  accuracyMeters?: number;
  source: CurrentLocationSource;
  /** ISO-8601 instant of the fix. */
  capturedAt?: string;
  /** Filled in by a reverse geocode, when one succeeded. */
  placeId?: string;
}

/**
 * Conversational handles that structured state resolves, so "there" is answered
 * from the record the user last acted on rather than from language alone.
 */
export interface ConversationalReferences {
  there?: string;
  destination?: string;
  origin?: string;
}

/**
 * Breadboard's authoritative geographic state for one conversation.
 *
 * The chat transcript is not a representation of places: this is. Hermes reads
 * it through tools, the map UI renders it, and both see the same records.
 */
export interface GeographicContext {
  /** Every place resolved in this conversation, by stable id. */
  places: Record<string, MapPlace>;
  selectedPlaceId?: string;
  currentLocation?: CurrentLocation;
  activeRoute?: MapRoute;
  /** Ids of the last POI answer, in the order the provider ranked them. */
  nearbyPlaceIds: string[];
  /** Ids of the last search answer, in provider rank order. */
  lastSearchPlaceIds: string[];
  /** The query that produced `lastSearchPlaceIds`, for ambiguity prompts. */
  lastSearchQuery?: string;
  viewport?: MapViewport;
  conversationalReferences: ConversationalReferences;
  /** Monotonic counter; the UI polls on it rather than diffing state. */
  revision: number;
  updatedAt: string;
}

export function emptyGeographicContext(now = new Date()): GeographicContext {
  return {
    places: {},
    nearbyPlaceIds: [],
    lastSearchPlaceIds: [],
    conversationalReferences: {},
    revision: 0,
    updatedAt: now.toISOString(),
  };
}

/** Resolve ids back to records, dropping ids the context no longer holds. */
export function placesForIds(
  context: GeographicContext,
  ids: readonly string[],
): MapPlace[] {
  return ids
    .map((id) => context.places[id])
    .filter((place): place is MapPlace => Boolean(place));
}
