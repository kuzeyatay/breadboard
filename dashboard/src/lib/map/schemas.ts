// Zod schemas for every map argument a model or a browser can supply.
//
// Map-tool arguments are untrusted in exactly the same way model-authored
// hardware requests are: they arrive as free JSON from a language model, and
// the only thing standing between "-91 degrees latitude" and a provider request
// is this file. The same schemas validate the browser's calls, so the map UI
// and Hermes cannot disagree about what a valid request is.

import { z } from "zod";
import { POI_CATEGORY_IDS } from "./categories.ts";
import { isMapPlaceId } from "./identity.ts";
import { TRAVEL_MODES } from "./types.ts";

export const latitudeSchema = z
  .number()
  .refine(Number.isFinite, "Latitude must be a finite number.")
  .min(-90, "Latitude must be between -90 and 90.")
  .max(90, "Latitude must be between -90 and 90.");

export const longitudeSchema = z
  .number()
  .refine(Number.isFinite, "Longitude must be a finite number.")
  .min(-180, "Longitude must be between -180 and 180.")
  .max(180, "Longitude must be between -180 and 180.");

export const coordinateSchema = z.strictObject({
  lat: latitudeSchema,
  lon: longitudeSchema,
});

export const placeIdSchema = z
  .string()
  .trim()
  .max(120)
  .refine(isMapPlaceId, "Not a Breadboard place id (osm:node|way|relation:<id>).");

/**
 * The handles structured state can resolve. Deliberately a closed set: a model
 * that wants "the place we were talking about" has to name one of these, and
 * Breadboard decides what it points at.
 */
export const PLACE_REFERENCES = [
  "there",
  "selected",
  "current_location",
  "origin",
  "destination",
  "viewport_center",
] as const;

export const placeReferenceSchema = z.enum(PLACE_REFERENCES);

/**
 * How routes and POI queries name their endpoints: an already-resolved place,
 * or a handle Breadboard resolves. Raw coordinates are deliberately absent —
 * this is the schema that makes `map_route("Metropol", "Mevlana")` and
 * `map_route(41.02, 29.11)` both impossible, so the only way to route to a
 * place is to have resolved it from map data first.
 */
export const resolvedPlaceRefSchema = z
  .strictObject({
    placeId: placeIdSchema.optional(),
    reference: placeReferenceSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.placeId) !== Boolean(value.reference),
    "Give exactly one of placeId or reference. Resolve a name with map_search first.",
  );

export const mapSearchArgsSchema = z.strictObject({
  query: z.string().trim().min(1, "Give something to search for.").max(200),
  near: coordinateSchema.optional(),
  /** Bias results toward what the map is showing, when nothing else is given. */
  useViewport: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  language: z.string().trim().max(8).optional(),
});

export const mapReverseArgsSchema = z.strictObject({
  lat: latitudeSchema,
  lon: longitudeSchema,
  /** Remember the result as the conversation's selected place. */
  select: z.boolean().optional(),
});

export const mapRouteArgsSchema = z.strictObject({
  origin: resolvedPlaceRefSchema,
  destination: resolvedPlaceRefSchema,
  mode: z.enum(TRAVEL_MODES),
  includeSteps: z.boolean().optional(),
});

export const mapNearbyArgsSchema = z.strictObject({
  center: resolvedPlaceRefSchema,
  category: z.enum(POI_CATEGORY_IDS as [string, ...string[]]).optional(),
  /** Free-text name filter applied to the returned OSM objects. */
  query: z.string().trim().max(120).optional(),
  radiusMeters: z.number().int().min(50).max(20_000),
  limit: z.number().int().min(1).max(50).optional(),
});

export const mapPlaceDetailsArgsSchema = z.strictObject({
  placeId: placeIdSchema,
});

export const mapViewportSchema = z.strictObject({
  center: coordinateSchema,
  bounds: z.strictObject({
    north: latitudeSchema,
    south: latitudeSchema,
    east: longitudeSchema,
    west: longitudeSchema,
  }),
  zoom: z.number().min(0).max(24),
});

export const mapCurrentLocationSchema = z.strictObject({
  lat: latitudeSchema,
  lon: longitudeSchema,
  accuracyMeters: z.number().min(0).max(100_000).optional(),
  source: z.enum(["device", "manual", "map"]),
});

export type MapSearchArgs = z.infer<typeof mapSearchArgsSchema>;
export type MapReverseArgs = z.infer<typeof mapReverseArgsSchema>;
export type MapRouteArgs = z.infer<typeof mapRouteArgsSchema>;
export type MapNearbyArgs = z.infer<typeof mapNearbyArgsSchema>;
export type MapPlaceDetailsArgs = z.infer<typeof mapPlaceDetailsArgsSchema>;
export type PlaceReference = (typeof PLACE_REFERENCES)[number];
