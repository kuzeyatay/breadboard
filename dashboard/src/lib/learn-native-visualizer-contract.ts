import type { GeneratedVisualizationDefinition } from "./visual-sdk.ts";

export const LEARN_VISUALIZER_SKILL = "interactive-visualizer-in-chat";
export const LEARN_VISUALIZER_ENGINE = "breadboard-interactive-visualizer";

/** The garden envelope remains v1; the explicitly tagged embedded runtime is v2. */
export interface LearnNativeVisualizerRuntime {
  engine: typeof LEARN_VISUALIZER_ENGINE;
  version: "2.0.0";
  sourceSkill: typeof LEARN_VISUALIZER_SKILL;
  skillHash: string;
  mode: "2d" | "3d" | "hybrid";
  html: string;
  controlIds: string[];
}

export function isLearnNativeVisualizer(
  value: unknown,
): value is GeneratedVisualizationDefinition & {
  nativeRuntime: LearnNativeVisualizerRuntime;
} {
  if (!value || typeof value !== "object") return false;
  const definition = value as GeneratedVisualizationDefinition;
  const runtime = definition.nativeRuntime;
  return (
    definition.schemaVersion === 1 &&
    definition.sdkVersion === "1.0.0" &&
    typeof definition.title === "string" &&
    typeof definition.description === "string" &&
    Array.isArray(definition.controls) &&
    definition.controls.length === 0 &&
    Array.isArray(definition.outputs) &&
    definition.outputs.length === 0 &&
    Array.isArray(definition.scenes) &&
    definition.scenes.length === 0 &&
    !!runtime &&
    runtime.engine === LEARN_VISUALIZER_ENGINE &&
    runtime.version === "2.0.0" &&
    runtime.sourceSkill === LEARN_VISUALIZER_SKILL &&
    /^[a-f0-9]{64}$/.test(runtime.skillHash) &&
    ["2d", "3d", "hybrid"].includes(runtime.mode) &&
    typeof runtime.html === "string" &&
    runtime.html.length > 100 &&
    runtime.html.length <= 2_000_000 &&
    runtime.html.includes('http-equiv="Content-Security-Policy"') &&
    Array.isArray(runtime.controlIds) &&
    runtime.controlIds.length <= 16 &&
    runtime.controlIds.every(
      (id) =>
        typeof id === "string" && /^[A-Za-z][A-Za-z0-9_-]{1,79}$/.test(id),
    )
  );
}
