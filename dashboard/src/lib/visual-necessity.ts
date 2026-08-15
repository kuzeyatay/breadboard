import fs from "fs";
import path from "path";
import type { LearningUnitContract } from "./learning-unit-contract.ts";
import { TRUSTED_RENDERER_REGISTRY } from "./visualization-registry.ts";
import type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  GardenZeroVisualSafeguard,
  InteractiveVisualNecessity,
  PreferredTeachingMedium,
  TeachingMediumPlan,
  VisualDecisionFailure,
  VisualDecisionOverride,
  VisualDecisionRecord,
  VisualNecessityArtifact,
  VisualNecessityDecision,
  VisualNecessityReviewPacket,
} from "./visual-necessity-types.ts";

export type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  GardenZeroVisualSafeguard,
  InteractiveVisualIntent,
  InteractiveVisualNecessity,
  PreferredTeachingMedium,
  TeachingMediumPlan,
  VisualDecisionFailure,
  VisualDecisionOverride,
  VisualDecisionRecord,
  VisualNecessityArtifact,
  VisualNecessityDecision,
  VisualNecessityReviewPacket,
} from "./visual-necessity-types.ts";

export interface VisualNecessitySourceEvidence {
  anchorId: string;
  kind: "figure" | "table" | "formula" | "example" | "prose" | string;
  title?: string;
  semanticSummary?: string;
}

export interface VisualNecessityContext {
  pageId?: string;
  unitIndex?: number;
  totalUnits?: number;
  availablePrerequisiteConcepts?: string[];
  sourceEvidence?: VisualNecessitySourceEvidence[];
  nearbyVisualDecisions?: VisualNecessityDecision[];
  supportedVisualTypes?: string[];
  overrides?: VisualDecisionOverride[];
}

export interface GardenVisualDecisionContext {
  units: LearningUnitContract[];
  sectionByUnit?: Record<string, string>;
  budget?: GardenVisualBudget;
  overrides?: VisualDecisionOverride[];
}

export interface GardenVisualNecessityPlan {
  learningUnits: LearningUnitContract[];
  decisions: VisualNecessityDecision[];
  teachingMedia: TeachingMediumPlan[];
  budget: GardenVisualBudget;
  overrides: VisualDecisionOverride[];
  reviewCalls?: number;
  rejectedReviews?: number;
  decisionRecords: VisualDecisionRecord[];
  zeroVisualSafeguard: GardenZeroVisualSafeguard;
  /** Set only by the ChatMock review pass: candidates whose review failed. */
  unresolvedRecords?: VisualDecisionRecord[];
}

export interface VisualNecessityReviewResponse {
  action: VisualNecessityReviewPacket["allowedActions"][number];
  preferredMedium?: PreferredTeachingMedium;
  visualType?: string;
  reason: string;
}

const DYNAMIC_RE =
  /dynamic|dynamics|over time|temporal|trajectory|evolv|membrane potential|voltage|spike timing|stdp|plasticity|training curve|convergence|feedback|state transition|oscillat|propagat/i;
const PARAMETER_RE =
  /parameter|threshold|current|voltage|timing|delay|width|rate|temperature|learning rate|sensitivity|gain|input|amplitude|strength|vary|chang|adjust|tune|slider|control/i;
const COMPARISON_RE =
  /compar|versus|\bvs\b|trade[- ]?off|accuracy|latency|energy|alternative|benchmark|pareto|encoding/i;
const SPATIAL_RE = /spatial|geometry|network structure|topology|field|wave|propagation|architecture|layer|node|edge/i;
const HISTORICAL_RE = /history|historical|chronolog|development of|evolution of the field|milestone/i;
const DECORATIVE_RE = /decorat|aesthetic|visual variety|engagement only|look interesting|visual quota|quota/i;
const DEFINITION_RE = /define|definition|what is|terminology|means|called|introduction to/i;
const SUMMARY_RE = /summary|synthesis|recap|review|conclusion|takeaways/i;

function score(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => compact(value)).filter(Boolean))];
}

function normalizedKey(value: string): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unitConcepts(unit: LearningUnitContract): string[] {
  return unique([
    ...unit.newConcepts,
    ...(unit.semanticConcepts ?? []).flatMap((concept) => [concept.slug, concept.preferredLabel]),
  ]);
}

function unitText(unit: LearningUnitContract): string {
  return [
    unit.title,
    unit.learningQuestion,
    ...unit.prerequisiteConcepts,
    ...unitConcepts(unit),
    ...(unit.knowledgeClaims ?? []).map((claim) => claim.text),
  ]
    .filter(Boolean)
    .join(" ");
}

function supportedVisualTypes(context: VisualNecessityContext): Set<string> {
  return new Set(
    (context.supportedVisualTypes ?? TRUSTED_RENDERER_REGISTRY.renderers.map((renderer) => renderer.id))
      .map((value) => normalizedKey(value).replace(/ /g, "_"))
      .filter(Boolean),
  );
}

function evidenceForUnit(
  unit: LearningUnitContract,
  context: VisualNecessityContext,
): VisualNecessitySourceEvidence[] {
  const explicit = context.sourceEvidence ?? [];
  const synthesized: VisualNecessitySourceEvidence[] = [
    ...unit.sourceFigures.map((figure) => ({
      anchorId: figure.id,
      kind: "figure",
      title: figure.mustBeDiscussedWith,
      semanticSummary: figure.interpretationGoal,
    })),
    ...unit.sourceTables.map((table) => ({
      anchorId: table.id,
      kind: "table",
      title: table.teachingGoal,
      semanticSummary: table.rowsOrColumnsToExplain.join(", "),
    })),
    ...unit.sourceFormulas.map((formula) => ({
      anchorId: formula.id,
      kind: "formula",
      title: formula.teachingGoal,
      semanticSummary: formula.termsToDefine.join(", "),
    })),
  ];
  const byId = new Map<string, VisualNecessitySourceEvidence>();
  for (const item of [...synthesized, ...explicit]) {
    if (!compact(item.anchorId)) continue;
    byId.set(item.anchorId, item);
  }
  return [...byId.values()];
}

const STOPWORD_TOKENS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "with",
  "over",
  "basic",
  "simple",
  "general",
  "concept",
  "concepts",
]);

function conceptTokens(value: string): Set<string> {
  return new Set(
    normalizedKey(value)
      .split(" ")
      .map((token) => token.replace(/s$/, ""))
      .filter((token) => token.length >= 3 && !STOPWORD_TOKENS.has(token)),
  );
}

/**
 * Prerequisite coverage is matched by token overlap, not exact string equality.
 * Prerequisites and new-concept labels are authored independently, so a covered
 * prerequisite ("action-potential phases") rarely equals the concept that taught
 * it ("action potential"). Exact matching therefore reported nearly every
 * prerequisite as "missing", which previously saturated cognitive-load risk and
 * silently vetoed interaction across the whole garden. Overlap matching treats a
 * prerequisite as met when a meaningful share of its content words already
 * appears among earlier concepts.
 */
function prerequisiteIsCovered(prerequisite: string, availableTokens: Set<string>): boolean {
  const tokens = conceptTokens(prerequisite);
  if (tokens.size === 0) return true;
  let overlap = 0;
  for (const token of tokens) if (availableTokens.has(token)) overlap += 1;
  return overlap / tokens.size >= 0.5;
}

function missingPrerequisiteRatio(
  unit: LearningUnitContract,
  context: VisualNecessityContext,
): number {
  if (unit.prerequisiteConcepts.length === 0) return 0;
  if (!context.availablePrerequisiteConcepts) {
    return context.unitIndex === 0 ? 1 : 0;
  }
  const availableTokens = new Set<string>();
  for (const concept of context.availablePrerequisiteConcepts) {
    for (const token of conceptTokens(concept)) availableTokens.add(token);
  }
  const missing = unit.prerequisiteConcepts.filter(
    (concept) => !prerequisiteIsCovered(concept, availableTokens),
  ).length;
  return missing / unit.prerequisiteConcepts.length;
}

function duplicateRisk(
  unit: LearningUnitContract,
  context: VisualNecessityContext,
): { risk: number; nearbyIds: string[] } {
  const decisions = context.nearbyVisualDecisions ?? [];
  const learningGoal = normalizedKey(unit.learningQuestion || unit.title);
  const concepts = new Set(unitConcepts(unit).map(normalizedKey));
  let risk = 0;
  const nearbyIds: string[] = [];
  for (const decision of decisions) {
    const sameLearningGoal = Boolean(
      learningGoal && normalizedKey(decision.learningGoal) === learningGoal,
    );
    const sharedConcept = decision.evidence.concepts.some((concept) =>
      concepts.has(normalizedKey(concept)),
    );
    if (!sameLearningGoal && !sharedConcept) continue;
    nearbyIds.push(decision.unitId);
    // A shared concept is normal across a learning sequence and is not, by
    // itself, evidence that the learner repeats the same interaction.
    risk = Math.max(
      risk,
      sameLearningGoal && sharedConcept ? 0.95 : sameLearningGoal ? 0.82 : 0.35,
    );
  }
  return { risk: score(risk), nearbyIds: unique(nearbyIds) };
}

