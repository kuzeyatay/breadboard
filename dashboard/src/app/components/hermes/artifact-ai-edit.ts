import type { PresentedArtifact } from "@/lib/hermes/artifact-types";

export const ARTIFACT_AI_EDIT_EVENT = "breadboard:artifact-ai-edit";
const HANDOFF_KEY = "breadboard:artifact-ai-edit-handoff:v1";

export type ArtifactAiEditTarget = Pick<
  PresentedArtifact,
  "id" | "title" | "conversationId" | "gardenId" | "renderer" | "sourceSkill"
>;

export interface ArtifactAiEditDetail {
  artifact: ArtifactAiEditTarget;
  prompt: string;
}

export function dispatchArtifactAiEdit(detail: ArtifactAiEditDetail): void {
  window.dispatchEvent(new CustomEvent(ARTIFACT_AI_EDIT_EVENT, { detail }));
}

/** Queue a handoff across a full-page editor navigation (notably PDF.js). */
export function queueArtifactAiEdit(detail: ArtifactAiEditDetail): void {
  sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(detail));
}

export function consumeArtifactAiEdit(
  scope: { conversationId?: string | null; gardenId?: string | null },
): ArtifactAiEditDetail | null {
  let parsed: ArtifactAiEditDetail;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw) as ArtifactAiEditDetail;
  } catch {
    sessionStorage.removeItem(HANDOFF_KEY);
    return null;
  }
  if (
    !parsed?.artifact?.id ||
    typeof parsed.prompt !== "string" ||
    (scope.conversationId && parsed.artifact.conversationId !== scope.conversationId) ||
    (scope.gardenId && parsed.artifact.gardenId !== scope.gardenId)
  ) return null;
  sessionStorage.removeItem(HANDOFF_KEY);
  return parsed;
}
