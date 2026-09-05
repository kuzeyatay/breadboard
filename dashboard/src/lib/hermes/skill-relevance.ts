// Ranking installed skills against the request they might serve.
//
// Two turn shapes need the same judgement. A Super agent turn is handed the
// whole catalogue and told to choose, but the catalogue is listed in a prompt
// with a ceiling, so the order decides which skills the model can see at all.
// An ordinary agent-mode turn selects a skill only when one of the hand-written
// routers claims it, which leaves every other installed skill unreachable
// unless the user types its slash command. Both want the same thing: the
// installed skills that plausibly cover this request, closest first.
//
// This is a lexical ranker, on purpose. It runs on every turn before dispatch,
// so it has to be a pure function over the request text and the catalogue —
// no model call, no network, no embeddings to keep in sync with an install. It
// scores a skill by which request terms appear in its slug, name and
// description, weighted by where they appear and discounted when the term is
// common across the catalogue. It never selects a skill by itself: callers
// either order a listing by it or offer the shortlist behind `skill_open`, so a
// wrong guess costs the model a glance at one line, not the turn.

export interface SkillRelevanceCandidate {
  slug: string;
  name: string;
  description: string;
}

export interface RankedSkill<T extends SkillRelevanceCandidate = SkillRelevanceCandidate> {
  skill: T;
  /** Zero when nothing in the request matched; callers decide what that means. */
  score: number;
  /** Request terms that matched this skill, strongest field first. */
  matched: string[];
}

export interface ShortlistOptions {
  /** Most skills to return. */
  limit?: number;
  /** Slugs never shortlisted, whatever their score. */
  exclude?: Iterable<string>;
}

/** A term in the slug is the strongest signal: slugs are short and deliberate. */
const SLUG_WEIGHT = 3;
const NAME_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
/** A request phrase found verbatim in the name or description. */
const PHRASE_WEIGHT = 2;
const MAX_PHRASE_HITS = 3;
/** Descriptions longer than this are discounted so prose length cannot win. */
const DESCRIPTION_TERM_BUDGET = 40;
/** A term in more than this share of the catalogue says little about any one skill. */
const COMMON_TERM_SHARE = 0.25;
const COMMON_TERM_DISCOUNT = 0.5;
/**
 * The least a skill can score and still be offered unasked: one slug or name
 * term, or two description terms at full weight. One word in a description is
 * never enough.
 */
const SHORTLIST_MIN_SCORE = 2;
const DEFAULT_SHORTLIST_LIMIT = 3;
/** Fewer request terms than this is a greeting or a one-word follow-up. */
const MIN_REQUEST_TERMS = 2;

// Function words plus the verbs and nouns nearly every request and nearly every
// skill description share. Matching on "use", "create" or "file" would rank the
// catalogue by description length, so they carry no signal here.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "as", "at",
  "by", "for", "from", "in", "into", "of", "on", "onto", "to", "up", "with",
  "without", "about", "over", "under", "out", "off", "via", "per", "vs",
  "i", "me", "my", "mine", "we", "us", "our", "you", "your", "yours", "it",
  "its", "he", "him", "his", "she", "her", "they", "them", "their", "this",
  "that", "these", "those", "there", "here", "what", "which", "who", "whom",
  "whose", "when", "where", "why", "how", "any", "some", "all", "each",
  "every", "both", "few", "more", "most", "other", "another", "such", "no",
  "not", "nor", "only", "own", "same", "too", "very", "just", "also", "even",
  "still", "yet", "again", "ever", "never", "always", "often",
  "is", "am", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "having", "do", "does", "did", "doing", "done", "will", "would",
  "shall", "should", "can", "could", "may", "might", "must", "let", "lets",
  "please", "thanks", "thank", "hi", "hello", "hey", "ok", "okay", "yes",
  "yeah", "sure", "right", "well", "now", "today", "tomorrow", "already",
  "want", "wants", "wanted", "need", "needs", "needed", "like", "likes",
  "know", "think", "get", "got", "give", "make", "made", "making", "take",
  "put", "go", "going", "come", "see", "look", "looking", "show", "tell",
  "say", "said", "ask", "asked", "try", "trying", "keep", "help", "helps",
  "helping", "use", "uses", "used", "using", "useful", "work", "works",
  "working", "run", "runs", "running", "create", "creates", "created",
  "creating", "build", "builds", "building", "write", "writes", "writing",
  "written", "read", "reads", "reading", "open", "opens", "opened", "start",
  "started", "stop", "add", "set", "change", "turn", "find", "check",
  "something", "anything", "everything", "nothing", "thing", "things",
  "way", "ways", "one", "ones", "two", "new", "good", "great", "best",
  "better", "real", "actual", "actually", "really", "quite", "much", "many",
  "lot", "lots", "bit", "kind", "sort", "type", "case", "cases", "part",
  "user", "users", "skill", "skills", "tool", "tools", "task", "tasks",
  "file", "files", "text", "chat", "message", "messages", "response",
  "answer", "answers", "question", "questions", "request", "example",
  "examples", "based", "given", "into", "them", "whenever", "whether",
  "because", "while", "during", "before", "after", "between", "through",
  "across", "against", "around", "within", "instead", "rather", "either",
  "neither", "once", "twice", "first", "last", "next", "back", "down",
  "along", "own", "etc", "eg", "ie",
]);

