// Stable geographic identity.
//
// A place is only the same place as another when the *source* says so, which is
// why ids are built from OSM object identity and never from a name. Two venues
// called "Starbucks" therefore remain two records with two ids, and a follow-up
// that refers to one of them can only ever reach that one.

import type { MapPlace } from "./types.ts";

export type OsmElementType = "node" | "way" | "relation";

const OSM_ID_PATTERN = /^osm:(node|way|relation):(\d+)$/;
/** A coordinate-derived fallback for sources with no identifier at all. */
const POINT_ID_PATTERN = /^point:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/;

export function osmPlaceId(type: OsmElementType, osmId: number | string): string {
  return `osm:${type}:${String(osmId).trim()}`;
}

/** Photon and Overpass abbreviate the element type; Nominatim spells it out. */
export function osmElementType(value: unknown): OsmElementType | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "n" || raw === "node") return "node";
  if (raw === "w" || raw === "way") return "way";
  if (raw === "r" || raw === "relation") return "relation";
  return null;
}

/** A coordinate-keyed id, used only where the source carries no identity. */
export function pointPlaceId(lat: number, lon: number): string {
  return `point:${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

export function isMapPlaceId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return OSM_ID_PATTERN.test(value) || POINT_ID_PATTERN.test(value);
}

export function parseOsmPlaceId(
  value: string,
): { type: OsmElementType; osmId: string } | null {
  const match = OSM_ID_PATTERN.exec(value);
  if (!match) return null;
  return { type: match[1] as OsmElementType, osmId: match[2] };
}

/** Nominatim's `/lookup` takes N123,W456,R789. */
export function nominatimLookupId(placeId: string): string | null {
  const parsed = parseOsmPlaceId(placeId);
  if (!parsed) return null;
  return `${parsed.type[0].toUpperCase()}${parsed.osmId}`;
}

/**
 * Collapse repeats by source identity only. Nothing here falls back to
 * comparing names or rounded coordinates: two records a metre apart are two
 * places until the source says otherwise, which is what keeps a pair of
 * same-named venues from silently becoming one.
 */
export function dedupePlaces(places: readonly MapPlace[]): MapPlace[] {
  const seen = new Map<string, MapPlace>();
  for (const place of places) {
    if (!seen.has(place.id)) seen.set(place.id, place);
  }
  return [...seen.values()];
}
