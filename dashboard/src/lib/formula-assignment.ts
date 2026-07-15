/**
 * Verified, family-constrained formula-assignment planner.
 *
 * This module owns the ONLY sanctioned path from an extracted source formula
 * into a learning unit's `sourceFormulas`. It runs strictly AFTER canonical
 * formula identities exist (formula-identity.ts) and BEFORE any learner page
 * is written:
 *
 *   extract source formulas
 *   → verify canonical formula identities
 *   → derive unit formula requirements        (deriveUnitFormulaRequirement)
 *   → build formula-to-unit compatibility     (scoreFormulaUnitCompatibility)
 *   → solve assignments under hard constraints (buildFormulaAssignmentPlan)
 *   → apply the complete plan atomically       (applyFormulaAssignmentPlanToUnits)
 *   → persist contract → generate pages
 *
 * Hard semantic constraints (verified family compatibility) always outrank
 * soft keyword preferences: an incompatible-family pair scores -Infinity and
 * can never be assigned, no matter how high its title overlap is. Extraction
 * anchor ids ("S1.P6.E6") are opaque handles — no code here may read meaning
 * out of their numeric suffixes.
 *
 * A unit may legitimately end up WITHOUT a source formula, and a formula may
 * legitimately stay unassigned with a recorded reason. Forcing coverage is
 * exactly the bug this module exists to prevent.
 */

import type { LearningUnitContract, LearningUnitRole, SourceFormulaPlacement } from "./learning-unit-contract.ts";
import {
  formulaFamiliesForAssignmentContext,
  type CanonicalFormulaIdentity,
  type FormulaSemanticFamily,
} from "./formula-identity.ts";

// ---------------------------------------------------------------------------
// Families: universal + domain aliases + garden-derived custom families
// ---------------------------------------------------------------------------

/** A canonical formula family with its aliases and the evidence vocabulary
 * that reveals it in unit titles/questions/concepts. Gardens may extend the
 * built-in registry with their own domain families (physics, economics, …). */
export type FormulaFamilyIdentity = {
  canonicalFamily: string;
  aliases: string[];
  evidenceTerms: string[];
};

/** Universal families every topic can use; SNN-era families are aliases of
 * these so existing verified identities keep working unchanged. */
export const UNIVERSAL_FORMULA_FAMILIES: readonly FormulaFamilyIdentity[] = [
  { canonicalFamily: "accuracy", aliases: ["classification_accuracy"], evidenceTerms: ["accuracy", "correct prediction", "classification accuracy", "error rate", "hit rate"] },
  { canonicalFamily: "latency", aliases: ["decision_latency", "response_time"], evidenceTerms: ["latency", "decision time", "response time", "reaction delay", "stimulus onset", "time to decision", "time to first spike"] },
  { canonicalFamily: "count", aliases: ["spike_count"], evidenceTerms: ["spike count", "total spikes", "number of spikes", "firing count", "event count"] },
  { canonicalFamily: "energy", aliases: [], evidenceTerms: ["energy", "joule", "power consumption", "energy cost", "synaptic operation"] },
  { canonicalFamily: "efficiency", aliases: ["energy_efficiency"], evidenceTerms: ["efficiency", "accuracy per energy", "per joule", "normalized energy"] },
  { canonicalFamily: "rate", aliases: ["learning_rate", "reaction_rate"], evidenceTerms: ["learning rate", "reaction rate", "rate constant", "step size", "per second", "kinetics"] },
  { canonicalFamily: "probability", aliases: [], evidenceTerms: ["probability", "likelihood", "odds", "chance of"] },
  { canonicalFamily: "distance", aliases: [], evidenceTerms: ["distance", "displacement", "path length"] },
  { canonicalFamily: "velocity", aliases: ["speed"], evidenceTerms: ["velocity", "speed", "distance over time", "motion rate", "meters per second"] },
  { canonicalFamily: "loss", aliases: [], evidenceTerms: ["loss", "cross entropy", "mean squared error", "objective function"] },
  { canonicalFamily: "convergence", aliases: [], evidenceTerms: ["convergence", "epochs to target", "training progress", "target accuracy epoch"] },
  { canonicalFamily: "membrane_dynamics", aliases: [], evidenceTerms: ["membrane potential", "leaky integrate", "neuron dynamics"] },
  { canonicalFamily: "spike_timing", aliases: ["stdp"], evidenceTerms: ["spike timing", "stdp", "pre-synaptic", "post-synaptic", "plasticity window"] },
];

/** Related families a requirement may EXPLICITLY accept next to its required
 * family. Nothing outside this table is ever treated as related. */
const RELATED_FAMILY_CONFIG: Record<string, string[]> = {
  latency: ["spike_timing"],
  efficiency: ["energy"],
  convergence: ["loss"],
};

function normalizeFamilyToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Canonical key for family equality: resolves aliases ("spike_count" ≡
 * "count", "speed" ≡ "velocity") across the built-in and garden registries. */
export function canonicalFormulaFamilyKey(
  family: string,
  familyRegistry: readonly FormulaFamilyIdentity[] = [],
): string {
  const token = normalizeFamilyToken(family);
  if (!token) return "other";
  for (const entry of [...familyRegistry, ...UNIVERSAL_FORMULA_FAMILIES]) {
    const canonical = normalizeFamilyToken(entry.canonicalFamily);
    if (token === canonical) return canonical;
    if (entry.aliases.some((alias) => normalizeFamilyToken(alias) === token)) return canonical;
  }
  return token;
}

function knownFamilies(familyRegistry: readonly FormulaFamilyIdentity[]): string[] {
  return [...new Set([
    ...UNIVERSAL_FORMULA_FAMILIES.map((entry) => normalizeFamilyToken(entry.canonicalFamily)),
    ...familyRegistry.map((entry) => normalizeFamilyToken(entry.canonicalFamily)),
  ])];
}

/** A verified identity as the planner consumes it. `family` is widened to
 * `string` so garden-derived custom families (velocity, profit_margin, …)
 * flow through the same planner as the built-in FormulaSemanticFamily set. */
export type AssignableFormulaIdentity = Omit<CanonicalFormulaIdentity, "family"> & {
  family: FormulaSemanticFamily | (string & {});
};

/**
 * Restrict source-formula candidates to the anchors explicitly assigned to a
 * learning unit. Page grounding and visual generation must share this same
 * family-safe boundary.
 */
export function formulaCandidatesForUnit<
  TFigure extends { figureId: string },
  TContract extends { id: string },
>(
  candidates: readonly TFigure[],
  contracts: readonly TContract[],
): TFigure[] {
  const allowedIds = new Set(contracts.map((contract) => contract.id).filter(Boolean));
  return candidates.filter((candidate) => allowedIds.has(candidate.figureId));
}

// ---------------------------------------------------------------------------
// Part 2 — Unit formula requirements
// ---------------------------------------------------------------------------

export type FormulaRequirementStrength =
  | "required"
  | "helpful"
  | "not_needed";

export type UnitFormulaRequirement = {
  unitId: string;
  unitTitle: string;
  unitRole: LearningUnitRole;

  requiredFamilies: string[];
  acceptedRelatedFamilies: string[];
  forbiddenFamilies: string[];

  strength: FormulaRequirementStrength;

  evidence: {
    titleTerms: string[];
    learningQuestionTerms: string[];
    newConceptTerms: string[];
    sourceConceptTerms: string[];
  };

  reason: string;
};

/** Roles that may carry a contract source formula. Mirrors the contract
 * validator in learning-unit-contract.ts (formula/metric plus the two
 * interpretation roles); any other role derives `not_needed`. */
const FORMULA_BEARING_ROLES = new Set<LearningUnitRole>([
  "formula",
  "metric",
  "worked_example",
  "result_interpretation",
]);

