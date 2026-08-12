// Dashboard-side map configuration.
//
// Every provider endpoint is configurable so the whole stack can be pointed at
// self-hosted Photon/Nominatim/Valhalla/Overpass instances without touching
// code. The defaults are the public OSM-community services, which is what makes
// the feature work out of the box; they are rate-limited, so the autocomplete
// path deliberately uses Photon rather than Nominatim.

export interface MapConfig {
  enabled: boolean;
  /** Photon-compatible forward geocoder / autocomplete. */
  geocoderUrl: string;
  /** Nominatim-compatible reverse geocoder and place-details lookup. */
  reverseGeocoderUrl: string;
  /** Valhalla-compatible router. */
  routerUrl: string;
  /** Overpass API endpoint for POI queries. */
  overpassUrl: string;
  /** MapLibre style document for the basemap. */
  styleUrl: string;
  /** Contact string sent as User-Agent; Nominatim's policy requires one. */
  userAgent: string;
  requestTimeoutMs: number;
  /** Overpass is slower than the rest and gets its own budget. */
  overpassTimeoutMs: number;
  routerTimeoutMs: number;
}

function trimmed(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  return candidate ? candidate.replace(/\/+$/, "") : fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function resolveMapConfig(
  env: NodeJS.ProcessEnv = process.env,
): MapConfig {
  const raw = (env.MAP_ENABLED ?? "").trim();
  return {
    enabled: raw ? /^(1|true|yes|on)$/i.test(raw) : true,
    geocoderUrl: trimmed(env.MAP_GEOCODER_URL, "https://photon.komoot.io"),
    reverseGeocoderUrl: trimmed(
      env.MAP_REVERSE_GEOCODER_URL,
      "https://nominatim.openstreetmap.org",
    ),
    routerUrl: trimmed(env.MAP_ROUTER_URL, "https://valhalla1.openstreetmap.de"),
    overpassUrl: trimmed(
      env.MAP_OVERPASS_URL,
      "https://overpass-api.de/api/interpreter",
    ),
    styleUrl: trimmed(
      env.MAP_STYLE_URL,
      "https://tiles.openfreemap.org/styles/liberty",
    ),
    userAgent: trimmed(
      env.MAP_USER_AGENT,
      "Breadboard/1.0 (self-hosted; local assistant)",
    ),
    requestTimeoutMs: positiveInteger(env.MAP_REQUEST_TIMEOUT_MS, 12_000),
    overpassTimeoutMs: positiveInteger(env.MAP_OVERPASS_TIMEOUT_MS, 30_000),
    routerTimeoutMs: positiveInteger(env.MAP_ROUTER_TIMEOUT_MS, 25_000),
  };
}

export function isMapEnabled(config = resolveMapConfig()): boolean {
  return config.enabled;
}
