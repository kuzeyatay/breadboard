export interface RenderedGardenManifest {
  buildId: string;
  snapshotFingerprint: string;
  files: { path: string; contentFingerprint: string; projectionType: string; sourceEntityIds: string[] }[];
}
