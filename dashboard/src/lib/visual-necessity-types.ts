import type { VisualizationInteractionGoal } from "./visualization-registry.ts";

export type InteractiveVisualNecessity =
  | "required"
  | "recommended"
  | "optional"
  | "not_needed"
  | "harmful_or_distracting";

export type PreferredTeachingMedium =
  | "interactive_visual"
  | "source_figure"
  | "generated_static_diagram"
  | "formula_derivation"
  | "worked_example"
  | "comparison_table"
  | "timeline"
  | "prose"
  | "no_additional_visual";

export interface InteractiveVisualControlEvidence {
  anchor: string;
  quote: string;
}

export type InteractiveVisualControlInputType =
  | "slider"
  | "number"
  | "select"
  | "toggle"
  | "button";

export type InteractiveVisualControlProtocolRole =
  | "prediction_input"
  | "commit_prediction"
  | "reveal_outcome"
  | "evaluate_prediction"
  | "reset";

export interface InteractiveVisualControlContract {
  /** Stable model-authored identifier used by the generated module contract. */
  id: string;
  kind: "variable" | "select_case" | "process_position" | "protocol_action";
  label: string;
  /** Input widget semantics are authored by the model, never inferred downstream. */
  type: InteractiveVisualControlInputType;
  /** Explicit model-authored interaction protocol; never inferred downstream. */
  protocolRole?: InteractiveVisualControlProtocolRole;
  unit?: string;
  /** Required for slider and number controls. */
  min?: number;
  /** Required for slider and number controls. */
  max?: number;
  /** Required for slider and number controls. */
  step?: number;
  /** Required for select controls and forbidden for numeric controls. */
  options?: string[];
  /** Subject controls use numbers/options; protocol buttons use 0 and toggles false. */
  defaultValue: number | string | boolean;
  /** Empty only for pure protocol_action button/toggle controls. */
  evidence: InteractiveVisualControlEvidence[];
}

export type InteractiveVisualOutputRepresentation =
  | "value"
  | "chart"
  | "diagram"
  | "animation"
  | "timeline"
  | "table"
  | "annotation";

export interface InteractiveVisualObservableContract {
  label: string;
  representation: InteractiveVisualOutputRepresentation;
  evidence: InteractiveVisualControlEvidence[];
}

/**
 * The complete model-authored interaction semantics shared by necessity,
 * executability review, routing, and generation. Keeping one typed record
 * prevents a post-review control set from diverging from decision.interaction.
 */
export interface InteractiveVisualPedagogyContract {
  interactionGoal: VisualizationInteractionGoal;
  uniqueConcept: string;
  whyStaticSourceFigureIsNotEnough: string;
  learnerAction: string;
  controls: InteractiveVisualControlContract[];
  observable: InteractiveVisualObservableContract;
  expectedInsight: string;
  expectedInsightEvidence: InteractiveVisualControlEvidence[];
  duplicateSignature: string;
}

export interface InteractiveVisualIntent {
  id: string;
  uniqueConcept: string;
  visualType: string;
  whyStaticSourceFigureIsNotEnough: string;
  learnerManipulates: string[];
  expectedInsight: string;
  sourceAnchors: string[];
  duplicateSignature: string;
  reuseOf?: string;
}

export interface VisualNecessityDecision {
  unitId: string;
  pageId: string;
  necessity: InteractiveVisualNecessity;
  preferredMedium: PreferredTeachingMedium;
  learningGoal: string;
  manipulationValue: number;
  dynamicBehaviorValue: number;
  comparisonValue: number;
  spatialValue: number;
  parameterSensitivityValue: number;
  sourceFigureSufficiency: number;
  proseSufficiency: number;
  formulaSufficiency: number;
  workedExampleSufficiency: number;
  cognitiveLoadRisk: number;
  duplicationRisk: number;
  implementationRisk: number;
  /** How sure the decision is, 0..1. The model authors this in the whole-garden
   * pass; the deterministic scorer derives it from its own margins. Consumers
   * read it rather than inventing a confidence of their own. */
  confidence: number;
  recommendedVisualType?: string;
  evidence: {
    unitRole: string;
    concepts: string[];
    learningQuestion: string;
    sourceAnchorIds: string[];
    nearbyVisualIntentIds: string[];
  };
  reason: string;
  /** Present for active model-authored decisions and synchronized atomically
   * with the top-level interaction plan after executability review. */
  interaction?: InteractiveVisualPedagogyContract;
}

export interface ContractInteractiveVisualPlan {
  decision: VisualNecessityDecision;
  requirement: "required" | "recommended" | "optional" | "none";
  visualIntent?: InteractiveVisualIntent;
  /** Validated model-authored controls; planning consumes these without inferring content. */
  controlContract?: InteractiveVisualControlContract[];
  /** Model-authored interaction behavior. Routing must not infer this from prose or roles. */
  interactionGoal?: VisualizationInteractionGoal;
  /** Exact learner sequence; generation projects it without interpreting it. */
  learnerAction?: string;
  /** Model-authored learner-visible response and its presentation form. */
  observable?: InteractiveVisualObservableContract;
  expectedInsightEvidence?: InteractiveVisualControlEvidence[];
  omissionReason?: string;
  /** Explicitly controls the exceptional case where an omitted recommendation may block. */
  alternativeCoverage?: "covered" | "uncovered" | "unverified";
}

