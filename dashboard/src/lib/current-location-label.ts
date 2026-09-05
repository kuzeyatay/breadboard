import type { MapPlace } from "./map/types.ts";

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Reduce a detailed reverse-geocoder result to the one line Profile needs. */
export function currentLocationLabel(place: MapPlace | null): string | null {
  if (!place) return null;
  const locality = text(
    place.address?.city ??
      place.address?.district ??
      place.address?.state ??
      place.name,
  );
  const country = text(place.address?.country);

  if (
    locality &&
    country &&
    locality.localeCompare(country, undefined, { sensitivity: "accent" }) !== 0
  ) {
    return `${locality}, ${country}`.slice(0, 160);
  }
  return (locality || country || null)?.slice(0, 160) ?? null;
}
