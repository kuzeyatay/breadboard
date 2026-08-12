// One image in, one GLB out.
//
// The bridge writes into a temporary directory that this module owns and
// removes; nothing SF3D produces is left behind, and no path the model chose is
// ever passed through. The mesh is returned as bytes, because what it becomes —
// an artifact, in this case — is not this module's decision.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_INPUT_IMAGE_BYTES,
  MAX_OUTPUT_MESH_BYTES,
  readSf3dConfig,
  REMESH_OPTIONS,
  TEXTURE_RESOLUTIONS,
  type RemeshOption,
  type Sf3dConfig,
  type TextureResolution,
} from "./config.ts";
import { sf3dStatus } from "./runtime.ts";

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
  /**
   * SF3D reconstructs a foreground, so an image with a background is matted
   * first. Turned off only for an input that is already a clean cutout, where
   * running the matter again can eat thin geometry.
   */
  removeBackground: boolean;
}

export interface Sf3dRunResult {
  mesh: Buffer;
  device: string;
  durationSeconds: number;
  peakMemoryMb: number | null;
  options: Sf3dRunOptions;
}

/**
 * Read the tool's arguments into a run. Everything is bounded here rather than
 * in the route, so the one place that knows what SF3D accepts is the one place
 * that decides what a caller may ask for.
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
    if (typeof rawRemesh !== "string" || !(REMESH_OPTIONS as readonly string[]).includes(rawRemesh)) {
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
      (Number(rawVertices) !== -1 && (Number(rawVertices) < 200 || Number(rawVertices) > 500_000))
    ) {
      throw new Sf3dServiceError(
        "sf3d_invalid_arguments",
        "targetVertexCount must be -1, or an integer from 200 to 500000.",
      );
    }
    targetVertexCount = Number(rawVertices);
  }
  // The remesher is what a vertex target is expressed through; without one the
  // number would be silently ignored, which reads as the tool lying about what
  // it did.
  if (targetVertexCount !== -1 && remesh === "none") remesh = "triangle";

  return {
    textureResolution,
    remesh,
    targetVertexCount,
    removeBackground: args.removeBackground !== false,
  };
}

interface BridgeResult {
  ok?: boolean;
  code?: string;
  message?: string;
  outputPath?: string;
  byteSize?: number;
  device?: string;
  durationSeconds?: number;
  peakMemoryMb?: number | null;
}

function spawnBridge(input: {
  config: Sf3dConfig;
  imagePath: string;
  outputPath: string;
  options: Sf3dRunOptions;
  signal?: AbortSignal;
}): Promise<BridgeResult> {
  const { config, options } = input;
  const args = [
    config.bridgeScript,
    "--image", input.imagePath,
    "--output", input.outputPath,
    "--pretrained-model", config.pretrainedModel,
    "--texture-resolution", String(options.textureResolution),
    "--remesh", options.remesh,
    "--target-vertex-count", String(options.targetVertexCount),
    ...(config.device ? ["--device", config.device] : []),
    ...(options.removeBackground ? [] : ["--no-remove-background"]),
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(config.pythonExecutable, args, {
      cwd: config.cloneRoot,
      env: {
        ...process.env,
        SF3D_ROOT: config.cloneRoot,
        PYTHONIOENCODING: "utf-8",
        // Progress bars in a captured pipe are noise that can outweigh the
        // result; the weights download is reported by duration instead.
        HF_HUB_DISABLE_PROGRESS_BARS: "1",
        ...(config.huggingFaceToken ? { HF_TOKEN: config.huggingFaceToken } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      ...(input.signal ? { signal: input.signal } : {}),
    });

    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(
          new Sf3dServiceError(
            "sf3d_timeout",
            "The reconstruction did not finish in time. The first run also downloads the model weights; try again once they are cached.",
          ),
        );
      }
    }, config.runTimeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 256 * 1024) stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Kept only to explain a failure; the tail is where the traceback ends up.
      stderr = `${stderr}${chunk}`.slice(-8 * 1024);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        new Sf3dServiceError(
          "sf3d_launch_failed",
          `The Stable Fast 3D runtime could not be started: ${error.message}`,
        ),
      );
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const line = stdout.trim().split("\n").at(-1) ?? "";
      let parsed: BridgeResult | null = null;
      try {
        parsed = JSON.parse(line) as BridgeResult;
      } catch {
        parsed = null;
      }
      if (!parsed) {
        reject(
          new Sf3dServiceError(
            "sf3d_reconstruction_failed",
            `The reconstruction produced no result.${stderr ? ` ${stderr.trim().split("\n").at(-1)}` : ""}`,
          ),
        );
        return;
      }
      resolve(parsed);
    });
  });
}

/**
 * Reconstruct one image.
 *
 * The readiness check runs first and on every call, deliberately: it is a few
 * hundred milliseconds against a five-minute run, and the alternative is a
 * missing compiler surfacing as a Python traceback three minutes in.
 */
