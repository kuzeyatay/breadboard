import type { GardenBuildStage } from "./types.ts";

export type GardenIssueSeverity = "blocking" | "warning" | "diagnostic";

export type GardenIssueRepairClass =
  | "deterministic"
  | "model"
  | "deterministic_then_model"
  | "projection_bug"
  | "non_repairable";

export interface GardenIssueTarget {
  sourceId?: string;
  anchorId?: string;
  formulaAnchorId?: string;
  formulaAssignmentId?: string;
  sectionId?: string;
  unitId?: string;
  pageId?: string;
  conceptId?: string;
  claimId?: string;
  visualId?: string;
  visualIntentId?: string;
}

export interface GardenIssueBase {
  issueId: string;
  type: string;
  severity: GardenIssueSeverity;
  repairClass: GardenIssueRepairClass;
  stage: GardenBuildStage;
  target: GardenIssueTarget;
  evidence: Record<string, unknown>;
  detectedBy: string[];
}

type Issue<TType extends string, TEvidence extends Record<string, unknown> = Record<string, unknown>> =
  GardenIssueBase & { type: TType; evidence: TEvidence };

export type MissingSourceAnchorIssue = Issue<"missing_source_anchor", { missingAnchorId: string; [key: string]: unknown }>;
export type WeakSourceAnchorIssue = Issue<"weak_source_anchor", { failureReason: string; [key: string]: unknown }>;
export type SourceAnchorRelevanceIssue = Issue<"source_anchor_relevance", { decision?: string; [key: string]: unknown }>;
export type FormulaIdentityIssue = Issue<"formula_identity", { semanticCategory: string; [key: string]: unknown }>;

export interface FormulaAssignmentMismatchIssue extends GardenIssueBase {
  type: "formula_assignment_family_mismatch";
  target: GardenIssueTarget & { formulaAnchorId: string; unitId: string; pageId?: string };
  evidence: {
    verifiedFormulaFamily: string;
    requiredFamilies: string[];
    acceptedRelatedFamilies: string[];
    compatibilityScore?: number;
    [key: string]: unknown;
  };
}

export type FormulaUsageProjectionIssue = Issue<"formula_usage_projection", { semanticCategory?: string; [key: string]: unknown }>;
export type FormulaLineageIssue = Issue<"formula_lineage", { semanticCategory?: string; [key: string]: unknown }>;
export type FormulaLineageMissingIssue = Issue<"formula_lineage_missing", { semanticCategory?: string; [key: string]: unknown }>;
export type UnitPageMappingIssue = Issue<"unit_page_mapping", { semanticCategory?: string; [key: string]: unknown }>;
export type TagProjectionIssue = Issue<"tag_projection", { semanticCategory?: string; [key: string]: unknown }>;
export type TagProjectionMismatchIssue = Issue<"tag_projection_mismatch", { semanticCategory?: string; [key: string]: unknown }>;
export type ClaimMappingIssue = Issue<"claim_page_mapping", { semanticCategory?: string; [key: string]: unknown }>;
export type ConceptReferenceIssue = Issue<"concept_reference", { semanticCategory?: string; [key: string]: unknown }>;
export type VisualGroundingIssue = Issue<"visual_grounding", { semanticCategory?: string; [key: string]: unknown }>;
export type MissingPlannedVisualIssue = Issue<"missing_planned_visual", { semanticCategory?: string; [key: string]: unknown }>;
export type VisualTypeMismatchIssue = Issue<"visual_type_mismatch", { expectedTypes?: string[]; actualType?: string; semanticCategory?: string; [key: string]: unknown }>;
export type DuplicateVisualSignatureIssue = Issue<"duplicate_visual_signature", { visualIds?: string[]; pageIds?: string[]; semanticCategory?: string; [key: string]: unknown }>;
export type VisualGroundingMismatchIssue = Issue<"visual_grounding_mismatch", { semanticCategory?: string; [key: string]: unknown }>;
export type ContractPageAnchorMismatchIssue = Issue<"contract_page_anchor_mismatch", { semanticCategory?: string; [key: string]: unknown }>;
export type SectionSemanticIssue = Issue<"section_semantic", { semanticCategory?: string; [key: string]: unknown }>;
export type SectionSemanticMismatchIssue = Issue<"section_semantic_mismatch", { unitIds?: string[]; semanticCategory?: string; [key: string]: unknown }>;
export type ScaffoldProseIssue = Issue<"scaffold_prose", { semanticCategory?: string; [key: string]: unknown }>;
export type RepeatedOpeningIssue = Issue<"repeated_opening", { semanticCategory?: string; [key: string]: unknown }>;
export type CriticSemanticIssue = Issue<"critic_semantic", { semanticCategory?: string; [key: string]: unknown }>;
export type ReportSerializationIssue = Issue<"report_serialization", { semanticCategory?: string; [key: string]: unknown }>;
export type IllegalStageMutationIssue = Issue<"illegal_stage_mutation", { field: string; operationType?: string; [key: string]: unknown }>;

export type ProjectionIntegrityIssue = Issue<
  | "projection_missing_file"
  | "projection_content_mismatch"
  | "projection_reference_mismatch"
  | "projection_manifest_mismatch"
  | "projection_report_mismatch",
  { projectionType?: string; semanticCategory?: string; [key: string]: unknown }
> & { repairClass: "projection_bug" };

export type GardenIssue =
  | MissingSourceAnchorIssue
  | WeakSourceAnchorIssue
  | SourceAnchorRelevanceIssue
  | FormulaIdentityIssue
  | FormulaAssignmentMismatchIssue
  | FormulaUsageProjectionIssue
  | FormulaLineageIssue
  | FormulaLineageMissingIssue
  | UnitPageMappingIssue
  | TagProjectionIssue
  | TagProjectionMismatchIssue
  | ClaimMappingIssue
  | ConceptReferenceIssue
  | VisualGroundingIssue
  | MissingPlannedVisualIssue
  | VisualTypeMismatchIssue
  | DuplicateVisualSignatureIssue
  | VisualGroundingMismatchIssue
  | ContractPageAnchorMismatchIssue
  | SectionSemanticIssue
  | SectionSemanticMismatchIssue
  | ScaffoldProseIssue
  | RepeatedOpeningIssue
  | ProjectionIntegrityIssue
  | CriticSemanticIssue
  | ReportSerializationIssue
  | IllegalStageMutationIssue;

export interface GardenIssueHistoryRecord {
  issueId: string;
  revision: number;
  status: "detected" | "resolved" | "superseded";
  issue: GardenIssue;
}

export interface GardenIssueMigrationMetrics {
  totalIssues: number;
  typedAtSource: number;
  producedByLegacyAdapter: number;
}

export function gardenIssueMigrationMetrics(issues: readonly GardenIssue[]): GardenIssueMigrationMetrics {
  const producedByLegacyAdapter = issues.filter((issue) => issue.evidence.legacyStringAdapter === true).length;
  return { totalIssues: issues.length, typedAtSource: issues.length - producedByLegacyAdapter, producedByLegacyAdapter };
}
