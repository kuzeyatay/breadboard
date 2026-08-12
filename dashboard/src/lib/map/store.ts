// Breadboard's geographic state.
//
// This is the source of truth for places, selection, routes and viewport. The
// chat transcript is not: a sentence Hermes writes cannot change what is stored
// here, because the only writers are the map service's own structured results
// and explicit user actions in the map UI. That asymmetry is the whole design —
// Hermes reads this state and describes it, and never edits it by describing it
// differently.
//
// Every function takes the database as a trailing argument so the rules can be
// exercised against an in-memory copy, the way the calendar and plan stores are.

import type DatabaseType from "better-sqlite3";
import db from "../db.ts";
import { ensureMapSchema } from "./schema.ts";
import {
  emptyGeographicContext,
  type CurrentLocation,
  type GeographicContext,
  type MapPlace,
  type MapRoute,
  type MapViewport,
} from "./types.ts";

type Db = DatabaseType.Database;

/** Places retained per conversation. Oldest resolutions fall off first. */
const MAX_REMEMBERED_PLACES = 250;

const prepared = new WeakSet<Db>();

function ready(database: Db): Db {
  if (!prepared.has(database)) {
    ensureMapSchema(database);
    prepared.add(database);
  }
  return database;
}

interface ContextRow {
  context_json: string;
  revision: number;
  updated_at: string;
}

export interface GeographicContextKey {
  userId: number;
  /** null for the map UI's own browsing state, which no conversation owns. */
  conversationId: number | null;
}

function conversationKey(conversationId: number | null): number {
  return conversationId === null || !Number.isInteger(conversationId)
    ? 0
    : conversationId;
}

function parseContext(
  raw: string,
  revision: number,
  updatedAt: string,
): GeographicContext {
  try {
    const parsed = JSON.parse(raw) as Partial<GeographicContext>;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return {
      places:
        parsed.places && typeof parsed.places === "object" ? parsed.places : {},
      ...(parsed.selectedPlaceId ? { selectedPlaceId: parsed.selectedPlaceId } : {}),
      ...(parsed.currentLocation ? { currentLocation: parsed.currentLocation } : {}),
      ...(parsed.activeRoute ? { activeRoute: parsed.activeRoute } : {}),
      nearbyPlaceIds: Array.isArray(parsed.nearbyPlaceIds) ? parsed.nearbyPlaceIds : [],
      lastSearchPlaceIds: Array.isArray(parsed.lastSearchPlaceIds)
        ? parsed.lastSearchPlaceIds
        : [],
      ...(parsed.lastSearchQuery ? { lastSearchQuery: parsed.lastSearchQuery } : {}),
      ...(parsed.viewport ? { viewport: parsed.viewport } : {}),
      conversationalReferences:
        parsed.conversationalReferences &&
        typeof parsed.conversationalReferences === "object"
          ? parsed.conversationalReferences
          : {},
      revision,
      updatedAt,
    };
  } catch {
    return { ...emptyGeographicContext(new Date(updatedAt)), revision };
  }
}

export function readGeographicContext(
  key: GeographicContextKey,
  database: Db = db,
): GeographicContext {
  const row = ready(database)
    .prepare(
      `SELECT context_json, revision, updated_at
         FROM map_geographic_contexts
        WHERE user_id = ? AND conversation_id = ?`,
    )
    .get(key.userId, conversationKey(key.conversationId)) as ContextRow | undefined;
  if (!row) return emptyGeographicContext();
  return parseContext(row.context_json, row.revision, row.updated_at);
}

/** The conversation whose geographic state this user touched most recently. */
export function latestGeographicContextConversationId(
  userId: number,
  database: Db = db,
): number | null {
  const row = ready(database)
    .prepare(
      `SELECT conversation_id
         FROM map_geographic_contexts
        WHERE user_id = ?
        ORDER BY updated_at DESC, revision DESC
        LIMIT 1`,
    )
    .get(userId) as { conversation_id: number } | undefined;
  if (!row) return null;
  return row.conversation_id === 0 ? null : row.conversation_id;
}

