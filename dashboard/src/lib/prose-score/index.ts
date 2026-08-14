/**
 * Prose scoring for Breadboard.
 *
 * Answers one question the unslop integration could never answer on its own:
 * does the text we just generated read like a machine wrote it, and by how
 * much? unslop is a prompt - it changes the odds but reports nothing. This
 * gives a number, per page, from the same text a reader sees.
 *
 * Read-only by design. There is a deliberate no `fix` here: the upstream
 * mechanical fixer rewrites em dashes and quotes with no idea what a source
 * anchor or a LaTeX macro is, and turning it loose on a learning page would
 * corrupt exactly the structures the pipeline spent a run getting right.
 * Repairs go back through the model via the existing subsection_repair path.
 */

import { analyzeText, badge } from "./engine.ts";
import type { Finding, ProseAnalysis, SlopRules } from "./engine.ts";
import { maskGardenMarkdown } from "./mask.ts";
import { BASE_SLOP_RULES } from "./rules.base.ts";
import { BREADBOARD_PROFILE, buildFindingFilter } from "./rules.breadboard.ts";
import type { RuleProfile } from "./rules.breadboard.ts";

export type { Finding, ProseAnalysis, ProseStats, SlopRules } from "./engine.ts";
export type { RuleProfile, RuleExemption } from "./rules.breadboard.ts";
export { BASE_SLOP_RULES } from "./rules.base.ts";
export { BREADBOARD_PROFILE } from "./rules.breadboard.ts";
export { maskGardenMarkdown } from "./mask.ts";
export { badge } from "./engine.ts";

/** Upstream's target: at or under this reads as human-written. */
export const PROSE_SCORE_TARGET = 25;

export interface ScoreOptions {
  /** Rule tuning. Pass null for the plain upstream pack. Default: Breadboard. */
  profile?: RuleProfile | null;
  /** Mask LaTeX, anchors, wikilinks and visual blocks. Default: true. */
  maskGardenStructures?: boolean;
  /** Skip markdown blockquotes (pasted source excerpts). Default: true. */
  ignoreQuotes?: boolean;
  /** Alternate rule pack, for tests. */
  rules?: SlopRules;
}

export interface ProseScore extends ProseAnalysis {
  /** Profile applied, or "upstream" when scored with the raw pack. */
  profile: string;
  /** Findings grouped by id, worst first - what to show a human. */
  topPatterns: { id: string; count: number; note?: string }[];
  band: string;
}

export function scoreProse(text: string, opts: ScoreOptions = {}): ProseScore {
  const profile = opts.profile === undefined ? BREADBOARD_PROFILE : opts.profile;
  const rules = opts.rules ?? BASE_SLOP_RULES;
  const ignoreQuotes = opts.ignoreQuotes !== false;
  const mask = opts.maskGardenStructures !== false;

  const prepared = mask
    ? maskGardenMarkdown(text, { ignoreQuotes })
    : text;

  const analysis = analyzeText(prepared, rules, {
    preMasked: mask,
    ignoreQuotes,
    filterFinding: buildFindingFilter(profile),
  });

  return {
    ...analysis,
    profile: profile ? profile.name : "upstream",
    topPatterns: summarizeFindings(analysis.findings),
    band: badge(analysis.score),
  };
}

/**
 * Score a garden page both ways: the Breadboard-tuned number to gate on, and
 * the plain upstream number so a score stays comparable to soundshuman's
 * published bands and to anything scored outside this repo.
 */
export function scoreGardenPage(markdown: string): {
  tuned: ProseScore;
  upstream: ProseScore;
} {
  return {
    tuned: scoreProse(markdown),
    upstream: scoreProse(markdown, {
      profile: null,
      maskGardenStructures: false,
      ignoreQuotes: false,
    }),
  };
}

export function summarizeFindings(
  findings: Finding[],
  limit = 6,
): { id: string; count: number; note?: string }[] {
  const counts = new Map<string, { count: number; note?: string }>();
  for (const f of findings) {
    const entry = counts.get(f.id);
    if (entry) entry.count += 1;
    else counts.set(f.id, { count: 1, note: f.note });
  }
  return [...counts.entries()]
    .map(([id, v]) => ({ id, count: v.count, note: v.note }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, limit);
}
