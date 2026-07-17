import fs from "fs";
import path from "path";
import type { LearningUnitContract } from "./learning-unit-contract.ts";
import { TRUSTED_RENDERER_REGISTRY } from "./visualization-registry.ts";
import type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  InteractiveVisualNecessity,
  PreferredTeachingMedium,
  TeachingMediumPlan,
  VisualDecisionOverride,
  VisualNecessityArtifact,
  VisualNecessityDecision,
  VisualNecessityReviewPacket,
} from "./visual-necessity-types.ts";

export type {
  ContractInteractiveVisualPlan,
  GardenVisualBudget,
  InteractiveVisualIntent,
  InteractiveVisualNecessity,
  PreferredTeachingMedium,
  TeachingMediumPlan,
  VisualDecisionOverride,
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

function missingPrerequisiteRatio(
  unit: LearningUnitContract,
  context: VisualNecessityContext,
): number {
  if (unit.prerequisiteConcepts.length === 0) return 0;
  if (!context.availablePrerequisiteConcepts) {
    return context.unitIndex === 0 ? 1 : 0;
  }
  const available = new Set(context.availablePrerequisiteConcepts.map(normalizedKey));
  const missing = unit.prerequisiteConcepts.filter(
    (concept) => !available.has(normalizedKey(concept)),
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
  const sourceFigureSufficiency = score(
    activeFigures.length === 0
      ? 0.05
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
  const cognitiveLoadRisk = score(
    missingPrerequisites >= 0.5
      ? 0.85
      : unit.prerequisiteConcepts.length >= 5
        ? 0.66
        : context.unitIndex === 0 && unit.prerequisiteConcepts.length > 0
          ? 0.78
          : 0.28,
  );
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
  };
  base.reason = decisionReason(base.necessity, base.preferredMedium, unit, base);
  const override = (context.overrides ?? []).find((item) => item.unitId === unit.id);
  return applyOverride(base, override, supportedTypes);
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
  const decisions = coordinateGardenVisualDecisions(reviewed, {
    units: input.learningUnits,
    sectionByUnit: input.sectionByUnit,
    budget: initialBudget,
    overrides,
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
  maxReviews?: number;
  supportedVisualTypes?: string[];
}): Promise<{ decisions: VisualNecessityDecision[]; reviewCalls: number; rejectedReviews: number }> {
  const next = [...input.decisions];
  let reviewCalls = 0;
  let rejectedReviews = 0;
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
    try {
      const response = await input.reviewer(packet);
      next[index] = applyVisualNecessityReview(packet, response, input.supportedVisualTypes);
    } catch {
      rejectedReviews += 1;
    }
  }
  return { decisions: next, reviewCalls, rejectedReviews };
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
  plan: Omit<GardenVisualNecessityPlan, "learningUnits">,
): VisualNecessityArtifact {
  const artifact: VisualNecessityArtifact = {
    schemaVersion: 1,
    gardenId,
    generatedAt: new Date().toISOString(),
    budget: plan.budget,
    decisions: plan.decisions,
    teachingMedia: plan.teachingMedia,
    overrides: plan.overrides,
    reviewCalls: plan.reviewCalls ?? 0,
    rejectedReviews: plan.rejectedReviews ?? 0,
  };
  const breadboardDir = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(breadboardDir, { recursive: true });
  fs.writeFileSync(visualNecessityArtifactPath(gardenDir), `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

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
