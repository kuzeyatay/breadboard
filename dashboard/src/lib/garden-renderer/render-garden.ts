import os from "node:os";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { buildGardenPathPlan } from "../garden-build/path-plan.ts";
import type { AcceptedGardenSnapshot } from "../garden-build/snapshot.ts";
import { contentFingerprint } from "../garden-build/fingerprint.ts";
import { renderClaimProjection } from "./render-claims.ts";
import { renderConceptProjection } from "./render-concepts.ts";
import { renderContractProjection } from "./render-contract.ts";
import type { RenderedGardenManifest } from "./manifest.ts";
import { renderPageProjections, type RenderedProjection } from "./render-pages.ts";
import { renderReportProjections } from "./render-reports.ts";
import { renderSourceCoverageProjection } from "./render-source-coverage.ts";
import { renderVisualProjections } from "./render-visuals.ts";

function writeProjection(root: string, projection: RenderedProjection): void {
  const target = path.join(root, ...projection.path.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, projection.content, "utf8");
}

export async function renderAcceptedGardenSnapshot(snapshot: AcceptedGardenSnapshot, outputDir: string): Promise<RenderedGardenManifest> {
  const resolved = path.resolve(outputDir);
  if (resolved === path.parse(resolved).root) throw new Error("Refusing to render a garden into a filesystem root.");
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, ".garden-shadow-render-"));
  const paths = buildGardenPathPlan(snapshot);
  const projections: RenderedProjection[] = [
    ...renderPageProjections(snapshot, paths), renderContractProjection(snapshot), renderConceptProjection(snapshot),
    renderClaimProjection(snapshot, paths), ...renderVisualProjections(snapshot, paths), renderSourceCoverageProjection(snapshot, paths),
    ...renderReportProjections(snapshot),
  ];
  const manifest: RenderedGardenManifest = {
    buildId: snapshot.buildId, snapshotFingerprint: snapshot.fingerprint,
    files: projections.map((projection) => ({ path: projection.path, contentFingerprint: contentFingerprint(projection.content), projectionType: projection.projectionType, sourceEntityIds: [...projection.sourceEntityIds].sort() })).sort((a, b) => a.path.localeCompare(b.path)),
  };
  try {
    for (const projection of projections) writeProjection(staging, projection);
    writeProjection(staging, { path: ".breadboard/render-manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n`, projectionType: "manifest", sourceEntityIds: [snapshot.buildId] });
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.renameSync(staging, resolved);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export function makeShadowRenderTempDir(gardenSlug: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-${gardenSlug}-shadow-`));
}
