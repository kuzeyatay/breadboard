// Nominatim reverse geocoding, forward search and place details.
//
// Nominatim answers the two questions Photon cannot: what is at this exact
// point, and what does OSM actually record about this object. Its `/lookup`
// endpoint takes the same OSM identity our place ids are built from, so a
// details call is a lookup of the very object a search returned rather than a
// second search that might land somewhere else.
//
// Missing is missing: a place with no `opening_hours` tag comes back with no
// opening hours and the field named in `missingFields`. Nothing is filled in.

import {
  nominatimLookupId,
  osmElementType,
  osmPlaceId,
  pointPlaceId,
} from "../identity.ts";
import { categoryForTags } from "../categories.ts";
import type { MapAddress, MapBounds, MapPlace, MapPlaceDetails } from "../types.ts";
import { requestProviderJson } from "./http.ts";
import type {
  GeocodeReverseInput,
  GeocodeSearchInput,
  GeocodingProvider,
  PlaceDetailsProvider,
} from "./types.ts";

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number | string;
  lat?: string | number;
  lon?: string | number;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  class?: string;
  address?: Record<string, string>;
  boundingbox?: unknown;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
  error?: string;
}

/** The detail fields Breadboard reports on, so absence can be stated exactly. */
export const DETAIL_FIELDS = [
  "openingHours",
  "website",
  "phone",
  "brand",
  "operator",
  "cuisine",
  "wheelchair",
  "parking",
] as const;

function text(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate ? candidate : undefined;
}

function addressFrom(raw: Record<string, string> | undefined): MapAddress | undefined {
  if (!raw) return undefined;
  const address: MapAddress = {
    ...(text(raw.road) ? { road: raw.road } : {}),
    ...(text(raw.house_number) ? { houseNumber: raw.house_number } : {}),
    ...(text(raw.neighbourhood ?? raw.suburb)
      ? { neighbourhood: raw.neighbourhood ?? raw.suburb }
      : {}),
    ...(text(raw.city_district ?? raw.district ?? raw.county)
      ? { district: raw.city_district ?? raw.district ?? raw.county }
      : {}),
    ...(text(raw.city ?? raw.town ?? raw.village ?? raw.municipality)
      ? { city: raw.city ?? raw.town ?? raw.village ?? raw.municipality }
      : {}),
    ...(text(raw.state) ? { state: raw.state } : {}),
    ...(text(raw.country) ? { country: raw.country } : {}),
    ...(text(raw.country_code) ? { countryCode: raw.country_code } : {}),
    ...(text(raw.postcode) ? { postcode: raw.postcode } : {}),
  };
  return Object.keys(address).length ? address : undefined;
}

/** Nominatim's `boundingbox` is [south, north, west, east], as strings. */
function boundsFrom(value: unknown): MapBounds | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [south, north, west, east] = value.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return undefined;
  return { north, south, east, west };
}

export function nominatimPlaceToMapPlace(
  raw: NominatimPlace,
  retrievedAt: string,
): MapPlace | null {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const elementType = osmElementType(raw.osm_type);
  const hasOsmIdentity =
    elementType !== null && raw.osm_id !== undefined && String(raw.osm_id) !== "";
  const id = hasOsmIdentity
    ? osmPlaceId(elementType, raw.osm_id as number | string)
    : pointPlaceId(lat, lon);

  const displayName = text(raw.display_name) ?? "";
  const name = text(raw.name) ?? displayName.split(",")[0]?.trim() ?? id;
  const osmKey = text(raw.category ?? raw.class);
  const osmValue = text(raw.type);

  return {
    id,
    name,
    displayName: displayName || name,
    lat,
    lon,
    ...(addressFrom(raw.address) ? { address: addressFrom(raw.address)! } : {}),
    ...(osmKey && osmValue ? { category: `${osmKey}=${osmValue}` } : {}),
    ...(osmKey ? { osmKey } : {}),
    ...(osmValue ? { osmValue } : {}),
    ...(boundsFrom(raw.boundingbox) ? { boundingBox: boundsFrom(raw.boundingbox)! } : {}),
    source: "openstreetmap",
    provenance: { provider: "OpenStreetMap/Nominatim", retrievedAt },
    ...(hasOsmIdentity ? {} : { synthesizedId: true }),
  };
}

