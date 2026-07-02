// Tag normalization for the knowledge graph.
//
// Tags in this app are *connectors*: notes that share a tag become linked in the
// Quartz garden/graph. So a good tag is a Zettelkasten-style atomic idea — a
// reusable proposition or a specific named concept — not a broad category label.
// A tag should answer "what exact idea would make two notes worth connecting?",
// never "what broad topic is this note about?".
//
// This module is intentionally dependency-free (no fs / OpenAI / Quartz imports)
// so the scoring can be unit-verified in isolation.

/** Kebab-case slug used for tags, note filenames, and Quartz tag URLs. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}

export const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "into",
  "the",
  "then",
  "this",
  "that",
  "with",
  "about",
  "between",
  "through",
]);

// App, document-type, and learning-activity words that describe the container or
// the act of studying rather than an idea. Banned outright when they make up a
// whole tag, and penalized as a part of a longer tag.
const GENERIC_TAGS = new Set([
  "answer",
  "answers",
  "chat",
  "chat-note",
  "cluster",
  "concept",
  "concepts",
  "content",
  "data",
  "definition",
  "definitions",
  "doc",
  "docs",
  "document",
  "documents",
  "example",
  "examples",
  "exercise",
  "exercises",
  "file",
  "files",
  "garden",
  "garden-home",
  "general",
  "generated",
  "graph",
  "graphs",
  "graph-link",
  "graph-links",
  "homework",
  "important",
  "index",
  "information",
  "intro",
  "introduction",
  "knowledge",
  "knowledge-graph",
  "knowledge-map",
  "learning",
  "lecture",
  "lectures",
  "lesson",
  "lessons",
  "link",
  "links",
  "map",
  "maps",
  "markdown",
  "misc",
  "node",
  "nodes",
  "note",
  "notes",
  "other",
  "overview",
  "pdf",
  "quartz",
  "quartz-garden",
  "quartz-graph",
  "reading",
  "readings",
  "response",
  "responses",
  "revision",
  "source",
  "sources",
  "study",
  "studies",
  "studying",
  "summary",
  "text",
  "topic",
  "topics",
  "upload",
  "uploaded",
]);

// Broad subject / category words. A precise idea tag should replace these
// (e.g. `calculus` -> `jacobian-measures-local-area-scaling`). Like the generic
// set, these are rejected when they make up a whole tag and penalized otherwise,
// but they never disqualify a longer tag that also carries specific words.
const BROAD_DOMAIN = new Set([
  "algebra",
  "biology",
  "boundary",
  "calculus",
  "chemistry",
  "computing",
  "economics",
  "engineering",
  "equation",
  "equations",
  "force",
  "forces",
  "formula",
  "formulas",
  "frequency",
  "geometry",
  "history",
  "math",
  "mathematics",
  "maths",
  "oscillation",
  "oscillations",
  "philosophy",
  "physics",
  "programming",
  "psychology",
  "science",
  "sciences",
  "scientific",
  "statistics",
  "theory",
  "theories",
  "trigonometry",
  "wave",
  "waves",
]);

// Layout / deixis words that pin a tag to one spot in one document, so it could
// never connect two notes. Any tag containing one of these is rejected.
const NON_REUSABLE_WORDS = new Set([
  "fig",
  "figure",
  "figures",
  "page",
  "pages",
  "screenshot",
  "sketch",
  "slide",
  "slides",
  "slideshow",
  "thumbnail",
]);

// Relation / verb / comparison words that signal a tag is a proposition ("X is
// Y", "X creates Y", "X measures Y") rather than a bare noun. These are the most
// valuable connectors, so their presence is rewarded heavily.
const RELATION_WORDS = new Set([
  "accumulates",
  "affects",
  "are",
  "balances",
  "causes",
  "conserves",
  "constrains",
  "controls",
  "converts",
  "counts",
  "create",
  "creates",
  "decreases",
  "defines",
  "depends",
  "derives",
  "describes",
  "determines",
  "differ",
  "differs",
  "drives",
  "enables",
  "equals",
  "explains",
  "fails",
  "follows",
  "forms",
  "generates",
  "governs",
  "implies",
  "increases",
  "is",
  "limits",
  "maps",
  "maximizes",
  "measures",
  "minimizes",
  "models",
  "not",
  "opposes",
  "oscillates",
  "point",
  "points",
  "predicts",
  "prevents",
  "produces",
  "propagates",
  "relates",
  "represents",
  "requires",
  "restores",
  "scales",
  "sets",
  "transforms",
  "varies",
  "versus",
  "vs",
  "yields",
]);

const TAG_STOP_WORDS = new Set([
  ...STOP_WORDS,
  "all",
  "also",
  "any",
  "are",
  "based",
  "because",
  "before",
  "being",
  "can",
  "could",
  "does",
  "during",
  "each",
  "had",
  "has",
  "have",
  "how",
  "its",
  "into",
  "let",
  "may",
  "might",
  "must",
  "not",
  "now",
  "only",
  "our",
  "out",
  "over",
  "own",
  "per",
  "same",
  "set",
  "shall",
  "should",
  "since",
  "some",
  "such",
  "than",
  "their",
  "them",
  "then",
  "these",
  "those",
  "thus",
  "use",
  "used",
  "uses",
  "using",
  "via",
  "was",
  "were",
  "when",
  "where",
  "which",
  "while",
  "will",
  "within",
  "without",
  "would",
]);

// Idea tags may be short propositions, so we allow several words — but cap the
// length so a tag stays an atomic idea instead of becoming a whole sentence.
export const IDEA_TAG_MIN_WORDS = 2;
export const IDEA_TAG_MAX_WORDS = 9;
export const IDEA_TAG_MAX_CHARS = 80;
export const DEFAULT_MAX_TAGS = 8;

/** A broad category / generic word that should not stand on its own as a tag. */
function isBroadWord(word: string): boolean {
  return GENERIC_TAGS.has(word) || BROAD_DOMAIN.has(word);
}

