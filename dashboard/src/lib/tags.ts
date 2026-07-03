// Tag normalization for the knowledge graph.
//
// Tags are Zettelkasten-style conceptual retrieval handles. They are not SEO
// keywords, summaries, folder names, source filenames, or page decoration. A
// good tag is a durable graph-vocabulary term that can connect future notes.
//
// This module is dependency-free so the tag vocabulary can be tested in
// isolation and reused by ingestion, Learn generation, manual edits, dashboard
// display, and Quartz publishing.

/** Kebab-case slug used for tags, note filenames, and Quartz tag URLs. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[''"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}

export const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "but",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "then",
  "this",
  "that",
  "to",
  "with",
  "about",
  "between",
  "through",
  "toward",
  "towards",
]);

const TAG_STOP_WORDS = new Set([
  ...STOP_WORDS,
  "all",
  "also",
  "any",
  "based",
  "because",
  "before",
  "being",
  "can",
  "could",
  "does",
  "during",
  "each",
  "has",
  "have",
  "its",
  "may",
  "might",
  "must",
  "not",
  "only",
  "over",
  "per",
  "same",
  "should",
  "such",
  "than",
  "their",
  "these",
  "those",
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
  "would",
]);

const BLOCKED_TAGS = new Set([
  "answer",
  "answers",
  "basics",
  "beginner",
  "chapter",
  "chat",
  "cluster",
  "concept",
  "concepts",
  "content",
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
  "general",
  "generated",
  "important",
  "important-concept",
  "index",
  "intro",
  "introduction",
  "key-idea",
  "knowledge",
  "learning",
  "lesson",
  "lessons",
  "link",
  "links",
  "map",
  "markdown",
  "misc",
  "note",
  "notes",
  "overview",
  "page",
  "pages",
  "paper",
  "pdf",
  "reading",
  "response",
  "section",
  "sections",
  "source",
  "sources",
  "student-friendly",
  "study",
  "summary",
  "text",
  "textbook",
  "topic",
  "topics",
  "understanding",
  "understanding-the-basics",
  "upload",
  "uploaded",
]);

const BLOCKED_WORDS = new Set([
  ...BLOCKED_TAGS,
  "advanced",
  "article",
  "author",
  "authors",
  "course",
  "data",
  "detail",
  "details",
  "exam",
  "figure",
  "figures",
  "graph",
  "graphs",
  "material",
  "materials",
  "prep",
  "question",
  "questions",
  "quiz",
  "slides",
  "subsection",
  "subsections",
  "table",
  "tables",
  "test",
  "tests",
  "thing",
  "things",
  "unit",
  "week",
]);

// Broad words are rejected as standalone tags, but they can appear inside a
// concrete concept handle such as "angular-frequency" or "restoring-force".
const BROAD_STANDALONE_TAGS = new Set([
  "activation",
  "analysis",
  "application",
  "applications",
  "approach",
  "approaches",
  "calculus",
  "comparison",
  "computing",
  "data",
  "energy",
  "equation",
  "equations",
  "field",
  "force",
  "forces",
  "formula",
  "formulas",
  "frequency",
  "hardware",
  "math",
  "model",
  "models",
  "network",
  "networks",
  "physics",
  "process",
  "result",
  "results",
  "science",
  "system",
  "systems",
  "theory",
  "value",
  "values",
  "wave",
  "waves",
]);

const SHORT_TAG_ALLOWLIST = new Set(["ai", "ml", "rl", "ui", "ux", "3d"]);

const CANONICAL_ALIASES: Record<string, string> = {
  "ann-to-snn": "ann-to-snn-conversion",
  "ann-snn-conversion": "ann-to-snn-conversion",
  "angular-frequency-omega": "angular-frequency",
  "back-propagation": "backpropagation",
  "continuous-activations": "continuous-activation",
  "dense-networks": "dense-computation",
  "event-driven-computation": "event-driven-processing",
  "force-restoring": "restoring-force",
  "hamming-7-4": "hamming-code",
  "lif": "lif-neuron",
  "lif-model": "lif-neuron",
  "lif-neurons": "lif-neuron",
  "leaky-integrate-and-fire": "lif-neuron",
  "leaky-integrate-fire": "lif-neuron",
  "membrane-potentials": "membrane-potential",
  "nyquist-condition": "nyquist-criterion",
  "nyquist-zero-isi": "zero-isi-condition",
  "phase-rate": "angular-frequency",
  "restoring-forces": "restoring-force",
  "simple-harmonic-oscillator": "simple-harmonic-motion",
  "simple-harmonic-oscillators": "simple-harmonic-motion",
  "shm": "simple-harmonic-motion",
  "spike-timing-dependent-plasticity": "stdp",
  "spiking-neural-network": "spiking-neural-networks",
  "synchronous-networks": "synchronous-computation",
  "threshold-firing": "spike-threshold",
};

const CANONICAL_GROUPS = [
  ["nyquist-criterion", "nyquist-condition"],
  ["simple-harmonic-motion", "simple-harmonic-oscillator", "shm"],
  ["restoring-force", "restoring-forces"],
  ["angular-frequency", "angular-frequency-omega", "phase-rate"],
  ["event-driven-processing", "event-driven-computation"],
  ["lif-neuron", "lif-model", "leaky-integrate-and-fire"],
  ["zero-isi-condition", "zero-isi-criterion"],
];

const SOURCE_FILE_RE =
  /(?:^|[-_./])(?:doi|isbn|issn|arxiv|crossref)(?:$|[-_./])|(?:^|[-_./])\d{4,5}[-_.]\d{3,}(?:v\d+)?(?:$|[-_.])|(?:pdf|docx?|pptx?|xlsx?|csv|zip|md)$/i;

const NUMERIC_CONCEPT_RE =
  /(?:^|-)hamming-code(?:-|$)|(?:^|-)\d+-psk(?:-|$)|(?:^|-)\d+-qam(?:-|$)|(?:^|-)l\d(?:-|$)|(?:^|-)ipv\d(?:-|$)|(?:^|-)fft(?:-|$)|(?:^|-)iir(?:-|$)|(?:^|-)fir(?:-|$)|(?:^|-)zero-isi(?:-|$)/i;

const CONCEPT_LEXICON: Array<[RegExp, string]> = [
  [/\bsimple harmonic motion\b|\bSHM\b/i, "simple-harmonic-motion"],
  [/\brestoring force\b|\bforce (?:that )?points? (?:back )?toward equilibrium\b/i, "restoring-force"],
  [/\bstable equilibrium\b/i, "stable-equilibrium"],
  [/\bangular frequency\b|\bomega\b/i, "angular-frequency"],
  [/\bphase constant\b|\bphase angle\b/i, "phase-constant"],
  [/\benergy exchange\b|\bkinetic energy\b.*\bpotential energy\b|\bpotential energy\b.*\bkinetic energy\b/i, "energy-exchange"],
  [/\boscillation mechanism\b|\bperiodic motion\b|\boscillat(?:es|ion)\b/i, "oscillation-mechanism"],
  [/\bseparation of variables\b/i, "separation-of-variables"],
  [/\bphasor addition\b|\bphasors?\b/i, "phasor-addition"],
  [/\bnormalization integral\b|\bnormalize the wavefunction\b/i, "normalization-integral"],
  [/\baliasing\b/i, "aliasing"],
  [/\bzero[- ]isi\b|\bzero intersymbol interference\b|\bno intersymbol interference\b/i, "zero-isi-condition"],
  [/\bnyquist (?:criterion|condition|rate)\b/i, "nyquist-criterion"],
  [/\bhamming(?:\s*\(?(?:7,?\s*4|7-4)\)?)?\b/i, "hamming-code"],
  [/\b8[- ]psk\b/i, "8-psk"],
  [/\braised[- ]cosine\b/i, "raised-cosine-filter"],
  [/\bpulse[- ]code modulation\b|\bpcm\b/i, "pulse-code-modulation"],
  [/\bfourier transform\b/i, "fourier-transform"],
  [/\bleaky integrate[- ]and[- ]fire\b|\blif neuron\b|\blif model\b|\bLIF\b/i, "lif-neuron"],
  [/\bmembrane potential\b/i, "membrane-potential"],
  [/\bthreshold crossing\b|\bfiring threshold\b|\bspike threshold\b/i, "spike-threshold"],
  [/\brefractory period\b|\brefractory\b/i, "refractory-period"],
  [/\breset (?:potential|behavior|dynamics)\b/i, "reset-dynamics"],
  [/\bspike[- ]timing[- ]dependent plasticity\b|\bSTDP\b/i, "stdp"],
  [/\bsynaptic plasticity\b|\bsynaptic weight\b/i, "synaptic-plasticity"],
  [/\bspike timing\b/i, "spike-timing"],
  [/\bsurrogate gradient\b/i, "surrogate-gradient"],
  [/\bnon[- ]differentiable spikes?\b|\bnon[- ]differentiab\w+\b/i, "non-differentiable-spikes"],
  [/\bbackpropagation\b|\bbackprop\b/i, "backpropagation"],
  [/\bann[- ]to[- ]snn\b|\bann to snn\b|\bconversion\b/i, "ann-to-snn-conversion"],
  [/\brate coding\b/i, "rate-coding"],
  [/\btemporal coding\b/i, "temporal-coding"],
  [/\bspike (?:coding|encoding)\b|\bencoding information as spikes\b/i, "spike-coding"],
  [/\bevent[- ]driven\b|\bevent driven\b/i, "event-driven-processing"],
  [/\bneuromorphic\b|\bloihi\b|\btruenorth\b/i, "neuromorphic-computing"],
  [/\benergy (?:efficiency|efficient|per inference|consumption)\b/i, "energy-efficiency"],
  [/\blatency\b|\bresponse time\b/i, "latency"],
  [/\bspike count\b/i, "spike-count"],
  [/\bconvergence\b/i, "convergence"],
  [/\bspiking neural networks?\b|\bSNNs?\b/i, "spiking-neural-networks"],
  [/\bsynchronous (?:computation|network|networks|updates?)\b/i, "synchronous-computation"],
  [/\bcontinuous activations?\b|\bactivation values?\b/i, "continuous-activation"],
  [/\bdense (?:computation|networks?|layers?)\b|\brecomputing whole arrays\b/i, "dense-computation"],
  [/\bhardware (?:pressure|constraints?|costs?)\b/i, "hardware-constraints"],
];

export const DEFAULT_MAX_TAGS = 8;

export interface ZettelkastenTagOptions {
  title?: string;
  content?: string;
  existingTags?: string[];
  sourceFilenames?: string[];
  sourceTopics?: string[];
  maxTags?: number;
}

export interface FallbackTagInput {
  title?: string;
  content?: string;
  learningSpine?: unknown;
  sectionMap?: unknown;
  sourceTopics?: string[];
  maxTags?: number;
  existingTags?: string[];
}

function stripLeadingNumber(value: string): string {
  return value.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").trim();
}

function normalizeTagSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function simplifyRawTag(raw: string): string {
  const text = raw.toLowerCase();
  for (const [pattern, tag] of CONCEPT_LEXICON) {
    if (pattern.test(text)) return tag;
  }
  return raw;
}

export function normalizeTag(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^#+/, "");
  if (!trimmed) return null;
  if (SOURCE_FILE_RE.test(trimmed)) return null;

  const simplified = simplifyRawTag(trimmed);
  const segments = simplified
    .split("/")
    .map((segment) => normalizeTagSegment(segment))
    .filter(Boolean)
    .slice(0, 2);
  if (segments.length === 0) return null;

  const tag = segments.join("/");
  return CANONICAL_ALIASES[tag] ?? tag;
}

function leafTag(tag: string): string {
  return tag.split("/").filter(Boolean).at(-1) ?? tag;
}

function singularizeWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ves")) return `${word.slice(0, -3)}f`;
  if (word.length > 4 && word.endsWith("ses")) return word.slice(0, -2);
  if (
    word.length > 3 &&
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("ous")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function singularizeTag(tag: string): string {
  return tag
    .split("/")
    .map((segment) => segment.split("-").map(singularizeWord).join("-"))
    .join("/");
}

function compactTagKey(tag: string): string {
  return singularizeTag(leafTag(tag));
}

function aliasFor(tag: string): string {
  const leaf = leafTag(tag);
  const alias = CANONICAL_ALIASES[tag] ?? CANONICAL_ALIASES[leaf] ?? singularizeTag(tag);
  return alias;
}

export function canonicalizeTag(
  tag: string,
  existingTags: string[] = [],
): string | null {
  const normalized = normalizeTag(tag);
  if (!normalized) return null;
  const existing = existingTags
    .map((item) => normalizeTag(item))
    .filter((item): item is string => Boolean(item));
  const aliased = aliasFor(normalized);
  const candidates = new Set([normalized, aliased, leafTag(aliased), singularizeTag(aliased)]);

  for (const group of CANONICAL_GROUPS) {
    if (!group.some((item) => candidates.has(item))) continue;
    const existingMatch = existing.find((item) => group.includes(item) || group.includes(leafTag(item)));
    return existingMatch ?? group[0];
  }

  const compact = compactTagKey(aliased);
  const existingMatch = existing.find((item) => compactTagKey(item) === compact);
  if (existingMatch) return existingMatch;
  return aliased;
}

function tagWords(tag: string): string[] {
  return tag
    .replace(/\//g, "-")
    .split("-")
    .map((word) => word.trim())
    .filter(Boolean);
}

function meaningfulWords(tag: string): string[] {
  return tagWords(tag).filter((word) => !TAG_STOP_WORDS.has(word));
}

function isSourceFilenameTag(tag: string, sourceFilenames: string[] = []): boolean {
  if (SOURCE_FILE_RE.test(tag)) return true;
  const leaf = leafTag(tag);
  if (/^\d{3,}[-\d]*(?:v\d+)?$/.test(leaf)) return true;
  const sourceBases = sourceFilenames
    .map((file) => file.replace(/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv|zip)$/i, ""))
    .map((file) => normalizeTagSegment(file))
    .filter(Boolean);
  return sourceBases.includes(leaf) || sourceBases.includes(tag);
}

function titleSlugs(title?: string): Set<string> {
  if (!title) return new Set();
  const clean = stripLeadingNumber(title);
  const titleSlug = normalizeTagSegment(clean);
  const meaningfulTitleSlug = clean
    .split(/[^a-zA-Z0-9]+/g)
    .map((word) => normalizeTagSegment(word))
    .filter((word) => word && !TAG_STOP_WORDS.has(word) && !BLOCKED_WORDS.has(word))
    .join("-");
  return new Set([titleSlug, meaningfulTitleSlug].filter(Boolean));
}

function hasBadShape(tag: string): boolean {
  if (tag.length > 40) return true;
  if (tag.includes("//")) return true;
  if (!/^[a-z0-9][a-z0-9/-]*[a-z0-9]$/.test(tag)) return true;
  if (/^\d+$/.test(tag)) return true;
  if (/\d/.test(tag) && !NUMERIC_CONCEPT_RE.test(tag)) return true;
  return false;
}

function isBlockedTag(tag: string): boolean {
  const leaf = leafTag(tag);
  if (BLOCKED_TAGS.has(tag) || BLOCKED_TAGS.has(leaf)) return true;
  const words = meaningfulWords(tag);
  if (words.length === 0) return true;
  if (words.length === 1) {
    const only = words[0];
    if (only.length < 3 && !SHORT_TAG_ALLOWLIST.has(only)) return true;
    if (BLOCKED_WORDS.has(only) || BROAD_STANDALONE_TAGS.has(only)) return true;
  }
  if (words.every((word) => BLOCKED_WORDS.has(word) || BROAD_STANDALONE_TAGS.has(word))) {
    return true;
  }
  if (words.some((word) => BLOCKED_WORDS.has(word)) && words.length <= 2) return true;
  return false;
}

function searchableText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordVariants(word: string): string[] {
  const variants = new Set([word, singularizeWord(word)]);
  if (word.length > 2) variants.add(`${word}s`);
  return [...variants];
}

function isGroundedTag(tag: string, groundingText: string): boolean {
  const grounded = searchableText(groundingText);
  if (!grounded) return true;

  const tagLeaf = leafTag(tag);
  for (const [pattern, conceptTag] of CONCEPT_LEXICON) {
    const canonicalConcept = aliasFor(conceptTag);
    if ((canonicalConcept === tag || canonicalConcept === tagLeaf) && pattern.test(groundingText)) {
      return true;
    }
  }

  const phrase = leafTag(tag).replace(/-/g, " ");
  if (
    phrase &&
    new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(
      grounded,
    )
  ) {
    return true;
  }

  const words = meaningfulWords(tag).filter((word) => !BROAD_STANDALONE_TAGS.has(word));
  if (words.length === 0) return true;
  const groundedWords = new Set(grounded.split(/\s+/).filter(Boolean));
  const present = words.filter((word) =>
    wordVariants(word).some((variant) => groundedWords.has(variant)),
  ).length;
  if (words.length <= 2) return present === words.length;
  return present / words.length >= 0.6;
}

export function validateZettelkastenTags(
  tags: string[],
  options: ZettelkastenTagOptions = {},
): string[] {
  const maxTags = Math.max(0, Math.min(options.maxTags ?? DEFAULT_MAX_TAGS, DEFAULT_MAX_TAGS));
  const titleSet = titleSlugs(options.title);
  const grounding = [options.title ?? "", options.content ?? "", ...(options.sourceTopics ?? [])].join("\n");
  const output: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    if (output.length >= maxTags) break;
    const canonical = canonicalizeTag(raw, [...(options.existingTags ?? []), ...output]);
    if (!canonical) continue;
    if (seen.has(canonical)) continue;
    if (hasBadShape(canonical)) continue;
    if (isBlockedTag(canonical)) continue;
    if (titleSet.has(canonical) || titleSet.has(leafTag(canonical))) continue;
    if (isSourceFilenameTag(canonical, options.sourceFilenames)) continue;
    if (!isGroundedTag(canonical, grounding)) continue;
    seen.add(canonical);
    output.push(canonical);
  }

  return output;
}

export function dedupeTags(tags: string[]): string[] {
  const output: string[] = [];
  for (const tag of tags) {
    const canonical = canonicalizeTag(tag, output);
    if (canonical && !output.includes(canonical)) output.push(canonical);
  }
  return output;
}

function plainTextFromUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainTextFromUnknown).join("\n");
  if (typeof value === "object") return Object.values(value).map(plainTextFromUnknown).join("\n");
  return String(value);
}

function addCandidate(
  scores: Map<string, number>,
  raw: string,
  score: number,
): void {
  const normalized = normalizeTag(raw);
  if (!normalized) return;
  scores.set(normalized, Math.max(scores.get(normalized) ?? 0, score));
}

function keywordPhraseCandidates(text: string): string[] {
  const words = searchableText(text)
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .filter((word) => !TAG_STOP_WORDS.has(word))
    .filter((word) => !BLOCKED_WORDS.has(word));
  const candidates: string[] = [];
  for (let size = 3; size >= 2; size -= 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      const phrase = words.slice(index, index + size);
      if (phrase.every((word) => BROAD_STANDALONE_TAGS.has(word))) continue;
      if (new Set(phrase).size !== phrase.length) continue;
      candidates.push(phrase.join("-"));
    }
  }
  return candidates;
}

export function generateFallbackTags(input: FallbackTagInput): string[] {
  const maxTags = Math.max(0, Math.min(input.maxTags ?? DEFAULT_MAX_TAGS, DEFAULT_MAX_TAGS));
  const content = [
    input.title ?? "",
    input.content ?? "",
    plainTextFromUnknown(input.learningSpine),
    plainTextFromUnknown(input.sectionMap),
    ...(input.sourceTopics ?? []),
  ].join("\n");

  const scores = new Map<string, number>();
  for (const [pattern, tag] of CONCEPT_LEXICON) {
    if (pattern.test(content)) addCandidate(scores, tag, 20);
  }
  for (const topic of input.sourceTopics ?? []) addCandidate(scores, topic, 12);

  const rankedStrong = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
  const strongTags = validateZettelkastenTags(rankedStrong, {
    title: input.title,
    content,
    existingTags: input.existingTags,
    sourceTopics: input.sourceTopics,
    maxTags,
  });
  if (strongTags.length >= Math.min(4, maxTags)) return strongTags;

  for (const phrase of keywordPhraseCandidates(input.content ?? "")) addCandidate(scores, phrase, 3);
  for (const phrase of keywordPhraseCandidates(input.title ?? "")) addCandidate(scores, phrase, 1);

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  return validateZettelkastenTags(ranked, {
    title: input.title,
    content,
    existingTags: input.existingTags,
    sourceTopics: input.sourceTopics,
    maxTags,
  });
}

export function semanticTagsFromText(
  value: string,
  maxTags = DEFAULT_MAX_TAGS,
  groundingText = value,
): string[] {
  return generateFallbackTags({
    title: "",
    content: groundingText || value,
    sourceTopics: [],
    maxTags,
  });
}

export function normalizeTopicTags(
  values: string[],
  fallbackText = "",
  maxTags = DEFAULT_MAX_TAGS,
  groundingText = fallbackText,
  options: ZettelkastenTagOptions = {},
): string[] {
  const max = Math.max(0, Math.min(maxTags, DEFAULT_MAX_TAGS));
  const existingTags = options.existingTags ?? [];
  const grounding = groundingText.trim() ? groundingText : fallbackText;
  const firstPass = validateZettelkastenTags(values, {
    ...options,
    content: grounding,
    existingTags,
    maxTags: max,
  });

  const minUsefulTags = Math.min(4, max);
  if (firstPass.length >= minUsefulTags || !fallbackText.trim()) {
    return firstPass.slice(0, max);
  }

  const fallback = generateFallbackTags({
    title: options.title,
    content: fallbackText,
    learningSpine: options.content,
    sourceTopics: options.sourceTopics,
    existingTags: [...existingTags, ...firstPass],
    maxTags: max,
  });

  return validateZettelkastenTags([...firstPass, ...fallback], {
    ...options,
    content: [grounding, fallbackText].join("\n"),
    existingTags,
    maxTags: max,
  });
}
