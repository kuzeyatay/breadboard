// Geographic grounding: deciding when an answer must come from map data.
//
// The system prompt asks the model not to invent geography. This module is the
// part that does not depend on the model complying. It answers two questions
// with no model in the loop:
//
//   1. Does this request need a verified geographic fact?
//   2. Did the turn actually obtain one?
//
// The classification is structural rather than a keyword sweep: a request needs
// grounding when a *geographic intent* (locate, distance, travel time, route,
// proximity, hours, existence-at-a-place) is aimed at a *geographic referent*
// (a named place, a spatial preposition with an object, a deictic like "there",
// or a place Breadboard already has in structured state). "What is a
// roundabout?" carries no referent and is left alone; "Is there a roundabout
// outside Metropol İstanbul?" carries one and is not.

import type { GeographicContext } from "./types.ts";

export const MAP_TOOL_NAMES = [
  "map_search",
  "map_reverse",
  "map_route",
  "map_nearby",
  "map_place_details",
  "map_get_current_location",
  "map_get_viewport",
  "map_get_selected_place",
] as const;

/** The map tools that actually produce a geographic fact from map data. */
export const MAP_FACT_TOOL_NAMES: readonly string[] = [
  "map_search",
  "map_reverse",
  "map_route",
  "map_nearby",
  "map_place_details",
];

export function isMapTool(toolName: string): boolean {
  return (MAP_TOOL_NAMES as readonly string[]).includes(toolName);
}

export type GeographicAsk =
  | "locate"
  | "distance"
  | "travel_time"
  | "route"
  | "recommendation"
  | "proximity"
  | "hours"
  | "existence"
  | "address";

/* ------------------------------------------------------------------ */
/* Intent                                                              */
/* ------------------------------------------------------------------ */