function isUsefulTagSlug(tag: string): boolean {
  if (!tag || isBroadWord(tag) || TAG_STOP_WORDS.has(tag)) return false;
  if (/^\d+$/.test(tag)) return false;
  return tag.length >= 3 || tag === "ai" || tag === "ml";
}

function searchableTagText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagPartVariants(part: string): string[] {
  const variants = new Set([part]);
  if (part.length > 3 && part.endsWith("ies"))
    variants.add(`${part.slice(0, -3)}y`);
  if (part.length > 3 && part.endsWith("es")) variants.add(part.slice(0, -2));
  if (part.length > 3 && part.endsWith("s")) variants.add(part.slice(0, -1));
  if (part.length > 2) variants.add(`${part}s`);
  return [...variants];
}

/** Strict grounding: every meaningful word of the tag must appear in the source. */
function isGroundedTagSlug(tag: string, groundingText: string): boolean {
  const grounded = searchableTagText(groundingText);
  if (!grounded) return true;

  const phrase = tag.split("-").filter(Boolean).join(" ");
  if (
    phrase &&
    new RegExp(
      `(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`,
    ).test(grounded)
  ) {
    return true;
  }

  const groundedWords = new Set(grounded.split(/\s+/).filter(Boolean));
  const parts = tag
    .split("-")
    .filter((part) => part && !TAG_STOP_WORDS.has(part));
  if (parts.length === 0) return false;

  return parts.every((part) =>
    tagPartVariants(part).some((variant) => groundedWords.has(variant)),
  );
}

/**
 * Relaxed grounding for multi-word idea tags. The exact phrase, or a high enough
 * share of the tag's meaningful words, must appear in the source. Short tags
 * still require every word so they stay honest; longer propositions tolerate one
 * rephrased connective word.
 */
function isGroundedIdeaTag(tag: string, groundingText: string): boolean {
  const grounded = searchableTagText(groundingText);
  if (!grounded) return true;

  const phrase = tag.split("-").filter(Boolean).join(" ");
  if (
    phrase &&
    new RegExp(
      `(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`,
    ).test(grounded)
  ) {
    return true;
  }

  const groundedWords = new Set(grounded.split(/\s+/).filter(Boolean));
  const parts = tag
    .split("-")
    .filter((part) => part && !TAG_STOP_WORDS.has(part));
  if (parts.length === 0) return false;

  const present = parts.filter((part) =>
    tagPartVariants(part).some((variant) => groundedWords.has(variant)),
  ).length;

  if (parts.length <= 2) return present === parts.length;
  return present / parts.length >= 0.6;
}

/** Hard filters: keep only tags that could plausibly be a reusable idea link. */
function acceptIdeaTag(slug: string, groundingText: string): boolean {
  if (!slug) return false;
  const rawParts = slug.split("-").filter(Boolean);
  const words = rawParts.length;
  if (words < IDEA_TAG_MIN_WORDS || words > IDEA_TAG_MAX_WORDS) return false;
  if (slug.length > IDEA_TAG_MAX_CHARS) return false;
  if (/^\d+$/.test(slug)) return false;
  if (rawParts.some((part) => NON_REUSABLE_WORDS.has(part))) return false;

  const meaningful = rawParts.filter((part) => !TAG_STOP_WORDS.has(part));
  if (meaningful.length === 0) return false;
  // Reject tags whose meaningful words are *all* broad/generic categories.
  if (meaningful.every((part) => isBroadWord(part))) return false;

  return isGroundedIdeaTag(slug, groundingText);
}

