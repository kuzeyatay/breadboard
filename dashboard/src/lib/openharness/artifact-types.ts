export const ARTIFACT_STATUSES = ["draft", "generating", "ready", "failed", "archived"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const ARTIFACT_KINDS = [
  "text", "markdown", "document", "pdf", "presentation", "spreadsheet",
  "html", "code", "image", "audio", "video", "diagram", "data", "unknown",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type ArtifactRendererId = "text" | "markdown" | "docx" | "pdf" | "html";

export const ARTIFACT_EVENT_TYPES = [
  "artifact.created",
  "artifact.updated",
  "artifact.rendering",
  "artifact.preview_ready",
  "artifact.completed",
  "artifact.failed",
  "artifact.version_created",
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
  sourceOpenHarnessTool: string | null;
  previewAvailable: boolean;
  downloadAvailable: boolean;
  byteSize: number | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
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
