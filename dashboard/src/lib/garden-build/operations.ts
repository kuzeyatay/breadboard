import type { BuildClaim, BuildFormulaAssignment, BuildFormulaEntry, ConceptId, GardenBuildState, LearningUnitId, PageId, SectionId, SourceAnchorId, VisualId } from "./types.ts";

export interface ReplaceSourceAnchorOperation { type: "replace_source_anchor"; oldAnchorId: SourceAnchorId; newAnchorId: SourceAnchorId; justification: string }
export interface UpdateSourceAnchorEvidenceOperation { type: "update_source_anchor_evidence"; anchorId: SourceAnchorId; patch: Record<string, unknown>; justification: string }
export interface SetFormulaAssignmentOperation { type: "set_formula_assignment"; formulaAssignment: BuildFormulaAssignment; expectedUnitId: LearningUnitId; expectedPageId: PageId; justification: string }
export interface RemoveFormulaAssignmentOperation { type: "remove_formula_assignment"; formulaAssignmentId: string; justification: string }
export interface SetFormulaLineageOperation { type: "set_formula_lineage"; pageId: PageId; entryIndex: number; basedOnFormulaAnchorId: SourceAnchorId; formulaFamily?: string; justification: string }
export interface ReclassifyFormulaEntryOperation { type: "reclassify_formula_entry"; pageId: PageId; entryIndex: number; kind: string; justification: string }
export interface SetUnitConceptsOperation { type: "set_unit_concepts"; unitId: LearningUnitId; primaryConceptIds: ConceptId[]; supportingConceptIds: ConceptId[]; prerequisiteConceptIds?: ConceptId[]; justification: string }
export interface ReplaceClaimsOperation { type: "replace_claims"; unitId: LearningUnitId; claims: BuildClaim[]; justification: string }
export interface SetPageBodyOperation { type: "set_page_body"; pageId: PageId; body: string; justification: string }
export interface SetPageFormulaEntriesOperation { type: "set_page_formula_entries"; pageId: PageId; formulaEntries: BuildFormulaEntry[]; justification: string }
export interface SetVisualGroundingOperation { type: "set_visual_grounding"; visualId: VisualId; pageId?: PageId; unitId?: LearningUnitId; sourceAnchorIds: SourceAnchorId[]; textAnchorIds: SourceAnchorId[]; status: "grounded" | "omitted" | "unresolved" | "historical"; justification: string }
export interface SetVisualTypeOperation { type: "set_visual_type"; visualId: VisualId; visualType: string; justification: string }
export interface SetVisualBodyOperation { type: "set_visual_body"; visualId: VisualId; body: string; justification: string }
export interface ReplacePageVisualBlockOperation { type: "replace_page_visual_block"; pageId: PageId; visualId: VisualId; block: string; justification: string }
export interface RemovePageVisualOperation { type: "remove_page_visual"; pageId: PageId; visualId: VisualId; justification: string }
export interface RenameSectionOperation { type: "rename_section"; sectionId: SectionId; title: string; justification: string }
export interface MoveUnitToSectionOperation { type: "move_unit_to_section"; unitId: LearningUnitId; fromSectionId: SectionId; toSectionId: SectionId; justification: string }
export interface MarkEntityHistoricalOperation { type: "mark_entity_historical"; entityType: "sourceAnchor" | "unit" | "claim" | "visual" | "formulaAssignment"; entityId: string; justification: string }

export type GardenBuildOperation =
  | ReplaceSourceAnchorOperation | UpdateSourceAnchorEvidenceOperation | SetFormulaAssignmentOperation
  | RemoveFormulaAssignmentOperation | SetFormulaLineageOperation | ReclassifyFormulaEntryOperation
  | SetUnitConceptsOperation | ReplaceClaimsOperation | SetPageBodyOperation | SetPageFormulaEntriesOperation
  | SetVisualGroundingOperation | SetVisualTypeOperation | SetVisualBodyOperation | ReplacePageVisualBlockOperation
  | RemovePageVisualOperation | RenameSectionOperation | MoveUnitToSectionOperation | MarkEntityHistoricalOperation;

export function operationMutatedFields(operation: GardenBuildOperation): (keyof GardenBuildState)[] {
  switch (operation.type) {
    case "replace_source_anchor": return ["sourceAnchors", "units", "claims", "visuals", "formulaAssignments", "sourceCoverage"];
    case "update_source_anchor_evidence": return ["sourceAnchors"];
    case "set_formula_assignment": case "remove_formula_assignment": return ["formulaAssignments", "units"];
    case "set_formula_lineage": case "reclassify_formula_entry": case "set_page_body": case "set_page_formula_entries": return ["pages"];
    case "set_unit_concepts": return ["units"];
    case "replace_claims": return ["claims", "units"];
    case "set_visual_grounding": return ["visuals", "pages", "units"];
    case "set_visual_type": case "set_visual_body": return ["visuals"];
    case "replace_page_visual_block": case "remove_page_visual": return ["pages", "visuals", "units"];
    case "rename_section": return ["sections"];
    case "move_unit_to_section": return ["sections", "units", "pages"];
    case "mark_entity_historical": return ["sourceAnchors", "units", "claims", "visuals", "formulaAssignments"];
  }
}
