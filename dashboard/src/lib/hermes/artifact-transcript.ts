import type Database from "better-sqlite3";
import type { ArtifactRow, ArtifactVersionRow } from "./artifact-store.ts";

interface PublishedReplyVersion extends ArtifactVersionRow {
  assistant_message_id: number;
  run_id: string;
  published_at: string;
}

/**
 * Project authorized visualizers onto the replies that published them. The
 * artifact archive remains mutable, but an earlier reply must keep its own
 * version when a later reply revises the same artifact. Publication events
 * also recover these associations for conversations saved before this view.
 */
export function artifactsForTranscript(
  artifacts: ArtifactRow[],
  database: Database.Database,
): ArtifactRow[] {
  const visualizers = artifacts.filter((artifact) =>
    artifact.renderer_id === "interactive-visualizer" && artifact.status !== "archived",
  );
  if (visualizers.length === 0) return artifacts;

  const publications = database.prepare(`
    SELECT v.*, e.assistant_message_id, e.run_id, e.created_at AS published_at
    FROM hermes_artifact_events e
    JOIN hermes_artifact_versions v
      ON v.artifact_id = e.artifact_id AND v.version = e.version
    JOIN hermes_artifacts a ON a.id = e.artifact_id
    JOIN conversation_messages m ON m.id = e.assistant_message_id
      AND m.conversation_id = a.conversation_id AND m.role = 'assistant'
    WHERE e.artifact_id IN (${visualizers.map(() => "?").join(",")})
      AND e.conversation_id = a.conversation_id
      AND e.event_type = 'artifact.completed' AND e.status = 'ready'
      AND v.status = 'ready'
    ORDER BY e.id DESC
  `).all(...visualizers.map((artifact) => artifact.id)) as PublishedReplyVersion[];

  const byArtifact = new Map<string, Map<number, PublishedReplyVersion>>();
  for (const publication of publications) {
    let replies = byArtifact.get(publication.artifact_id);
    if (!replies) byArtifact.set(publication.artifact_id, replies = new Map());
    // A reply can repair, republish, or roll back. Use its last successful
    // publication, not the greatest version or a failed candidate's event.
    if (!replies.has(publication.assistant_message_id)) {
      replies.set(publication.assistant_message_id, publication);
    }
  }

  return artifacts.flatMap((artifact) => {
    const replies = byArtifact.get(artifact.id);
    if (!replies?.size) return [artifact];
    return Array.from(replies.values(), (version) => {
      let title = artifact.title;
      try {
        const metadata = JSON.parse(version.metadata_json);
        const versionTitle = metadata?.interactiveVisualizer?.manifest?.title;
        if (typeof versionTitle === "string" && versionTitle.trim()) title = versionTitle;
      } catch { /* Legacy versions may not have structured metadata. */ }
      return {
        ...artifact,
        originating_message_id: version.assistant_message_id,
        presentation_message_id: version.assistant_message_id,
        originating_run_id: version.run_id,
        current_version: version.version,
        title,
        status: version.status,
        preview_location: version.preview_location,
        output_location: version.output_location,
        mime_type: version.mime_type,
        byte_size: version.byte_size,
        content_hash: version.content_hash,
        metadata_json: version.metadata_json,
        error_json: version.error_json,
        created_at: version.created_at,
        updated_at: version.published_at,
      };
    });
  });
}
