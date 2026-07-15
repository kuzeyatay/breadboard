import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import type { GardenPathPlan } from "../garden-build/path-plan.ts";
import type { RenderedProjection } from "./render-pages.ts";

export function renderVisualProjections(snapshot: AcceptedGardenSnapshot, paths: GardenPathPlan): RenderedProjection[] {
  return Object.values(snapshot.state.visuals).filter((visual) => visual.status !== "historical").map((visual) => ({
    path: paths.visualPaths[visual.id], projectionType: "visual", sourceEntityIds: [visual.id, ...(visual.pageId ? [visual.pageId] : []), ...visual.sourceAnchorIds, ...visual.textAnchorIds],
    content: `${JSON.stringify({ id: visual.id, type: visual.type, pageId: visual.pageId ? paths.pagePaths[visual.pageId]?.replace(/\.md$/i, "") : undefined, canonicalPageId: visual.pageId, learningUnitId: visual.unitId, sourceAnchors: visual.sourceAnchorIds, textAnchors: visual.textAnchorIds, status: visual.status, body: visual.body }, null, 2)}\n`,
  }));
}
