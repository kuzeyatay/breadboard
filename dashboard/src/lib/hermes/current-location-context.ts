import {
  isCurrentLocationFresh,
  normalizeCurrentLocationSnapshot,
  type CurrentLocationSnapshot,
} from "../current-location.ts";

const DIRECT_LOCATION_REFERENCE =
  /\b(near me|near us|nearby|around here|where i am|where we are|my location|our location|current location|closest|nearest|close to me|close to us|walking distance|within walking distance|from here|bana yakin|bize yakin|yakinimda|yakininda|yakinda|yakinlarda|buralarda|cevremde|konumum|bulundugum yer|en yakin|yurume mesafesi|buradan|burada ne)\b/i;

const ORIGIN_SENSITIVE_SUBJECT =
  /\b(weather|forecast|temperature|air quality|sunrise|sunset|local time|directions?|route|commute|travel time|hava|hava durumu|sicaklik|hava kalitesi|gunesin dogusu|gunesin batisi|yerel saat|yol tarifi|rota|ulasim suresi)\b/i;

const LOCATION_SENSITIVE_SUBJECT =
  /\b(weather|forecast|temperature|air quality|sunrise|sunset|time zone|local time|directions?|route|commute|travel time|delivery|places?|venues?|restaurants?|cafes?|coffee shops?|bars?|museums?|galler(?:y|ies)|exhibitions?|events?|concerts?|shows?|tours?|activities|experiences?|attractions?|hotels?|shops?|stores?|hava|hava durumu|sicaklik|hava kalitesi|gunesin dogusu|gunesin batisi|saat dilimi|yerel saat|yol tarifi|rota|ulasim|teslimat|mekan(?:lar)?|yer(?:ler)?|restoran(?:lar)?|kafe(?:ler)?|kahveci(?:ler)?|bar(?:lar)?|muze(?:ler|si)?|sergi(?:ler)?|etkinlik(?:ler)?|konser(?:ler)?|aktivite(?:ler)?|deneyim(?:ler)?|otel(?:ler)?|magaza(?:lar)?)\b/i;

const LOCAL_DECISION_LANGUAGE =
  /\b(recommend(?:ation)?s?|suggest(?:ion)?s?|find (?:me|us)|best|top|good|great|interesting|unusual|where should|what should (?:i|we)|which|things? to do|places? to (?:visit|eat|stay|go)|what to do|worth (?:visiting|trying)|oner\w*|tavsiye|bul|hangi|en iyi|iyi|ilginc|degisik|guzel|gezilecek|ne yap|nereye|nerede|mesela|baska)\b/i;

const LOCATION_FOLLOW_UP =
  /\b(closer|nearer|what about|how about|another one|what else|more like that|buna daha yakin|daha yakin|peki|baska ne|onun gibi|buna benzer)\b/i;

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

function isLocationSensitiveRequest(value: string): boolean {
  const text = foldLocationText(value);
  if (!text || LOCATION_OPT_OUT.test(text)) return false;
  if (DIRECT_LOCATION_REFERENCE.test(text)) return true;
  if (ORIGIN_SENSITIVE_SUBJECT.test(text)) return true;
  return (
    LOCATION_SENSITIVE_SUBJECT.test(text) &&
    LOCAL_DECISION_LANGUAGE.test(text)
  );
}

function isLocationFollowUp(value: string): boolean {
  const text = foldLocationText(value);
  return !LOCATION_OPT_OUT.test(text) && LOCATION_FOLLOW_UP.test(text);
}

function hasActiveLocationContext(priorRequests: readonly string[]): boolean {
  for (let index = priorRequests.length - 1; index >= 0; index -= 1) {
    const request = priorRequests[index]?.trim();
    if (!request) continue;
    if (isLocationSensitiveRequest(request)) return true;
    if (!isLocationFollowUp(request)) return false;
  }
  return false;
}

/**
 * Current location is useful only for geographic questions. This predicate is
 * shared by the browser and the server: the browser avoids attaching location
 * to unrelated messages, and the server independently refuses a forged extra.
 */
export function requestUsesCurrentLocation(
  request: string,
  priorRequests: readonly string[] = [],
): boolean {
  return (
    isLocationSensitiveRequest(request) ||
    (isLocationFollowUp(request) && hasActiveLocationContext(priorRequests))
  );
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
  priorRequests?: readonly string[];
  location?: CurrentLocationSnapshot | null;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const location = input.location
    ? parseCurrentLocationPayload(input.location, now)
    : null;
  if (
    !location ||
    !requestUsesCurrentLocation(input.request, input.priorRequests ?? [])
  ) {
    return "";
  }

  return [
    "# approximate_current_location",
    "The user explicitly enabled approximate current location for relevant answers on this device.",
    `Approximate coordinates: ${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}.`,
    `Captured at: ${location.capturedAt}.`,
    `Reported accuracy before coarse rounding: about ${Math.round(location.accuracyMeters)} metres.`,
    `Device time zone: ${location.timeZone}.`,
    "Use this only as an approximate fallback or origin when geography affects the answer. A place the user names explicitly always wins.",
    "Do not infer a home, residence, identity, or exact position. Do not repeat the coordinates unless the user asks. Describe human-readable areas instead. When tools are available, verify current venue, route, weather, or availability claims.",
  ]
    .filter(Boolean)
    .join("\n");
}
