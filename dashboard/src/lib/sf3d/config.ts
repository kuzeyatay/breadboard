// Where the Stable Fast 3D runtime lives, and what a run is allowed to ask for.
//
// Kept apart from the service so the status read, the tool route and the tests
// all resolve the same paths from the same environment, and so nothing has to
// import a child-process module to find out where the interpreter is.

import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

/** Texture atlas resolutions the tool will accept. */
export const TEXTURE_RESOLUTIONS = [256, 512, 1024, 2048] as const;
export type TextureResolution = (typeof TEXTURE_RESOLUTIONS)[number];

export const REMESH_OPTIONS = ["none", "triangle", "quad"] as const;
export type RemeshOption = (typeof REMESH_OPTIONS)[number];

/**
 * 1024 is SF3D's own default and the resolution its published results use. The
 * ceiling exists because the atlas is baked on the GPU: 2048 roughly doubles
 * the peak allocation, which on a 6 GB card is the difference between a run and
 * an out-of-memory error.
 */
export const DEFAULT_TEXTURE_RESOLUTION: TextureResolution = 1024;

/** Reconstruction is a single forward pass, but the first run also downloads ~1 GB of weights. */
export const DEFAULT_RUN_TIMEOUT_MS = 5 * 60_000;

/** Input images are re-encoded to PNG before the bridge sees them, so this bounds the decode. */
export const MAX_INPUT_IMAGE_BYTES = 24 * 1024 * 1024;

/** A textured SF3D mesh at 2048² is a few tens of megabytes; well beyond that means something is wrong. */
export const MAX_OUTPUT_MESH_BYTES = 256 * 1024 * 1024;

export interface Sf3dConfig {
  /** The vendored Stability checkout. */
  cloneRoot: string;
  /** The pinned Python 3.12 interpreter `npm run setup:sf3d` provisions. */
  pythonExecutable: string;
  /** The JSON bridge in dashboard/scripts. */
  bridgeScript: string;
  /** Forced device, when the operator has pinned one. */
  device: "cuda" | "mps" | "cpu" | null;
  pretrainedModel: string;
  textureResolution: TextureResolution;
  remesh: RemeshOption;
  runTimeoutMs: number;
  /** A read token for the gated model repository, if one is configured. */
  huggingFaceToken: string | null;
}

function envString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function envTextureResolution(): TextureResolution {
  const raw = Number(envString("SF3D_TEXTURE_RESOLUTION") ?? "");
  return (TEXTURE_RESOLUTIONS as readonly number[]).includes(raw)
    ? (raw as TextureResolution)
    : DEFAULT_TEXTURE_RESOLUTION;
}

export function readSf3dConfig(): Sf3dConfig {
  const root = repositoryRoot();
  const cloneRoot = envString("SF3D_ROOT") ?? path.join(root, "stable-fast-3d");
  const venv = envString("SF3D_VENV") ?? path.join(root, ".runtime", "sf3d-venv");
  const device = envString("SF3D_DEVICE");
  const remesh = envString("SF3D_REMESH");
  return {
    cloneRoot,
    pythonExecutable:
      envString("SF3D_PYTHON") ??
      (process.platform === "win32"
        ? path.join(venv, "Scripts", "python.exe")
        : path.join(venv, "bin", "python")),
    bridgeScript: path.join(root, "dashboard", "scripts", "sf3d-bridge.py"),
    device:
      device === "cuda" || device === "mps" || device === "cpu" ? device : null,
    pretrainedModel: envString("SF3D_PRETRAINED_MODEL") ?? "stabilityai/stable-fast-3d",
    textureResolution: envTextureResolution(),
    remesh: (REMESH_OPTIONS as readonly string[]).includes(remesh ?? "")
      ? (remesh as RemeshOption)
      : "none",
    runTimeoutMs: Number(envString("SF3D_TIMEOUT_MS") ?? "") || DEFAULT_RUN_TIMEOUT_MS,
    // Both names are read because `huggingface-cli login` writes neither: the
    // repository .env is the one place a person is asked to put it.
    huggingFaceToken:
      envString("HUGGINGFACE_TOKEN") ??
      envString("HF_TOKEN") ??
      envString("HUGGING_FACE_HUB_TOKEN"),
  };
}
