// Ported from the worldmonitor clone (github.com/koala73/worldmonitor, AGPL-3.0)
// — upstream's `shared/story-identity.js`, converted to TypeScript with the
// algorithm and the tuned constants unchanged.
//
// This is the single answer to "are these two headlines the same story?", and
// it is what makes corroboration meaningful: when nine sources carry one event,
// the monitor should say so once and count the nine, not print nine rows.
//
// Method: dual-view feature-hashed lexical vectors, similarity = the MIN of the
// two views' cosines. The uniform view weights every token flat and so notices
// action swaps ("seizes tanker" vs "threatens to close"); the boosted view
// weights entity-shaped and numeric tokens up and so notices actor swaps
// ("Turkey hikes rates" vs "Argentina hikes rates"). Each view is blind to the
// failure the other catches, so a pair only merges when both agree.

const DIM = 512;

/** Tuned upstream on a labeled pair set; positives ≥ 0.634, negatives ≤ 0.595. */
export const STORY_SIMILARITY_THRESHOLD = 0.615;

const WEIGHT_TOKEN = 2.0;
const WEIGHT_BIGRAM = 1.5;
const WEIGHT_CHARGRAM = 1.0;
const BOOST_ENTITY = 3.0;
const BOOST_NUMBER = 2.0;

/** FNV-1a 32-bit, seeded so one feature yields both an index and a sign. */
function fnv1a(str: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function normalizeStoryText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonAscii(token: string): boolean {
  for (let i = 0; i < token.length; i++) {
    if (token.charCodeAt(i) > 127) return true;
  }
  return false;
}

// Google News wraps every title with a publisher suffix. Left in, the publisher
// token is capitalized (so entity-boosted) and shared by every story from that
// publisher, which drags unrelated stories toward a false merge.
const ATTRIBUTION_SUFFIX_RES = [
  /\s*[-–—|]\s*[\w\s.]+\.(?:com|org|net|co\.uk)\s*$/i,
  /\s*[-–—|]\s*(?:reuters|ap news|bbc|cnn|al jazeera|france 24|dw news|pbs newshour|cbs news|nbc|abc|associated press|the guardian|nos nieuws|tagesschau|cnbc|the national)\s*$/i,
];

/** Clamp after suffix stripping — char-4gram loops are O(length). */
const MAX_IDENTITY_CHARS = 300;

export function stripAttributionSuffix(text: string): string {
  let out = text || "";
  for (const re of ATTRIBUTION_SUFFIX_RES) out = out.replace(re, "");
  return out;
}

/** Cheap pre-filter keys: only titles sharing a token get scored as a pair. */
export function candidateTokens(text: string): Set<string> {
  const out = new Set<string>();
  const clamped = stripAttributionSuffix(text).slice(0, MAX_IDENTITY_CHARS);
  for (const tok of normalizeStoryText(clamped).split(" ")) {
    if (!tok) continue;
    if (isNonAscii(tok)) {
      out.add(tok);
      for (let i = 0; i + 2 <= tok.length; i++) out.add(tok.slice(i, i + 2));
    } else if (tok.length >= 3) {
      out.add(tok);
    }
  }
  return out;
}

/** Case is read from the RAW text — lowercasing first loses the entity signal. */
function contentTokens(text: string): Array<{ tok: string; boost: number }> {
  const kept: Array<{ tok: string; boost: number }> = [];
  const clamped = stripAttributionSuffix(text).slice(0, MAX_IDENTITY_CHARS);
  for (const raw of clamped.split(/\s+/)) {
    const clean = raw.replace(/[^\p{L}\p{N}]/gu, "");
    if (!clean) continue;
    const tok = clean.toLowerCase();
    if (!isNonAscii(tok) && tok.length < 3) continue;
    const capitalized = /^\p{Lu}/u.test(clean);
    const hasDigit = /\p{N}/u.test(clean);
    kept.push({ tok, boost: hasDigit ? BOOST_NUMBER : capitalized ? BOOST_ENTITY : 1 });
  }
  return kept;
}

function addFeature(vec: Float64Array, feature: string, weight: number): void {
  const idx = fnv1a(feature, 0) % DIM;
  const sign = (fnv1a(feature, 0x9e3779b9) & 1) === 1 ? 1 : -1;
  vec[idx]! += sign * weight;
}

function l2normalize(vec: Float64Array): Float64Array | null {
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  for (let i = 0; i < DIM; i++) vec[i]! /= norm;
  return vec;
}

export interface StoryVector {
  u: Float64Array;
  b: Float64Array;
  /** Token set, carried for the containment rescue below. */
  t: Set<string>;
}

export function storyVector(text: string): StoryVector | null {
  const tokens = contentTokens(text);
  if (tokens.length === 0) return null;

  const u = new Float64Array(DIM);
  const b = new Float64Array(DIM);
  for (let i = 0; i < tokens.length; i++) {
    const { tok, boost } = tokens[i]!;
    addFeature(u, `w:${tok}`, WEIGHT_TOKEN);
    addFeature(b, `w:${tok}`, WEIGHT_TOKEN * boost);

    if (i + 1 < tokens.length) {
      const bigram = `b:${tok} ${tokens[i + 1]!.tok}`;
      addFeature(u, bigram, WEIGHT_BIGRAM);
      addFeature(b, bigram, WEIGHT_BIGRAM);
    }

    if (isNonAscii(tok)) {
      // Unsegmented scripts produce no whitespace tokens; char bigrams carry it.
      for (let j = 0; j + 2 <= tok.length; j++) {
        const g = `c2:${tok.slice(j, j + 2)}`;
        addFeature(u, g, WEIGHT_CHARGRAM);
        addFeature(b, g, WEIGHT_CHARGRAM);
      }
    }

    if (tok.length >= 4) {
      const padded = `<${tok}>`;
      for (let j = 0; j + 4 <= padded.length; j++) {
        const g = `c4:${padded.slice(j, j + 4)}`;
        addFeature(u, g, WEIGHT_CHARGRAM);
        addFeature(b, g, WEIGHT_CHARGRAM);
      }
    }
  }

  const un = l2normalize(u);
  const bn = l2normalize(b);
  if (!un || !bn) return null;
  return { u: un, b: bn, t: new Set(tokens.map((entry) => entry.tok)) };
}

function dot(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}

// A headline truncated by an RSS feed to ~40% of its tokens is still the same
// story, but its cosine falls under threshold. Token containment rescues that
// class — with a floor on the smaller side, so a fragment like "Iran" cannot.
const CONTAINMENT_RESCUE_MIN_TOKENS = 4;
const CONTAINMENT_RESCUE_RATIO = 0.9;
const CONTAINMENT_RESCUE_SCORE = 0.9;

export function cosineSimilarity(
  a: StoryVector | null,
  b: StoryVector | null,
): number {
  if (!a || !b) return 0;
  const score = Math.min(dot(a.u, b.u), dot(a.b, b.b));
  if (score < CONTAINMENT_RESCUE_SCORE && a.t && b.t) {
    const [small, large] = a.t.size <= b.t.size ? [a.t, b.t] : [b.t, a.t];
    if (small.size >= CONTAINMENT_RESCUE_MIN_TOKENS) {
      let shared = 0;
      for (const tok of small) if (large.has(tok)) shared++;
      if (shared / small.size >= CONTAINMENT_RESCUE_RATIO) {
        return CONTAINMENT_RESCUE_SCORE;
      }
    }
  }
  return score;
}

export function storySimilarity(textA: string, textB: string): number {
  return cosineSimilarity(storyVector(textA), storyVector(textB));
}

// A token shared by more titles than this is the batch's "the": no clustering
// signal, but it drives O(bucket²) scoring. Pairs joined only by an ultra-hot
// token almost always share a rarer one too.
const MAX_CANDIDATE_BUCKET = 250;

/**
 * Same-story groups as connected components over the "similarity ≥ threshold"
 * edge set. Components rather than a greedy first-seed pass, because feed
 * arrival order varies run to run and greedy assignment would let a chain
 * (A~B, B~C, A≁C) land C in or out of A's group depending on which arrived
 * first — the cluster, and everything keyed off it, would churn for free.
 *
 * @returns clusters of indices into `texts`, ordered by smallest member.
 */
export function clusterTexts(
  texts: string[],
  opts: { threshold?: number } = {},
): number[][] {
  const threshold =
    typeof opts.threshold === "number" ? opts.threshold : STORY_SIMILARITY_THRESHOLD;
  const vectors = texts.map((t) => storyVector(t));
  const tokenSets = texts.map((t) => candidateTokens(t));

  const invertedIndex = new Map<string, number[]>();
  for (let i = 0; i < texts.length; i++) {
    for (const token of tokenSets[i]!) {
      const bucket = invertedIndex.get(token);
      if (bucket) bucket.push(i);
      else invertedIndex.set(token, [i]);
    }
  }

  const parent = new Array<number>(texts.length);
  for (let i = 0; i < texts.length; i++) parent[i] = i;

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Smaller index wins so the result is order-independent.
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  // Verbatim syndications union first: a mega-story pushes every one of its
  // tokens past MAX_CANDIDATE_BUCKET, so without this the most-corroborated
  // story of the day would be the one that degrades to singletons.
  const byExactText = new Map<string, number>();
  for (let i = 0; i < texts.length; i++) {
    const normalized = normalizeStoryText(texts[i]!);
    if (!normalized) continue;
    const first = byExactText.get(normalized);
    if (first === undefined) byExactText.set(normalized, i);
    else union(first, i);
  }

  for (let i = 0; i < texts.length; i++) {
    if (!vectors[i]) continue;
    const candidates = new Set<number>();
    for (const token of tokenSets[i]!) {
      const bucket = invertedIndex.get(token);
      if (!bucket || bucket.length > MAX_CANDIDATE_BUCKET) continue;
      for (const idx of bucket) if (idx > i) candidates.add(idx);
    }
    for (const j of candidates) {
      if (find(i) === find(j)) continue;
      if (cosineSimilarity(vectors[i]!, vectors[j]!) >= threshold) union(i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < texts.length; i++) {
    const root = find(i);
    const members = byRoot.get(root);
    if (members) members.push(i);
    else byRoot.set(root, [i]);
  }
  return Array.from(byRoot.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, members]) => members);
}