function requirementForNecessity(
  necessity: InteractiveVisualNecessity,
): ContractInteractiveVisualPlan["requirement"] {
  if (necessity === "required" || necessity === "recommended" || necessity === "optional") {
    return necessity;
  }
  return "none";
}

function bestAlternativeMedium(
  unit: LearningUnitContract,
  values: {
    sourceFigureSufficiency: number;
    proseSufficiency: number;
    formulaSufficiency: number;
    workedExampleSufficiency: number;
    comparisonValue: number;
    spatialValue: number;
  },
): PreferredTeachingMedium {
  if (values.sourceFigureSufficiency >= 0.75) return "source_figure";
  if (values.formulaSufficiency >= 0.75) return "formula_derivation";
  if (values.workedExampleSufficiency >= 0.75) return "worked_example";
  if (unit.sourceTables.length > 0 && values.comparisonValue >= 0.55) return "comparison_table";
  if (HISTORICAL_RE.test(unitText(unit))) return "timeline";
  if (values.spatialValue >= 0.65) return "generated_static_diagram";
  if (unit.role === "synthesis" && values.proseSufficiency >= 0.8) {
    return "no_additional_visual";
  }
  return "prose";
}

function decisionReason(
  necessity: InteractiveVisualNecessity,
  medium: PreferredTeachingMedium,
  unit: LearningUnitContract,
  values: {
    sourceFigureSufficiency: number;
    formulaSufficiency: number;
    workedExampleSufficiency: number;
    duplicationRisk: number;
    cognitiveLoadRisk: number;
  },
): string {
  if (necessity === "required") {
    return "Learner-controlled parameters reveal a dynamic, causal, or tradeoff relationship that the available static media do not adequately expose.";
  }
  if (necessity === "recommended") {
    return "Interaction adds meaningful manipulation or comparison value, but the learning goal remains teachable through a fallback medium if implementation fails.";
  }
  if (necessity === "optional") {
    return "Interaction may add value, but it should be included only when grounding, implementation quality, and uniqueness are strong.";
  }
  if (necessity === "harmful_or_distracting") {
    if (values.duplicationRisk >= 0.8) {
      return "The proposed interaction duplicates an earlier exploration and would add cognitive load without a new learner action or insight.";
    }
    if (values.cognitiveLoadRisk >= 0.75) {
      return "The interaction arrives before required concepts are established and would distract from the unit's immediate learning goal.";
    }
    return "The proposed interaction is decorative or unrelated to the causal, structural, or comparative relationship the learner needs to understand.";
  }
  if (medium === "source_figure") {
    return "An assigned source figure already communicates the relevant structure or result clearly; interaction would duplicate it.";
  }
  if (medium === "formula_derivation") {
    return "A motivated formula derivation exposes the relationship more directly than an interactive control surface.";
  }
  if (medium === "worked_example") {
    return "A concrete worked example gives the learner the needed reasoning practice with less cognitive overhead.";
  }
  if (medium === "comparison_table") {
    return "The comparison is static and is communicated more precisely by the assigned table.";
  }
  if (medium === "timeline") {
    return "The unit is historical or descriptive, so a concise timeline is clearer than learner-controlled interaction.";
  }
  if (medium === "generated_static_diagram") {
    return "A static diagram is sufficient to explain the spatial structure without adding controls that do not change the insight.";
  }
  if (medium === "no_additional_visual") {
    return "The unit consolidates ideas already introduced and does not need another visual treatment.";
  }
  return `${unit.title} is primarily definitional or explanatory, and direct prose is sufficient for its learning goal.`;
}

function applyOverride(
  decision: VisualNecessityDecision,
  override: VisualDecisionOverride | undefined,
  supportedTypes: Set<string>,
): VisualNecessityDecision {
  if (!override) return decision;
  const suffix = ` Author override (${override.createdBy}): ${override.reason}`;
  if (override.action === "force_none") {
    return {
      ...decision,
      necessity: "not_needed",
      preferredMedium:
        decision.preferredMedium === "interactive_visual" ? "prose" : decision.preferredMedium,
      reason: `Interaction was explicitly disabled for this unit.${suffix}`,
    };
  }
  if (override.action === "prefer_static") {
    return {
      ...decision,
      necessity: "not_needed",
      preferredMedium:
        decision.sourceFigureSufficiency >= 0.6 ? "source_figure" : "generated_static_diagram",
      reason: `A static teaching medium was explicitly preferred.${suffix}`,
    };
  }
  if (override.action === "prefer_interactive") {
    return {
      ...decision,
      necessity: decision.necessity === "required" ? "required" : "recommended",
      preferredMedium: "interactive_visual",
      reason: `Interaction was explicitly preferred and remains subject to grounding, uniqueness, and implementation checks.${suffix}`,
    };
  }
  const type = normalizedKey(decision.recommendedVisualType ?? "").replace(/ /g, "_");
  const feasible = Boolean(type && (supportedTypes.has(type) || decision.implementationRisk <= 0.65));
  return feasible
    ? {
        ...decision,
        necessity: "required",
        preferredMedium: "interactive_visual",
        reason: `A feasible interactive implementation was explicitly required.${suffix}`,
      }
    : {
        ...decision,
        necessity: "recommended",
        preferredMedium: "interactive_visual",
        reason: `The requested interaction is not yet supported, so it remains recommended until a feasible capability is available.${suffix}`,
      };
}

