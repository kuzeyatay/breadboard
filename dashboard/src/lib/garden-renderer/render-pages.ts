import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { GardenPathPlan } from "../garden-build/path-plan.ts";

export interface RenderedProjection { path: string; content: string; projectionType: string; sourceEntityIds: string[] }

function yamlValue(value: unknown): string { return JSON.stringify(value); }

export function renderPageProjections(snapshot: AcceptedGardenSnapshot, paths: GardenPathPlan): RenderedProjection[] {
  const out: RenderedProjection[] = [];
  const orderedSections = Object.values(snapshot.state.sections).sort((a, b) => a.order - b.order);
  out.push({
    path: "learning/_index.md", projectionType: "navigation", sourceEntityIds: [snapshot.buildId, ...orderedSections.map((section) => section.id)],
    content: ["---", `title: ${yamlValue(snapshot.state.topicTitle)}`, `buildId: ${yamlValue(snapshot.buildId)}`, "---", "", `# ${snapshot.state.topicTitle}`, "", ...orderedSections.map((section) => `- [[${paths.sectionPaths[section.id]}/_index|${section.title}]]`), ""].join("\n"),
  });
  for (const section of orderedSections) {
    const sectionPath = paths.sectionPaths[section.id];
    out.push({
      path: `${sectionPath}/_index.md`, projectionType: "section", sourceEntityIds: [section.id, ...section.unitIds],
      content: `---\ntitle: ${yamlValue(section.title)}\nsectionId: ${yamlValue(section.id)}\nunitIds: ${yamlValue(section.unitIds)}\n---\n\n# ${section.title}\n\n${section.summary ?? ""}\n`,
    });
  }
  for (const page of Object.values(snapshot.state.pages).sort((a, b) => a.order - b.order)) {
    const unit = snapshot.state.units[page.unitId];
    if (!unit || !paths.pagePaths[page.id]) continue;
    const tags = [...new Set([...unit.primaryConceptIds, ...unit.supportingConceptIds].map((id) => snapshot.state.concepts[id]?.slug).filter(Boolean))];
    const sourceFormulaAnchors = unit.formulaAssignmentIds.map((id) => snapshot.state.formulaAssignments[id]).filter((entry) => entry?.status === "verified").map((entry) => entry.formulaAnchorId);
    const formulas = page.formulaEntries.map((entry) => ({ kind: entry.kind, text: entry.text, ...(entry.sourceAnchorId ? { sourceAnchor: entry.sourceAnchorId } : {}), ...(entry.basedOnFormulaAnchorId ? { basedOnFormula: entry.basedOnFormulaAnchorId } : {}), ...(entry.formulaFamily ? { formulaFamily: entry.formulaFamily } : {}), ...(entry.exampleGroupId ? { exampleGroupId: entry.exampleGroupId } : {}) }));
    const frontmatter = [
      "---", `title: ${yamlValue(page.title)}`, `pageId: ${yamlValue(page.id)}`, `learningUnitId: ${yamlValue(unit.id)}`,
      `sectionId: ${yamlValue(unit.sectionId)}`, `learningUnitRole: ${yamlValue(unit.role)}`,
      `primaryConcepts: ${yamlValue(unit.primaryConceptIds.map((id) => snapshot.state.concepts[id]?.slug).filter(Boolean))}`,
      `supportingConcepts: ${yamlValue(unit.supportingConceptIds.map((id) => snapshot.state.concepts[id]?.slug).filter(Boolean))}`,
      `tags: ${yamlValue(tags)}`, `claimIds: ${yamlValue(unit.claimIds)}`, `sourceAnchors: ${yamlValue(unit.sourceAnchorIds)}`,
      `sourceFormulaAnchors: ${yamlValue(sourceFormulaAnchors)}`, `sourceVisualIds: ${yamlValue(unit.sourceVisualAnchorIds)}`,
      `visuals: ${yamlValue(page.embeddedVisualIds)}`, `formulas: ${yamlValue(formulas)}`, "---", "",
    ].join("\n");
    out.push({ path: paths.pagePaths[page.id], content: `${frontmatter}${page.body.replace(/^\s+/, "").replace(/\s*$/, "")}\n`, projectionType: "page", sourceEntityIds: [page.id, unit.id, unit.sectionId, ...unit.claimIds, ...unit.formulaAssignmentIds] });
  }
  return out;
}