export async function runImageTo3d(input: {
  image: Buffer;
  /** Only for the temporary filename, so a traceback names something recognisable. */
  imageName?: string;
  options: Sf3dRunOptions;
  signal?: AbortSignal;
}): Promise<Sf3dRunResult> {
  if (input.image.byteLength === 0) {
    throw new Sf3dServiceError("sf3d_invalid_image", "The attached image is empty.");
  }
  if (input.image.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new Sf3dServiceError("sf3d_invalid_image", "That image is too large to reconstruct.");
  }

  const status = await sf3dStatus(input.signal);
  if (status.state !== "ready") {
    throw new Sf3dServiceError("sf3d_runtime_unavailable", status.detail);
  }

  const config = readSf3dConfig();
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-sf3d-"));
  const safeName = (input.imageName ?? "input.png")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^\.+/, "")
    .slice(0, 80) || "input.png";
  const imagePath = path.join(workDirectory, safeName);
  const outputPath = path.join(workDirectory, "mesh.glb");

  try {
    fs.writeFileSync(imagePath, input.image, { flag: "wx" });
    const result = await spawnBridge({
      config,
      imagePath,
      outputPath,
      options: input.options,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!result.ok) {
      throw new Sf3dServiceError(
        result.code === "sf3d_model_access_denied" ||
        result.code === "sf3d_out_of_memory" ||
        result.code === "sf3d_runtime_incomplete"
          ? result.code
          : "sf3d_reconstruction_failed",
        result.code === "sf3d_model_access_denied" && !config.huggingFaceToken
          ? "The Stable Fast 3D weights are gated. Request access at " +
            "https://huggingface.co/stabilityai/stable-fast-3d and set HUGGINGFACE_TOKEN in the repository .env."
          : (result.message ?? "The reconstruction failed."),
      );
    }
    if (!fs.existsSync(outputPath)) {
      throw new Sf3dServiceError(
        "sf3d_reconstruction_failed",
        "The reconstruction reported success but wrote no mesh.",
      );
    }
    const mesh = fs.readFileSync(outputPath);
    if (mesh.byteLength === 0 || mesh.byteLength > MAX_OUTPUT_MESH_BYTES) {
      throw new Sf3dServiceError(
        "sf3d_reconstruction_failed",
        "The reconstruction produced an unusable mesh.",
      );
    }
    // A binary glTF starts with the ASCII magic `glTF`. Checking it here means a
    // malformed export is caught before it is stored as an artifact rather than
    // when a viewer fails to open it.
    if (mesh.subarray(0, 4).toString("ascii") !== "glTF") {
      throw new Sf3dServiceError(
        "sf3d_reconstruction_failed",
        "The reconstruction produced a file that is not a binary glTF.",
      );
    }
    return {
      mesh,
      device: result.device ?? status.device ?? "cuda",
      durationSeconds: result.durationSeconds ?? 0,
      peakMemoryMb: result.peakMemoryMb ?? null,
      options: input.options,
    };
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}