export function decideInteractiveVisualNecessity(
  unit: LearningUnitContract,
  context: VisualNecessityContext = {},
): VisualNecessityDecision {
  const text = unitText(unit);
  const evidence = evidenceForUnit(unit, context);
  const hasDynamicSignal = DYNAMIC_RE.test(text);
  const hasParameterSignal = PARAMETER_RE.test(text);
  const hasComparisonSignal = unit.role === "comparison" || COMPARISON_RE.test(text);
  const hasSpatialSignal = SPATIAL_RE.test(text);
  const hasHistoricalSignal = HISTORICAL_RE.test(text);
  const hasDefinitionSignal = unit.role === "core_concept" && DEFINITION_RE.test(text);
  const activeFigures = unit.sourceFigures.filter(
    (figure) => figure.placement !== "not_used_with_reason",
  );

  // Necessity is derived exclusively from the learning goal, role, concepts,
  // prerequisites, and source evidence. An already-routed visual intent must
  // not make a later repair pass more eager to keep that visual.
  const manipulationValue = score(
    unit.role === "comparison"
        ? /change|adjust|vary|manipulat|explore/i.test(text)
          ? 0.78
          : 0.58
      : hasParameterSignal && (hasDynamicSignal || hasComparisonSignal)
        ? 0.82
        : hasParameterSignal
          ? 0.67
        : hasComparisonSignal
          ? 0.58
          : 0.15,
  );
  const dynamicBehaviorValue = score(
    hasDynamicSignal
      ? unit.role === "mechanism" || unit.role === "training_method"
        ? 0.9
        : 0.78
      : unit.role === "mechanism"
        ? 0.55
        : 0.12,
  );
  const comparisonValue = score(hasComparisonSignal ? (unit.role === "comparison" ? 0.9 : 0.76) : 0.12);
  const spatialValue = score(hasSpatialSignal ? 0.78 : 0.1);
  const parameterSensitivityValue = score(
    hasParameterSignal && (hasDynamicSignal || hasComparisonSignal || unit.sourceFormulas.length > 0)
      ? 0.86
      : hasParameterSignal
        ? 0.58
        : 0.12,
  );
  // A source figure only *substitutes* for interaction when it depicts something
  // static and structural. A static snapshot of dynamic, parameter-driven,
  // comparative, or spatial behavior — an action-potential trace, an encoding
  // comparison, a loss landscape — is exactly the material a learner understands
  // better by manipulating it, so such a figure is only a partial alternative and
  // must not by itself veto interaction. Treating every assigned figure as a full
  // substitute was a root cause of gardens finishing with zero interactive
  // visuals: every figure-bearing dynamic unit was forced to "not_needed".
  const figureDepictsManipulableBehavior =
    activeFigures.length > 0 &&
    (hasDynamicSignal || hasParameterSignal || hasComparisonSignal || hasSpatialSignal);
  const sourceFigureSufficiency = score(
    activeFigures.length === 0
      ? 0.05
      : figureDepictsManipulableBehavior
        ? 0.5
        : 0.86,
  );
  const formulaSufficiency = score(
    unit.sourceFormulas.length === 0
      ? 0.05
      : unit.role === "formula" && parameterSensitivityValue < 0.75
        ? 0.9
        : unit.role === "formula"
          ? 0.7
          : 0.58,
  );
  const workedExampleSufficiency = score(
    unit.role === "worked_example" || /worked example|calculate|step[- ]by[- ]step example/i.test(text)
      ? 0.9
      : 0.08,
  );
  const proseSufficiency = score(
    hasHistoricalSignal || hasDefinitionSignal || unit.role === "limitation"
      ? 0.9
      : unit.role === "motivation" || unit.role === "synthesis" || SUMMARY_RE.test(text)
        ? 0.84
        : !hasDynamicSignal && !hasComparisonSignal && !hasSpatialSignal
          ? 0.76
          : 0.35,
  );
  const missingPrerequisites = missingPrerequisiteRatio(unit, context);
  // How far into the sequence this unit sits (0 = first … 1 = last). Later units
  // have, by construction, been preceded by more instruction, so a prerequisite
  // that looks "unmet" is far more likely a vocabulary mismatch — a thematic
  // prerequisite ("spike encoding") against granular new concepts ("rate coding",
  // "spike train") — than a genuine gap. Position therefore relieves the
  // prerequisite-driven load rather than letting brittle string matching veto
  // every visual (which previously slammed this to 0.85 across a whole garden,
  // even for the final synthesis unit).
  const sequenceProgress =
    context.unitIndex != null && context.totalUnits && context.totalUnits > 1
      ? context.unitIndex / (context.totalUnits - 1)
      : null;
  const positionRelief = sequenceProgress == null ? 0 : score(sequenceProgress * 0.5);
  // Unmet prerequisites raise cognitive load, but on their own they cap an
  // interaction at "optional" (load ≤ 0.70) — they never brand it distracting.
  // The "harmful_or_distracting" verdict stays reserved for decorative or
  // duplicate interactions (DECORATIVE_RE / high duplication risk below).
  const rawPrerequisiteLoad =
    missingPrerequisites >= 0.5
      ? 0.68
      : missingPrerequisites > 0
        ? 0.5
        : context.unitIndex === 0 && unit.prerequisiteConcepts.length > 0
          ? 0.6
          : 0.28;
  const cognitiveLoadRisk = score(Math.max(0.2, rawPrerequisiteLoad - positionRelief));
  const duplication = duplicateRisk(unit, context);
  const supportedTypes = supportedVisualTypes(context);
  // Capability selection happens after coordination; before that point the
  // conservative neutral implementation risk is the only valid estimate.
  const implementationRisk = score(0.4);
  const alternativeSufficiency = Math.max(
    sourceFigureSufficiency,
    proseSufficiency,
    formulaSufficiency,
    workedExampleSufficiency,
  );

  let necessity: InteractiveVisualNecessity;
  if (
    DECORATIVE_RE.test(text) ||
    duplication.risk >= 0.85 ||
    (cognitiveLoadRisk >= 0.75 && manipulationValue < 0.7)
  ) {
    necessity = "harmful_or_distracting";
  } else if (alternativeSufficiency >= 0.8 && manipulationValue < 0.75) {
    necessity = "not_needed";
  } else if (
    manipulationValue >= 0.75 &&
    (dynamicBehaviorValue >= 0.65 ||
      comparisonValue >= 0.75 ||
      parameterSensitivityValue >= 0.75) &&
    cognitiveLoadRisk <= 0.55 &&
    duplication.risk <= 0.45 &&
    alternativeSufficiency < 0.8
  ) {
    necessity = "required";
  } else if (
    manipulationValue >= 0.55 &&
    Math.max(dynamicBehaviorValue, comparisonValue, parameterSensitivityValue, spatialValue) >= 0.55 &&
    cognitiveLoadRisk <= 0.65 &&
    duplication.risk <= 0.6 &&
    alternativeSufficiency < 0.82
  ) {
    necessity = "recommended";
  } else if (
    manipulationValue >= 0.4 &&
    Math.max(dynamicBehaviorValue, comparisonValue, parameterSensitivityValue, spatialValue) >= 0.4 &&
    cognitiveLoadRisk <= 0.7 &&
    duplication.risk <= 0.7 &&
    alternativeSufficiency < 0.85
  ) {
    necessity = "optional";
  } else {
    necessity = "not_needed";
  }

  const preferredMedium =
    necessity === "required" || necessity === "recommended" || necessity === "optional"
      ? "interactive_visual"
      : bestAlternativeMedium(unit, {
          sourceFigureSufficiency,
          proseSufficiency,
          formulaSufficiency,
          workedExampleSufficiency,
          comparisonValue,
          spatialValue,
        });
  const base: VisualNecessityDecision = {
    unitId: unit.id,
    pageId: context.pageId ?? unit.id,
    necessity,
    preferredMedium,
    learningGoal: unit.learningQuestion || `Understand ${unit.title}`,
    manipulationValue,
    dynamicBehaviorValue,
    comparisonValue,
    spatialValue,
    parameterSensitivityValue,
    sourceFigureSufficiency,
    proseSufficiency,
    formulaSufficiency,
    workedExampleSufficiency,
    cognitiveLoadRisk,
    duplicationRisk: duplication.risk,
    implementationRisk,
    evidence: {
      unitRole: unit.role,
      concepts: unitConcepts(unit),
      learningQuestion: unit.learningQuestion,
      sourceAnchorIds: unique([
        ...unit.sourceAnchors,
        ...evidence.map((item) => item.anchorId),
      ]),
      nearbyVisualIntentIds: duplication.nearbyIds,
    },
    reason: "",
    // Both are derived from the finished decision, so they are filled in once
    // the literal above is complete.
    confidence: 0,
  };
  base.reason = decisionReason(base.necessity, base.preferredMedium, unit, base);
  const override = (context.overrides ?? []).find((item) => item.unitId === unit.id);
  const decided = applyOverride(base, override, supportedTypes);
  // An override can change the necessity, so confidence is derived last, from
  // whichever decision actually stands.
  return { ...decided, confidence: decisionConfidence(decided) };
}

export function deriveTeachingMediumPlan(
  unit: LearningUnitContract,
  decision: VisualNecessityDecision,
): TeachingMediumPlan {
  const preferredMedium = decision.preferredMedium;
  const activeFigure = unit.sourceFigures.find(
    (figure) => figure.placement !== "not_used_with_reason",
  );
  const activeTable = unit.sourceTables[0];
  return {
    unitId: unit.id,
    preferredMedium,
    ...(preferredMedium === "source_figure" && activeFigure
      ? { sourceFigureAnchorId: activeFigure.id }
      : {}),
    ...(preferredMedium === "generated_static_diagram"
      ? { staticDiagramIntent: `Explain ${decision.learningGoal} as a static, labeled structure.` }
      : {}),
    ...(preferredMedium === "formula_derivation"
      ? { formulaAnchorIds: unit.sourceFormulas.map((formula) => formula.id) }
      : {}),
    ...(preferredMedium === "worked_example"
      ? { workedExampleIntent: `Work through one concrete case that answers: ${decision.learningGoal}` }
      : {}),
    ...(preferredMedium === "comparison_table"
      ? {
          comparisonTableIntent: activeTable
            ? activeTable.teachingGoal
            : `Compare the cases relevant to ${decision.learningGoal}.`,
        }
      : {}),
    reason: decision.reason,
  };
}

export function deriveGardenVisualBudget(
  units: LearningUnitContract[],
  decisions: VisualNecessityDecision[] = [],
): GardenVisualBudget {
  const unitCount = units.length;
  const dynamicUnits = units.filter((unit) =>
    DYNAMIC_RE.test(unitText(unit)) || PARAMETER_RE.test(unitText(unit)) || unit.role === "mechanism",
  ).length;
  const comparisonUnits = units.filter(
    (unit) => unit.role === "comparison" || COMPARISON_RE.test(unitText(unit)),
  ).length;
  const evidenceRichUnits = units.filter(
    (unit) => unit.sourceFigures.length + unit.sourceFormulas.length + unit.sourceTables.length > 0,
  ).length;
  const complexity = unitCount === 0
    ? 0
    : score((dynamicUnits + comparisonUnits * 0.7 + evidenceRichUnits * 0.25) / unitCount);
  const targetMinimum = unitCount === 0
    ? 0
    : Math.max(1, Math.min(dynamicUnits, Math.round(unitCount * (0.1 + complexity * 0.1))));
  const targetMaximum = unitCount === 0
    ? 0
    : Math.max(
        targetMinimum,
        Math.min(dynamicUnits + comparisonUnits, Math.ceil(unitCount * (0.25 + complexity * 0.15))),
      );
  return {
    targetMinimum,
    targetMaximum,
    maximumPerSection: complexity >= 0.7 ? 3 : 2,
    minimumUnitsBetweenSimilarVisuals: complexity >= 0.75 ? 2 : 3,
    requiredVisuals: decisions.filter((item) => item.necessity === "required").length,
    recommendedVisuals: decisions.filter((item) => item.necessity === "recommended").length,
    optionalVisuals: decisions.filter((item) => item.necessity === "optional").length,
    reason: `Soft budget derived from ${unitCount} units, ${dynamicUnits} dynamic units, ${comparisonUnits} comparison units, source evidence density, and implemented visual capabilities. It never creates a visual to meet the minimum or removes a required visual to meet the maximum.`,
  };
}