export interface TeachingMediumPlan {
  unitId: string;
  preferredMedium: PreferredTeachingMedium;
  sourceFigureAnchorId?: string;
  staticDiagramIntent?: string;
  formulaAnchorIds?: string[];
  workedExampleIntent?: string;
  comparisonTableIntent?: string;
  reason: string;
}

export interface GardenVisualBudget {
  targetMinimum: number;
  targetMaximum: number;
  maximumPerSection: number;
  minimumUnitsBetweenSimilarVisuals: number;
  requiredVisuals: number;
  recommendedVisuals: number;
  optionalVisuals: number;
  reason: string;
}

export interface VisualDecisionOverride {
  unitId: string;
  action: "force_required" | "force_none" | "prefer_static" | "prefer_interactive";
  reason: string;
  createdBy: "user" | "reviewer";
}

export interface VisualNecessityReviewPacket {
  unit: {
    id: string;
    title: string;
    role: string;
    learningQuestion: string;
    concepts: string[];
  };
  deterministicDecision: VisualNecessityDecision;
  relevantSourceEvidence: {
    anchorId: string;
    kind: string;
    title: string;
    semanticSummary: string;
  }[];
  nearbyVisualDecisions: {
    unitId: string;
    decision: InteractiveVisualNecessity;
    visualType?: string;
    learningGoal?: string;
  }[];
  supportedAlternatives: PreferredTeachingMedium[];
  allowedActions: (
    | "confirm_required"
    | "downgrade_to_recommended"
    | "downgrade_to_optional"
    | "select_noninteractive_medium"
    | "reject_as_distracting"
  )[];
}

/**
 * A stage that can fail while resolving a visual. A failure here must surface as
 * an explicit `unresolved` record so repair logic can act — it must never be
 * silently reinterpreted as "the visual is pedagogically unnecessary".
 */
export interface VisualDecisionFailure {
  stage:
    | "necessity_review"
    | "structured_response"
    | "contract_creation"
    | "implementation"
    | "validation"
    | "finalization"
    | string;
  code: string;
  message: string;
}

/**
 * Structured, human-readable observability record for a single visual decision.
 * Persisted alongside the necessity artifact so a reader can answer "why did this
 * garden receive zero, one, or several interactive visualizers?" without rerunning
 * the pipeline. Its `decision` vocabulary is the reader-facing policy taxonomy
 * (required / strongly_recommended / optional / not_useful / unresolved); it maps
 * from the internal InteractiveVisualNecessity plus an explicit unresolved state.
 */
export interface VisualDecisionRecord {
  unitId: string;
  candidateType: string;
  decision:
    | "required"
    | "strongly_recommended"
    | "optional"
    | "not_useful"
    | "unresolved";
  pedagogicalBenefit: string;
  learnerAction?: string;
  conceptMadeVisible?: string;
  positiveSignals: string[];
  negativeSignals: string[];
  duplicateOf?: string;
  confidence: number;
  decisionSource:
    | "deterministic"
    | "chatmock_review"
    | "garden_zero_safeguard"
    | "author_override"
    | string;
  failure?: VisualDecisionFailure;
}

/**
 * Result of the garden-level zero-visual safeguard: a diagnostic (never a blind
 * quota) recording whether an all-zero interactive outcome is consistent with the
 * content, and — when it is not — which candidate was recovered and why.
 */
export interface GardenZeroVisualSafeguard {
  triggered: boolean;
  activeInteractiveCount: number;
  latentStrongCandidateUnitIds: string[];
  recoveredUnitId?: string;
  recoveredReason?: string;
  status: "not_applicable" | "consistent_zero" | "recovered" | "inconsistent_zero";
  reason: string;
}

export interface VisualNecessityArtifact {
  schemaVersion: 1;
  gardenId: string;
  generatedAt: string;
  artifactRole: "pre_executability_model_necessity_and_teaching_medium_source";
  interactionContractsAreAuthoritative: false;
  supersededBy: {
    learningUnitContract: ".breadboard/learning-unit-contract.json";
    visualizationPlan: ".breadboard/visualization-plan.json";
    executabilityReviewLedger: ".breadboard/visual-contract-executability-reviews.json";
  };
  budget: GardenVisualBudget;
  decisions: VisualNecessityDecision[];
  teachingMedia: TeachingMediumPlan[];
  overrides: VisualDecisionOverride[];
  reviewCalls?: number;
  rejectedReviews?: number;
  decisionRecords?: VisualDecisionRecord[];
  zeroVisualSafeguard?: GardenZeroVisualSafeguard;
}
