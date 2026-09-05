// Photon forward geocoding.
//
// Photon is the autocomplete path on purpose: it is built for prefix search and
// it is not the public Nominatim instance, whose usage policy forbids exactly
// the keystroke-rate querying an address box produces. Every field of the
// MapPlace it returns comes out of Photon's own properties — nothing is
// completed, corrected or inferred here.

import { MapServiceError } from "../errors.ts";
import { osmElementType, osmPlaceId, pointPlaceId } from "../identity.ts";
import type { MapBounds, MapPlace } from "../types.ts";
import { requestProviderJson } from "./http.ts";
import type {
  GeocodeReverseInput,
  GeocodeSearchInput,
  GeocodingProvider,
} from "./types.ts";

interface PhotonFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

function text(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate ? candidate : undefined;
}

/** Photon's `extent` is [minLon, maxLat, maxLon, minLat]. */
function boundsFromExtent(value: unknown): MapBounds | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [west, north, east, south] = value.map(Number);
  if (![west, north, east, south].every(Number.isFinite)) return undefined;
  return { north, south, east, west };
}

function displayNameFor(properties: Record<string, unknown>): string {
  const parts = [
    [text(properties.housenumber), text(properties.street)]
      .filter(Boolean)
      .join(" ") || undefined,
    text(properties.name),
    text(properties.district),
    text(properties.city),
    text(properties.county),
    text(properties.state),
    text(properties.country),
  ].filter((part): part is string => Boolean(part));
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique.join(", ");
}

export function photonFeatureToPlace(
  feature: PhotonFeature,
  retrievedAt: string,
): MapPlace | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const properties = feature.properties ?? {};
  const elementType = osmElementType(properties.osm_type);
  const osmId = properties.osm_id;
  const hasOsmIdentity =
    elementType !== null &&
    (typeof osmId === "number" || typeof osmId === "string") &&
    String(osmId).trim() !== "";
  const id = hasOsmIdentity
    ? osmPlaceId(elementType, osmId as number | string)
    : pointPlaceId(lat, lon);

  const streetLine =
    [text(properties.housenumber), text(properties.street)]
      .filter(Boolean)
      .join(" ") || undefined;
  const name =
    text(properties.name) ??
    streetLine ??
    text(properties.city) ??
    text(properties.state) ??
    text(properties.country) ??
    `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  const osmKey = text(properties.osm_key);
  const osmValue = text(properties.osm_value);
  const address = {
    ...(text(properties.street) ? { road: text(properties.street) } : {}),
    ...(text(properties.housenumber)
      ? { houseNumber: text(properties.housenumber) }
      : {}),
    ...(text(properties.district) ? { neighbourhood: text(properties.district) } : {}),
    ...(text(properties.county) ? { district: text(properties.county) } : {}),
    ...(text(properties.city) ? { city: text(properties.city) } : {}),
    ...(text(properties.state) ? { state: text(properties.state) } : {}),
    ...(text(properties.country) ? { country: text(properties.country) } : {}),
    ...(text(properties.countrycode)
      ? { countryCode: text(properties.countrycode) }
      : {}),
    ...(text(properties.postcode) ? { postcode: text(properties.postcode) } : {}),
  };
  const bounds = boundsFromExtent(properties.extent);

  return {
    id,
    name,
    displayName: displayNameFor(properties) || name,
    lat,
    lon,
    ...(Object.keys(address).length ? { address } : {}),
    ...(osmKey && osmValue ? { category: `${osmKey}=${osmValue}` } : {}),
    ...(osmKey ? { osmKey } : {}),
    ...(osmValue ? { osmValue } : {}),
    ...(bounds ? { boundingBox: bounds } : {}),
    source: "openstreetmap",
    provenance: { provider: "OpenStreetMap/Photon", retrievedAt },
    ...(hasOsmIdentity ? {} : { synthesizedId: true }),
  };
}

export class PhotonGeocoder implements GeocodingProvider {
  readonly name = "OpenStreetMap/Photon";

  private readonly options: {
    baseUrl: string;
    userAgent: string;
    timeoutMs: number;
  };

  constructor(options: { baseUrl: string; userAgent: string; timeoutMs: number }) {
    this.options = options;
  }

  async search(input: GeocodeSearchInput): Promise<MapPlace[]> {
    const url = new URL(`${this.options.baseUrl}/api`);
    url.searchParams.set("q", input.query);
    url.searchParams.set("limit", String(input.limit));
    if (input.near) {
      url.searchParams.set("lat", String(input.near.lat));
      url.searchParams.set("lon", String(input.near.lon));
    }
    if (input.language) url.searchParams.set("lang", input.language);

    const response = await requestProviderJson<PhotonResponse>({
      url: url.toString(),
      provider: this.name,
      failureCode: "map_search_failed",
      failureMessage: "The map search service failed.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const retrievedAt = new Date().toISOString();
    const features = Array.isArray(response.features) ? response.features : [];
    return features
      .map((feature) => photonFeatureToPlace(feature, retrievedAt))
      .filter((place): place is MapPlace => place !== null);
  }

  async reverse(input: GeocodeReverseInput): Promise<MapPlace | null> {
    const url = new URL(`${this.options.baseUrl}/reverse`);
    url.searchParams.set("lat", String(input.lat));
    url.searchParams.set("lon", String(input.lon));
    url.searchParams.set("limit", "1");
    if (input.language) url.searchParams.set("lang", input.language);
    const response = await requestProviderJson<PhotonResponse>({
      url: url.toString(),
      provider: this.name,
      failureCode: "map_reverse_failed",
      failureMessage: "The reverse geocoding service failed.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const feature = response.features?.[0];
    if (!feature) return null;
    return photonFeatureToPlace(feature, new Date().toISOString());
  }
}

/** Guard for callers that construct the provider from configuration. */
export function assertHttpEndpoint(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MapServiceError(
      "map_invalid_arguments",
      `${label} is not a valid URL.`,
      { status: 500 },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MapServiceError(
      "map_invalid_arguments",
      `${label} must be an http(s) endpoint.`,
      { status: 500 },
    );
  }
}
