/**
 * A map operation that could not be completed.
 *
 * The distinction that matters is between "the provider failed" and "the
 * provider answered, and the answer is empty": both stop the agent from
 * asserting a geographic fact, but only the first is a failure. Every message
 * here is written to be repeated to the user verbatim, because the one thing
 * that must never happen next is an estimate standing in for the missing
 * result.
 */
export type MapErrorCode =
  | "map_disabled"
  | "map_invalid_arguments"
  | "map_unknown_place"
  | "map_search_failed"
  | "map_reverse_failed"
  | "map_route_failed"
  | "map_nearby_failed"
  | "map_details_failed"
  | "map_unresolved_reference"
  | "map_ambiguous";

export class MapServiceError extends Error {
  code: MapErrorCode;
  status: number;
  /** Provider identity, when the failure happened inside one. */
  provider?: string;

  constructor(
    code: MapErrorCode,
    message: string,
    options: { status?: number; provider?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "MapServiceError";
    this.code = code;
    this.status = options.status ?? (code === "map_invalid_arguments" ? 400 : 502);
    if (options.provider) this.provider = options.provider;
  }
}

/** The sentence Breadboard says when a provider failed, by operation. */
export const MAP_FAILURE_MESSAGES: Record<string, string> = {
  search:
    "I couldn't verify that location because the map search service failed.",
  reverse:
    "I couldn't identify that point because the reverse geocoding service failed.",
  route:
    "I found both locations, but I couldn't calculate a verified route between them.",
  nearby: "I couldn't retrieve nearby places from the map data.",
  details: "I couldn't retrieve the details for that place from the map data.",
};

/** The sentence Breadboard says when a provider answered with nothing. */
export const MAP_EMPTY_MESSAGES: Record<string, string> = {
  search: "I couldn't find a matching location in the available map data.",
  reverse:
    "The available map data has no named place at those coordinates.",
  nearby:
    "I couldn't find a matching place in the available OpenStreetMap data around that location.",
};
