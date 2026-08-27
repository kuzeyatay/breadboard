// Pure developer/packaging discovery for the immutable ShapeR source closure.
// Product health and execution live in Runtime V2 and never call this module as
// a subprocess fallback.

import path from "node:path";

import { externalRuntimePathExists } from "../external-runtime-filesystem.ts";
import { repositoryRoot } from "../runtime-paths.ts";

export interface ShapeRRuntime {
  root: string;
  source: "configured" | "repository" | "cwd";
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function isShapeRClone(candidate: string): boolean {
  return (
    externalRuntimePathExists(path.join(candidate, "infer_shape.py")) &&
    externalRuntimePathExists(path.join(candidate, "experimental", "workaround_dataproc.py")) &&
    externalRuntimePathExists(path.join(candidate, "model", "flow_matching", "shaper_denoiser.py"))
  );
}

/** Developer/build-time discovery only; Runtime receives a native-sealed root. */
export function resolveShapeRRoot(env: NodeJS.ProcessEnv = process.env): ShapeRRuntime | null {
  const candidates: ShapeRRuntime[] = [];
  const explicit = configured(env.SHAPER_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isShapeRClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "ShapeR"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "ShapeR"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "ShapeR"), source: "cwd" });
  return candidates.find((candidate) => isShapeRClone(candidate.root)) ?? null;
}

export function shapeRBridgePath(): string {
  return path.join(repositoryRoot(), "scripts", "shaper-bridge.py");
}
