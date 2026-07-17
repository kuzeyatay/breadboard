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
  recommendedVisualType?: string;
  evidence: {
    unitRole: string;
    concepts: string[];
    learningQuestion: string;
    sourceAnchorIds: string[];
    nearbyVisualIntentIds: string[];
  };
  reason: string;
}

export interface ContractInteractiveVisualPlan {
  decision: VisualNecessityDecision;
  requirement: "required" | "recommended" | "optional" | "none";
  visualIntent?: InteractiveVisualIntent;
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

export interface VisualNecessityArtifact {
  schemaVersion: 1;
  gardenId: string;
  generatedAt: string;
  budget: GardenVisualBudget;
  decisions: VisualNecessityDecision[];
  teachingMedia: TeachingMediumPlan[];
  overrides: VisualDecisionOverride[];
  reviewCalls?: number;
  rejectedReviews?: number;
}
