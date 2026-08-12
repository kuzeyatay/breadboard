// Filing a reconstructed mesh as a durable artifact of the chat that asked for it.
//
// Nothing new is invented here. `model` is already an artifact kind and
// `model-file` already renders a GLB in the artifact viewer's three.js panel —
// both were built for the Formsmith/ShapeR agent, and a second way to store a
// mesh is how the two would slowly stop behaving alike. This module only stages
// the bytes where the importer can verify them and records what produced them.
//
// The metadata is the part worth caring about. A single-view reconstruction is
// a guess about the sides nobody photographed, and a mesh with no record of the
// picture, the resolution and the remesher behind it is a guess that has lost
// its own provenance.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createImportedArtifact, type ArtifactRow } from "../hermes/artifact-store.ts";
import { inspectModelUpload } from "../conversations/model-inspect.ts";
import type { ModelAttachmentSummary } from "../model-attachments.ts";
import type { Sf3dRunResult } from "./service.ts";

export const IMAGE_TO_3D_TOOL = "image_to_3d";

export interface Sf3dArtifactContext {
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

export interface PublishedMesh {
  artifact: ArtifactRow;
  summary: ModelAttachmentSummary;
}

function slug(value: string): string {
  return (
    value
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .toLowerCase() || "object"
  );
}

/**
 * Read what the mesh actually turned out to be.
 *
 * Failure here is not failure of the run: a mesh that renders but whose header
 * this parser dislikes is still the thing the person asked for, so the counts
 * are simply absent rather than fatal.
 */
function summarize(mesh: Buffer): ModelAttachmentSummary {
  try {
    return inspectModelUpload(mesh, "glb");
  } catch {
    return {};
  }
}

export function publishReconstructedMesh(input: {
  context: Sf3dArtifactContext;
  result: Sf3dRunResult;
  sourceImageName: string;
}): PublishedMesh {
  const base = slug(input.sourceImageName);
  const summary = summarize(input.result.mesh);
  // The importer verifies the file it is given against the `model` kind's glTF
  // signature, so the bytes are staged in a directory this function owns and
  // then removed — the mesh never touches a workspace the model can reach.
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-sf3d-artifact-"));
  const stagedFile = path.join(stagingRoot, `${base}-3d.glb`);
  try {
    fs.writeFileSync(stagedFile, input.result.mesh, { flag: "wx" });
    const artifact = createImportedArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId: input.context.assistantMessageId,
      toolCallId: input.context.toolCallId,
      surface: input.context.surface,
      kind: "model",
      title: `3D model from ${input.sourceImageName}`.slice(0, 240),
      filename: `${base}-3d.glb`,
      authorizedRoot: stagingRoot,
      filePath: stagedFile,
      parentArtifactId: null,
      metadata: {
        imageTo3d: true,
        stableFast3d: true,
        sourceImageName: input.sourceImageName.slice(0, 200),
        device: input.result.device,
        durationSeconds: input.result.durationSeconds,
        textureResolution: input.result.options.textureResolution,
        remesh: input.result.options.remesh,
        ...(input.result.options.targetVertexCount === -1
          ? {}
          : { targetVertexCount: input.result.options.targetVertexCount }),
        backgroundRemoved: input.result.options.removeBackground,
        ...(input.result.peakMemoryMb === null ? {} : { peakMemoryMb: input.result.peakMemoryMb }),
        ...(summary.triangles === undefined ? {} : { triangles: summary.triangles }),
        ...(summary.vertices === undefined ? {} : { vertices: summary.vertices }),
        ...(summary.materials === undefined ? {} : { materials: summary.materials }),
        // Said once, here, so it travels with the file rather than only with the
        // sentence the model happened to write underneath it.
        provenanceNote:
          "Reconstructed from a single image by Stable Fast 3D; unseen surfaces are inferred.",
      },
      sourceHermesTool: IMAGE_TO_3D_TOOL,
    });
    return { artifact, summary };
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}
