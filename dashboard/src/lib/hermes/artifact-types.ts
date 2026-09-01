export const ARTIFACT_STATUSES = ["draft", "generating", "ready", "failed", "archived"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/**
 * New kinds are appended rather than inserted in place: this list is mirrored by a
 * CHECK constraint on `hermes_artifacts.kind`, and the migration that widens
 * that constraint on an existing database appends to the same list. Keeping the
 * two in the same order lets them be read as one fact.
 */
export const ARTIFACT_KINDS = [
  "text", "markdown", "document", "pdf", "presentation", "spreadsheet",
  "html", "code", "image", "audio", "video", "diagram", "data", "unknown",
  "gadget",
  "model",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type ArtifactRendererId =
  | "text"
  | "markdown"
  | "docx"
  | "pdf"
  | "html"
  | "code"
  | "json"
  | "csv"
  | "presentation-html"
  | "svg"
  | "pdf-file"
  | "image-file"
  | "audio-file"
  | "video-file"
  | "document-file"
  | "presentation-file"
  | "spreadsheet-file"
  | "diagram-file"
  | "data-file"
  | "model-file"
  | "archive-file"
  | "text-file"
  | "markdown-file"
  | "html-file"
  | "interactive-visualizer"
  | "hardware-blueprint"
  | "parametric-cad"
  | "vimax-production"
  | "vox-director-production"
  | "socials-manager-post"
  | "gadget";

export const ARTIFACT_EVENT_TYPES = [
  "artifact.created",
  "artifact.updated",
  "artifact.rendering",
  "artifact.preview_ready",
  "artifact.completed",
  "artifact.failed",
  "artifact.version_created",
  "interactive_visualizer_planning",
  "interactive_visualizer_generating",
  "interactive_visualizer_validating",
  "interactive_visualizer_building",
  "interactive_visualizer_browser_testing",
  "interactive_visualizer_repairing",
  "interactive_visualizer_ready",
  "interactive_visualizer_failed",
  "interactive_visualizer_cancelled",
  "gadget_generating",
  "gadget_validating",
  "gadget_ready",
  "gadget_failed",
  "gadget_revised",
  // The approval queue's own lifecycle. These ride the artifact event stream so
  // an open chat learns that a gadget is waiting on the user without polling.
  "gadget_action_submitted",
  "gadget_action_approved",
  "gadget_action_rejected",
  "gadget_action_applied",
  "gadget_action_apply_failed",
  "gadget_action_reverted",
] as const;
export type ArtifactEventType = (typeof ARTIFACT_EVENT_TYPES)[number];

export interface PresentedArtifact {
  id: string;
  conversationId: string;
  gardenId: string | null;
  runId: string;
  assistantMessageId: string | null;
  toolCallId: string | null;
  kind: ArtifactKind;
  renderer: string;
  title: string;
  filename: string;
  mimeType: string;
  status: ArtifactStatus;
  version: number;
  parentArtifactId: string | null;
  sourceSkill: string | null;
  sourceMcpServer: string | null;
  sourceMcpTool: string | null;
  sourceHermesTool: string | null;
  previewAvailable: boolean;
  downloadAvailable: boolean;
  byteSize: number | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  /** A palette slug from lib/conversations/highlights, or null for unmarked. */
  highlight: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresentedArtifactEvent {
  id: number;
  type: ArtifactEventType;
  artifactId: string;
  runId: string;
  conversationId: string;
  gardenId: string | null;
  assistantMessageId: string | null;
  status: ArtifactStatus;
  version: number;
  timestamp: string;
  payload: Record<string, unknown>;
}
