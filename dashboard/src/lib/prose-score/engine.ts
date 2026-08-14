/**
 * Deterministic scorer for AI writing patterns.
 *
 * Ported from sloplint (aashaexo/soundshuman, MIT), which in turn takes its
 * scoring method from brandonwise/humanizer: weighted pattern density on a log
 * curve blended with statistical uniformity (burstiness, type-token ratio,
 * trigram repetition). Higher score = more AI-flavored, 0-100.
 *
 * The scoring math here is deliberately identical to upstream so a Breadboard
 * score can be compared against upstream's published bands (under 25 = clean).
 * Everything Breadboard-specific lives outside this file: structural masking in
 * mask.ts, rule tuning in rules.breadboard.ts.
 *
 * Pure text in, analysis out. No filesystem, no network, so it runs anywhere -
 * a server action, a script, a test.
 */

export interface VocabularyTier {
  weight: number;
  note?: string;
  words: string[];
  /** tier2: flagged only when this many distinct terms appear. */
  minDistinct?: number;
  /** tier3: flagged only when combined density per 100 words exceeds this. */
  maxDensityPct?: number;
}

export interface PhraseRule {
  match: string;
  fix: string | null;
  category: string;
  weight: number;
}

export interface RegexRule {
  id: string;
  pattern: string;
  flags?: string;
  category: string;
  weight: number;
  note?: string;
}

export interface SlopRules {
  version: string;
  description?: string;
  source?: string;
  vocabulary: {
    tier1: VocabularyTier;
    tier2: VocabularyTier;
    tier3: VocabularyTier;
  };
  phrases: PhraseRule[];
  regex: RegexRule[];
}

export interface Finding {
  id: string;
  category: string;
  weight: number;
  match: string;
  index: number;
  line: number;
  tier?: number;
  note?: string;
  fix?: string | null;
}

export interface ProseStats {
  sentenceCount: number;
  wordCount: number;
  meanSentenceLength: number;
  burstiness: number;
  typeTokenRatio: number;
  trigramRepetition: number;
}

export interface ProseAnalysis {
  score: number;
  patternScore: number;
  uniformityScore: number;
  stats: ProseStats;
  findings: Finding[];
  confidence: "high" | "medium" | "low";
}

export interface PrepareOptions {
  /** Skip markdown blockquotes, which usually hold pasted examples. */
  ignoreQuotes?: boolean;
}

/**
 * Blank out a region while keeping every index and newline in place, so
 * character offsets and line numbers stay true after masking.
 */