function decisionSimilarityKey(decision: VisualNecessityDecision): string {
  const type = normalizedKey(decision.recommendedVisualType ?? "").replace(/ /g, "_");
  if (type) return `type:${type}`;
  const concept = decision.evidence.concepts.map(normalizedKey).filter(Boolean).sort()[0];
  return concept ? `concept:${concept}` : `goal:${normalizedKey(decision.learningGoal)}`;
}

function downgradeDuplicate(
  decision: VisualNecessityDecision,
  owner: VisualNecessityDecision,
): VisualNecessityDecision {
  const preferredMedium: PreferredTeachingMedium =
    decision.sourceFigureSufficiency >= 0.75
      ? "source_figure"
      : decision.formulaSufficiency >= 0.75
        ? "formula_derivation"
        : decision.workedExampleSufficiency >= 0.75
          ? "worked_example"
          : "prose";
  return {
    ...decision,
    necessity: "not_needed",
    preferredMedium,
    duplicationRisk: 1,
    evidence: {
      ...decision.evidence,
      nearbyVisualIntentIds: unique([
        ...decision.evidence.nearbyVisualIntentIds,
        owner.unitId,
      ]),
    },
    reason: `Interaction is owned by ${owner.unitId}; repeating it here would duplicate the same learner action. This unit uses ${preferredMedium.replace(/_/g, " ")} instead.`,
  };
}

export function coordinateGardenVisualDecisions(
  decisions: VisualNecessityDecision[],
  context: GardenVisualDecisionContext,
): VisualNecessityDecision[] {
  const budget = context.budget ?? deriveGardenVisualBudget(context.units, decisions);
  const unitIndex = new Map(context.units.map((unit, index) => [unit.id, index]));
  const coordinated = decisions.map((decision) => ({ ...decision, evidence: { ...decision.evidence } }));
  const ownerBySimilarity = new Map<string, VisualNecessityDecision>();
  const visualsPerSection = new Map<string, number>();
  const protectedInteractiveUnits = new Set(
    (context.overrides ?? [])
      .filter((override) =>
        override.action === "force_required" || override.action === "prefer_interactive")
      .map((override) => override.unitId),
  );

  for (let index = 0; index < coordinated.length; index += 1) {
    let decision = coordinated[index];
    if (!['required', 'recommended', 'optional'].includes(decision.necessity)) continue;
    const key = decisionSimilarityKey(decision);
    const owner = ownerBySimilarity.get(key);
    if (owner) {
      const distance = Math.abs(
        (unitIndex.get(decision.unitId) ?? index) -
          (unitIndex.get(owner.unitId) ?? coordinated.indexOf(owner)),
      );
      const sharedConcept = decision.evidence.concepts.some((concept) =>
        owner.evidence.concepts.some(
          (ownerConcept) => normalizedKey(ownerConcept) === normalizedKey(concept),
        ),
      );
      if (
        !protectedInteractiveUnits.has(decision.unitId) &&
        (sharedConcept || distance < budget.minimumUnitsBetweenSimilarVisuals)
      ) {
        decision = downgradeDuplicate(decision, owner);
        coordinated[index] = decision;
        continue;
      }
    } else {
      ownerBySimilarity.set(key, decision);
    }

    const section = context.sectionByUnit?.[decision.unitId] ?? "garden";
    const sectionCount = visualsPerSection.get(section) ?? 0;
    if (
      sectionCount >= budget.maximumPerSection &&
      decision.necessity === "optional" &&
      !protectedInteractiveUnits.has(decision.unitId)
    ) {
      coordinated[index] = {
        ...decision,
        necessity: "not_needed",
        preferredMedium: decision.sourceFigureSufficiency >= 0.7 ? "source_figure" : "prose",
        reason: `This optional interaction was omitted because the section already contains ${sectionCount} stronger interactive explanations; the learning goal remains covered by ${decision.sourceFigureSufficiency >= 0.7 ? "its source figure" : "prose"}.`,
      };
      continue;
    }
    visualsPerSection.set(section, sectionCount + 1);
  }

  let activeCount = coordinated.filter((decision) =>
    ['required', 'recommended', 'optional'].includes(decision.necessity),
  ).length;
  if (activeCount > budget.targetMaximum) {
    for (let index = coordinated.length - 1; index >= 0 && activeCount > budget.targetMaximum; index -= 1) {
      const decision = coordinated[index];
      if (decision.necessity !== "optional" || protectedInteractiveUnits.has(decision.unitId)) continue;
      coordinated[index] = {
        ...decision,
        necessity: "not_needed",
        preferredMedium: decision.sourceFigureSufficiency >= 0.7 ? "source_figure" : "prose",
        reason: "This optional interaction was omitted after garden-level coordination because stronger required and recommended interactions already cover the meaningful manipulations. The soft budget never forces a weak replacement.",
      };
      activeCount -= 1;
    }
  }

  return coordinated;
}

const ACTIVE_NECESSITIES = new Set<InteractiveVisualNecessity>(["required", "recommended", "optional"]);

function isActiveNecessity(necessity: InteractiveVisualNecessity): boolean {
  return ACTIVE_NECESSITIES.has(necessity);
}

/** Strength of the case *for* interaction, independent of alternative media. */
function interactiveStrength(decision: VisualNecessityDecision): number {
  return Math.max(
    decision.dynamicBehaviorValue,
    decision.parameterSensitivityValue,
    decision.comparisonValue,
    decision.spatialValue,
  );
}

function bestAlternativeSufficiency(decision: VisualNecessityDecision): number {
  return Math.max(
    decision.sourceFigureSufficiency,
    decision.proseSufficiency,
    decision.formulaSufficiency,
    decision.workedExampleSufficiency,
  );
}

/**
 * Garden-level zero-visual safeguard — a diagnostic, never a blind quota.
 *
 * When a garden selects zero interactive visuals we re-examine the rejected
 * units. If at least one unit still exhibits a strong dynamic, parameter-driven,
 * comparative, or spatial relationship that interaction would materially clarify
 * — and was only rejected for a *soft* reason (a static alternative, borderline
 * load) rather than being decorative or a duplicate — the all-zero outcome is
 * inconsistent with the content and we recover the single highest-value
 * candidate. If no such unit exists, an all-zero garden is genuinely consistent
 * with the content and is left untouched, with a structured reason.
 */
/** Minimum garden size for the zero-visual safeguard to even consider acting. */
export const ZERO_VISUAL_SAFEGUARD_MIN_UNITS = 6;

