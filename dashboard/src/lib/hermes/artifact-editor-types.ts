import type { PresentedArtifact } from "./artifact-types.ts";

export type ArtifactEditorMode =
  | "source"
  | "file-text"
  | "office-blocks"
  | "spreadsheet-cells"
  | "pdf";

type EditableArtifactShape = Pick<
  PresentedArtifact,
  "kind" | "renderer" | "mimeType" | "metadata" | "status"
>;

const SOURCE_RENDERERS = new Set([
  "text",
  "markdown",
  "docx",
  "pdf",
  "html",
  "code",
  "json",
  "csv",
  "presentation-html",
]);

/**
 * One shared answer for every artifact surface. Specialist binary editors win
 * first; source-owned renderers keep editing their source rather than a lossy
 * exported copy.
 */
export function artifactEditorMode(
  artifact: EditableArtifactShape,
): ArtifactEditorMode | null {
  if (artifact.status !== "ready") return null;
  if (artifact.renderer === "pdf-file") return "pdf";
  if (
    (artifact.renderer === "document-file" && artifact.mimeType.includes("wordprocessingml")) ||
    (artifact.renderer === "presentation-file" && artifact.mimeType.includes("presentationml"))
  ) {
    return "office-blocks";
  }
  if (
    artifact.renderer === "spreadsheet-file" &&
    artifact.mimeType.includes("spreadsheetml")
  ) {
    return "spreadsheet-cells";
  }
  if (
    artifact.renderer === "data-file" ||
    artifact.renderer === "text-file" ||
    artifact.renderer === "markdown-file" ||
    artifact.renderer === "html-file" ||
    (artifact.renderer === "spreadsheet-file" &&
      /^(?:text\/|application\/(?:json|csv))/i.test(artifact.mimeType)) ||
    (artifact.renderer === "code" && artifact.metadata.imported === true)
  ) {
    return "file-text";
  }
  return SOURCE_RENDERERS.has(artifact.renderer) ? "source" : null;
}

/** Standalone HTML sources can use Vvveb's visual canvas without conversion. */
export function artifactUsesVisualHtmlEditor(
  artifact: EditableArtifactShape,
): boolean {
  return artifactEditorMode(artifact) === "source" &&
    /^text\/html(?:;|$)/i.test(artifact.mimeType) &&
    (artifact.renderer === "html" || artifact.renderer === "presentation-html");
}

export interface ArtifactReviewComment {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  target?: string;
}

export interface ArtifactEditorBlock {
  anchor: string;
  kind: string;
  text: string;
  editable: boolean;
  slide?: number;
  sheet?: string;
  cell?: string;
}
