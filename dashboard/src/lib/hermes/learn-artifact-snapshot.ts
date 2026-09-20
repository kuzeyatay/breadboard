import { createHash } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { artifactDeliveryFile, getArtifactVersion, readArtifactSource, presentArtifact, ArtifactStoreError, type ArtifactRow } from "./artifact-store.ts";
import { artifactEditorMode } from "./artifact-editor-types.ts";
import type { LearnArtifact } from "../learn-artifacts.ts";

/** Read source and rendered content without running an artifact's scripts. */
export async function snapshotArtifactForLearn(artifact: ArtifactRow, version: number): Promise<LearnArtifact> {
  const stored = getArtifactVersion(artifact.id, version);
  if (stored.status !== "ready") throw new ArtifactStoreError(409, "artifact_version_not_ready", "Choose a completed artifact version for Learn.");
  const versioned = { ...artifact, status: stored.status, current_version: version,
    metadata_json: stored.metadata_json, mime_type: stored.mime_type,
    preview_location: stored.preview_location, output_location: stored.output_location };
  const presented = presentArtifact(versioned);
  const file = artifactDeliveryFile(artifact, version);
  const source = readArtifactSource(artifact, version);
  let content = source;
  const textual = /^(text\/|application\/(json|javascript|xml))|image\/svg\+xml/i.test(file.mimeType) ||
    ["html", "code", "markdown", "text", "data"].includes(artifact.kind);
  if (textual && file.byteSize <= 5 * 1024 * 1024) {
    const rendered = fs.readFileSync(file.absolutePath, "utf8");
    if (rendered !== source) content += `\n\nRendered file (${file.filename}):\n${rendered}`;
  } else if (["document", "pdf", "presentation", "spreadsheet"].includes(artifact.kind) && artifactEditorMode(presented)) {
    const { loadArtifactEditor } = await import("./artifact-document-editor.ts");
    const payload = await loadArtifactEditor(versioned);
    const extracted = typeof payload.content === "string" ? payload.content
      : payload.blocks?.map(block => block.text).join("\n\n");
    if (extracted) content += `\n\nDocument contents:\n${extracted}`;
  }
  const query = new URLSearchParams({ conversationId: artifact.conversation_public_id!, version: String(version) });
  const base = `/api/hermes/artifacts/${encodeURIComponent(artifact.id)}`;
  const manifest = (presented.metadata.interactiveVisualizer as { manifest?: { title?: string } } | undefined)?.manifest;
  return {
    id: artifact.id, conversationId: artifact.conversation_public_id!, version,
    title: manifest?.title || artifact.title, kind: artifact.kind, renderer: artifact.renderer_id, filename: artifact.filename,
    content, contentHash: createHash("sha256").update(content).digest("hex"),
    previewUrl: stored.preview_location ? `${base}/preview?${query}` : null,
    downloadUrl: `${base}/download?${query}`,
  };
}
