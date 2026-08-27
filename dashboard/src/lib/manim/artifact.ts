import { createImportedArtifact, type ArtifactRow } from "../hermes/artifact-store.ts";
import type { ManimRuntimeResult } from "../runtime-v2/manim-job.ts";
import { MANIM_SKILL, MANIM_TOOL } from "./identity.ts";

export interface ManimArtifactContext {
  userId: number;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  assistantMessageId: number | null;
  toolCallId: string | null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "animation";
}

export async function publishManimVideo(input: {
  context: ManimArtifactContext;
  result: ManimRuntimeResult;
}): Promise<ArtifactRow> {
  const filename = `${slug(input.result.title)}-manim.mp4`;
  return await createImportedArtifact({
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    toolCallId: input.context.toolCallId,
    surface: input.context.surface,
    kind: "video",
    title: input.result.title,
    filename,
    authorizedRoot: input.result.videoRoot,
    filePath: input.result.videoPath,
    parentArtifactId: null,
    metadata: {
      manim: true,
      manimCommunity: true,
      sourceSkill: MANIM_SKILL,
      sceneName: input.result.sceneName,
      description: input.result.description,
      quality: input.result.quality,
      runtimeImage: input.result.image,
      renderDurationSeconds: input.result.durationSeconds,
      sourceHash: input.result.sourceHash,
    },
    sourceSkill: MANIM_SKILL,
    sourceHermesTool: MANIM_TOOL,
  });
}