function familyEvidenceTermsInText(
  text: string,
  familyRegistry: readonly FormulaFamilyIdentity[],
): Array<{ term: string; family: string }> {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const matches: Array<{ term: string; family: string }> = [];
  for (const entry of [...UNIVERSAL_FORMULA_FAMILIES, ...familyRegistry]) {
    for (const term of entry.evidenceTerms) {
      const needle = ` ${term.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      if (haystack.includes(needle)) {
        matches.push({ term, family: normalizeFamilyToken(entry.canonicalFamily) });
      }
    }
  }
  return matches;
}

/**
 * From a set of family evidence matches, keep only the families whose evidence
 * is not fully DOMINATED by a more specific term from a different family. This
 * resolves overlapping phrases: in "Normalized Energy Efficiency", the plain
 * "energy" match is a substring of the efficiency-specific "normalized energy"
 * match, so only `efficiency` survives — while in "Accuracy-Latency-Energy
 * Tradeoff" the three metric words are distinct and all survive.
 */
function dominantFamilies(matches: Array<{ term: string; family: string }>): string[] {
  const families = [...new Set(matches.map((match) => match.family))];
  const kept: string[] = [];
  for (const family of families) {
    const familyTerms = matches.filter((match) => match.family === family).map((match) => match.term.toLowerCase());
    const dominated = familyTerms.every((term) =>
      matches.some((other) =>
        other.family !== family
        && other.term.length > term.length
        && other.term.toLowerCase().includes(term)));
    if (!dominated) kept.push(family);
  }
  return kept;
}

/**
 * Derive what kind of source formula (if any) a unit NEEDS from the unit's
 * own semantic content — title, learning question, and concepts. Existing
 * `sourceFormulas` are deliberately never consulted: a wrong prior assignment
 * must not be able to justify itself.
 */
export function deriveUnitFormulaRequirement(
  unit: LearningUnitContract,
  familyRegistry: readonly FormulaFamilyIdentity[] = [],
): UnitFormulaRequirement {
  const titleMatches = familyEvidenceTermsInText(unit.title, familyRegistry);
  const questionMatches = familyEvidenceTermsInText(unit.learningQuestion ?? "", familyRegistry);
  const conceptMatches = familyEvidenceTermsInText((unit.newConcepts ?? []).join(" "), familyRegistry);
  const sourceConceptMatches = familyEvidenceTermsInText(
    [
      ...(unit.prerequisiteConcepts ?? []),
      ...(unit.semanticConcepts ?? []).map((concept) => concept.preferredLabel),
    ].join(" "),
    familyRegistry,
  );

  const evidence: UnitFormulaRequirement["evidence"] = {
    titleTerms: [...new Set(titleMatches.map((match) => match.term))],
    learningQuestionTerms: [...new Set(questionMatches.map((match) => match.term))],
    newConceptTerms: [...new Set(conceptMatches.map((match) => match.term))],
    sourceConceptTerms: [...new Set(sourceConceptMatches.map((match) => match.term))],
  };

  const base = {
    unitId: unit.id,
    unitTitle: unit.title,
    unitRole: unit.role,
    evidence,
  };

  // Family derivation is TITLE-FIRST: the title is the learner-facing
  // declaration of what a unit teaches, so its families are authoritative when
  // present. The learning question and new concepts are the fallback, and the
  // structural built-in context is the last resort. Existing sourceFormulas
  // are never consulted — a prior wrong assignment must not justify itself.
  const canonical = (family: string) => canonicalFormulaFamilyKey(family, familyRegistry);
  const titleFamilies = [...new Set(dominantFamilies(titleMatches).map(canonical))];
  const questionFamilies = [...new Set(dominantFamilies(questionMatches).map(canonical))];
  const conceptFamilies = [...new Set(dominantFamilies(conceptMatches).map(canonical))];
  const builtinContext = formulaFamiliesForAssignmentContext(unit).map(canonical);

  const requiredFamilies = titleFamilies.length > 0
    ? titleFamilies
    : questionFamilies.length > 0 || conceptFamilies.length > 0
      ? [...new Set([...questionFamilies, ...conceptFamilies])]
      : [...new Set(builtinContext)];

  // No formula family is derivable from the unit's own semantics. A unit that
  // also does not play a formula-bearing role needs no formula at all; a
  // formula-bearing unit with no derivable family stays helpful-but-empty so
  // it accepts nothing arbitrary rather than a wrong-family formula.
  if (requiredFamilies.length === 0) {
    const strength: FormulaRequirementStrength =
      FORMULA_BEARING_ROLES.has(unit.role) ? "helpful" : "not_needed";
    return {
      ...base,
      requiredFamilies: [],
      acceptedRelatedFamilies: [],
      forbiddenFamilies: strength === "not_needed" ? knownFamilies(familyRegistry) : [],
      strength,
      reason: strength === "not_needed"
        ? `Role "${unit.role}" carries no formula and the unit's semantics name no formula family; it teaches without a source formula.`
        : "No formula family is derivable from the unit's title, question, or concepts; the unit stays source-formula-free rather than accepting an arbitrary formula.",
    };
  }

  const acceptedRelatedFamilies = [...new Set(
    requiredFamilies.flatMap((family) => RELATED_FAMILY_CONFIG[family] ?? [])
      .map((family) => canonicalFormulaFamilyKey(family, familyRegistry))
      .filter((family) => !requiredFamilies.includes(family)),
  )];
  const forbiddenFamilies = knownFamilies(familyRegistry).filter((family) =>
    !requiredFamilies.includes(family) && !acceptedRelatedFamilies.includes(family));

  // Family evidence exists. A focused formula/metric unit REQUIRES its one
  // semantic family. A broad metric overview that names several families is a
  // synthesis host, not five separate definition units: making every family
  // required lets it steal canonical formulas from the focused units that
  // actually teach them. Such a unit may still receive an otherwise-unclaimed
  // compatible formula in Phase B, but it never outranks a focused unit.
  const strength: FormulaRequirementStrength =
    unit.role === "formula" || (unit.role === "metric" && requiredFamilies.length === 1)
      ? "required"
      : "helpful";
  return {
    ...base,
    requiredFamilies,
    acceptedRelatedFamilies,
    forbiddenFamilies,
    strength,
    reason: `Unit semantics (${[...evidence.titleTerms, ...evidence.learningQuestionTerms, ...evidence.newConceptTerms].slice(0, 4).join(", ") || "role context"}) support the ${requiredFamilies.join(", ")} famil${requiredFamilies.length === 1 ? "y" : "ies"}; role "${unit.role}" makes a source formula ${strength}.`,
  };
}

// ---------------------------------------------------------------------------
// Part 3 — Formula-to-unit compatibility matrix
// ---------------------------------------------------------------------------

export type FormulaUnitCompatibility = {
  formulaAnchorId: string;
  formulaFamily: string;

  unitId: string;
  requiredFamilies: string[];

  familyCompatible: boolean;

  titleOverlapScore: number;
  learningQuestionOverlapScore: number;
  conceptOverlapScore: number;
  sourceContextScore: number;
  placementCompatibilityScore: number;

  totalScore: number;

  hardRejectionReasons: string[];
  reason: string;
};

const OVERLAP_STOP_WORDS = new Set([
  "the", "and", "for", "from", "with", "into", "that", "this", "when", "where",
  "what", "which", "how", "why", "are", "was", "its", "their", "formula",
  "defined", "definition", "total", "source", "using", "used", "unit",
]);

function overlapTokens(value: string): string[] {
  return [...new Set(
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
      .filter((token) => token.length >= 3 && !OVERLAP_STOP_WORDS.has(token)),
  )];
}

function overlapScore(left: string, right: string): number {
  const a = overlapTokens(left);
  if (a.length === 0) return 0;
  const b = new Set(overlapTokens(right));
  return Math.round((a.filter((token) => b.has(token)).length / a.length) * 1000) / 1000;
}

function placementScoreForRole(role: LearningUnitRole): number {
  if (role === "metric" || role === "formula") return 1;
  if (role === "worked_example") return 0.9;
  if (role === "result_interpretation") return 0.8;
  return 0;
}

/** Text the identity contributes to keyword overlap. Anchor ids are excluded
 * on purpose: the extraction suffix carries no semantics. */
function identityOverlapText(identity: AssignableFormulaIdentity): string {
  return [
    identity.title,
    identity.caption ?? "",
    identity.canonicalText ?? "",
    identity.evidence?.detectedTerms?.join(" ") ?? "",
  ].join(" ");
}