export function blankPreservingLines(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

export function prepareText(raw: string, opts: PrepareOptions = {}): string {
  let text = raw;
  text = text.replace(/^---\n[\s\S]*?\n---\n/, blankPreservingLines); // frontmatter
  text = text.replace(
    /^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm,
    blankPreservingLines,
  ); // fenced code
  text = text.replace(/`[^`\n]+`/g, blankPreservingLines); // inline code
  text = text.replace(/\bhttps?:\/\/\S+/g, blankPreservingLines); // bare URLs
  text = text.replace(/\]\([^)\n]+\)/g, blankPreservingLines); // link targets
  if (opts.ignoreQuotes) {
    text = text.replace(/^[ \t]*>[^\n]*$/gm, blankPreservingLines);
  }
  return text;
}

function lineOfIndex(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function words(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

export function computeStats(text: string): ProseStats {
  const sents = sentences(text);
  const lens = sents.map((s) => words(s).length);
  const n = lens.length;
  const mean = n ? lens.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n
    ? lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n
    : 0;
  const burstiness = mean ? Math.sqrt(variance) / mean : 0;

  const toks = words(text).map((w) => w.toLowerCase());
  const window = toks.slice(0, 500); // fixed window so length doesn't skew TTR
  const ttr = window.length ? new Set(window).size / window.length : 0;

  const trigrams = new Map<string, number>();
  for (let i = 0; i + 2 < toks.length; i++) {
    const t = `${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`;
    trigrams.set(t, (trigrams.get(t) || 0) + 1);
  }
  let repeated = 0;
  for (const count of trigrams.values()) if (count > 1) repeated += count - 1;
  const trigramRepetition =
    toks.length > 3 ? repeated / (toks.length - 2) : 0;

  return {
    sentenceCount: n,
    wordCount: toks.length,
    meanSentenceLength: round2(mean),
    burstiness: round2(burstiness),
    typeTokenRatio: round2(ttr),
    trigramRepetition: round2(trigramRepetition),
  };
}

export function uniformityScore(stats: ProseStats): number {
  let score = 0;
  if (stats.burstiness < 0.45) {
    score += 40 * ((0.45 - stats.burstiness) / 0.45);
  }
  if (stats.typeTokenRatio > 0 && stats.typeTokenRatio < 0.45) {
    score += 30 * ((0.45 - stats.typeTokenRatio) / 0.45);
  }
  if (stats.trigramRepetition > 0.04) {
    score += 30 * Math.min(1, (stats.trigramRepetition - 0.04) / 0.1);
  }
  // Short samples get a confidence haircut instead of a confident wrong answer.
  if (stats.wordCount < 120) score *= stats.wordCount / 120;
  return Math.min(100, score);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detect(prepared: string, rules: SlopRules): Finding[] {
  const findings: Finding[] = [];
  const wordCount = words(prepared).length || 1;

  const addMatches = (re: RegExp, meta: Omit<Finding, "match" | "index" | "line">) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(prepared)) !== null) {
      findings.push({
        ...meta,
        match: m[0].trim(),
        index: m.index,
        line: lineOfIndex(prepared, m.index),
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };

  const vocab = rules.vocabulary;

  for (const word of vocab.tier1?.words || []) {
    addMatches(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"), {
      id: `vocab:${word}`,
      category: "vocabulary",
      tier: 1,
      weight: vocab.tier1.weight,
    });
  }

  const collect = (tier: VocabularyTier | undefined) => {
    const found: { word: string; match: string; index: number }[] = [];
    for (const word of tier?.words || []) {
      const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(prepared)) !== null) {
        found.push({ word, match: m[0], index: m.index });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    return found;
  };

  const tier2 = vocab.tier2;
  const tier2Found = collect(tier2);
  const distinctTier2 = new Set(tier2Found.map((f) => f.word.toLowerCase()));
  if (distinctTier2.size >= (tier2?.minDistinct || 2)) {
    for (const f of tier2Found) {
      findings.push({
        id: `vocab:${f.word}`,
        category: "vocabulary",
        tier: 2,
        weight: tier2.weight,
        match: f.match,
        index: f.index,
        line: lineOfIndex(prepared, f.index),
      });
    }
  }

  const tier3 = vocab.tier3;
  const tier3Found = collect(tier3);
  const tier3Density = (tier3Found.length / wordCount) * 100;
  if (tier3Density > (tier3?.maxDensityPct || 1.5)) {
    for (const f of tier3Found) {
      findings.push({
        id: `vocab:${f.word}`,
        category: "vocabulary",
        tier: 3,
        weight: tier3.weight,
        match: f.match,
        index: f.index,
        line: lineOfIndex(prepared, f.index),
      });
    }
  }

  for (const p of rules.phrases || []) {
    addMatches(
      new RegExp(escapeRegex(p.match).replace(/'/g, "['\\u2019]"), "gi"),
      {
        id: `phrase:${p.match}`,
        category: p.category,
        weight: p.weight,
        fix: p.fix,
      },
    );
  }

  for (const r of rules.regex || []) {
    addMatches(new RegExp(r.pattern, r.flags || "gi"), {
      id: r.id,
      category: r.category,
      weight: r.weight,
      note: r.note,
    });
  }

  findings.sort((a, b) => a.index - b.index);
  return findings;
}

export function patternScore(findings: Finding[], wordCount: number): number {
  if (!wordCount) return 0;
  const weighted = findings.reduce((a, f) => a + f.weight, 0);
  const per100 = (weighted / wordCount) * 100;
  let score = 34 * Math.log1p(per100); // density on a log curve
  const breadth = new Set(findings.map((f) => f.id)).size;
  score += Math.min(20, breadth * 2); // breadth bonus
  const categories = new Set(findings.map((f) => f.category)).size;
  score += Math.min(15, categories * 3); // category diversity bonus
  return Math.min(100, score);
}

export interface AnalyzeOptions extends PrepareOptions {
  /**
   * Runs after detection and before scoring. Return false to drop a finding.
   * This is how the Breadboard profile spares technical vocabulary without
   * editing the shared rule pack.
   */
  filterFinding?: (finding: Finding, prepared: string) => boolean;
  /** Text is already masked; skip prepareText. */
  preMasked?: boolean;
}

export function analyzeText(
  raw: string,
  rules: SlopRules,
  opts: AnalyzeOptions = {},
): ProseAnalysis {
  const prepared = opts.preMasked ? raw : prepareText(raw, opts);
  const stats = computeStats(prepared);
  let findings = detect(prepared, rules);
  if (opts.filterFinding) {
    findings = findings.filter((f) => opts.filterFinding!(f, prepared));
  }
  const pScore = patternScore(findings, stats.wordCount);
  const uScore = uniformityScore(stats);
  const score = Math.round(0.7 * pScore + 0.3 * uScore);
  return {
    score,
    patternScore: Math.round(pScore),
    uniformityScore: Math.round(uScore),
    stats,
    findings,
    confidence:
      stats.wordCount >= 120 ? "high" : stats.wordCount >= 40 ? "medium" : "low",
  };
}

export function badge(score: number): string {
  if (score <= 25) return "clean";
  if (score <= 50) return "lightly AI";
  if (score <= 75) return "moderate AI";
  return "heavy AI";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