export function applyGardenZeroVisualSafeguard(input: {
  decisions: VisualNecessityDecision[];
  units: LearningUnitContract[];
  protectedUnitIds?: Set<string>;
}): { decisions: VisualNecessityDecision[]; safeguard: GardenZeroVisualSafeguard } {
  const active = input.decisions.filter((decision) => isActiveNecessity(decision.necessity));
  const protectedUnitIds = input.protectedUnitIds ?? new Set<string>();
  const latent = input.decisions
    .map((decision, index) => ({ decision, index, strength: interactiveStrength(decision) }))
    .filter(
      ({ decision, strength }) =>
        decision.necessity === "not_needed" &&
        // Never resurrect a unit the author explicitly steered away from interaction.
        !protectedUnitIds.has(decision.unitId) &&
        strength >= 0.65 &&
        decision.manipulationValue >= 0.55 &&
        decision.duplicationRisk < 0.6 &&
        !DECORATIVE_RE.test(decision.reason),
    )
    .sort(
      (a, b) =>
        b.strength - a.strength ||
        b.decision.manipulationValue - a.decision.manipulationValue ||
        a.index - b.index,
    );

  // The safeguard targets "a substantial technical garden". A tiny garden that
  // legitimately selects no interaction (or an explicit single-unit decision) is
  // never second-guessed.
  if (active.length === 0 && input.units.length < ZERO_VISUAL_SAFEGUARD_MIN_UNITS) {
    return {
      decisions: input.decisions,
      safeguard: {
        triggered: false,
        activeInteractiveCount: 0,
        latentStrongCandidateUnitIds: latent.map((item) => item.decision.unitId),
        status: "not_applicable",
        reason: `The garden has ${input.units.length} unit(s); the zero-visual safeguard only reviews substantial gardens (≥ ${ZERO_VISUAL_SAFEGUARD_MIN_UNITS} units).`,
      },
    };
  }

  if (active.length > 0) {
    return {
      decisions: input.decisions,
      safeguard: {
        triggered: false,
        activeInteractiveCount: active.length,
        latentStrongCandidateUnitIds: latent.map((item) => item.decision.unitId),
        status: "not_applicable",
        reason: `The garden already selected ${active.length} interactive visual(s); the zero-visual safeguard did not need to act.`,
      },
    };
  }

  if (latent.length === 0) {
    return {
      decisions: input.decisions,
      safeguard: {
        triggered: true,
        activeInteractiveCount: 0,
        latentStrongCandidateUnitIds: [],
        status: "consistent_zero",
        reason:
          "No unit exhibits a dynamic, parameter-driven, comparative, or spatial relationship that manipulation would materially clarify. A zero-visual garden is consistent with this content.",
      },
    };
  }

  const best = latent[0];
  const signals = describePositiveSignals(best.decision);
  const recoveredReason =
    `Garden-level safeguard: the garden selected no interactive visuals, yet this unit exhibits ${
      signals.join(", ") || "a manipulable relationship"
    } that prose and static media do not convey as effectively. Recovered as the garden's highest-value interactive candidate.`;
  const promoted: VisualNecessityDecision = {
    ...best.decision,
    necessity: "recommended",
    preferredMedium: "interactive_visual",
    reason: recoveredReason,
  };
  const decisions = input.decisions.slice();
  decisions[best.index] = promoted;
  return {
    decisions,
    safeguard: {
      triggered: true,
      activeInteractiveCount: 1,
      latentStrongCandidateUnitIds: latent.map((item) => item.decision.unitId),
      recoveredUnitId: best.decision.unitId,
      recoveredReason,
      status: "recovered",
      reason:
        "An all-zero interactive outcome was inconsistent with the garden's dynamic, comparative, or spatial content; the highest-value candidate was recovered rather than silently shipping zero visuals.",
    },
  };
}

function describePositiveSignals(decision: VisualNecessityDecision): string[] {
  const signals: string[] = [];
  const role = decision.evidence.unitRole;
  if (decision.dynamicBehaviorValue >= 0.6) signals.push("time-dependent behavior");
  if (decision.dynamicBehaviorValue >= 0.6 && (role === "mechanism" || role === "training_method")) {
    signals.push("state transitions / a causal mechanism");
  }
  if (decision.parameterSensitivityValue >= 0.6) signals.push("parameter sensitivity");
  if (decision.comparisonValue >= 0.6) signals.push("competing quantities / multiple scenarios");
  if (decision.spatialValue >= 0.6) signals.push("spatial or geometric structure");
  if (decision.manipulationValue >= 0.6 && signals.length === 0) {
    signals.push("a relationship the learner can manipulate");
  }
  return unique(signals);
}

function describeNegativeSignals(decision: VisualNecessityDecision): string[] {
  const signals: string[] = [];
  if (decision.proseSufficiency >= 0.8) signals.push("fully conveyed by prose");
  if (decision.sourceFigureSufficiency >= 0.8) signals.push("covered by a sufficient source figure");
  if (decision.formulaSufficiency >= 0.8) signals.push("covered by a formula derivation");
  if (decision.workedExampleSufficiency >= 0.8) signals.push("covered by a worked example");
  if (decision.duplicationRisk >= 0.6) signals.push("duplicates a nearby interaction");
  if (decision.cognitiveLoadRisk >= 0.7) signals.push("arrives before prerequisites are established");
  if (DECORATIVE_RE.test(decision.reason)) signals.push("decorative only");
  return unique(signals);
}

const RECORD_DECISION_BY_NECESSITY: Record<InteractiveVisualNecessity, VisualDecisionRecord["decision"]> = {
  required: "required",
  recommended: "strongly_recommended",
  optional: "optional",
  not_needed: "not_useful",
  harmful_or_distracting: "not_useful",
};

/** A display-only category for the observability record — never used for routing. */
function candidateCategory(decision: VisualNecessityDecision): string {
  if (decision.recommendedVisualType) return decision.recommendedVisualType;
  const values: Array<[string, number]> = [
    ["time_series_simulation", decision.dynamicBehaviorValue],
    ["parameter_explorer", decision.parameterSensitivityValue],
    ["scenario_comparison", decision.comparisonValue],
    ["spatial_diagram", decision.spatialValue],
  ];
  values.sort((a, b) => b[1] - a[1]);
  return values[0][1] >= 0.55 ? values[0][0] : "interactive_visual";
}

function decisionConfidence(decision: VisualNecessityDecision): number {
  const strength = interactiveStrength(decision);
  const alternative = bestAlternativeSufficiency(decision);
  const margin = isActiveNecessity(decision.necessity)
    ? strength - alternative
    : Math.max(alternative, 1 - strength) - strength;
  return score(0.55 + Math.max(-0.35, Math.min(0.4, margin)) * 0.9);
}

export function buildVisualDecisionRecord(
  decision: VisualNecessityDecision,
  options: { decisionSource?: VisualDecisionRecord["decisionSource"]; duplicateOf?: string } = {},
): VisualDecisionRecord {
  const duplicateOf =
    options.duplicateOf ??
    (decision.duplicationRisk >= 0.85 ? decision.evidence.nearbyVisualIntentIds[0] : undefined);
  return {
    unitId: decision.unitId,
    candidateType: candidateCategory(decision),
    decision: RECORD_DECISION_BY_NECESSITY[decision.necessity],
    pedagogicalBenefit: decision.reason,
    ...(isActiveNecessity(decision.necessity)
      ? {
          learnerAction: `Manipulate ${decision.evidence.concepts.slice(0, 2).join(" and ") || "the key variables"} and observe the response.`,
          conceptMadeVisible: decision.learningGoal,
        }
      : {}),
    positiveSignals: describePositiveSignals(decision),
    negativeSignals: describeNegativeSignals(decision),
    ...(duplicateOf ? { duplicateOf } : {}),
    confidence: decisionConfidence(decision),
    decisionSource: options.decisionSource ?? "deterministic",
  };
}

/**
 * An explicit unresolved record. A model call failure, invalid structured
 * response, timeout, or downstream implementation/validation failure MUST be
 * represented as `unresolved` so repair logic can retry — it is never evidence
 * that the visual is pedagogically unnecessary.
 */
export function unresolvedVisualDecisionRecord(input: {
  unitId: string;
  candidateType?: string;
  failure: VisualDecisionFailure;
  positiveSignals?: string[];
  negativeSignals?: string[];
}): VisualDecisionRecord {
  return {
    unitId: input.unitId,
    candidateType: input.candidateType ?? "interactive_visual",
    decision: "unresolved",
    pedagogicalBenefit:
      "The pedagogical value is not yet decided because resolving this candidate failed; it awaits repair, not omission.",
    positiveSignals: input.positiveSignals ?? [],
    negativeSignals: input.negativeSignals ?? [],
    confidence: 0.2,
    decisionSource: "chatmock_review",
    failure: input.failure,
  };
}

export function buildVisualDecisionRecords(
  decisions: VisualNecessityDecision[],
  options: { overriddenUnitIds?: Set<string>; safeguard?: GardenZeroVisualSafeguard } = {},
): VisualDecisionRecord[] {
  const overridden = options.overriddenUnitIds ?? new Set<string>();
  const recovered = options.safeguard?.recoveredUnitId;
  return decisions.map((decision) =>
    buildVisualDecisionRecord(decision, {
      decisionSource: overridden.has(decision.unitId)
        ? "author_override"
        : recovered === decision.unitId
          ? "garden_zero_safeguard"
          : "deterministic",
    }),
  );
}

export type VisualNecessityReviewResolution =
  | { status: "resolved"; decision: VisualNecessityDecision; record: VisualDecisionRecord }
  | { status: "unresolved"; decision: VisualNecessityDecision; record: VisualDecisionRecord };

/**
 * Resolve a single ambiguous-decision review, mapping failure to an explicit
 * `unresolved` record instead of silently keeping — or worse, downgrading — the
 * deterministic decision without evidence. On any failure the deterministic
 * decision is retained as the operating decision (a safe fallback) while the
 * record marks the candidate unresolved so a repair pass can revisit it.
 */
