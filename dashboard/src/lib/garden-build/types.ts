import type { CanonicalFormulaIdentity } from "../formula-identity.ts";
import type { FormulaAssignmentProvenance, FormulaUnitCompatibility, UnitFormulaRequirement } from "../formula-assignment.ts";
import type { AnchorEvidence, SourceTextRelevanceResult } from "../final-garden-state.ts";
import type { LearningUnitRole } from "../learning-unit-contract.ts";
import type { RelationPredicate } from "../semantic-core.ts";
import type { GardenIssue, GardenIssueHistoryRecord } from "./issues.ts";

export type GardenBuildId = string;
export type SourceId = string;
export type SourceAnchorId = string;
export type SectionId = string;
export type LearningUnitId = string;
export type PageId = string;
export type ConceptId = string;
export type ClaimId = string;
export type VisualId = string;
export type FormulaAssignmentId = string;

export type GardenBuildStage =
  | "source_ingestion"
  | "planning"
  | "grounding"
  | "semantic_construction"
  | "content_generation"
  | "repair"
  | "accepted_snapshot"
  | "rendering"
  | "projection_validation"
  | "published";

export const STAGE_MUTATION_POLICY = {
  source_ingestion: ["sources", "sourceAnchors"],
  planning: ["sections", "units"],
  grounding: ["sourceAnchors", "formulaAssignments", "visuals", "sourceCoverage"],
  semantic_construction: ["concepts", "claims", "units"],
  content_generation: ["pages", "visuals"],
  repair: ["typed_operation_targets_only"],
  accepted_snapshot: [],
  rendering: [],
  projection_validation: [],
  published: [],
} as const satisfies Record<GardenBuildStage, readonly string[]>;

export interface BuildSource {
  id: SourceId;
  title: string;
  contentHash?: string;
  status: "active" | "historical";
  provenance: Record<string, unknown>;
}

export interface BuildSourceAnchor {
  id: SourceAnchorId;
  sourceId: SourceId;
  kind: "text_concept" | "formula" | "figure" | "graph" | "table" | "example";
  title: string;
  semanticSummary: string;
  conceptKeywords: string[];
  page?: number;
  exactText?: string;
  assetId?: string;
  conceptFamily?: string;
  formulaIdentity?: CanonicalFormulaIdentity;
  evidence?: AnchorEvidence;
  relevance?: SourceTextRelevanceResult;
  status: "verified" | "needs_review" | "unsupported" | "historical";
  provenance: Record<string, unknown>;
}

export interface BuildSection {
  id: SectionId;
  order: number;
  title: string;
  unitIds: LearningUnitId[];
  summary?: string;
}

export interface BuildLearningUnit {
  id: LearningUnitId;
  sectionId: SectionId;
  pageId: PageId;
  order: number;
  title: string;
  role: LearningUnitRole;
  learningQuestion: string;
  prerequisiteConceptIds: ConceptId[];
  primaryConceptIds: ConceptId[];
  supportingConceptIds: ConceptId[];
  sourceAnchorIds: SourceAnchorId[];
  sourceVisualAnchorIds: SourceAnchorId[];
  formulaAssignmentIds: FormulaAssignmentId[];
  claimIds: ClaimId[];
  visualIds: VisualId[];
  zettelNotes: { handle: string; claim: string; connectedConceptIds: ConceptId[] }[];
  status: "planned" | "grounded" | "generated" | "repaired" | "accepted" | "historical";
}

export interface BuildFormulaEntry {
  kind: string;
  text: string;
  sourceAnchorId?: SourceAnchorId;
  basedOnFormulaAnchorId?: SourceAnchorId;
  formulaFamily?: string;
  exampleGroupId?: string;
}

export interface BuildPage {
  id: PageId;
  unitId: LearningUnitId;
  sectionId: SectionId;
  order: number;
  title: string;
  body: string;
  formulaEntries: BuildFormulaEntry[];
  embeddedVisualIds: VisualId[];
  contentFingerprint: string;
  /** Import-only provenance. It is excluded from semantic fingerprints. */
  legacyPath?: string;
}