function trimPlaces(context: GeographicContext): GeographicContext {
  const ids = Object.keys(context.places);
  if (ids.length <= MAX_REMEMBERED_PLACES) return context;
  // Anything the conversation is actively pointing at survives regardless of
  // age: dropping the selected place or a route endpoint would break exactly
  // the follow-up this state exists to answer.
  const pinned = new Set(
    [
      context.selectedPlaceId,
      context.activeRoute?.origin.id,
      context.activeRoute?.destination.id,
      context.currentLocation?.placeId,
      ...Object.values(context.conversationalReferences),
      ...context.nearbyPlaceIds,
      ...context.lastSearchPlaceIds,
    ].filter((id): id is string => Boolean(id)),
  );
  const places: Record<string, MapPlace> = {};
  for (const id of pinned) {
    if (context.places[id]) places[id] = context.places[id];
  }
  for (const id of ids.slice(-MAX_REMEMBERED_PLACES)) {
    places[id] = context.places[id];
  }
  return { ...context, places };
}

/**
 * Apply a structured change and bump the revision the UI polls on. The mutator
 * receives a copy and returns the next context; it never performs I/O.
 */
export function mutateGeographicContext(
  key: GeographicContextKey,
  mutate: (context: GeographicContext) => GeographicContext,
  database: Db = db,
): GeographicContext {
  const current = readGeographicContext(key, database);
  const next = trimPlaces(mutate(structuredClone(current)));
  const updatedAt = new Date().toISOString();
  const revision = current.revision + 1;
  const stored: GeographicContext = { ...next, revision, updatedAt };
  ready(database)
    .prepare(
      `INSERT INTO map_geographic_contexts
         (user_id, conversation_id, context_json, revision, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, conversation_id) DO UPDATE SET
         context_json = excluded.context_json,
         revision     = excluded.revision,
         updated_at   = excluded.updated_at`,
    )
    .run(
      key.userId,
      conversationKey(key.conversationId),
      JSON.stringify(stored),
      revision,
      updatedAt,
    );
  return stored;
}

export function rememberPlaces(
  context: GeographicContext,
  places: readonly MapPlace[],
): GeographicContext {
  const next = { ...context, places: { ...context.places } };
  for (const place of places) next.places[place.id] = place;
  return next;
}

export function recordSearchResults(
  key: GeographicContextKey,
  input: { query: string; places: readonly MapPlace[]; select?: boolean },
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => {
      const next = rememberPlaces(context, input.places);
      next.lastSearchQuery = input.query;
      next.lastSearchPlaceIds = input.places.map((place) => place.id);
      // A single unambiguous hit is a resolution; several are candidates, and
      // choosing between them is the user's to make, not the model's.
      if (input.select !== false && input.places.length === 1) {
        next.selectedPlaceId = input.places[0].id;
        next.conversationalReferences = {
          ...next.conversationalReferences,
          there: input.places[0].id,
        };
      }
      return next;
    },
    database,
  );
}

export function recordSelectedPlace(
  key: GeographicContextKey,
  place: MapPlace,
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => {
      const next = rememberPlaces(context, [place]);
      next.selectedPlaceId = place.id;
      next.conversationalReferences = {
        ...next.conversationalReferences,
        there: place.id,
      };
      return next;
    },
    database,
  );
}

export function recordNearbyResults(
  key: GeographicContextKey,
  input: { center: MapPlace | null; places: readonly MapPlace[] },
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => {
      const next = rememberPlaces(
        context,
        input.center ? [input.center, ...input.places] : input.places,
      );
      next.nearbyPlaceIds = input.places.map((place) => place.id);
      return next;
    },
    database,
  );
}

export function recordRoute(
  key: GeographicContextKey,
  route: MapRoute,
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => {
      const next = rememberPlaces(context, [route.origin, route.destination]);
      next.activeRoute = route;
      next.conversationalReferences = {
        ...next.conversationalReferences,
        origin: route.origin.id,
        destination: route.destination.id,
        there: route.destination.id,
      };
      return next;
    },
    database,
  );
}

export function recordViewport(
  key: GeographicContextKey,
  viewport: MapViewport,
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => ({ ...context, viewport }),
    database,
  );
}

export function recordCurrentLocation(
  key: GeographicContextKey,
  location: CurrentLocation,
  place?: MapPlace | null,
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => {
      const next = place ? rememberPlaces(context, [place]) : { ...context };
      next.currentLocation = place ? { ...location, placeId: place.id } : location;
      return next;
    },
    database,
  );
}

export function clearActiveRoute(
  key: GeographicContextKey,
  database: Db = db,
): GeographicContext {
  return mutateGeographicContext(
    key,
    (context) => {
      const next = { ...context };
      delete next.activeRoute;
      return next;
    },
    database,
  );
}