const ASK_PATTERNS: { ask: GeographicAsk; pattern: RegExp }[] = [
  {
    ask: "locate",
    pattern:
      /\b(where (?:is|are|was|can i find)|whereabouts|locate|show me (?:on )?(?:the )?map|show me|find me|pin(?: it)? on the map|nerede|nerededir|nereda|haritada goster)\b/,
  },
  {
    ask: "distance",
    pattern:
      /\b(how far|what(?:'s| is) the distance|distance (?:from|to|between)|how many (?:km|kilometres|kilometers|miles|metres|meters)|ne kadar uzak|kac km|mesafe)\b/,
  },
  {
    ask: "travel_time",
    pattern:
      /\b(how long|how many minutes|travel time|takes? to (?:get|walk|drive|cycle|reach)|walking time|driving time|ne kadar surer|kac dakika|ne kadar zaman)\b/,
  },
  {
    ask: "route",
    pattern:
      /\b(directions?|route|how do i get|how can i get|take me to|navigate|get me to|drive to|walk to|cycle to|yol tarifi|nasil giderim|goturur musun)\b/,
  },
  {
    ask: "recommendation",
    pattern:
      /\b(?:(?:recommend|suggest|find)\w*|best|top|good|great|interesting|unusual|where should (?:i|we)|what should (?:i|we)|things? to do|places? to (?:visit|eat|stay|go)|what to do|worth (?:visiting|trying)|oner\w*|tavsiye\w*|en iyi|ilginc|degisik|guzel|gezilecek|ne yap\w*|nereye)\b.{0,70}\b(?:places?|venues?|restaurants?|cafes?|coffee shops?|bars?|museums?|galleries|exhibitions?|events?|concerts?|shows?|activities|experiences?|attractions?|hotels?|shops?|stores?|mekan\w*|yer\w*|restoran\w*|kafe\w*|kahveci\w*|bar\w*|muze\w*|sergi\w*|etkinlik\w*|konser\w*|aktivite\w*|deneyim\w*|otel\w*|magaza\w*)\b|\b(?:places?|venues?|restaurants?|cafes?|bars?|museums?|activities|attractions|hotels?|mekan\w*|yer\w*|restoran\w*|kafe\w*|bar\w*|muze\w*|aktivite\w*|otel\w*)\b.{0,70}\b(?:recommend|suggest|best|top|oner\w*|tavsiye\w*|en iyi|guzel|ilginc|degisik)\b/,
  },
  {
    ask: "proximity",
    pattern:
      /\b(near(?:by|est)?|closest|close to|around (?:here|there|me|us)|within walking distance|in the area|next to|(?:what|which) (?:is|are) around (?!\d)|(?:restaurants?|cafes?|bars?|hotels?|shops?|stores?|museums?|parks?|pharmac(?:y|ies)|places?|things to do)\b.{0,40}\baround|yakin(?:in|da|inda)?|en yakin|civarinda|yakinlarinda)\b/,
  },
  {
    ask: "hours",
    pattern:
      /\b(opening hours|open(?:ing)? time|what time does .{0,40}\b(?:open|close)|is .{0,40}\bopen (?:now|today)|acilis saat|kacta acilir|kacta kapanir)\b/,
  },
  {
    ask: "address",
    pattern:
      /\b(address|postcode|post code|zip code|what street|which street|adres|posta kodu)\b/,
  },
  {
    ask: "existence",
    pattern:
      /\b(is there (?:a|an|any)|are there (?:any)?|do they have (?:a|an)|any .{0,30}\b(?:near|around|in|at)\b|var mi|bulunur mu)\b/,
  },
];

/* ------------------------------------------------------------------ */
/* Referent                                                            */
/* ------------------------------------------------------------------ */

/** A spatial preposition followed by something to be spatial about. */
const SPATIAL_PHRASE =
  /\b(near|nearby|around|close to|next to|beside|outside|inside|opposite|within|in|at|from|to|between)\s+(?:the\s+|a\s+|an\s+)?([\p{Lu}\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}\p{M}'’.-]+){0,4})/u;

const DEICTIC =
  /\b(here|near me|near us|around me|my location|our location|current location|this place|this spot|burada|burasi|orada|orasi|bana yakin|konumum)\b|(?<!\b(?:is|are|was|were)\s)\bthere\b(?!\s+(?:is|are|was|were|s\b))/;

/**
 * "The nearest pharmacy" names no place, but it is unmistakably about one: the
 * anchor is the user's own position or the visible map, which is exactly what
 * Breadboard's structured state holds. Treated as a referent so the question is
 * answered from POI data rather than from a chain the model happens to know.
 */
const IMPLICIT_ANCHOR = /\b(nearest|closest|near me|near us|around here|nearby)\b/;

/**
 * A short refinement of the previous geographic request. These phrases do not
 * name the venue category again, but abandoning the map here is exactly how
 * "not too far, no farther than Galataport" turns into an invented shortlist.
 */
const GEOGRAPHIC_FOLLOW_UP =
  /\b(?:another|something else|closer|farther|further|not too far|no farther than|no further than|within|up to|at most|by car|on foot|walking|driving|cycling|baska|daha yakin|cok uzak olmasin|uzak olmasin|en fazla|kadar|yuruyerek|arabayla|bisikletle)\b/;

/** Two or more capitalised words in a row, or one capitalised non-sentence-initial word. */
const PROPER_NOUN = /(?:^|[^.!?]\s)([\p{Lu}][\p{L}\p{M}'’-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’-]+)+)/u;

/* ------------------------------------------------------------------ */
/* Exclusions                                                          */
/* ------------------------------------------------------------------ */

/** Asking what a word means is not asking where something is. */
const DEFINITIONAL =
  /\b(what (?:is|are) (?:a|an|the)?\s*(?:difference|meaning)?|what does .{0,40}\bmean\b|define|definition of|explain (?:what|how|why)|how does .{0,40}\bwork\b|why (?:do|does|is|are)|ne demek|nedir|nasil calisir)\b/;

/** Fiction, code and hypotheticals are not claims about the world. */
const NON_FACTUAL =
  /\b(?:write|draft|compose)\s+(?:a|an|me|us)?\s*(?:\w+\s+){0,2}(?:story|poem|song|script|essay|novel|fiction|scene)\b|\b(imagine|pretend|hypothetical|in a video game|for a novel|make up|invent)\b/;

/**
 * Words that put "nearest", "distance" or "where" inside a different subject.
 * "What's the closest thing to a decorator in Go?" is not a POI question, and
 * the implicit-anchor rule above would otherwise make it one.
 */
const NON_GEOGRAPHIC_DOMAIN =
  /\b(code|codebase|source file|files?|functions?|variables?|packages?|repos?|repositor(?:y|ies)|endpoints?|databases?|schemas?|components?|typescript|javascript|python|regexe?s?|commits?|branch(?:es)?|compilers?|algorithms?|api)\b/;

/**
 * Navigation verbs also target websites and app screens. Remove only those
 * clauses before looking for geographic intent, preserving a separate request
 * for real directions. The target must end at a clause boundary: "Instagram
 * headquarters" is a physical destination, unlike "Instagram" on its own.
 * Match the original text so URLs retain their dots and slashes.
 */
const DIGITAL_NAVIGATION = new RegExp(
  [
    /\b(?:navigate(?: me)? to|take me to|get me to|go to|open|visit)\s+(?:the\s+)?/.source,
    "(?:",
    [
      /https?:\/\/[^\s,;]+|(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#][^\s,;]*)?/.source,
      /(?:instagram|facebook|youtube|tiktok|twitter|reddit|linkedin|github|gmail|spotify|whatsapp|discord|chatgpt)(?:'s)?(?:\s+(?:website|site|app|profile|page|homepage))?/.source,
      /(?:[\p{L}\p{N}'’-]+\s+){0,5}(?:website|webpage|web page|homepage|home page|settings|dashboard|browser tab)/u.source,
    ].join("|"),
    ")",
    /(?:\s+in\s+(?:(?:my|the|a)\s+)?(?:browser|chrome|edge|firefox|safari|new tab))?/.source,
    /(?=\s*(?:$|[.!?,;]|\b(?:and|then)\b))/.source,
  ].join(""),
  "giu",
);

const OPT_OUT =
  /\b(?:do not|don'?t|without|no need to|skip)\b.{0,30}\b(?:use|check|call|look up)?\s*(?:the )?(?:map|maps|map tools?)\b/;

export function foldRequestText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s'’-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GeographicGroundingAssessment {
  required: boolean;
  asks: GeographicAsk[];
  /** Why the classifier decided as it did; recorded in the audit trail. */
  reason: string;
}

/**
 * Does answering this request require a verified geographic fact?
 *
 * `structuredPlaceAvailable` is a genuine referent: when Breadboard already has
 * a selected place or an active route, "how long would it take to walk there?"
 * is unambiguously about that place even though the sentence names none.
 */
export function requiresGeographicGrounding(
  request: string,
  options: {
    priorRequests?: readonly string[];
    structuredPlaceAvailable?: boolean;
  } = {},
): GeographicGroundingAssessment {
  const original = (request ?? "").trim();
  if (!original) return { required: false, asks: [], reason: "empty request" };
  const raw = original.replace(DIGITAL_NAVIGATION, " ").trim();
  const folded = foldRequestText(raw);

  if (OPT_OUT.test(folded)) {
    return { required: false, asks: [], reason: "user opted out of map lookups" };
  }
  if (NON_FACTUAL.test(folded)) {
    return { required: false, asks: [], reason: "fictional or hypothetical framing" };
  }

  let asks = ASK_PATTERNS.filter(({ pattern }) => pattern.test(folded)).map(
    ({ ask }) => ask,
  );
  if (!asks.length && GEOGRAPHIC_FOLLOW_UP.test(folded)) {
    const inherited = [...(options.priorRequests ?? [])]
      .reverse()
      .map((prior) => requiresGeographicGrounding(prior))
      .find((assessment) => assessment.required);
    if (inherited) asks = inherited.asks;
  }
  if (!asks.length) {
    return { required: false, asks: [], reason: "no geographic intent" };
  }

  const hasDeictic = DEICTIC.test(folded) || IMPLICIT_ANCHOR.test(folded);
  const hasSpatialPhrase = SPATIAL_PHRASE.test(raw);
  const hasProperNoun = PROPER_NOUN.test(` ${raw}`);
  const hasReferent =
    hasDeictic ||
    hasProperNoun ||
    hasSpatialPhrase ||
    asks.includes("recommendation") ||
    options.structuredPlaceAvailable === true;

  // A question about software that happens to use spatial words is not a
  // question about the world.
  if (NON_GEOGRAPHIC_DOMAIN.test(folded) && !hasProperNoun) {
    return { required: false, asks, reason: "spatial wording inside a non-geographic subject" };
  }

  // A definition question with no referent at all ("what is a roundabout?") is
  // knowledge work. The same question aimed at a place is not.
  if (
    DEFINITIONAL.test(folded) &&
    !hasDeictic &&
    !hasProperNoun &&
    !hasSpatialPhrase
  ) {
    return {
      required: false,
      asks,
      reason: "definitional question with no place referent",
    };
  }
  if (!hasReferent) {
    return { required: false, asks, reason: "geographic intent with no referent" };
  }

  const referent = hasDeictic
    ? "a deictic reference"
    : hasProperNoun
      ? "a named place"
    : hasSpatialPhrase
        ? "a spatial phrase"
        : asks.includes("recommendation")
          ? "a requested real-world place recommendation"
          : "a place in Breadboard's geographic state";
  return {
    required: true,
    asks,
    reason: `${asks.join("/")} aimed at ${referent}`,
  };
}

/** Convenience for callers holding the conversation's structured state. */
export function requiresGeographicGroundingInContext(
  request: string,
  context: Pick<GeographicContext, "selectedPlaceId" | "activeRoute"> | null,
  priorRequests: readonly string[] = [],
): GeographicGroundingAssessment {
  return requiresGeographicGrounding(request, {
    priorRequests,
    structuredPlaceAvailable: Boolean(
      context?.selectedPlaceId || context?.activeRoute,
    ),
  });
}

/* ------------------------------------------------------------------ */
/* Answer-side enforcement                                             */
/* ------------------------------------------------------------------ */

/**
 * Sentences that assert a geographic fact. Matching one of these in an answer
 * with no successful map evidence behind it is the failure this whole feature
 * exists to prevent, so each is reported as an unsupported claim.
 */
const GEOGRAPHIC_CLAIMS: { pattern: RegExp; claim: string }[] = [
  {
    pattern:
      /\b\d+(?:[.,]\d+)?\s?(?:km|kilometres?|kilometers?|miles?|metres?|meters?)\b[^.\n]{0,60}\b(?:away|from|to|walk\w*|driv\w*|cycl\w*|apart|on foot|by car|by bike|journey|trip)\b/i,
    claim: "Distance claim has no successful map-service result behind it.",
  },
  {
    // A bare "m" is only a metre in lowercase and only when it is not a
    // magnitude suffix on money. Case-insensitively, this alternative used to
    // read "$403M to $935M" as four hundred and three metres, and flagged a
    // report about robotics funding for making an unsourced distance claim.
    pattern:
      /(?<![$€£¥])\b\d+(?:[.,]\d+)?\s?m\b[^.\n]{0,60}\b(?:away|from|to|walk\w*|driv\w*|cycl\w*|apart|on foot|by car|by bike|journey|trip)\b/,
    claim: "Distance claim has no successful map-service result behind it.",
  },
  {
    pattern: /\b(?:about|roughly|around|approximately|takes?|it'?s)\b.{0,30}\b\d+\s?(?:minute|min|hour|hr)s?\b.{0,40}\b(?:walk|on foot|drive|driving|cycle|cycling|away|to get)\b/i,
    claim: "Travel-time claim has no successful routing result behind it.",
  },
  {
    pattern: /\b(?:the address is|located at|situated at|it'?s at)\b\s+\S/i,
    claim: "Address claim has no successful map-service result behind it.",
  },
  {
    pattern: /\b(?:coordinates?|latitude|longitude|lat\/lon)\b.{0,20}[-\d]/i,
    claim: "Coordinate claim has no successful map-service result behind it.",
  },
  {
    pattern: /\b(?:opens? at|closes? at|open from|opening hours are)\b/i,
    claim: "Opening-hours claim has no successful place-details result behind it.",
  },
  {
    pattern: /\b(?:the nearest|closest)\b.{0,40}\b(?:is|are)\b/i,
    claim: "Nearest-place claim has no successful POI result behind it.",
  },
];

export interface GeographicVerdict {
  /** The request needed map data. */
  required: boolean;
  /** A map tool that produces geographic facts succeeded on this turn. */
  satisfied: boolean;
  unsupportedClaims: string[];
}

/**
 * Judge one finished turn.
 *
 * `groundingRequired` comes from the request-side classification made before
 * dispatch, so an answer cannot talk its way out of needing evidence.
 */
export function assessGeographicGrounding(input: {
  groundingRequired: boolean;
  answer: string;
  /** Successful fact-producing map tool calls observed on this turn. */
  successfulMapFactTools: readonly string[];
}): GeographicVerdict {
  const satisfied = input.successfulMapFactTools.some((tool) =>
    MAP_FACT_TOOL_NAMES.includes(tool),
  );
  const answer = input.answer ?? "";
  const unsupportedClaims: string[] = [];
  if (!satisfied) {
    for (const { pattern, claim } of GEOGRAPHIC_CLAIMS) {
      if (pattern.test(answer) && !unsupportedClaims.includes(claim)) {
        unsupportedClaims.push(claim);
      }
    }
    if (input.groundingRequired && answer.trim() && !unsupportedClaims.length) {
      // The request needed map data and none was obtained. Even a hedged answer
      // is recorded as ungrounded so the turn cannot read as verified.
      unsupportedClaims.push(
        "This request needed verified map data, and no map tool returned a result.",
      );
    }
  }
  return {
    required: input.groundingRequired,
    satisfied,
    unsupportedClaims,
  };
}

/**
 * The server-authored system section for a turn that needs map grounding.
 * Deliberately narrow: it states the obligation for *this* request rather than
 * repeating the permanent rules, which live in the Hermes system prompt.
 */
export function renderGeographicGroundingDirective(
  assessment: GeographicGroundingAssessment,
): string {
  if (!assessment.required) return "";
  return [
    "# geographic_grounding_required",
    `Breadboard classified this request as needing verified map data (${assessment.reason}).`,
    "Use the map tools before making any factual geographic claim in your answer.",
    "Resolve every named place with map_search and carry its placeId; do not pass names or coordinates to map_route or map_nearby.",
    ...(assessment.asks.includes("recommendation")
      ? ["For place recommendations, resolve the requested area and call map_nearby; a prose shortlist or map_search alone is not a recommendation result."]
      : []),
    ...(assessment.asks.includes("route")
      ? ["For directions, call map_route with includeSteps: true so the native map can show the requested route and its instructions."]
      : []),
    "Quote the distance, duration, address and opening hours exactly as the tools returned them. Do not convert, round further, or estimate.",
    "If a tool fails or returns nothing, say the information could not be verified from the available map data. Do not answer from memory.",
    "If several places match and Breadboard's geographic state does not resolve the ambiguity, ask the user which one they mean.",
  ].join("\n");
}
