import type { ConceptId, FormulaAssignmentId, GardenBuildState, LearningUnitId, PageId, SectionId, SourceAnchorId, VisualId } from "./types.ts";

export interface GardenBuildIndexes {
  pageIdByUnitId: Record<LearningUnitId, PageId>;
  unitIdByPageId: Record<PageId, LearningUnitId>;
  sectionUnitIds: Record<SectionId, LearningUnitId[]>;
  claimIdsByPageId: Record<PageId, string[]>;
  conceptIdsByPageId: Record<PageId, ConceptId[]>;
  anchorIdsByUnitId: Record<LearningUnitId, SourceAnchorId[]>;
  visualIdsByPageId: Record<PageId, VisualId[]>;
  formulaAssignmentIdsByUnitId: Record<LearningUnitId, FormulaAssignmentId[]>;
}

export function buildGardenBuildIndexes(state: GardenBuildState): GardenBuildIndexes {
  const indexes: GardenBuildIndexes = {
    pageIdByUnitId: {}, unitIdByPageId: {}, sectionUnitIds: {}, claimIdsByPageId: {},
    conceptIdsByPageId: {}, anchorIdsByUnitId: {}, visualIdsByPageId: {}, formulaAssignmentIdsByUnitId: {},
  };
  for (const unit of Object.values(state.units)) {
    indexes.pageIdByUnitId[unit.id] = unit.pageId;
    indexes.unitIdByPageId[unit.pageId] = unit.id;
    indexes.anchorIdsByUnitId[unit.id] = [...unit.sourceAnchorIds];
    indexes.formulaAssignmentIdsByUnitId[unit.id] = [...unit.formulaAssignmentIds];
  }
  for (const section of Object.values(state.sections)) indexes.sectionUnitIds[section.id] = [...section.unitIds];
  for (const claim of Object.values(state.claims)) (indexes.claimIdsByPageId[claim.pageId] ??= []).push(claim.id);
  for (const page of Object.values(state.pages)) {
    const unit = state.units[page.unitId];
    indexes.conceptIdsByPageId[page.id] = unit ? [...new Set([...unit.primaryConceptIds, ...unit.supportingConceptIds])].sort() : [];
  }
  for (const visual of Object.values(state.visuals)) if (visual.pageId) (indexes.visualIdsByPageId[visual.pageId] ??= []).push(visual.id);
  for (const map of [indexes.claimIdsByPageId, indexes.visualIdsByPageId] as Record<string, string[]>[]) {
    for (const values of Object.values(map)) values.sort();
  }
  return indexes;
}
