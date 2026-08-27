import {
  readSf3dConfig,
  REMESH_OPTIONS,
  TEXTURE_RESOLUTIONS,
  type RemeshOption,
  type TextureResolution,
} from "./config.ts";

export class Sf3dServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Sf3dServiceError";
    this.code = code;
  }
}

export interface Sf3dRunOptions {
  textureResolution: TextureResolution;
  remesh: RemeshOption;
  /** -1 leaves the mesh at whatever the remesher produced. */
  targetVertexCount: number;
  /** Skip foreground matting only when the input is already a clean cutout. */
  removeBackground: boolean;
}

/**
 * Validate the public tool options without importing the worker-only process
 * implementation into Next.js.
 */
export function parseSf3dOptions(args: Record<string, unknown>): Sf3dRunOptions {
  const config = readSf3dConfig();

  const rawResolution = args.textureResolution;
  let textureResolution = config.textureResolution;
  if (rawResolution !== undefined && rawResolution !== null) {
    if (!(TEXTURE_RESOLUTIONS as readonly unknown[]).includes(rawResolution)) {
      throw new Sf3dServiceError(
        "sf3d_invalid_arguments",
        `textureResolution must be one of ${TEXTURE_RESOLUTIONS.join(", ")}.`,
      );
    }
    textureResolution = rawResolution as TextureResolution;
  }

  const rawRemesh = args.remesh;
  let remesh = config.remesh;
  if (rawRemesh !== undefined && rawRemesh !== null) {
    if (
      typeof rawRemesh !== "string" ||
      !(REMESH_OPTIONS as readonly string[]).includes(rawRemesh)
    ) {
      throw new Sf3dServiceError(
        "sf3d_invalid_arguments",
        `remesh must be one of ${REMESH_OPTIONS.join(", ")}.`,
      );
    }
    remesh = rawRemesh as RemeshOption;
  }

  const rawVertices = args.targetVertexCount;
  let targetVertexCount = -1;
  if (rawVertices !== undefined && rawVertices !== null) {
    if (
      !Number.isInteger(rawVertices) ||
      (Number(rawVertices) !== -1 &&
        (Number(rawVertices) < 200 || Number(rawVertices) > 500_000))
    ) {
      throw new Sf3dServiceError(
        "sf3d_invalid_arguments",
        "targetVertexCount must be -1, or an integer from 200 to 500000.",
      );
    }
    targetVertexCount = Number(rawVertices);
  }
  if (targetVertexCount !== -1 && remesh === "none") remesh = "triangle";

  return {
    textureResolution,
    remesh,
    targetVertexCount,
    removeBackground: args.removeBackground !== false,
  };
}
