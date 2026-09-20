import type Database from "better-sqlite3";
import type { ArtifactRow, ArtifactVersionRow } from "./artifact-store.ts";

/** Every delivered file remains discoverable, including before a failed revision. */
export function artifactsForArchive(artifacts: ArtifactRow[], database: Database.Database): ArtifactRow[] {
  if (!artifacts.length) return [];
  const versions = database.prepare(`
    SELECT * FROM hermes_artifact_versions
    WHERE artifact_id IN (${artifacts.map(() => "?").join(",")})
      AND status = 'ready'
    ORDER BY updated_at DESC, version DESC
  `).all(...artifacts.map(item => item.id)) as ArtifactVersionRow[];
  const byId = new Map<string, ArtifactVersionRow[]>();
  for (const version of versions) {
    const entries = byId.get(version.artifact_id) ?? [];
    entries.push(version);
    byId.set(version.artifact_id, entries);
  }
  return artifacts.flatMap(artifact => {
    const ready = byId.get(artifact.id);
    if (!ready?.length) return [artifact];
    return ready.map(version => {
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(version.metadata_json); } catch { /* Legacy metadata. */ }
      const manifest = (metadata.interactiveVisualizer as { manifest?: { title?: string } } | undefined)?.manifest;
      return {
        ...artifact,
        current_version: version.version,
        title: manifest?.title || artifact.title,
        status: "ready" as const,
        preview_location: version.preview_location,
        output_location: version.output_location,
        mime_type: version.mime_type,
        byte_size: version.byte_size,
        content_hash: version.content_hash,
        metadata_json: version.metadata_json,
        error_json: null,
        updated_at: version.updated_at,
      };
    });
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.current_version - a.current_version);
}