export function scoreFormulaUnitCompatibility(
  formula: AssignableFormulaIdentity,
  requirement: UnitFormulaRequirement,
  unit: LearningUnitContract,
  familyRegistry: readonly FormulaFamilyIdentity[] = [],
): FormulaUnitCompatibility {
  const formulaFamily = canonicalFormulaFamilyKey(String(formula.family), familyRegistry);
  const requiredFamilies = requirement.requiredFamilies.map((family) => canonicalFormulaFamilyKey(family, familyRegistry));
  const relatedFamilies = requirement.acceptedRelatedFamilies.map((family) => canonicalFormulaFamilyKey(family, familyRegistry));
  const forbiddenFamilies = requirement.forbiddenFamilies.map((family) => canonicalFormulaFamilyKey(family, familyRegistry));

  const hardRejectionReasons: string[] = [];
  if (!formula.verified) {
    hardRejectionReasons.push(`formula identity ${formula.anchorId} is not verified`);
  }
  if (!String(formula.canonicalText ?? "").trim()
    && !String(formula.evidence?.sourceContext ?? "").trim()
    && !String(formula.caption ?? "").trim()) {
    hardRejectionReasons.push(`formula ${formula.anchorId} has no recoverable source text`);
  }
  if (requirement.strength === "not_needed") {
    hardRejectionReasons.push(`unit ${requirement.unitId} (${requirement.unitRole}) does not take a source formula`);
  }
  const familyAccepted = requiredFamilies.includes(formulaFamily) || relatedFamilies.includes(formulaFamily);
  if (requirement.strength !== "not_needed") {
    if (requiredFamilies.length === 0) {
      hardRejectionReasons.push(`unit ${requirement.unitId} derives no compatible formula family from its own semantics`);
    } else if (!familyAccepted) {
      hardRejectionReasons.push(
        `verified family "${formulaFamily}" is not in ${requirement.unitId}'s required [${requiredFamilies.join(", ")}] or accepted related [${relatedFamilies.join(", ") || "none"}] families`,
      );
    }
  }
  if (forbiddenFamilies.includes(formulaFamily) && !familyAccepted) {
    hardRejectionReasons.push(`verified family "${formulaFamily}" is explicitly forbidden for ${requirement.unitId}`);
  }

  const familyCompatible = requirement.strength !== "not_needed" && requiredFamilies.length > 0 && familyAccepted;

  const identityText = identityOverlapText(formula);
  const titleOverlapScore = overlapScore(identityText, `${unit.title} ${(unit.newConcepts ?? []).join(" ")}`);
  const learningQuestionOverlapScore = overlapScore(identityText, unit.learningQuestion ?? "");
  const conceptOverlapScore = overlapScore(
    identityText,
    [...(unit.newConcepts ?? []), ...(unit.prerequisiteConcepts ?? [])].join(" "),
  );
  const sourceContextScore = overlapScore(
    `${unit.title} ${unit.learningQuestion ?? ""}`,
    String(formula.evidence?.sourceContext ?? formula.caption ?? ""),
  );
  const placementCompatibilityScore = placementScoreForRole(requirement.unitRole);

  // Hard constraints outrank soft preferences absolutely: an incompatible
  // family scores -Infinity so no keyword overlap can ever rescue it.
  const totalScore = hardRejectionReasons.length > 0
    ? Number.NEGATIVE_INFINITY
    : Math.round((
        0.55
        + titleOverlapScore * 0.15
        + learningQuestionOverlapScore * 0.1
        + conceptOverlapScore * 0.1
        + sourceContextScore * 0.05
        + placementCompatibilityScore * 0.05
      ) * 1000) / 1000;

  return {
    formulaAnchorId: formula.anchorId,
    formulaFamily,
    unitId: requirement.unitId,
    requiredFamilies,
    familyCompatible,
    titleOverlapScore,
    learningQuestionOverlapScore,
    conceptOverlapScore,
    sourceContextScore,
    placementCompatibilityScore,
    totalScore,
    hardRejectionReasons,
    reason: hardRejectionReasons.length > 0
      ? `impossible assignment: ${hardRejectionReasons.join("; ")}`
      : `verified ${formulaFamily} matches ${requirement.unitId} [${requiredFamilies.join(", ")}]; semantic score ${totalScore}`,
  };
}

// ---------------------------------------------------------------------------
// Part 11 — the single pre-write guard
// ---------------------------------------------------------------------------