// Short technical tokens that are real signal despite their length.
const SHORT_TERMS = new Set([
  "3d", "2d", "ai", "ui", "ux", "db", "os", "js", "ts", "go", "c", "r", "qa",
  "pr", "ci", "cd", "vm", "ip", "ml", "nn", "ar", "vr", "pc", "tv", "hr",
  "seo", "api", "sql", "css", "svg", "pdf", "csv", "url", "cli", "gpu", "cpu",
  "ios", "mac", "rust", "vue",
]);

function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  // "boxes", "matches", "sketches" lose the whole "es"; "notes" loses only the
  // "s", or it would turn into "not" and vanish into the stopwords.
  if (token.length > 4 && /(?:x|z|ch|sh|ss)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function rawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);
}

function keepToken(token: string): boolean {
  if (STOPWORDS.has(token)) return false;
  if (token.length >= 3) return true;
  return SHORT_TERMS.has(token);
}

/**
 * The request as the set of terms worth matching on: lowercased, split on
 * punctuation, stopwords dropped, lightly stemmed so "diagrams" meets
 * "diagram". Order is first occurrence; duplicates are removed.
 */
export function requestTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of rawTokens(text)) {
    if (!keepToken(token)) continue;
    const term = stem(token);
    if (STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

/** Adjacent request-term pairs, for the verbatim-phrase bonus. */
function requestPhrases(text: string): string[] {
  const tokens = rawTokens(text).filter(keepToken).map(stem);
  const phrases = new Set<string>();
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (tokens[index] === tokens[index + 1]) continue;
    phrases.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return [...phrases];
}

function termSet(text: string): Set<string> {
  return new Set(rawTokens(text).filter(keepToken).map(stem));
}

/** The name and description as stemmed running text, for phrase lookups. */
function phraseText(skill: SkillRelevanceCandidate): string {
  const words = rawTokens(`${skill.name} ${skill.description}`)
    .filter(keepToken)
    .map(stem);
  return ` ${words.join(" ")} `;
}

interface SkillProfile<T extends SkillRelevanceCandidate> {
  skill: T;
  slugTerms: Set<string>;
  nameTerms: Set<string>;
  descriptionTerms: Set<string>;
  descriptionSize: number;
  phrases: string;
}

function profile<T extends SkillRelevanceCandidate>(skill: T): SkillProfile<T> {
  const descriptionTerms = termSet(skill.description);
  return {
    skill,
    slugTerms: termSet(skill.slug.replace(/[-_.]/g, " ")),
    nameTerms: termSet(skill.name),
    descriptionTerms,
    descriptionSize: descriptionTerms.size,
    phrases: phraseText(skill),
  };
}

/**
 * How many skills mention each term anywhere. A term half the catalogue shares
 * — "design" in a catalogue of design skills — is discounted, so a request
 * that says only that does not crown an arbitrary member of the crowd.
 */
function termFrequencies<T extends SkillRelevanceCandidate>(
  profiles: readonly SkillProfile<T>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of profiles) {
    const terms = new Set([
      ...entry.slugTerms,
      ...entry.nameTerms,
      ...entry.descriptionTerms,
    ]);
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

function byScoreThenName<T extends SkillRelevanceCandidate>(
  left: RankedSkill<T>,
  right: RankedSkill<T>,
): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.skill.name.localeCompare(right.skill.name);
}

/**
 * Every candidate, best match first. Skills nothing matched are still
 * returned, scored zero and in name order, so a caller listing the catalogue
 * can put the relevant part at the top without losing the rest.
 */
export function rankSkillsForRequest<T extends SkillRelevanceCandidate>(
  request: string,
  skills: readonly T[],
): RankedSkill<T>[] {
  const profiles = skills.map(profile);
  const terms = requestTerms(request);
  const phrases = requestPhrases(request);
  if (terms.length === 0) {
    return profiles
      .map((entry) => ({ skill: entry.skill, score: 0, matched: [] }))
      .sort(byScoreThenName);
  }
  const frequencies = termFrequencies(profiles);
  const commonAbove = Math.max(1, Math.floor(profiles.length * COMMON_TERM_SHARE));
  return profiles
    .map((entry) => {
      const matched: Array<{ term: string; weight: number }> = [];
      let score = 0;
      for (const term of terms) {
        let weight = 0;
        if (entry.slugTerms.has(term)) weight = SLUG_WEIGHT;
        else if (entry.nameTerms.has(term)) weight = NAME_WEIGHT;
        else if (entry.descriptionTerms.has(term)) {
          weight =
            DESCRIPTION_WEIGHT *
            Math.min(
              1,
              DESCRIPTION_TERM_BUDGET / Math.max(1, entry.descriptionSize),
            );
        }
        if (weight === 0) continue;
        if (
          profiles.length > 3 &&
          (frequencies.get(term) ?? 0) > commonAbove
        ) {
          weight *= COMMON_TERM_DISCOUNT;
        }
        score += weight;
        matched.push({ term, weight });
      }
      let phraseHits = 0;
      for (const phrase of phrases) {
        if (phraseHits >= MAX_PHRASE_HITS) break;
        if (entry.phrases.includes(` ${phrase} `)) {
          phraseHits += 1;
          score += PHRASE_WEIGHT;
        }
      }
      return {
        skill: entry.skill,
        score: Math.round(score * 100) / 100,
        matched: matched
          .sort((left, right) => right.weight - left.weight)
          .map((item) => item.term),
      };
    })
    .sort(byScoreThenName);
}

/**
 * The few skills confident enough to offer on a turn nobody selected one for.
 *
 * Confidence means more than a stray word in a long description: the request
 * has to carry at least two real terms, the skill has to reach the minimum
 * score, and the match has to touch the slug or name, or land two distinct
 * description terms or a whole phrase. Excluded slugs never appear — the caller
 * uses that for skills another selector already declined this turn, and for
 * skills whose selection would unlock a tool.
 */
export function shortlistSkills<T extends SkillRelevanceCandidate>(
  request: string,
  skills: readonly T[],
  options: ShortlistOptions = {},
): RankedSkill<T>[] {
  const limit = Math.max(0, options.limit ?? DEFAULT_SHORTLIST_LIMIT);
  if (limit === 0) return [];
  const excluded = new Set(
    [...(options.exclude ?? [])].map((slug) => slug.trim().toLowerCase()),
  );
  const terms = requestTerms(request);
  if (terms.length < MIN_REQUEST_TERMS) return [];
  const eligible = skills.filter(
    (skill) => !excluded.has(skill.slug.trim().toLowerCase()),
  );
  const ranked = rankSkillsForRequest(request, eligible);
  const profiles = new Map(
    eligible.map((skill) => [skill.slug, profile(skill)] as const),
  );
  const phrases = requestPhrases(request);
  return ranked
    .filter((entry) => {
      if (entry.score < SHORTLIST_MIN_SCORE) return false;
      const own = profiles.get(entry.skill.slug);
      if (!own) return false;
      const strong = entry.matched.some(
        (term) => own.slugTerms.has(term) || own.nameTerms.has(term),
      );
      if (strong) return true;
      const descriptionHits = entry.matched.filter((term) =>
        own.descriptionTerms.has(term),
      ).length;
      if (descriptionHits >= 2) return true;
      return phrases.some((phrase) => own.phrases.includes(` ${phrase} `));
    })
    .slice(0, limit);
}