export function nominatimPlaceToDetails(
  raw: NominatimPlace,
  retrievedAt: string,
): MapPlaceDetails | null {
  const place = nominatimPlaceToMapPlace(raw, retrievedAt);
  if (!place) return null;
  const tags: Record<string, string> = {
    ...(raw.extratags && typeof raw.extratags === "object" ? raw.extratags : {}),
  };
  const detail = (key: string) => text(tags[key]);
  const details: MapPlaceDetails = {
    ...place,
    ...(detail("opening_hours") ? { openingHours: tags.opening_hours } : {}),
    ...(detail("website") ?? detail("contact:website")
      ? { website: tags.website ?? tags["contact:website"] }
      : {}),
    ...(detail("phone") ?? detail("contact:phone")
      ? { phone: tags.phone ?? tags["contact:phone"] }
      : {}),
    ...(detail("brand") ? { brand: tags.brand } : {}),
    ...(detail("operator") ? { operator: tags.operator } : {}),
    ...(detail("cuisine") ? { cuisine: tags.cuisine } : {}),
    ...(detail("wheelchair") ? { wheelchair: tags.wheelchair } : {}),
    ...(detail("parking") ? { parking: tags.parking } : {}),
    ...(Object.keys(tags).length ? { osmTags: tags } : {}),
    missingFields: [],
    ...(place.category ? {} : categoryFromTags(tags)),
  };
  details.missingFields = DETAIL_FIELDS.filter(
    (field) => details[field] === undefined,
  );
  return details;
}

function categoryFromTags(tags: Record<string, string>): { category?: string } {
  const category = categoryForTags(tags);
  return category ? { category } : {};
}

export class NominatimGeocoder implements GeocodingProvider, PlaceDetailsProvider {
  readonly name = "OpenStreetMap/Nominatim";

  private readonly options: {
    baseUrl: string;
    userAgent: string;
    timeoutMs: number;
  };

  constructor(options: { baseUrl: string; userAgent: string; timeoutMs: number }) {
    this.options = options;
  }

  async search(input: GeocodeSearchInput): Promise<MapPlace[]> {
    const url = new URL(`${this.options.baseUrl}/search`);
    url.searchParams.set("q", input.query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(input.limit));
    if (input.language) url.searchParams.set("accept-language", input.language);
    const response = await requestProviderJson<NominatimPlace[]>({
      url: url.toString(),
      provider: this.name,
      failureCode: "map_search_failed",
      failureMessage: "The map search service failed.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const retrievedAt = new Date().toISOString();
    return (Array.isArray(response) ? response : [])
      .map((place) => nominatimPlaceToMapPlace(place, retrievedAt))
      .filter((place): place is MapPlace => place !== null);
  }

  async reverse(input: GeocodeReverseInput): Promise<MapPlace | null> {
    const url = new URL(`${this.options.baseUrl}/reverse`);
    url.searchParams.set("lat", String(input.lat));
    url.searchParams.set("lon", String(input.lon));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    const response = await requestProviderJson<NominatimPlace>({
      url: url.toString(),
      provider: this.name,
      failureCode: "map_reverse_failed",
      failureMessage: "The reverse geocoding service failed.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!response || response.error) return null;
    return nominatimPlaceToMapPlace(response, new Date().toISOString());
  }

  async details(
    placeId: string,
    signal?: AbortSignal,
  ): Promise<MapPlaceDetails | null> {
    const lookupId = nominatimLookupId(placeId);
    if (!lookupId) return null;
    const url = new URL(`${this.options.baseUrl}/lookup`);
    url.searchParams.set("osm_ids", lookupId);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("extratags", "1");
    url.searchParams.set("namedetails", "1");
    const response = await requestProviderJson<NominatimPlace[]>({
      url: url.toString(),
      provider: this.name,
      failureCode: "map_details_failed",
      failureMessage: "The place details service failed.",
      timeoutMs: this.options.timeoutMs,
      userAgent: this.options.userAgent,
      ...(signal ? { signal } : {}),
    });
    const raw = Array.isArray(response) ? response[0] : undefined;
    if (!raw) return null;
    return nominatimPlaceToDetails(raw, new Date().toISOString());
  }
}