export function resolveVisualNecessityReview(input: {
  packet: VisualNecessityReviewPacket;
  response?: VisualNecessityReviewResponse;
  error?: unknown;
  supportedVisualTypes?: readonly string[];
}): VisualNecessityReviewResolution {
  const deterministic = input.packet.deterministicDecision;
  const candidateType = candidateCategory(deterministic);
  if (input.error !== undefined || !input.response) {
    return {
      status: "unresolved",
      decision: deterministic,
      record: unresolvedVisualDecisionRecord({
        unitId: deterministic.unitId,
        candidateType,
        failure: {
          stage: "necessity_review",
          code: "model_call_failed",
          message:
            input.error instanceof Error
              ? input.error.message
              : String(input.error ?? "the reviewer returned no response"),
        },
        positiveSignals: describePositiveSignals(deterministic),
        negativeSignals: describeNegativeSignals(deterministic),
      }),
    };
  }
  const problems = validateVisualNecessityReview(input.packet, input.response, input.supportedVisualTypes);
  if (problems.length > 0) {
    return {
      status: "unresolved",
      decision: deterministic,
      record: unresolvedVisualDecisionRecord({
        unitId: deterministic.unitId,
        candidateType,
        failure: {
          stage: "structured_response",
          code: "invalid_structured_response",
          message: problems.join("; "),
        },
        positiveSignals: describePositiveSignals(deterministic),
        negativeSignals: describeNegativeSignals(deterministic),
      }),
    };
  }
  const decision = applyVisualNecessityReview(input.packet, input.response, input.supportedVisualTypes);
  return {
    status: "resolved",
    decision,
    record: buildVisualDecisionRecord(decision, { decisionSource: "chatmock_review" }),
  };
}

export function planGardenVisualNecessity(input: {
  gardenId: string;
  learningUnits: LearningUnitContract[];
  sectionByUnit?: Record<string, string>;
  overrides?: VisualDecisionOverride[];
  reviewedDecisions?: VisualNecessityDecision[];
  reviewCalls?: number;
  rejectedReviews?: number;
}): GardenVisualNecessityPlan {
  const overrides = input.overrides ?? [];
  const availableConcepts: string[] = [];
  const deterministic: VisualNecessityDecision[] = [];
  input.learningUnits.forEach((unit, unitIndex) => {
    const decision = decideInteractiveVisualNecessity(unit, {
      pageId: unit.id,
      unitIndex,
      totalUnits: input.learningUnits.length,
      availablePrerequisiteConcepts: availableConcepts,
      nearbyVisualDecisions: deterministic,
      overrides,
    });
    deterministic.push(decision);
    availableConcepts.push(...unit.newConcepts, ...unitConcepts(unit));
  });
  const reviewedByUnit = new Map(
    (input.reviewedDecisions ?? []).map((decision) => [decision.unitId, decision]),
  );
  const reviewed = deterministic.map((decision) => reviewedByUnit.get(decision.unitId) ?? decision);
  const initialBudget = deriveGardenVisualBudget(input.learningUnits, reviewed);
  const coordinated = coordinateGardenVisualDecisions(reviewed, {
    units: input.learningUnits,
    sectionByUnit: input.sectionByUnit,
    budget: initialBudget,
    overrides,
  });
  // Garden-level diagnostic: if a substantial, dynamic garden still selected zero
  // interactive visuals, re-examine the rejected units and recover the single
  // highest-value candidate when the all-zero outcome is inconsistent with the
  // content. Author-forced-none units are never resurrected.
  const overriddenUnitIds = new Set(overrides.map((override) => override.unitId));
  const { decisions, safeguard } = applyGardenZeroVisualSafeguard({
    decisions: coordinated,
    units: input.learningUnits,
    protectedUnitIds: overriddenUnitIds,
  });
  const decisionRecords = buildVisualDecisionRecords(decisions, {
    overriddenUnitIds,
    safeguard,
  });
  const teachingMedia = input.learningUnits.map((unit) =>
    deriveTeachingMediumPlan(
      unit,
      decisions.find((decision) => decision.unitId === unit.id)!,
    ),
  );
  const decisionByUnit = new Map(decisions.map((decision) => [decision.unitId, decision]));
  const mediumByUnit = new Map(teachingMedia.map((plan) => [plan.unitId, plan]));
  const learningUnits = input.learningUnits.map((unit) => {
    const decision = decisionByUnit.get(unit.id)!;
    const requirement = requirementForNecessity(decision.necessity);
    // Renderer/type intent is deliberately cleared here. It is attached by
    // applyVisualizationRoutesToLearningUnits only after necessity and
    // garden-level coordination have completed.
    const visualIntent = undefined;
    const bestAlternative = Math.max(
      decision.sourceFigureSufficiency,
      decision.proseSufficiency,
      decision.formulaSufficiency,
      decision.workedExampleSufficiency,
    );
    const interactiveVisualPlan: ContractInteractiveVisualPlan = {
      decision,
      requirement,
      ...(visualIntent ? { visualIntent } : {}),
      ...(requirement === "none" ? { omissionReason: decision.reason } : {}),
      alternativeCoverage:
        requirement === "none" || bestAlternative >= 0.65
          ? "covered"
          : requirement === "required"
            ? "uncovered"
            : "unverified",
    };
    return {
      ...unit,
      interactiveVisual: visualIntent,
      interactiveVisualPlan,
      teachingMediumPlan: mediumByUnit.get(unit.id),
    };
  });
  const budget = deriveGardenVisualBudget(learningUnits, decisions);
  return {
    learningUnits,
    decisions,
    teachingMedia,
    budget,
    overrides,
    reviewCalls: input.reviewCalls ?? 0,
    rejectedReviews: input.rejectedReviews ?? 0,
    decisionRecords,
    zeroVisualSafeguard: safeguard,
  };
}

/** Rebuild contract fields from independently reviewed decisions. */
export function applyVisualNecessityDecisionsToUnits(input: {
  gardenId: string;
  learningUnits: LearningUnitContract[];
  decisions: VisualNecessityDecision[];
  sectionByUnit?: Record<string, string>;
  overrides?: VisualDecisionOverride[];
  reviewCalls?: number;
  rejectedReviews?: number;
}): GardenVisualNecessityPlan {
  return planGardenVisualNecessity({
    ...input,
    reviewedDecisions: input.decisions,
  });
}

export interface VisualFulfillmentAssessment {
  severity: "blocker" | "warning" | "none";
  code:
    | "required_missing"
    | "recommended_missing"
    | "model_approved_missing"
    | "required_type_mismatch"
    | "unexpected_visual"
    | "harmful_visual"
    | "satisfied";
  reason: string;
}

export function assessInteractiveVisualFulfillment(input: {
  unit: LearningUnitContract;
  embeddedVisualTypes?: string[];
  generatedVisualIds?: string[];
  intentionallyOmitted?: boolean;
  /** Active Learn freezes the model-authored visual plan. Once its dedicated
   * reviewer approves an interaction, finalization may not reinterpret an
   * omission marker or alternative medium as permission to drop it. */
  strictModelApprovedRequirement?: boolean;
}): VisualFulfillmentAssessment {
  const plan = input.unit.interactiveVisualPlan;
  const requirement = plan?.requirement ?? (input.unit.interactiveVisual ? "recommended" : "none");
  const types = input.embeddedVisualTypes ?? [];
  const generated = input.generatedVisualIds ?? [];
  const present = types.length > 0 || generated.length > 0;
  const absent = !present;
  const missing = absent && !input.intentionallyOmitted;
  const expectedType =
    plan?.visualIntent?.visualType ??
    plan?.decision.recommendedVisualType ??
    input.unit.interactiveVisual?.visualType;

  if (
    input.strictModelApprovedRequirement === true &&
    plan &&
    (requirement === "required" || requirement === "recommended" || requirement === "optional") &&
    absent
  ) {
    return {
      severity: "blocker",
      code: "model_approved_missing",
      reason:
        `A model-approved ${requirement} interactive visual is missing. ` +
        "Strict Learn finalization does not allow omission metadata or alternative coverage to demote an approved interaction.",
    };
  }

  if (requirement === "required" && absent) {
    return { severity: "blocker", code: "required_missing", reason: "A required interactive visual is missing." };
  }
  if (requirement === "recommended" && missing) {
    const blocker = plan?.alternativeCoverage === "uncovered";
    return {
      severity: blocker ? "blocker" : "warning",
      code: "recommended_missing",
      reason: blocker
        ? "The recommendation explicitly records that no alternative medium covers the learning goal."
        : "The recommended interaction was omitted; the omission is non-blocking unless alternative coverage is explicitly marked uncovered.",
    };
  }
  if (
    requirement === "required" &&
    expectedType &&
    generated.length === 0 &&
    types.length > 0 &&
    !types.some((type) => normalizedKey(type) === normalizedKey(expectedType))
  ) {
    return { severity: "blocker", code: "required_type_mismatch", reason: `Required visual type ${expectedType} was not embedded.` };
  }
  if (requirement === "none" && present) {
    const harmful = plan?.decision.necessity === "harmful_or_distracting";
    return {
      severity: harmful ? "blocker" : "warning",
      code: harmful ? "harmful_visual" : "unexpected_visual",
      reason: harmful
        ? "A visual rejected as harmful or distracting is still embedded."
        : "A visual is embedded even though the contract deliberately selected no interaction.",
    };
  }
  return { severity: "none", code: "satisfied", reason: "The visual contract is satisfied." };
}

