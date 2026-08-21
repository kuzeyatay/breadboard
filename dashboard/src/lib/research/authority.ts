// How much a source counts for — which depends on what is being claimed.
//
// The tempting rule is "primary beats secondary", and it is wrong often enough
// to matter. A university's own page is the best source for whether a team is
// part of its programme and a poor one for how many members that team has
// today; the team's own roster is the reverse. A competition organiser beats
// both on who actually placed third, and loses to both on when the team was
// founded.
//
// So authority is a function of (claim, source class), not of source class
// alone. The table below is generic: it is expressed in claim *shapes* —
// membership, headcount, result, lifecycle, identity, date — that any domain's
// fields map onto, rather than in any particular subject's vocabulary.

import type { EvidenceKind, ResearchEvidence, SourceClass } from "./types.ts";

/**
 * The claim shapes authority is defined over. A requested field is mapped onto
 * one of these; anything unrecognized falls to `general`, which uses a neutral
 * ordering rather than pretending to know better.
 */
export type ClaimShape =
  | "identity"
  | "membership"
  | "headcount"
  | "lifecycle"
  | "result"
  | "date"
  | "general";

/** 0..1. Relative only — the number is never shown to anyone. */
const AUTHORITY: Record<ClaimShape, Partial<Record<SourceClass, number>>> = {
  // Who this is, and what it is called. The owner names itself.
  identity: {
    official_entity: 1,
    institution: 0.85,
    official_database: 0.8,
    archive: 0.7,
    competition: 0.6,
    partner: 0.5,
    reputable_secondary: 0.45,
    social: 0.3,
    // The seller names its own product correctly; that much it has no
    // reason to get wrong.
    vendor_marketing: 0.8,
    other: 0.2,
  },
  // Whether the entity belongs to a programme or body. The body decides.
  membership: {
    institution: 1,
    official_database: 0.9,
    official_entity: 0.75,
    competition: 0.6,
    partner: 0.5,
    reputable_secondary: 0.4,
    archive: 0.4,
    social: 0.25,
    vendor_marketing: 0.3,
    other: 0.2,
  },
  // How many. Only the entity knows its own current size.
  headcount: {
    official_entity: 1,
    institution: 0.7,
    partner: 0.55,
    official_database: 0.5,
    competition: 0.45,
    reputable_secondary: 0.4,
    social: 0.3,
    archive: 0.25,
    // A number a seller publishes about the market it sells into is
    // marketing before it is measurement.
    vendor_marketing: 0.22,
    other: 0.2,
  },
  // Alive, dormant, dissolved. The entity first, then the body that lists it.
  lifecycle: {
    official_entity: 0.95,
    institution: 0.9,
    official_database: 0.85,
    archive: 0.6,
    competition: 0.5,
    reputable_secondary: 0.45,
    partner: 0.4,
    social: 0.3,
    vendor_marketing: 0.3,
    other: 0.2,
  },
  // Who placed where. The organiser keeps the score.
  result: {
    competition: 1,
    official_database: 0.8,
    official_entity: 0.6,
    institution: 0.55,
    reputable_secondary: 0.5,
    archive: 0.45,
    partner: 0.35,
    social: 0.25,
    vendor_marketing: 0.25,
    other: 0.2,
  },
  // When something happened. Contemporaneous records beat later retellings.
  date: {
    archive: 0.9,
    official_entity: 0.85,
    official_database: 0.85,
    institution: 0.8,
    competition: 0.6,
    reputable_secondary: 0.5,
    partner: 0.35,
    social: 0.25,
    vendor_marketing: 0.3,
    other: 0.2,
  },
  general: {
    official_entity: 0.8,
    institution: 0.8,
    official_database: 0.8,
    competition: 0.6,
    archive: 0.55,
    reputable_secondary: 0.5,
    partner: 0.4,
    social: 0.25,
    vendor_marketing: 0.25,
    other: 0.2,
  },
};

