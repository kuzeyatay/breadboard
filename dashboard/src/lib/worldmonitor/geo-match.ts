// Pinning a headline to a place. Ported from the worldmonitor clone
// (github.com/koala73/worldmonitor, AGPL-3.0) — upstream's
// `src/utils/keyword-match.ts` and the matching half of `geo-hub-index.ts`.
//
// Matching is token-based rather than substring-based so "Iran" does not fire
// on "Iranian-American" the way a naive `includes` would, while inflections
// ("iran" → "iranian", "israel" → "israeli") still land on the right hub.

import { GEO_HUBS, type GeoHubLocation } from "./geo-hubs.ts";

interface TokenizedTitle {
  words: Set<string>;
  ordered: string[];
}

const INFLECTION_SUFFIXES = new Set([
  "s", "es", "ian", "ians", "ean", "eans", "an", "ans", "n", "ns", "i", "is", "ish", "ese",
]);
const MIN_SUFFIX_KEYWORD_LEN = 4;

export function tokenizeForMatch(title: string): TokenizedTitle {
  const lower = title.toLowerCase();
  const words = new Set<string>();
  const ordered: string[] = [];
  for (const raw of lower.split(/\s+/)) {
    const cleaned = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (!cleaned) continue;
    words.add(cleaned);
    ordered.push(cleaned);
    for (const part of cleaned.split(/[^a-z0-9]+/)) {
      if (part) words.add(part);
    }
  }
  return { words, ordered };
}

function hasSuffix(word: string, keyword: string): boolean {
  if (word.length <= keyword.length) return false;
  if (word.startsWith(keyword)) {
    if (INFLECTION_SUFFIXES.has(word.slice(keyword.length))) return true;
  }
  if (keyword.endsWith("e")) {
    const stem = keyword.slice(0, -1);
    if (word.length > stem.length && word.startsWith(stem)) {
      if (INFLECTION_SUFFIXES.has(word.slice(stem.length))) return true;
    }
  }
  return false;
}

function wordMatches(token: string, kwPart: string): boolean {
  if (token === kwPart) return true;
  return kwPart.length >= MIN_SUFFIX_KEYWORD_LEN ? hasSuffix(token, kwPart) : false;
}

function matchSingleWord(words: Set<string>, keyword: string): boolean {
  if (words.has(keyword)) return true;
  if (keyword.length < MIN_SUFFIX_KEYWORD_LEN) return false;
  for (const word of words) {
    if (hasSuffix(word, keyword)) return true;
  }
  return false;
}

export function matchKeyword(tokens: TokenizedTitle, keyword: string): boolean {
  const parts = keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (parts.length === 0) return false;
  if (parts.length === 1) return matchSingleWord(tokens.words, parts[0]!);

  const { ordered } = tokens;
  for (let i = 0; i <= ordered.length - parts.length; i++) {
    let match = true;
    for (let j = 0; j < parts.length; j++) {
      if (!wordMatches(ordered[i + j]!, parts[j]!)) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

interface GeoHubIndex {
  hubs: Map<string, GeoHubLocation>;
  byKeyword: Map<string, string[]>;
}

let cachedIndex: GeoHubIndex | null = null;

function buildGeoHubIndex(): GeoHubIndex {
  if (cachedIndex) return cachedIndex;

  const hubs = new Map<string, GeoHubLocation>();
  const byKeyword = new Map<string, string[]>();
  for (const hub of GEO_HUBS) {
    hubs.set(hub.id, hub);
    for (const kw of hub.keywords) {
      const lower = kw.toLowerCase();
      const existing = byKeyword.get(lower) ?? [];
      if (!existing.includes(hub.id)) {
        existing.push(hub.id);
        byKeyword.set(lower, existing);
      }
    }
  }

  cachedIndex = { hubs, byKeyword };
  return cachedIndex;
}

export interface GeoHubMatch {
  hubId: string;
  hub: GeoHubLocation;
  confidence: number;
  matchedKeyword: string;
}

/**
 * Hubs a headline names, most confident first. Confidence rises with the
 * length of the matched keyword — "kremlin" is a surer pin than "uk" — and is
 * nudged up for conflict/strategic sites and critical-tier hubs, which are the
 * ones a reader is scanning the map for.
 */
export function inferGeoHubsFromTitle(title: string): GeoHubMatch[] {
  const index = buildGeoHubIndex();
  const matches: GeoHubMatch[] = [];
  const tokens = tokenizeForMatch(title);
  const seenHubs = new Set<string>();

  for (const [keyword, hubIds] of index.byKeyword) {
    if (keyword.length < 2) continue;
    if (!matchKeyword(tokens, keyword)) continue;

    for (const hubId of hubIds) {
      if (seenHubs.has(hubId)) continue;
      seenHubs.add(hubId);

      const hub = index.hubs.get(hubId);
      if (!hub) continue;

      let confidence = 0.5;
      if (keyword.length >= 10) confidence = 0.9;
      else if (keyword.length >= 6) confidence = 0.75;
      else if (keyword.length >= 4) confidence = 0.6;

      if (hub.type === "conflict" || hub.type === "strategic") {
        confidence = Math.min(1, confidence + 0.1);
      }
      if (hub.tier === "critical") {
        confidence = Math.min(1, confidence + 0.1);
      }

      matches.push({ hubId, hub, confidence, matchedKeyword: keyword });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}