function pseudoUnitFromRequirement(requirement: UnitFormulaRequirement): LearningUnitContract {
  return {
    id: requirement.unitId,
    title: requirement.unitTitle,
    role: requirement.unitRole,
    learningQuestion: requirement.evidence.learningQuestionTerms.join(" "),
    prerequisiteConcepts: requirement.evidence.sourceConceptTerms,
    newConcepts: requirement.evidence.newConceptTerms,
    sourceAnchors: [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: [],
    mustNotRepeat: [],
    expectedWordRange: [0, 0],
  };
}

/**
 * The one guard every assignment entry point runs before a formula anchor may
 * reach `unit.sourceFormulas` or a page's `sourceFormulaAnchors`. Returns the
 * full compatibility verdict; callers must treat any hardRejectionReasons as
 * a refusal to write.
 */
export function validateFormulaAssignment(
  formula: AssignableFormulaIdentity,
  requirement: UnitFormulaRequirement,
  unit?: LearningUnitContract,
  familyRegistry: readonly FormulaFamilyIdentity[] = [],
): FormulaUnitCompatibility {
  return scoreFormulaUnitCompatibility(
    formula,
    requirement,
    unit ?? pseudoUnitFromRequirement(requirement),
    familyRegistry,
  );
}

/** Throwing form of the guard for strict pre-write call sites. The message
 * format matches assertFormulaAssignmentCompatible so log tooling keeps
 * matching on "Formula assignment rejected:". */
export function assertPlannedFormulaAssignment(
  formula: AssignableFormulaIdentity,
  requirement: UnitFormulaRequirement,
  unit?: LearningUnitContract,
  familyRegistry: readonly FormulaFamilyIdentity[] = [],
): FormulaUnitCompatibility {
  const verdict = validateFormulaAssignment(formula, requirement, unit, familyRegistry);
  if (verdict.hardRejectionReasons.length > 0) {
    throw new Error(`Formula assignment rejected: ${verdict.reason}`);
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// Part 4/5/6/7 — global assignment planning
// ---------------------------------------------------------------------------

export type PlannedFormulaAssignment = {
  formulaAnchorId: string;
  unitId: string;

  status:
    | "assigned"
    | "reused_with_reason"
    | "unassigned_with_reason"
    | "ambiguous"
    | "rejected";

  compatibility: FormulaUnitCompatibility;

  placement?: SourceFormulaPlacement;
  teachingGoal?: string;
  termsToDefine?: string[];

  reason: string;
};

export type FormulaReuseProvenance = {
  formulaAnchorId: string;
  primaryUnitId: string;
  reusedByUnitId: string;
  reason: string;
};

export type FormulaAssignmentPlan = {
  assignments: PlannedFormulaAssignment[];

  formulasWithoutCompatibleUnits: {
    formulaAnchorId: string;
    reason: string;
  }[];

  unitsMissingRequiredFormulas: {
    unitId: string;
    requiredFamilies: string[];
    reason: string;
  }[];

  ambiguousAssignments: {
    formulaAnchorId: string;
    candidateUnitIds: string[];
    reason: string;
  }[];

  rejectedAssignments: {
    formulaAnchorId: string;
    unitId: string;
    reason: string;
  }[];

  /** Justified cross-unit reuse (same verified family, distinct purposes). */
  reuse: FormulaReuseProvenance[];

  valid: boolean;
  problems: string[];
};

export type FormulaAssignmentPlanOptions = {
  familyRegistry?: readonly FormulaFamilyIdentity[];
  /** Assignments already present in the contract (for stability, reuse
   * justification, and reporting rejected prior proposals). Every previous
   * assignment is REVALIDATED — none survives on trust. */
  previousAssignments?: Array<{ formulaAnchorId: string; unitId: string }>;
  /** Two candidates within this score margin are ambiguous → ChatMock. */
  ambiguityMargin?: number;
  maxFormulasPerUnit?: number;
};

function normalizedFormulaTextKey(identity: AssignableFormulaIdentity): string {
  return String(identity.canonicalText ?? "")
    .toLowerCase()
    .replace(/\\(?:left|right|,|;|:|!)/g, "")
    .replace(/[\s{}]+/g, "");
}

function placementForRole(role: LearningUnitRole): SourceFormulaPlacement {
  if (role === "metric" || role === "formula") return "inside_metric_definition";
  if (role === "result_interpretation") return "inside_result_interpretation";
  return "before_example";
}

const NO_UNIT_REQUIREMENT: UnitFormulaRequirement = {
  unitId: "",
  unitTitle: "",
  unitRole: "core_concept",
  requiredFamilies: [],
  acceptedRelatedFamilies: [],
  forbiddenFamilies: [],
  strength: "not_needed",
  evidence: { titleTerms: [], learningQuestionTerms: [], newConceptTerms: [], sourceConceptTerms: [] },
  reason: "no target unit",
};

/** Compatibility row for a formula that ends up bound to no unit at all. */
function unassignedCompatibilityRow(
  formula: AssignableFormulaIdentity,
  familyRegistry: readonly FormulaFamilyIdentity[],
): FormulaUnitCompatibility {
  return scoreFormulaUnitCompatibility(
    formula,
    NO_UNIT_REQUIREMENT,
    pseudoUnitFromRequirement(NO_UNIT_REQUIREMENT),
    familyRegistry,
  );
}

/**
 * Evaluate every verified formula against every unit TOGETHER and solve the
 * assignment under hard constraints. No greedy first-match: scarce required
 * families are satisfied first, duplicates stay unassigned with a reason, and
 * close calls become explicit ambiguities instead of silent picks.
 */
export function buildFormulaAssignmentPlan(
  formulas: AssignableFormulaIdentity[],
  units: LearningUnitContract[],
  options: FormulaAssignmentPlanOptions = {},
): FormulaAssignmentPlan {
  const familyRegistry = options.familyRegistry ?? [];
  const ambiguityMargin = options.ambiguityMargin ?? 0.05;
  const maxFormulasPerUnit = options.maxFormulasPerUnit ?? 3;
  const previousAssignments = options.previousAssignments ?? [];

  const requirements = new Map(units.map((unit) => [unit.id, deriveUnitFormulaRequirement(unit, familyRegistry)]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const formulasById = new Map(formulas.map((formula) => [formula.anchorId, formula]));
  const previousByPair = new Set(previousAssignments.map((entry) => `${entry.formulaAnchorId}::${entry.unitId}`));

  // Full matrix, sorted deterministically.
  const matrix: FormulaUnitCompatibility[] = [];
  for (const formula of [...formulas].sort((left, right) => left.anchorId.localeCompare(right.anchorId))) {
    for (const unit of units) {
      matrix.push(scoreFormulaUnitCompatibility(formula, requirements.get(unit.id)!, unit, familyRegistry));
    }
  }
  const rowsForFormula = (anchorId: string) => matrix.filter((row) => row.formulaAnchorId === anchorId);
  const rowsForUnit = (unitId: string) => matrix.filter((row) => row.unitId === unitId);
  const eligible = (row: FormulaUnitCompatibility) => row.hardRejectionReasons.length === 0;

  // Duplicate detection: identical canonical text within the same family. The
  // preferred copy is the higher-confidence identity (anchor id only breaks
  // exact ties for determinism — it never carries meaning).
  const duplicateOf = new Map<string, string>();
  const byTextKey = new Map<string, AssignableFormulaIdentity[]>();
  for (const formula of formulas) {
    const key = `${canonicalFormulaFamilyKey(String(formula.family), familyRegistry)}::${normalizedFormulaTextKey(formula)}`;
    if (!normalizedFormulaTextKey(formula)) continue;
    byTextKey.set(key, [...(byTextKey.get(key) ?? []), formula]);
  }
  const confidenceRank = (identity: AssignableFormulaIdentity): number =>
    identity.evidence?.confidence === "high" ? 2 : identity.evidence?.confidence === "medium" ? 1 : 0;
  for (const group of byTextKey.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) =>
      confidenceRank(right) - confidenceRank(left) || left.anchorId.localeCompare(right.anchorId));
    for (const dup of ordered.slice(1)) duplicateOf.set(dup.anchorId, ordered[0].anchorId);
  }

  const assignments: PlannedFormulaAssignment[] = [];
  const ambiguousEntries: FormulaAssignmentPlan["ambiguousAssignments"] = [];
  const rejectedEntries: FormulaAssignmentPlan["rejectedAssignments"] = [];
  const reuse: FormulaReuseProvenance[] = [];
  const assignedUnitByFormula = new Map<string, string>();
  const unitAssignedCount = new Map<string, number>();
  const ambiguousFormulaIds = new Set<string>();

  const claim = (row: FormulaUnitCompatibility, status: "assigned" | "reused_with_reason", reason: string) => {
    const unit = unitsById.get(row.unitId)!;
    const previousContract = unit.sourceFormulas.find((entry) => entry.id === row.formulaAnchorId);
    assignments.push({
      formulaAnchorId: row.formulaAnchorId,
      unitId: row.unitId,
      status,
      compatibility: row,
      placement: previousContract?.placement ?? placementForRole(unit.role),
      teachingGoal: previousContract?.teachingGoal
        || `Define and interpret the verified ${row.formulaFamily} relationship for "${unit.title}".`,
      termsToDefine: previousContract?.termsToDefine?.length
        ? previousContract.termsToDefine
        : formulasById.get(row.formulaAnchorId)?.evidence?.detectedTerms?.slice(0, 6) ?? [],
      reason,
    });
    if (status === "assigned") assignedUnitByFormula.set(row.formulaAnchorId, row.unitId);
    unitAssignedCount.set(row.unitId, (unitAssignedCount.get(row.unitId) ?? 0) + 1);
  };

  // Report every previously persisted pair that is now hard-rejected. This is
  // where a stale "S1.P6.E6 → U10" proposal becomes an explicit rejection.
  for (const previous of previousAssignments) {
    const row = matrix.find((candidate) =>
      candidate.formulaAnchorId === previous.formulaAnchorId && candidate.unitId === previous.unitId);
    const missing = !formulasById.has(previous.formulaAnchorId);
    if (missing || (row && !eligible(row))) {
      const reason = missing
        ? `formula anchor ${previous.formulaAnchorId} has no verified identity in the registry`
        : row!.reason;
      rejectedEntries.push({ formulaAnchorId: previous.formulaAnchorId, unitId: previous.unitId, reason });
      if (row) {
        assignments.push({
          formulaAnchorId: previous.formulaAnchorId,
          unitId: previous.unitId,
          status: "rejected",
          compatibility: row,
          reason,
        });
      }
    }
  }

  // Stability preference: keep a previously persisted pair when it is still
  // fully compatible and within the margin of the best candidate. A focused
  // one-family unit also outranks a broad synthesis unit when both are valid;
  // this preference is deliberately far smaller than the hard family gate.
  const scoreWithStability = (row: FormulaUnitCompatibility): number => {
    const familyCount = requirements.get(row.unitId)?.requiredFamilies.length ?? 0;
    const specificityBonus = familyCount === 1 ? 0.05 : 0;
    const stabilityBonus = previousByPair.has(`${row.formulaAnchorId}::${row.unitId}`) ? 0.02 : 0;
    return row.totalScore + specificityBonus + stabilityBonus;
  };

  // Phase A — required units first, scarcest family first, so broad keyword
  // overlap elsewhere can never steal the only compatible formula.
  type Need = { unitId: string; family: string; candidates: FormulaUnitCompatibility[] };
  const needs: Need[] = [];
  for (const unit of units) {
    const requirement = requirements.get(unit.id)!;
    if (requirement.strength !== "required") continue;
    for (const family of requirement.requiredFamilies) {
      const candidates = rowsForUnit(unit.id).filter((row) =>
        eligible(row) && row.formulaFamily === canonicalFormulaFamilyKey(family, familyRegistry));
      needs.push({ unitId: unit.id, family, candidates });
    }
  }
  needs.sort((left, right) =>
    left.candidates.length - right.candidates.length
    // When the same scarce formula can serve both a focused unit and a broad
    // multi-family unit, satisfy the focused unit first. Anchor ids remain an
    // opaque final tie-break only.
    || requirements.get(left.unitId)!.requiredFamilies.length
      - requirements.get(right.unitId)!.requiredFamilies.length
    || left.unitId.localeCompare(right.unitId)
    || left.family.localeCompare(right.family));

  // Per-need shortfall reasons; the actual "missing" list is derived AFTER all
  // needs are processed so a unit that satisfied ANY of its required families
  // is never reported as missing (e.g. an efficiency unit that also matched a
  // broader "energy" term keeps its efficiency formula and is not "missing").
  const needShortfalls = new Map<string, { requiredFamilies: string[]; reason: string }>();
  for (const need of needs) {
    const open = need.candidates
      .filter((row) => !assignedUnitByFormula.has(row.formulaAnchorId)
        && !duplicateOf.has(row.formulaAnchorId)
        && !ambiguousFormulaIds.has(row.formulaAnchorId))
      .sort((left, right) => scoreWithStability(right) - scoreWithStability(left)
        || left.formulaAnchorId.localeCompare(right.formulaAnchorId));
    if (open.length === 0) {
      const requirement = requirements.get(need.unitId)!;
      if (!needShortfalls.has(need.unitId)) {
        needShortfalls.set(need.unitId, {
          requiredFamilies: requirement.requiredFamilies,
          reason: need.candidates.length === 0
            ? `no verified ${need.family} formula exists in the source registry`
            : `every verified ${need.family} formula is already assigned, duplicate, or ambiguous`,
        });
      }
      continue;
    }
    const [best, second] = open;
    if (second && scoreWithStability(best) - scoreWithStability(second) < ambiguityMargin) {
      // Multiple close candidates for one unit: defer to ChatMock instead of
      // silently picking one.
      const involved = open.filter((row) =>
        scoreWithStability(best) - scoreWithStability(row) < ambiguityMargin);
      for (const row of involved) {
        ambiguousFormulaIds.add(row.formulaAnchorId);
        ambiguousEntries.push({
          formulaAnchorId: row.formulaAnchorId,
          candidateUnitIds: [need.unitId],
          reason: `multiple verified ${need.family} candidates score within ${ambiguityMargin} for ${need.unitId}`,
        });
        assignments.push({
          formulaAnchorId: row.formulaAnchorId,
          unitId: need.unitId,
          status: "ambiguous",
          compatibility: row,
          reason: `deterministic selection unsafe: candidate within ${ambiguityMargin} of the best ${need.family} option`,
        });
      }
      needShortfalls.set(need.unitId, {
        requiredFamilies: requirements.get(need.unitId)!.requiredFamilies,
        reason: `ambiguous ${need.family} candidates require a targeted critic decision`,
      });
      continue;
    }
    claim(best, "assigned", `strongest unambiguous verified ${need.family} candidate for required unit ${need.unitId}`);
  }

  const unitsMissingRequired: FormulaAssignmentPlan["unitsMissingRequiredFormulas"] = [];

  // Phase B — remaining formulas onto helpful units, best unit per formula,
  // still under hard constraints, with formula-side ambiguity detection.
  for (const formula of [...formulas].sort((left, right) => left.anchorId.localeCompare(right.anchorId))) {
    if (assignedUnitByFormula.has(formula.anchorId) || ambiguousFormulaIds.has(formula.anchorId)) continue;
    if (duplicateOf.has(formula.anchorId)) {
      const primary = duplicateOf.get(formula.anchorId)!;
      assignments.push({
        formulaAnchorId: formula.anchorId,
        unitId: "",
        status: "unassigned_with_reason",
        compatibility: rowsForFormula(formula.anchorId).find(eligible)
          ?? rowsForFormula(formula.anchorId)[0]
          ?? unassignedCompatibilityRow(formula, familyRegistry),
        reason: `duplicate formula — the same canonical ${canonicalFormulaFamilyKey(String(formula.family), familyRegistry)} formulation is already covered by ${primary}`,
      });
      continue;
    }
    const candidates = rowsForFormula(formula.anchorId)
      .filter((row) => eligible(row)
        && FORMULA_BEARING_ROLES.has(unitsById.get(row.unitId)?.role ?? "core_concept")
        && (unitAssignedCount.get(row.unitId) ?? 0) < maxFormulasPerUnit)
      .sort((left, right) => scoreWithStability(right) - scoreWithStability(left)
        || left.unitId.localeCompare(right.unitId));
    if (candidates.length === 0) {
      continue; // recorded below as formulasWithoutCompatibleUnits
    }
    const [best, second] = candidates;
    if (second && second.unitId !== best.unitId
      && scoreWithStability(best) - scoreWithStability(second) < ambiguityMargin) {
      const candidateUnitIds = candidates
        .filter((row) => scoreWithStability(best) - scoreWithStability(row) < ambiguityMargin)
        .map((row) => row.unitId);
      ambiguousFormulaIds.add(formula.anchorId);
      ambiguousEntries.push({
        formulaAnchorId: formula.anchorId,
        candidateUnitIds: [...new Set(candidateUnitIds)],
        reason: `verified ${best.formulaFamily} formula fits ${candidateUnitIds.length} units within ${ambiguityMargin}`,
      });
      assignments.push({
        formulaAnchorId: formula.anchorId,
        unitId: best.unitId,
        status: "ambiguous",
        compatibility: best,
        reason: "multiple compatible units score too closely for a deterministic pick",
      });
      continue;
    }
    claim(best, "assigned", `best compatible unit for verified ${best.formulaFamily} formula (score ${best.totalScore})`);
  }

  // Phase C — justified reuse. A formula may appear on a SECOND unit only when
  // the contract already carried that pair, both pairs are fully compatible
  // (same verified family by construction), and the two units have distinct
  // teaching purposes. Reuse never substitutes for missing family coverage:
  // it can only revisit a formula that already has a primary home.
  for (const previous of previousAssignments) {
    const primaryUnitId = assignedUnitByFormula.get(previous.formulaAnchorId);
    if (!primaryUnitId || primaryUnitId === previous.unitId) continue;
    if (assignments.some((assignment) => assignment.formulaAnchorId === previous.formulaAnchorId
      && assignment.unitId === previous.unitId
      && assignment.status !== "rejected")) continue;
    const row = matrix.find((candidate) =>
      candidate.formulaAnchorId === previous.formulaAnchorId && candidate.unitId === previous.unitId);
    if (!row || !eligible(row)) continue;
    const primaryRole = unitsById.get(primaryUnitId)?.role;
    const reuseRole = unitsById.get(previous.unitId)?.role;
    if (!primaryRole || !reuseRole || primaryRole === reuseRole) continue;
    if ((unitAssignedCount.get(previous.unitId) ?? 0) >= maxFormulasPerUnit) continue;
    claim(row, "reused_with_reason",
      `justified reuse: same verified ${row.formulaFamily} family, distinct teaching purpose (${primaryRole} vs ${reuseRole})`);
    reuse.push({
      formulaAnchorId: previous.formulaAnchorId,
      primaryUnitId,
      reusedByUnitId: previous.unitId,
      reason: `The ${row.formulaFamily} definition is first taught on ${primaryUnitId} (${primaryRole}) and deliberately revisited on ${previous.unitId} (${reuseRole}).`,
    });
  }

  // Formulas with no compatible unit anywhere.
  const formulasWithoutCompatibleUnits: FormulaAssignmentPlan["formulasWithoutCompatibleUnits"] = [];
  for (const formula of formulas) {
    if (assignedUnitByFormula.has(formula.anchorId)
      || ambiguousFormulaIds.has(formula.anchorId)
      || duplicateOf.has(formula.anchorId)) continue;
    const rows = rowsForFormula(formula.anchorId);
    const anyEligible = rows.some(eligible);
    const reason = anyEligible
      ? "every compatible unit is at capacity; the formula defers to its source reference"
      : !formula.verified
        ? "formula identity is not verified; assignment would be guesswork"
        : `no selected unit supports the verified ${canonicalFormulaFamilyKey(String(formula.family), familyRegistry)} family — formula stays outside the learning scope`;
    formulasWithoutCompatibleUnits.push({ formulaAnchorId: formula.anchorId, reason });
    assignments.push({
      formulaAnchorId: formula.anchorId,
      unitId: "",
      status: "unassigned_with_reason",
      compatibility: rows.find(eligible) ?? rows[0] ?? unassignedCompatibilityRow(formula, familyRegistry),
      reason,
    });
  }

  // A required unit is "missing" only if it received NO assignment at all. A
  // unit that satisfied any of its required families (even while another
  // family need went unmet) is fully served, not missing.
  for (const [unitId, shortfall] of needShortfalls) {
    if ((unitAssignedCount.get(unitId) ?? 0) > 0) continue;
    unitsMissingRequired.push({ unitId, requiredFamilies: shortfall.requiredFamilies, reason: shortfall.reason });
  }

  const plan: FormulaAssignmentPlan = {
    assignments,
    formulasWithoutCompatibleUnits,
    unitsMissingRequiredFormulas: unitsMissingRequired,
    ambiguousAssignments: ambiguousEntries,
    rejectedAssignments: rejectedEntries,
    reuse,
    valid: true,
    problems: [],
  };
  const validation = validateFormulaAssignmentPlan(plan);
  plan.valid = validation.valid;
  plan.problems = validation.problems;
  return plan;
}

/** Re-validate a complete plan (also usable on merged/edited plans). */
export function validateFormulaAssignmentPlan(
  plan: FormulaAssignmentPlan,
): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  const active = plan.assignments.filter((assignment) =>
    assignment.status === "assigned" || assignment.status === "reused_with_reason");
  const primaryUnits = new Map<string, string[]>();
  for (const assignment of active) {
    if (!assignment.unitId) {
      problems.push(`assignment for ${assignment.formulaAnchorId} has no target unit`);
      continue;
    }
    if (assignment.compatibility.hardRejectionReasons.length > 0) {
      problems.push(`assignment ${assignment.formulaAnchorId} → ${assignment.unitId} violates hard constraints: ${assignment.compatibility.hardRejectionReasons.join("; ")}`);
    }
    if (!assignment.compatibility.familyCompatible) {
      problems.push(`assignment ${assignment.formulaAnchorId} → ${assignment.unitId} is not family-compatible`);
    }
    primaryUnits.set(assignment.formulaAnchorId, [
      ...(primaryUnits.get(assignment.formulaAnchorId) ?? []),
      assignment.unitId,
    ]);
  }
  for (const [anchorId, unitIds] of primaryUnits) {
    const assignedCount = plan.assignments.filter((assignment) =>
      assignment.formulaAnchorId === anchorId && assignment.status === "assigned").length;
    if (assignedCount > 1) {
      problems.push(`conflicting proposals: ${anchorId} is primarily assigned to ${unitIds.join(", ")} — reuse must be explicit`);
    }
    const reused = plan.assignments.filter((assignment) =>
      assignment.formulaAnchorId === anchorId && assignment.status === "reused_with_reason");
    for (const entry of reused) {
      if (!plan.reuse.some((record) => record.formulaAnchorId === anchorId && record.reusedByUnitId === entry.unitId)) {
        problems.push(`reuse of ${anchorId} on ${entry.unitId} lacks reuse provenance`);
      }
    }
  }
  return { valid: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Part 9 — targeted ChatMock assignment packet
// ---------------------------------------------------------------------------

export type FormulaAssignmentRepairPacket = {
  unit: {
    id: string;
    title: string;
    role: string;
    learningQuestion: string;
    newConcepts: string[];
    requiredFamilies: string[];
  };

  candidates: {
    anchorId: string;
    canonicalText?: string;
    verifiedFamily: string;
    title: string;
    sourceContext?: string;
    compatibilityScore: number;
    reason: string;
  }[];

  rejectedCandidates: {
    anchorId: string;
    verifiedFamily: string;
    rejectionReason: string;
  }[];

  allowedActions: (
    | "select_candidate"
    | "no_compatible_formula"
  )[];
};

export type FormulaAssignmentRepairDecision =
  | {
      action: "select_candidate";
      anchorId: string;
      justification: string;
      confidence: "high" | "medium" | "low";
    }
  | {
      action: "no_compatible_formula";
      justification: string;
      confidence: "high" | "medium" | "low";
    };

export type FormulaAssignmentRepairModel = (
  packet: FormulaAssignmentRepairPacket,
) => Promise<FormulaAssignmentRepairDecision | null>;

/** Build the critic packet for ONE unit whose compatible candidates are too
 * close to pick deterministically. Incompatible formulas appear ONLY under
 * rejectedCandidates so the critic can never select them. */
export function buildFormulaAssignmentRepairPacket(args: {
  unit: LearningUnitContract;
  requirement: UnitFormulaRequirement;
  formulas: AssignableFormulaIdentity[];
  familyRegistry?: readonly FormulaFamilyIdentity[];
}): FormulaAssignmentRepairPacket {
  const familyRegistry = args.familyRegistry ?? [];
  const rows = args.formulas.map((formula) => ({
    formula,
    row: scoreFormulaUnitCompatibility(formula, args.requirement, args.unit, familyRegistry),
  }));
  return {
    unit: {
      id: args.unit.id,
      title: args.unit.title,
      role: args.unit.role,
      learningQuestion: args.unit.learningQuestion ?? "",
      newConcepts: args.unit.newConcepts ?? [],
      requiredFamilies: args.requirement.requiredFamilies,
    },
    candidates: rows
      .filter(({ row }) => row.hardRejectionReasons.length === 0)
      .sort((left, right) => right.row.totalScore - left.row.totalScore
        || left.formula.anchorId.localeCompare(right.formula.anchorId))
      .map(({ formula, row }) => ({
        anchorId: formula.anchorId,
        canonicalText: formula.canonicalText,
        verifiedFamily: row.formulaFamily,
        title: formula.title,
        sourceContext: formula.evidence?.sourceContext?.slice(0, 700),
        compatibilityScore: row.totalScore,
        reason: row.reason,
      })),
    rejectedCandidates: rows
      .filter(({ row }) => row.hardRejectionReasons.length > 0)
      .map(({ formula, row }) => ({
        anchorId: formula.anchorId,
        verifiedFamily: row.formulaFamily,
        rejectionReason: row.hardRejectionReasons.join("; "),
      })),
    allowedActions: ["select_candidate", "no_compatible_formula"],
  };
}

/** Independently verify a critic decision against the compatibility matrix.
 * The critic may only select a packet candidate; invented anchors, rejected
 * candidates, and family changes are refused. */
export function verifyFormulaAssignmentRepairDecision(
  packet: FormulaAssignmentRepairPacket,
  decision: FormulaAssignmentRepairDecision,
  args: {
    unit: LearningUnitContract;
    requirement: UnitFormulaRequirement;
    formulas: AssignableFormulaIdentity[];
    familyRegistry?: readonly FormulaFamilyIdentity[];
  },
): { accepted: boolean; reason: string } {
  if (!packet.allowedActions.includes(decision.action)) {
    return { accepted: false, reason: "action is not allowed by the packet" };
  }
  if (!decision.justification?.trim()) {
    return { accepted: false, reason: "decision lacks a justification" };
  }
  if (decision.action === "no_compatible_formula") {
    return { accepted: true, reason: "leaving the unit without a source formula is always safe" };
  }
  if (decision.confidence === "low") {
    return { accepted: false, reason: "low-confidence selections are not mutation-safe" };
  }
  const candidate = packet.candidates.find((entry) => entry.anchorId === decision.anchorId);
  if (!candidate) {
    const wasRejected = packet.rejectedCandidates.some((entry) => entry.anchorId === decision.anchorId);
    return {
      accepted: false,
      reason: wasRejected
        ? `candidate ${decision.anchorId} was hard-rejected for this unit and cannot be selected`
        : `candidate ${decision.anchorId} is not in the packet (invented anchors are refused)`,
    };
  }
  const identity = args.formulas.find((formula) => formula.anchorId === decision.anchorId);
  if (!identity) {
    return { accepted: false, reason: `candidate ${decision.anchorId} has no identity in the registry` };
  }
  const verdict = validateFormulaAssignment(identity, args.requirement, args.unit, args.familyRegistry ?? []);
  if (verdict.hardRejectionReasons.length > 0) {
    return { accepted: false, reason: `independent re-validation failed: ${verdict.hardRejectionReasons.join("; ")}` };
  }
  return { accepted: true, reason: "selection is packet-bounded and independently family-compatible" };
}

/**
 * Resolve the plan's ambiguities with a bounded number of targeted critic
 * calls. Deterministic-first: only true ambiguities reach the model, every
 * decision is independently verified, and a refused/unavailable critic leaves
 * the unit source-formula-free instead of blocking generation.
 */
export async function resolveFormulaAssignmentAmbiguities(args: {
  plan: FormulaAssignmentPlan;
  formulas: AssignableFormulaIdentity[];
  units: LearningUnitContract[];
  repairModel?: FormulaAssignmentRepairModel;
  familyRegistry?: readonly FormulaFamilyIdentity[];
  maxCalls?: number;
}): Promise<{
  plan: FormulaAssignmentPlan;
  packetsSent: number;
  decisionsApplied: number;
  decisions: Array<{ unitId: string; decision: FormulaAssignmentRepairDecision | null; accepted: boolean; reason: string }>;
}> {
  const familyRegistry = args.familyRegistry ?? [];
  const maxCalls = args.maxCalls ?? 3;
  const unitsById = new Map(args.units.map((unit) => [unit.id, unit]));
  const formulasById = new Map(args.formulas.map((formula) => [formula.anchorId, formula]));
  const decisions: Array<{ unitId: string; decision: FormulaAssignmentRepairDecision | null; accepted: boolean; reason: string }> = [];
  let packetsSent = 0;
  let decisionsApplied = 0;

  const ambiguousUnitIds = [...new Set(
    args.plan.assignments
      .filter((assignment) => assignment.status === "ambiguous" && assignment.unitId)
      .map((assignment) => assignment.unitId),
  )];

  const plan: FormulaAssignmentPlan = {
    ...args.plan,
    assignments: [...args.plan.assignments],
    unitsMissingRequiredFormulas: [...args.plan.unitsMissingRequiredFormulas],
    ambiguousAssignments: [...args.plan.ambiguousAssignments],
  };

  for (const unitId of ambiguousUnitIds) {
    if (!args.repairModel || packetsSent >= maxCalls) break;
    const unit = unitsById.get(unitId);
    if (!unit) continue;
    const requirement = deriveUnitFormulaRequirement(unit, familyRegistry);
    const ambiguousForUnit = plan.assignments.filter((assignment) =>
      assignment.status === "ambiguous" && assignment.unitId === unitId);
    const candidateIdentities = ambiguousForUnit
      .map((assignment) => formulasById.get(assignment.formulaAnchorId))
      .filter((identity): identity is AssignableFormulaIdentity => Boolean(identity));
    const packet = buildFormulaAssignmentRepairPacket({
      unit,
      requirement,
      formulas: [...candidateIdentities, ...args.formulas.filter((formula) =>
        !candidateIdentities.some((candidate) => candidate.anchorId === formula.anchorId))],
      familyRegistry,
    });
    packetsSent += 1;
    let decision: FormulaAssignmentRepairDecision | null = null;
    try {
      decision = await args.repairModel(packet);
    } catch {
      decision = null;
    }
    const verdictArgs = { unit, requirement, formulas: args.formulas, familyRegistry };
    const verdict = decision
      ? verifyFormulaAssignmentRepairDecision(packet, decision, verdictArgs)
      : { accepted: false, reason: "critic unavailable or returned no decision" };
    decisions.push({ unitId, decision, accepted: verdict.accepted, reason: verdict.reason });

    if (verdict.accepted && decision?.action === "select_candidate") {
      decisionsApplied += 1;
      const selected = decision.anchorId;
      plan.assignments = plan.assignments.map((assignment) => {
        if (assignment.unitId !== unitId || assignment.status !== "ambiguous") return assignment;
        if (assignment.formulaAnchorId === selected) {
          return {
            ...assignment,
            status: "assigned" as const,
            placement: placementForRole(unit.role),
            teachingGoal: assignment.teachingGoal
              || `Define and interpret the verified ${assignment.compatibility.formulaFamily} relationship for "${unit.title}".`,
            reason: `critic-selected among close candidates: ${decision.justification}`,
          };
        }
        return {
          ...assignment,
          status: "unassigned_with_reason" as const,
          reason: `not selected by the verified critic decision for ${unitId}`,
        };
      });
      plan.unitsMissingRequiredFormulas = plan.unitsMissingRequiredFormulas
        .filter((entry) => entry.unitId !== unitId);
      plan.ambiguousAssignments = plan.ambiguousAssignments
        .filter((entry) => !entry.candidateUnitIds.includes(unitId)
          || plan.assignments.some((assignment) =>
            assignment.formulaAnchorId === entry.formulaAnchorId && assignment.status === "ambiguous"));
    } else {
      // Verified "no compatible formula" (or a refused/unavailable critic):
      // the unit stays source-formula-free with an explicit record.
      plan.assignments = plan.assignments.map((assignment) =>
        assignment.unitId === unitId && assignment.status === "ambiguous"
          ? { ...assignment, status: "unassigned_with_reason" as const, reason: `ambiguity unresolved: ${verdict.reason}` }
          : assignment);
      if (!plan.unitsMissingRequiredFormulas.some((entry) => entry.unitId === unitId)) {
        plan.unitsMissingRequiredFormulas.push({
          unitId,
          requiredFamilies: requirement.requiredFamilies,
          reason: `unit deliberately left without a source formula: ${verdict.reason}`,
        });
      }
    }
  }

  const finalized = finalizeFormulaAssignmentPlanWithoutCritic(plan);
  return { plan: finalized, packetsSent, decisionsApplied, decisions };
}

/**
 * Resolve every remaining ambiguity to the SAFE outcome — unassigned with a
 * reason — so the plan can be applied without a critic. Used directly by the
 * synchronous contract-write path and as the tail of the critic loop.
 */
export function finalizeFormulaAssignmentPlanWithoutCritic(
  plan: FormulaAssignmentPlan,
): FormulaAssignmentPlan {
  const next: FormulaAssignmentPlan = {
    ...plan,
    assignments: plan.assignments.map((assignment) =>
      assignment.status === "ambiguous"
        ? { ...assignment, status: "unassigned_with_reason" as const, reason: `${assignment.reason}; no critic decision available` }
        : assignment),
  };
  const validation = validateFormulaAssignmentPlan(next);
  next.valid = validation.valid;
  next.problems = validation.problems;
  return next;
}

// ---------------------------------------------------------------------------
// Part 10/12 — atomic application + provenance
// ---------------------------------------------------------------------------

export type FormulaAssignmentApplicationResult = {
  applied: boolean;

  assignmentsAdded: {
    formulaAnchorId: string;
    unitId: string;
  }[];

  assignmentsRemoved: {
    formulaAnchorId: string;
    unitId: string;
  }[];

  formulasLeftUnassigned: string[];
  unitsWithoutCompatibleFormula: string[];

  changedFiles: string[];

  blockersBefore: number;
  blockersAfter: number;

  rolledBack: boolean;
  reason: string;
};

export type FormulaAssignmentProvenance = {
  formulaAnchorId: string;
  unitId: string;

  verifiedFamily: string;
  compatibilityScore: number;

  status:
    | "verified"
    | "reassigned"
    | "removed_incompatible"
    | "unassigned"
    | "critic_selected";

  previousUnitId?: string;
  reason: string;
};

/**
 * Apply a validated plan to the in-memory contract units as one staged
 * transaction: stage → validate the staged state → commit only when nothing
 * incompatible remains and the blocker count did not grow, otherwise roll the
 * whole application back untouched. Persistence of the returned units (and
 * every projection derived from them) is the caller's single commit point.
 */
export function applyFormulaAssignmentPlanToUnits(args: {
  units: LearningUnitContract[];
  plan: FormulaAssignmentPlan;
  formulas: AssignableFormulaIdentity[];
  familyRegistry?: readonly FormulaFamilyIdentity[];
  /** "remove" (default, post-extraction): a contract entry whose anchor has no
   * verified identity is a blocker and is removed. "preserve" (pre-extraction
   * contract writes): unknown anchors pass through untouched — extraction has
   * not seen them yet, so removing them would be guesswork. */
  unknownAnchorPolicy?: "preserve" | "remove";
}): { units: LearningUnitContract[]; result: FormulaAssignmentApplicationResult } {
  const familyRegistry = args.familyRegistry ?? [];
  const unknownAnchorPolicy = args.unknownAnchorPolicy ?? "remove";
  const formulasById = new Map(args.formulas.map((formula) => [formula.anchorId, formula]));
  const requirements = new Map(args.units.map((unit) => [unit.id, deriveUnitFormulaRequirement(unit, familyRegistry)]));

  const blockerCount = (units: LearningUnitContract[]): number => {
    let blockers = 0;
    for (const unit of units) {
      const requirement = requirements.get(unit.id);
      for (const entry of unit.sourceFormulas) {
        const identity = formulasById.get(entry.id);
        if (!identity || !requirement) {
          if (unknownAnchorPolicy === "remove" || !requirement) blockers += 1;
          continue;
        }
        const verdict = validateFormulaAssignment(identity, requirement, unit, familyRegistry);
        if (verdict.hardRejectionReasons.length > 0) blockers += 1;
      }
    }
    return blockers;
  };

  const blockersBefore = blockerCount(args.units);
  const emptyResult = (reason: string, rolledBack: boolean): FormulaAssignmentApplicationResult => ({
    applied: false,
    assignmentsAdded: [],
    assignmentsRemoved: [],
    formulasLeftUnassigned: args.plan.assignments
      .filter((assignment) => assignment.status === "unassigned_with_reason")
      .map((assignment) => assignment.formulaAnchorId),
    unitsWithoutCompatibleFormula: args.plan.unitsMissingRequiredFormulas.map((entry) => entry.unitId),
    changedFiles: [],
    blockersBefore,
    blockersAfter: blockersBefore,
    rolledBack,
    reason,
  });

  if (!args.plan.valid) {
    return { units: args.units, result: emptyResult(`plan failed validation: ${args.plan.problems.join("; ")}`, true) };
  }

  const desired = args.plan.assignments.filter((assignment) =>
    (assignment.status === "assigned" || assignment.status === "reused_with_reason") && assignment.unitId);
  const desiredByUnit = new Map<string, PlannedFormulaAssignment[]>();
  for (const assignment of desired) {
    desiredByUnit.set(assignment.unitId, [...(desiredByUnit.get(assignment.unitId) ?? []), assignment]);
  }

  const assignmentsAdded: FormulaAssignmentApplicationResult["assignmentsAdded"] = [];
  const assignmentsRemoved: FormulaAssignmentApplicationResult["assignmentsRemoved"] = [];

  // Stage.
  const staged = args.units.map((unit) => {
    const target = desiredByUnit.get(unit.id) ?? [];
    const targetIds = new Set(target.map((assignment) => assignment.formulaAnchorId));
    const preserved = unknownAnchorPolicy === "preserve"
      ? unit.sourceFormulas.filter((entry) => !formulasById.has(entry.id) && !targetIds.has(entry.id))
      : [];
    const preservedIds = new Set(preserved.map((entry) => entry.id));
    for (const entry of unit.sourceFormulas) {
      if (!targetIds.has(entry.id) && !preservedIds.has(entry.id)) {
        assignmentsRemoved.push({ formulaAnchorId: entry.id, unitId: unit.id });
      }
    }
    const existingById = new Map(unit.sourceFormulas.map((entry) => [entry.id, entry]));
    const sourceFormulas = [
      ...target.map((assignment) => {
        const existing = existingById.get(assignment.formulaAnchorId);
        if (!existing) assignmentsAdded.push({ formulaAnchorId: assignment.formulaAnchorId, unitId: unit.id });
        return existing ?? {
          id: assignment.formulaAnchorId,
          teachingGoal: assignment.teachingGoal ?? "Teach the verified source formula.",
          termsToDefine: assignment.termsToDefine ?? [],
          placement: assignment.placement ?? placementForRole(unit.role),
        };
      }),
      ...preserved,
    ];
    // Formula anchors that hard-reject for this unit leave broad evidence too;
    // anything the plan assigns is guaranteed present.
    const requirement = requirements.get(unit.id)!;
    const sourceAnchors = unit.sourceAnchors.filter((anchorId) => {
      const identity = formulasById.get(anchorId);
      if (!identity) return true; // not a formula anchor — untouched
      if (targetIds.has(anchorId)) return true;
      return validateFormulaAssignment(identity, requirement, unit, familyRegistry).hardRejectionReasons.length === 0;
    });
    for (const assignment of target) {
      if (!sourceAnchors.includes(assignment.formulaAnchorId)) sourceAnchors.push(assignment.formulaAnchorId);
    }
    return { ...unit, sourceFormulas, sourceAnchors };
  });

  // Validate the staged state before committing anything.
  const stagedProblems: string[] = [];
  for (const unit of staged) {
    const requirement = requirements.get(unit.id)!;
    for (const entry of unit.sourceFormulas) {
      const identity = formulasById.get(entry.id);
      if (!identity) {
        if (unknownAnchorPolicy === "remove") {
          stagedProblems.push(`staged assignment ${entry.id} → ${unit.id} has no verified identity`);
        }
        continue;
      }
      const verdict = validateFormulaAssignment(identity, requirement, unit, familyRegistry);
      if (verdict.hardRejectionReasons.length > 0) {
        stagedProblems.push(`staged assignment ${entry.id} → ${unit.id} is incompatible: ${verdict.hardRejectionReasons.join("; ")}`);
      }
    }
  }
  const blockersAfter = blockerCount(staged);
  if (stagedProblems.length > 0 || blockersAfter > blockersBefore) {
    return {
      units: args.units,
      result: {
        ...emptyResult(
          stagedProblems.length > 0
            ? `staged state failed validation: ${stagedProblems.join("; ")}`
            : `blocker count would grow (${blockersBefore} → ${blockersAfter})`,
          true,
        ),
        blockersAfter,
      },
    };
  }

  return {
    units: staged,
    result: {
      applied: true,
      assignmentsAdded,
      assignmentsRemoved,
      formulasLeftUnassigned: args.plan.assignments
        .filter((assignment) => assignment.status === "unassigned_with_reason")
        .map((assignment) => assignment.formulaAnchorId),
      unitsWithoutCompatibleFormula: args.plan.unitsMissingRequiredFormulas.map((entry) => entry.unitId),
      changedFiles: [],
      blockersBefore,
      blockersAfter,
      rolledBack: false,
      reason: `applied ${assignmentsAdded.length} additions and ${assignmentsRemoved.length} removals; blockers ${blockersBefore} → ${blockersAfter}`,
    },
  };
}

/** Provenance records for the applied plan — the durable audit trail that
 * regeneration reads instead of trusting stale assignments. */
export function formulaAssignmentProvenanceFromPlan(
  plan: FormulaAssignmentPlan,
  previousAssignments: Array<{ formulaAnchorId: string; unitId: string }> = [],
): FormulaAssignmentProvenance[] {
  const previousUnitFor = (anchorId: string): string | undefined =>
    previousAssignments.find((entry) => entry.formulaAnchorId === anchorId)?.unitId;
  const records: FormulaAssignmentProvenance[] = [];
  for (const assignment of plan.assignments) {
    const previousUnitId = previousUnitFor(assignment.formulaAnchorId);
    const criticSelected = assignment.reason.startsWith("critic-selected");
    const status: FormulaAssignmentProvenance["status"] =
      assignment.status === "assigned" || assignment.status === "reused_with_reason"
        ? criticSelected ? "critic_selected"
          : previousUnitId && previousUnitId !== assignment.unitId ? "reassigned" : "verified"
        : assignment.status === "rejected" ? "removed_incompatible"
          : "unassigned";
    records.push({
      formulaAnchorId: assignment.formulaAnchorId,
      unitId: assignment.unitId,
      verifiedFamily: assignment.compatibility.formulaFamily,
      compatibilityScore: Number.isFinite(assignment.compatibility.totalScore)
        ? assignment.compatibility.totalScore : -1,
      status,
      ...(previousUnitId && previousUnitId !== assignment.unitId ? { previousUnitId } : {}),
      reason: assignment.reason,
    });
  }
  return records;
}