/**
 * How much the way a value was obtained discounts it.
 *
 * The discount is steep at the bottom on purpose: an inference drawn from the
 * single best source still ranks below a plainly stated figure from a
 * mid-quality one. It does not outrank a stated figure from the very weakest
 * sources, and it should not — a number on the entity's own page beats a
 * stranger's guess, which beats a reconstruction from nothing in particular.
 */
const KIND_WEIGHT: Record<EvidenceKind, number> = {
  explicit: 1,
  roster_count: 0.9,
  derived: 0.7,
  estimate: 0.45,
  inference: 0.35,
};

/**
 * How much a stake in the answer discounts an observation.
 *
 * Halving rather than excluding, deliberately. An interested source is still a
 * source — often the only one that publishes the number at all — and dropping
 * it would trade a disclosed weak figure for no figure. What the discount buys
 * is that a disinterested source of even middling quality outranks it, which is
 * the ordering that stops a lead-generation page from setting the benchmark.
 */
const INTEREST_WEIGHT = 0.5;

const SHAPE_PATTERNS: ReadonlyArray<{ shape: ClaimShape; pattern: RegExp }> = [
  { shape: "headcount", pattern: /count|members|size|headcount|staff|employees|population/i },
  { shape: "lifecycle", pattern: /status|active|lifecycle|state|dissolved|defunct/i },
  { shape: "membership", pattern: /member(?:ship)?_?of|affiliation|programme|program|department|faculty/i },
  { shape: "result", pattern: /result|award|prize|achievement|rank|placement|championship|score/i },
  { shape: "date", pattern: /date|founded|established|since|year|created_?at|start/i },
  { shape: "identity", pattern: /^name$|names?|alias|title|website|url/i },
];

/** Map a requested field key onto the claim shape it behaves like. */
export function claimShapeForField(field: string): ClaimShape {
  for (const { shape, pattern } of SHAPE_PATTERNS) {
    if (pattern.test(field)) return shape;
  }
  return "general";
}

/**
 * Authority of one observation for its own claim.
 *
 * The evidence kind multiplies rather than adds, so an inference from the very
 * best source still ranks below an explicit statement from a mediocre one —
 * which is the ordering that keeps a plausible guess from beating a fact.
 */
export function evidenceAuthority(evidence: {
  field: string;
  sourceClass: SourceClass;
  evidenceKind: EvidenceKind;
  selfInterested?: boolean;
}): number {
  const shape = claimShapeForField(evidence.field);
  const base = AUTHORITY[shape][evidence.sourceClass] ?? AUTHORITY.general[evidence.sourceClass] ?? 0.2;
  const interest = evidence.selfInterested ? INTEREST_WEIGHT : 1;
  return Number((base * KIND_WEIGHT[evidence.evidenceKind] * interest).toFixed(4));
}

/** Whether an observation states the fact rather than reconstructing it. */
export function isExplicit(kind: EvidenceKind): boolean {
  return kind === "explicit" || kind === "roster_count";
}

/**
 * The publisher behind a URL, for counting sources rather than pages.
 *
 * Host-level and lenient about the `www.` prefix, which is enough to stop the
 * common inflation — the same site's landing page, blog post and PDF quoted as
 * three agreeing sources. It will not see through a company republishing its
 * own number under a different domain, and nothing here can.
 */
export function sourceIdentity(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** How many distinct publishers stand behind a set of observations. */
export function independentSourceCount(
  evidence: ReadonlyArray<{ sourceUrl: string }>,
): number {
  return new Set(evidence.map((item) => sourceIdentity(item.sourceUrl))).size;
}

/**
 * The evidence a synthesis may cite as fact, in the order it should be trusted.
 * Inference and estimate are excluded: they belong in the answer labelled as
 * what they are, never as the source of a stated number.
 */
export function citableEvidence(
  evidence: readonly ResearchEvidence[],
): ResearchEvidence[] {
  return evidence
    .filter((item) => isExplicit(item.evidenceKind))
    .slice()
    .sort((left, right) => evidenceAuthority(right) - evidenceAuthority(left));
}