export type ScopedVisualRepairIssueKind = "missing" | "type_mismatch" | "duplicate" | "unexpected";
export type ScopedVisualRepairAction =
  | "generate_required_visual"
  | "repair_required_visual"
  | "replace_required_visual_type"
  | "attempt_recommended_visual"
  | "replace_with_alternative_medium"
  | "ignore_optional_absence"
  | "remove_optional_duplicate"
  | "remove_stale_requirement"
  | "remove_unnecessary_visual";

export interface ScopedVisualRepairInstruction {
  unitId: string;
  issue: ScopedVisualRepairIssueKind;
  action: ScopedVisualRepairAction;
  preferredMedium: PreferredTeachingMedium;
  reason: string;
}

/**
 * Decides repair scope only after the current necessity plan has been rerun.
 * Units not named by an issue never receive an instruction.
 */
export function planScopedVisualRepairs(input: {
  learningUnits: LearningUnitContract[];
  issues: Array<{ unitId: string; kind: ScopedVisualRepairIssueKind }>;
}): ScopedVisualRepairInstruction[] {
  const units = new Map(input.learningUnits.map((unit) => [unit.id, unit]));
  const instructions: ScopedVisualRepairInstruction[] = [];
  for (const issue of input.issues) {
    const unit = units.get(issue.unitId);
    if (!unit) continue;
    const plan = unit.interactiveVisualPlan;
    const requirement = plan?.requirement ?? (unit.interactiveVisual ? "recommended" : "none");
    const medium = unit.teachingMediumPlan?.preferredMedium ?? plan?.decision.preferredMedium ?? "prose";
    let action: ScopedVisualRepairAction;
    if (requirement === "required") {
      action = issue.kind === "type_mismatch"
        ? "replace_required_visual_type"
        : issue.kind === "missing"
          ? "generate_required_visual"
          : "repair_required_visual";
    } else if (requirement === "recommended") {
      action = issue.kind === "missing" && plan?.alternativeCoverage === "covered"
        ? "replace_with_alternative_medium"
        : "attempt_recommended_visual";
    } else if (requirement === "optional") {
      action = issue.kind === "duplicate" || issue.kind === "unexpected"
        ? "remove_optional_duplicate"
        : "ignore_optional_absence";
    } else {
      action = issue.kind === "unexpected" || issue.kind === "duplicate"
        ? "remove_unnecessary_visual"
        : "remove_stale_requirement";
    }
    instructions.push({
      unitId: unit.id,
      issue: issue.kind,
      action,
      preferredMedium: medium,
      reason: plan?.decision.reason ?? "The current necessity decision controls this scoped repair.",
    });
  }
  return instructions;
}

export function isAmbiguousVisualNecessityDecision(
  decision: VisualNecessityDecision,
): boolean {
  const bestAlternative = Math.max(
    decision.sourceFigureSufficiency,
    decision.proseSufficiency,
    decision.formulaSufficiency,
    decision.workedExampleSufficiency,
  );
  return (
    (decision.necessity === "recommended" || decision.necessity === "optional") &&
    bestAlternative >= 0.55 &&
    bestAlternative <= 0.82 &&
    decision.manipulationValue >= 0.5
  );
}

export function buildVisualNecessityReviewPacket(input: {
  unit: LearningUnitContract;
  deterministicDecision: VisualNecessityDecision;
  sourceEvidence?: VisualNecessitySourceEvidence[];
  nearbyVisualDecisions?: VisualNecessityDecision[];
}): VisualNecessityReviewPacket {
  const sourceEvidence = input.sourceEvidence ?? evidenceForUnit(input.unit, {});
  return {
    unit: {
      id: input.unit.id,
      title: input.unit.title,
      role: input.unit.role,
      learningQuestion: input.unit.learningQuestion,
      concepts: unitConcepts(input.unit),
    },
    deterministicDecision: input.deterministicDecision,
    relevantSourceEvidence: sourceEvidence.slice(0, 8).map((item) => ({
      anchorId: item.anchorId,
      kind: item.kind,
      title: item.title ?? "",
      semanticSummary: item.semanticSummary ?? "",
    })),
    nearbyVisualDecisions: (input.nearbyVisualDecisions ?? []).slice(-6).map((decision) => ({
      unitId: decision.unitId,
      decision: decision.necessity,
      visualType: decision.recommendedVisualType,
      learningGoal: decision.learningGoal,
    })),
    supportedAlternatives: [
      "source_figure",
      "generated_static_diagram",
      "formula_derivation",
      "worked_example",
      "comparison_table",
      "timeline",
      "prose",
      "no_additional_visual",
    ],
    allowedActions: [
      "confirm_required",
      "downgrade_to_recommended",
      "downgrade_to_optional",
      "select_noninteractive_medium",
      "reject_as_distracting",
    ],
  };
}

export function validateVisualNecessityReview(
  packet: VisualNecessityReviewPacket,
  response: VisualNecessityReviewResponse,
  supportedVisualTypes: readonly string[] = TRUSTED_RENDERER_REGISTRY.renderers.map(
    (renderer) => renderer.id,
  ),
): string[] {
  const problems: string[] = [];
  if (!packet.allowedActions.includes(response.action)) {
    problems.push(`action ${response.action} is not allowed`);
  }
  if (!compact(response.reason)) problems.push("review reason is required");
  const type = normalizedKey(response.visualType ?? "").replace(/ /g, "_");
  const supported = new Set(supportedVisualTypes.map((item) => normalizedKey(item).replace(/ /g, "_")));
  if (type && !supported.has(type)) problems.push(`visual type ${type} is not supported`);
  if (
    response.action === "confirm_required" &&
    (packet.deterministicDecision.sourceFigureSufficiency >= 0.8 ||
      packet.deterministicDecision.formulaSufficiency >= 0.8 ||
      packet.deterministicDecision.workedExampleSufficiency >= 0.8)
  ) {
    problems.push("a sufficient non-interactive medium cannot be ignored");
  }
  if (response.action === "confirm_required" && DECORATIVE_RE.test(response.reason)) {
    problems.push("aesthetic variety is not pedagogical evidence");
  }
  if (
    response.action === "confirm_required" &&
    packet.deterministicDecision.duplicationRisk > 0.6
  ) {
    problems.push("nearby duplicate interaction must be resolved first");
  }
  if (
    response.action === "select_noninteractive_medium" &&
    (!response.preferredMedium || response.preferredMedium === "interactive_visual")
  ) {
    problems.push("a supported non-interactive medium is required");
  }
  if (
    response.preferredMedium &&
    !packet.supportedAlternatives.includes(response.preferredMedium)
  ) {
    problems.push(`teaching medium ${response.preferredMedium} is not a supported alternative`);
  }
  return problems;
}

export function applyVisualNecessityReview(
  packet: VisualNecessityReviewPacket,
  response: VisualNecessityReviewResponse,
  supportedVisualTypes?: readonly string[],
): VisualNecessityDecision {
  const problems = validateVisualNecessityReview(packet, response, supportedVisualTypes);
  if (problems.length > 0) {
    throw new Error(`Invalid visual necessity review: ${problems.join("; ")}`);
  }
  const base = packet.deterministicDecision;
  if (response.action === "confirm_required") {
    return {
      ...base,
      necessity: "required",
      preferredMedium: "interactive_visual",
      ...(response.visualType ? { recommendedVisualType: response.visualType } : {}),
      reason: response.reason,
    };
  }
  if (response.action === "downgrade_to_recommended") {
    return { ...base, necessity: "recommended", preferredMedium: "interactive_visual", reason: response.reason };
  }
  if (response.action === "downgrade_to_optional") {
    return { ...base, necessity: "optional", preferredMedium: "interactive_visual", reason: response.reason };
  }
  if (response.action === "reject_as_distracting") {
    return { ...base, necessity: "harmful_or_distracting", preferredMedium: "prose", reason: response.reason };
  }
  return {
    ...base,
    necessity: "not_needed",
    preferredMedium: response.preferredMedium!,
    reason: response.reason,
  };
}