/**
 * Score an accepted idea tag. Higher is better. The ranking prefers tags that
 * are proposition-like, specific, source-grounded, and a single atomic idea, and
 * penalizes broad nouns, sentence-length fragments, and over-long tags.
 */
function ideaTagScore(slug: string, groundingText: string): number {
  const rawParts = slug.split("-").filter(Boolean);
  const meaningful = rawParts.filter((part) => !TAG_STOP_WORDS.has(part));
  const words = rawParts.length;
  let score = 0;

  // A relation/verb word means the tag states an idea ("X is Y", "X creates Y").
  if (rawParts.some((part) => RELATION_WORDS.has(part))) score += 3;
  else if (words >= 3) score += 1; // specific multi-word noun phrase

  // Sweet spot is one atomic idea, not a single noun pair or a long sentence.
  if (words >= 3 && words <= 7) score += 1;
  else if (words === 2) score += 0.25;
  if (words >= 8) score -= 1;

  // Broad words drag a tag toward "category label"; specific words make it a
  // real connector.
  const broad = meaningful.filter((part) => isBroadWord(part)).length;
  const specific = meaningful.filter((part) => !isBroadWord(part)).length;
  score -= broad * 1.5;
  score += Math.min(specific, 4) * 0.5;

  // Grounded tags reflect the actual source material.
  if (isGroundedIdeaTag(slug, groundingText)) score += 1;

  // Discourage tags that have grown into full sentences.
  if (slug.length > 60) score -= 1;

  return score;
}

/**
 * Frequency-based keyword fallback. Used only when an upstream caller could not
 * supply enough real idea tags; produces specific noun / noun-pair tags drawn
 * straight from the text. Broad and generic words are filtered out.
 */
export function semanticTagsFromText(
  value: string,
  maxTags = DEFAULT_MAX_TAGS,
  groundingText = value,
): string[] {
  const words = value
    .toLowerCase()
    .slice(0, 9000)
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => isUsefulTagSlug(slugify(word)));

  const scores = new Map<string, number>();
  const addScore = (tag: string, amount: number) => {
    const slug = slugify(tag);
    if (!isUsefulTagSlug(slug)) return;
    if (!isGroundedTagSlug(slug, groundingText)) return;
    scores.set(slug, (scores.get(slug) ?? 0) + amount);
  };

  for (const word of words) addScore(word, 1);
  for (let index = 0; index < words.length - 1; index++) {
    const first = words[index];
    const second = words[index + 1];
    if (first === second) continue;
    // Two-word phrases are more connector-like than bare nouns, so weight them.
    addScore(`${first}-${second}`, 2.5);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
    .slice(0, maxTags);
}

/**
 * Normalize raw tag candidates (usually from the model) into ranked, deduped,
 * Quartz-compatible kebab-case idea tags.
 *
 * - lowercases, trims, collapses whitespace, and kebab-cases (via `slugify`);
 * - strips punctuation noise and empty tags;
 * - drops single words, sentence-length tags, and layout/deixis tags;
 * - bans whole-tag generic categories and document/learning labels;
 * - prefers proposition-like, specific, source-grounded tags;
 * - deduplicates and caps the count.
 *
 * If too few real idea tags survive, it tops up from `fallbackText` keywords so
 * a note is never left untagged.
 */
export function normalizeTopicTags(
  values: string[],
  fallbackText = "",
  maxTags = DEFAULT_MAX_TAGS,
  groundingText = fallbackText,
): string[] {
  const grounded = groundingText.trim() ? groundingText : fallbackText;

  const scored = new Map<string, number>();
  for (const value of values) {
    const slug = slugify(value);
    if (!acceptIdeaTag(slug, grounded)) continue;
    const score = ideaTagScore(slug, grounded);
    scored.set(slug, Math.max(scored.get(slug) ?? Number.NEGATIVE_INFINITY, score));
  }

  const ordered = [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
  const deduped = ordered.slice(0, maxTags);

  if (deduped.length >= Math.min(3, maxTags) || !fallbackText.trim()) {
    return deduped;
  }

  return [
    ...new Set([
      ...deduped,
      ...semanticTagsFromText(fallbackText, maxTags, grounded),
    ]),
  ].slice(0, maxTags);
}
