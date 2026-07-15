import path from "node:path";
import type { AcceptedGardenSnapshot } from "./snapshot.ts";
import type { PageId, SectionId, SourceId, VisualId } from "./types.ts";

export interface GardenPathPlan {
  sectionPaths: Record<SectionId, string>;
  pagePaths: Record<PageId, string>;
  sourcePaths: Record<SourceId, string>;
  visualPaths: Record<VisualId, string>;
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return cleaned || "Untitled";
}

export function buildGardenPathPlan(snapshot: AcceptedGardenSnapshot): GardenPathPlan {
  const plan: GardenPathPlan = { sectionPaths: {}, pagePaths: {}, sourcePaths: {}, visualPaths: {} };
  const sections = Object.values(snapshot.state.sections).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const sectionPath = path.posix.join("learning", `${sectionIndex + 1}. ${safeSegment(section.title)}`);
    plan.sectionPaths[section.id] = sectionPath;
    const units = section.unitIds.map((id) => snapshot.state.units[id]).filter(Boolean).sort((left, right) => left.order - right.order);
    for (let pageIndex = 0; pageIndex < units.length; pageIndex += 1) {
      const unit = units[pageIndex];
      plan.pagePaths[unit.pageId] = path.posix.join(sectionPath, `${sectionIndex + 1}.${pageIndex + 1} ${safeSegment(snapshot.state.pages[unit.pageId]?.title ?? unit.title)}.md`);
    }
  }
  for (const source of Object.values(snapshot.state.sources)) plan.sourcePaths[source.id] = path.posix.join("sources", `${safeSegment(source.id)}.md`);
  for (const visual of Object.values(snapshot.state.visuals)) plan.visualPaths[visual.id] = path.posix.join(".breadboard", "visuals", `${safeSegment(visual.id)}.json`);
  return plan;
}
