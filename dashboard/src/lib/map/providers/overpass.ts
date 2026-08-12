// Overpass POI lookup over OpenStreetMap.
//
// Every record returned here is an object that exists in OSM, with the id OSM
// gave it. When a query returns nothing, nothing is what the caller gets: there
// is no "well-known venue" list, no fallback to a wider radius under another
// name, and no completion from anywhere but the response.

import { categoryForTags } from "../categories.ts";
import { osmElementType, osmPlaceId } from "../identity.ts";
import type { MapPlace } from "../types.ts";
import { requestProviderJson } from "./http.ts";
import type { NearbyProviderInput, POIProvider } from "./types.ts";

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Overpass QL for one radius query.
 *
 * Exported so the query a request will make can be asserted in tests without a
 * network call — the translation from a category word to OSM tags is the part
 * that must not drift.
 */
export function buildOverpassQuery(input: {
  center: { lat: number; lon: number };
  selectors: readonly string[];
  radiusMeters: number;
  timeoutSeconds: number;
}): string {
  const around = `(around:${Math.round(input.radiusMeters)},${input.center.lat},${input.center.lon})`;
  const selectors = input.selectors.length ? input.selectors : ['["name"]'];
  const clauses = selectors
    .flatMap((selector) => [
      `node${selector}${around};`,
      `way${selector}${around};`,
      `relation${selector}${around};`,
    ])
    .join("\n  ");
  return `[out:json][timeout:${input.timeoutSeconds}];\n(\n  ${clauses}\n);\nout center tags;`;
}

function haversineMeters(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function foldName(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function overpassElementToPlace(
  element: OverpassElement,
  retrievedAt: string,
): MapPlace | null {
  const elementType = osmElementType(element.type);
  if (!elementType || element.id === undefined) return null;
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const tags = element.tags ?? {};
  const name = (tags.name ?? tags["name:en"] ?? tags.brand ?? tags.operator ?? "").trim();
  if (!name) return null;
  const category = categoryForTags(tags);
  const locality = [tags["addr:city"], tags["addr:suburb"], tags["addr:district"]]
    .filter(Boolean)
    .join(", ");
  const street = [tags["addr:street"], tags["addr:housenumber"]]
    .filter(Boolean)
    .join(" ");

  const address = {
    ...(tags["addr:street"] ? { road: tags["addr:street"] } : {}),
    ...(tags["addr:housenumber"] ? { houseNumber: tags["addr:housenumber"] } : {}),
    ...(tags["addr:suburb"] ? { neighbourhood: tags["addr:suburb"] } : {}),
    ...(tags["addr:district"] ? { district: tags["addr:district"] } : {}),
    ...(tags["addr:city"] ? { city: tags["addr:city"] } : {}),
    ...(tags["addr:state"] ? { state: tags["addr:state"] } : {}),
    ...(tags["addr:country"] ? { country: tags["addr:country"] } : {}),
    ...(tags["addr:postcode"] ? { postcode: tags["addr:postcode"] } : {}),
  };

  return {
    id: osmPlaceId(elementType, element.id),
    name,
    displayName: [name, street, locality].filter(Boolean).join(", "),
    lat,
    lon,
    ...(Object.keys(address).length ? { address } : {}),
    ...(category ? { category } : {}),
    source: "openstreetmap",
    provenance: { provider: "OpenStreetMap/Overpass", retrievedAt },
  };
}

export class OverpassPOIProvider implements POIProvider {
  readonly name = "OpenStreetMap/Overpass";

  private readonly options: {
    endpoint: string;
    userAgent: string;
    timeoutMs: number;
  };

  constructor(options: { endpoint: string; userAgent: string; timeoutMs: number }) {
    this.options = options;
  }

  async nearby(input: NearbyProviderInput): Promise<MapPlace[]> {
    const query = buildOverpassQuery({
      center: input.center,
      selectors: input.selectors,
      radiusMeters: input.radiusMeters,
      timeoutSeconds: Math.max(5, Math.round(this.options.timeoutMs / 1000) - 3),
    });
    const response = await requestProviderJson<OverpassResponse>({
      url: this.options.endpoint,
      provider: this.name,
      failureCode: "map_nearby_failed",
      failureMessage: "I couldn't retrieve nearby places from the map data.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: `data=${encodeURIComponent(query)}`,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    const retrievedAt = new Date().toISOString();
    const elements = Array.isArray(response.elements) ? response.elements : [];
    const needle = input.query ? foldName(input.query) : "";
    const seen = new Set<string>();
    const places: { place: MapPlace; distance: number }[] = [];
    for (const element of elements) {
      const place = overpassElementToPlace(element, retrievedAt);
      if (!place || seen.has(place.id)) continue;
      if (needle && !foldName(place.displayName).includes(needle)) continue;
      seen.add(place.id);
      places.push({ place, distance: haversineMeters(input.center, place) });
    }
    // Ranked by real distance from the requested centre — an ordering derived
    // from the returned coordinates, not a relevance score anybody invented.
    places.sort((left, right) => left.distance - right.distance);
    return places.slice(0, input.limit).map((entry) => entry.place);
  }
}
