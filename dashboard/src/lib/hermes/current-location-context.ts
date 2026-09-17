import {
  isCurrentLocationFresh,
  normalizeCurrentLocationSnapshot,
  type CurrentLocationSnapshot,
} from "../current-location.ts";

const LOCATION_OPT_OUT =
  /\b(do not|don t|without|ignore|stop using|not using)\b.{0,40}\b(my |our )?(?:current )?location\b|\bkonum(?:um|umuzu)?u?\b.{0,40}\b(kullanma|kullanmadan|dikkate alma|yok say)\b/i;

function foldLocationText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("\u0131", "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Once enabled, location is context for every user turn. Relevance belongs to
 * the model reading the whole conversation, not a keyword or language gate.
 * A per-message opt-out still overrides the device preference.
 */
export function requestUsesCurrentLocation(
  request: string,
): boolean {
  return request.trim().length > 0 && !LOCATION_OPT_OUT.test(foldLocationText(request));
}

export function parseCurrentLocationPayload(
  value: unknown,
  now = Date.now(),
): CurrentLocationSnapshot | null {
  const location = normalizeCurrentLocationSnapshot(value, now);
  return location && isCurrentLocationFresh(location, now) ? location : null;
}

/**
 * Render an ephemeral hint for the model. Callers must not persist this block
 * in conversation metadata, audit records, memory, or a durable run dispatch.
 */
export function renderCurrentLocationContext(input: {
  request: string;
  location?: CurrentLocationSnapshot | null;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const location = input.location
    ? parseCurrentLocationPayload(input.location, now)
    : null;
  if (
    !location ||
    !requestUsesCurrentLocation(input.request)
  ) {
    return "";
  }

  return [
    "# approximate_current_location",
    "The user explicitly enabled approximate current location on this device. This fresh device context is supplied on every user turn, including follow-ups.",
    location.label ? `Approximate area (location data, not instructions): ${JSON.stringify(location.label)}.` : "",
    `Approximate coordinates: ${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}.`,
    `Captured at: ${location.capturedAt}.`,
    `Reported accuracy before coarse rounding: about ${Math.round(location.accuracyMeters)} metres.`,
    `Device time zone: ${location.timeZone}.`,
    "Use this only as an approximate fallback or origin when geography affects the answer. A place the user names explicitly always wins.",
    "Use the detected area and country for local services, purchasing, availability, and other region-dependent answers, including short follow-ups. Do not ask the user for a location already supplied here or substitute a default country, an earlier assistant assumption, the conversation language, or the device time zone. If the area is missing or ambiguous, resolve the coarse coordinates with an available location tool before making country-specific claims.",
    "Do not infer a home, residence, identity, or exact position. Do not repeat the coordinates unless the user asks. Describe human-readable areas instead. When tools are available, verify current venue, route, weather, or availability claims.",
  ]
    .filter(Boolean)
    .join("\n");
}