export interface BuildConcept {
  id: ConceptId;
  slug: string;
  preferredLabel: string;
  aliases: string[];
  description: string;
  broader: ConceptId[];
  narrower: ConceptId[];
  related: ConceptId[];
  status: "active" | "historical";
}

export interface BuildClaim {
  id: ClaimId;
  unitId: LearningUnitId;
  pageId: PageId;
  text: string;
  subjectConceptId: ConceptId;
  objectConceptId?: ConceptId;
  predicate: RelationPredicate;
  conceptIds: ConceptId[];
  evidenceAnchorIds: SourceAnchorId[];
  derivationAnchorIds: SourceAnchorId[];
  status: "active" | "superseded" | "historical";
}

export interface BuildVisual {
  id: VisualId;
  pageId?: PageId;
  unitId?: LearningUnitId;
  type: string;
  sourceAnchorIds: SourceAnchorId[];
  textAnchorIds: SourceAnchorId[];
  body?: string;
  status: "grounded" | "omitted" | "unresolved" | "historical";
  provenance: Record<string, unknown>;
}

export interface BuildFormulaAssignment {
  id: FormulaAssignmentId;
  formulaAnchorId: SourceAnchorId;
  unitId: LearningUnitId;
  pageId: PageId;
  identity: CanonicalFormulaIdentity;
  requirement: UnitFormulaRequirement;
  compatibility: FormulaUnitCompatibility;
  usage:
    | "source_definition"
    | "source_derived_definition"
    | "worked_example_basis"
    | "text_explanation"
    | "interactive_grounding"
    | "synthesis_reference"
    | "intentional_omission";
  status: "verified" | "ambiguous" | "rejected" | "historical";
  provenance: FormulaAssignmentProvenance;
}

export interface BuildSourceCoverageState {
  usages: Array<{ anchorId: SourceAnchorId; pageId?: PageId; unitId?: LearningUnitId; mode: string }>;
  intentionalOmissions: Array<{ anchorId: SourceAnchorId; reason: string }>;
}

export interface CanonicalAcceptanceDecision {
  buildId: string;
  stateFingerprint: string;
  canonicalStatePass: boolean;
  snapshotCreated: boolean;
  projectionPass: boolean;
  criticAvailable: boolean;
  criticPass: boolean;
  blockers: GardenIssue[];
  warnings: GardenIssue[];
  accepted: boolean;
  publishReady: boolean;
  primaryReason:
    | "accepted"
    | "canonical_state_invalid"
    | "model_unavailable_with_semantic_blockers"
    | "repair_budget_exhausted"
    | "projection_integrity_failed"
    | "verified_critic_blockers";
}

export interface GardenBuildState {
  schemaVersion: number;
  buildId: GardenBuildId;
  gardenId: string;
  gardenSlug: string;
  topicTitle: string;
  revision: number;
  stage: GardenBuildStage;
  sourceSetHash: string;
  sources: Record<SourceId, BuildSource>;
  sourceAnchors: Record<SourceAnchorId, BuildSourceAnchor>;
  sections: Record<SectionId, BuildSection>;
  units: Record<LearningUnitId, BuildLearningUnit>;
  pages: Record<PageId, BuildPage>;
  concepts: Record<ConceptId, BuildConcept>;
  claims: Record<ClaimId, BuildClaim>;
  visuals: Record<VisualId, BuildVisual>;
  formulaAssignments: Record<FormulaAssignmentId, BuildFormulaAssignment>;
  sourceCoverage: BuildSourceCoverageState;
  issueState: { active: GardenIssue[]; warnings: GardenIssue[]; history: GardenIssueHistoryRecord[] };
  acceptance: CanonicalAcceptanceDecision;
  fingerprint: string;
}