export async function reviewAmbiguousVisualNecessityDecisions(input: {
  units: LearningUnitContract[];
  decisions: VisualNecessityDecision[];
  reviewer: (packet: VisualNecessityReviewPacket) => Promise<VisualNecessityReviewResponse>;
  /** Lets orchestration propagate cancellation while ordinary reviewer/model
   * failures remain explicit unresolved decisions. */
  shouldRethrowError?: (error: unknown) => boolean;
  maxReviews?: number;
  supportedVisualTypes?: string[];
}): Promise<{
  decisions: VisualNecessityDecision[];
  reviewCalls: number;
  rejectedReviews: number;
  unresolvedRecords: VisualDecisionRecord[];
}> {
  const next = [...input.decisions];
  let reviewCalls = 0;
  let rejectedReviews = 0;
  const unresolvedRecords: VisualDecisionRecord[] = [];
  const maxReviews = Math.max(0, input.maxReviews ?? 3);
  for (let index = 0; index < next.length && reviewCalls < maxReviews; index += 1) {
    const decision = next[index];
    if (!isAmbiguousVisualNecessityDecision(decision)) continue;
    const unit = input.units.find((candidate) => candidate.id === decision.unitId);
    if (!unit) continue;
    const packet = buildVisualNecessityReviewPacket({
      unit,
      deterministicDecision: decision,
      nearbyVisualDecisions: next.slice(0, index),
    });
    reviewCalls += 1;
    // A reviewer failure or an invalid structured response must not silently keep
    // the deterministic decision as if the model had agreed. We retain the
    // deterministic decision as a safe operating fallback but emit an explicit
    // `unresolved` record so a repair pass can revisit the candidate.
    let resolution: VisualNecessityReviewResolution;
    try {
      const response = await input.reviewer(packet);
      resolution = resolveVisualNecessityReview({
        packet,
        response,
        supportedVisualTypes: input.supportedVisualTypes,
      });
    } catch (error) {
      if (input.shouldRethrowError?.(error)) throw error;
      resolution = resolveVisualNecessityReview({ packet, error, supportedVisualTypes: input.supportedVisualTypes });
    }
    next[index] = resolution.decision;
    if (resolution.status === "unresolved") {
      rejectedReviews += 1;
      unresolvedRecords.push(resolution.record);
    }
  }
  return { decisions: next, reviewCalls, rejectedReviews, unresolvedRecords };
}

export function visualNecessityArtifactPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "visual-necessity-decisions.json");
}

export function visualDecisionOverridesPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "visual-decision-overrides.json");
}

function markdownEscape(value: string): string {
  return compact(value).replace(/\|/g, "\\|");
}

export function saveVisualNecessityArtifacts(
  gardenDir: string,
  gardenId: string,
  plan: Omit<GardenVisualNecessityPlan, "learningUnits" | "decisionRecords" | "zeroVisualSafeguard"> & {
    decisionRecords?: VisualDecisionRecord[];
    zeroVisualSafeguard?: GardenZeroVisualSafeguard;
    unresolvedRecords?: VisualDecisionRecord[];
  },
): VisualNecessityArtifact {
  const overriddenUnitIds = new Set(plan.overrides.map((override) => override.unitId));
  const decisionRecords = [
    ...(plan.decisionRecords ??
      buildVisualDecisionRecords(plan.decisions, {
        overriddenUnitIds,
        safeguard: plan.zeroVisualSafeguard,
      })),
    ...(plan.unresolvedRecords ?? []),
  ];
  const zeroVisualSafeguard = plan.zeroVisualSafeguard;
  const artifact: VisualNecessityArtifact = {
    schemaVersion: 1,
    gardenId,
    generatedAt: new Date().toISOString(),
    artifactRole: "pre_executability_model_necessity_and_teaching_medium_source",
    interactionContractsAreAuthoritative: false,
    supersededBy: {
      learningUnitContract: ".breadboard/learning-unit-contract.json",
      visualizationPlan: ".breadboard/visualization-plan.json",
      executabilityReviewLedger: ".breadboard/visual-contract-executability-reviews.json",
    },
    budget: plan.budget,
    decisions: plan.decisions,
    teachingMedia: plan.teachingMedia,
    overrides: plan.overrides,
    reviewCalls: plan.reviewCalls ?? 0,
    rejectedReviews: plan.rejectedReviews ?? 0,
    decisionRecords,
    ...(zeroVisualSafeguard ? { zeroVisualSafeguard } : {}),
  };
  const breadboardDir = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(breadboardDir, { recursive: true });
  fs.writeFileSync(visualNecessityArtifactPath(gardenDir), `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  fs.writeFileSync(
    path.join(breadboardDir, "visual-decision-records.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      gardenId,
      generatedAt: artifact.generatedAt,
      artifactRole: artifact.artifactRole,
      interactionContractsAreAuthoritative: false,
      supersededBy: artifact.supersededBy,
      zeroVisualSafeguard,
      decisionRecords,
    }, null, 2)}\n`,
    "utf-8",
  );

  const groups: Array<[string, InteractiveVisualNecessity[]]> = [
    ["Required Interactive Visuals", ["required"]],
    ["Recommended Interactive Visuals", ["recommended"]],
    ["Optional Interactive Visuals", ["optional"]],
    ["No Interactive Visual Needed", ["not_needed"]],
    ["Rejected as Distracting or Duplicative", ["harmful_or_distracting"]],
  ];
  const lines = [
    "# Interactive Visual Decisions",
    "",
    "> **Artifact role:** Pre-executability necessity and teaching-medium source. Any nested interaction contract here is not authoritative after review. Use `.breadboard/learning-unit-contract.json` and `.breadboard/visualization-plan.json`; audit replacements in `.breadboard/visual-contract-executability-reviews.json`.",
    "",
    "| Unit | Decision | Preferred Medium | Reason |",
    "|---|---|---|---|",
    ...artifact.decisions.map(
      (decision) =>
        `| ${markdownEscape(decision.unitId)} | ${decision.necessity} | ${decision.preferredMedium} | ${markdownEscape(decision.reason)} |`,
    ),
    "",
  ];
  for (const [heading, necessities] of groups) {
    lines.push(`## ${heading}`, "");
    const matches = artifact.decisions.filter((decision) => necessities.includes(decision.necessity));
    lines.push(
      ...(matches.length > 0
        ? matches.map((decision) => `- **${decision.unitId}** — ${decision.reason}`)
        : ["- None."]),
      "",
    );
  }
  const unresolved = decisionRecords.filter((record) => record.decision === "unresolved");
  if (unresolved.length > 0) {
    lines.push("## Unresolved (awaiting repair, not omission)", "");
    lines.push(
      ...unresolved.map(
        (record) =>
          `- **${record.unitId}** — ${record.failure?.stage ?? "unknown"} / ${record.failure?.code ?? "unknown"}: ${markdownEscape(record.failure?.message ?? "")}`,
      ),
      "",
    );
  }
  if (zeroVisualSafeguard) {
    lines.push("## Garden-Level Zero-Visual Safeguard", "");
    lines.push(`- Status: **${zeroVisualSafeguard.status}**`, `- ${markdownEscape(zeroVisualSafeguard.reason)}`);
    if (zeroVisualSafeguard.recoveredUnitId) {
      lines.push(`- Recovered candidate: **${zeroVisualSafeguard.recoveredUnitId}**`);
    }
    lines.push("");
  }
  fs.writeFileSync(
    path.join(breadboardDir, "visual-necessity-decisions.md"),
    `${lines.join("\n")}\n`,
    "utf-8",
  );
  return artifact;
}

export function loadVisualNecessityArtifact(gardenDir: string): VisualNecessityArtifact | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(visualNecessityArtifactPath(gardenDir), "utf-8"));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.decisions)) return null;
    return parsed as VisualNecessityArtifact;
  } catch {
    return null;
  }
}

export function loadVisualDecisionOverrides(gardenDir: string): VisualDecisionOverride[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(visualDecisionOverridesPath(gardenDir), "utf-8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.overrides;
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is VisualDecisionOverride =>
      Boolean(
        item &&
          typeof item.unitId === "string" &&
          ["force_required", "force_none", "prefer_static", "prefer_interactive"].includes(item.action) &&
          typeof item.reason === "string" &&
          ["user", "reviewer"].includes(item.createdBy),
      ),
    );
  } catch {
    return [];
  }
}

export function saveVisualDecisionOverrides(
  gardenDir: string,
  overrides: VisualDecisionOverride[],
): void {
  const filePath = visualDecisionOverridesPath(gardenDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ schemaVersion: 1, overrides }, null, 2)}\n`, "utf-8");
}
