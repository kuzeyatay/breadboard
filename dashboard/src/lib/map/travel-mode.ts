// Automatic travel-mode selection shared by the map UI and map operations.
//
// The straight-line calculation is used only to choose which real Valhalla
// route to request. It is never shown as a route distance or used to estimate a
// duration; those values still come exclusively from the routing provider.

import {
  TRAVEL_MODES,
  type MapPlace,
  type MapRoute,
  type TravelMode,
} from "./types.ts";

export const ROUTE_MODE_PREFERENCES = ["auto", ...TRAVEL_MODES] as const;
export type RouteModePreference = (typeof ROUTE_MODE_PREFERENCES)[number];

/** Beyond this, walking is no longer the sensible automatic default. */
export const AUTO_WALKING_MAX_DISTANCE_METERS = 3_000;

type Coordinate = Pick<MapPlace, "lat" | "lon">;

function straightLineDistanceMeters(
  origin: Coordinate,
  destination: Coordinate,
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (destination.lat - origin.lat) * radians;
  const longitudeDelta = (destination.lon - origin.lon) * radians;
  const originLatitude = origin.lat * radians;
  const destinationLatitude = destination.lat * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function automaticTravelMode(
  origin: Coordinate,
  destination: Coordinate,
): TravelMode {
  return straightLineDistanceMeters(origin, destination) <=
    AUTO_WALKING_MAX_DISTANCE_METERS
    ? "walking"
    : "driving";
}

/** A nearby point can still require a long detour around water or roads. */
export function automaticWalkingRouteIsTooLong(
  preference: RouteModePreference,
  route: Pick<MapRoute, "distanceMeters" | "mode">,
): boolean {
  return (
    preference === "auto" &&
    route.mode === "walking" &&
    route.distanceMeters > AUTO_WALKING_MAX_DISTANCE_METERS
  );
}
