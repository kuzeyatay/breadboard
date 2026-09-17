import crypto from "node:crypto";
import {
  compileCustomInteractiveVisualizerPackage,
  bundleCustomInteractiveVisualizer,
} from "./hermes/interactive-visualizer-custom.ts";
import { validateInteractiveVisualizerPlan } from "./hermes/interactive-visualizer-plan.ts";
import type { GeneratedVisualCompilation } from "./generated-visuals.ts";
import type { GeneratedVisualizationDefinition } from "./visual-sdk.ts";
import type { VisualizationOpportunity } from "./visualization-opportunities.ts";
import {
  LEARN_VISUALIZER_ENGINE,
  LEARN_VISUALIZER_SKILL,
} from "./learn-native-visualizer-contract.ts";

const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

export async function compileLearnNativeVisualizer(
  source: string,
  opportunity?: VisualizationOpportunity,
): Promise<GeneratedVisualCompilation> {
  const failed = (errors: string[]): GeneratedVisualCompilation => ({
    definition: null,
    validation: {
      valid: false,
      checkedAt: new Date().toISOString(),
      astNodeCount: 0,
      sourceBytes: Buffer.byteLength(source),
      imports: [],
      errors,
      warnings: [],
    },
    sourceHash: hash(source),
    compiledHash: "",
    compiledJavaScript: "",
    cacheHit: false,
  });
  if (source.length > 60_000)
    return failed(["Native package exceeds the garden compiler source limit."]);
  let candidate;
  try {
    candidate = JSON.parse(source);
  } catch {
    return failed(["Native package must be complete JSON."]);
  }
  if (
    candidate.sourceSkill !== LEARN_VISUALIZER_SKILL ||
    !/^[a-f0-9]{64}$/.test(candidate.skillHash ?? "")
  ) {
    return failed([
      "Native package requires the interactive-visualizer-in-chat skill identity and hash.",
    ]);
  }
  const checked = validateInteractiveVisualizerPlan(candidate.plan);
  if (!checked.plan) return failed(checked.errors);
  const plan = checked.plan;
  if (
    !plan.animation?.enabled ||
    !plan.animation.canPause ||
    !plan.animation.canReset
  ) {
    return failed([
      "Learn simulations require meaningful animation with Play/Pause and Reset.",
    ]);
  }
  const compiled = compileCustomInteractiveVisualizerPackage(
    plan,
    candidate.package,
  );
  if (!compiled.package)
    return {
      ...failed(compiled.validation.errors),
      validation: {
        ...compiled.validation,
        sourceBytes: Buffer.byteLength(source),
      },
    };
  const html = compiled.package.files["index.html"];
  const errors: string[] = [];
  for (const control of opportunity?.requiredInputs ?? []) {
    const projected = plan.controls.find((entry) => entry.id === control.id);
    if (!projected)
      errors.push(`Missing required control ${control.id} in plan.`);
    else {
      if (
        projected.type !== (control.type === "slider" ? "range" : control.type)
      )
        errors.push(`Preserve the required type of ${control.id}.`);
      if (projected.initialValue !== control.defaultValue)
        errors.push(`Preserve the required default of ${control.id}.`);
      for (const [original, target] of [
        ["min", "minimum"],
        ["max", "maximum"],
        ["step", "step"],
      ] as const) {
        if (
          control[original] !== undefined &&
          projected[target] !== control[original]
        )
          errors.push(`Preserve ${control.id}.${original}.`);
      }
    }
    if (!new RegExp(`\\bid=["']${control.id}["']`).test(html))
      errors.push(`Missing native control #${control.id}.`);
  }
  for (const output of opportunity?.requiredOutputs ?? []) {
    if (!plan.outputs.some((entry) => entry.id === output.id))
      errors.push(`Missing required output ${output.id} in plan.`);
  }
  if (errors.length) return failed(errors);
  const bundle = await bundleCustomInteractiveVisualizer(compiled.package);
  const definition: GeneratedVisualizationDefinition = {
    schemaVersion: 1 as const,
    sdkVersion: "1.0.0",
    title: plan.title,
    description: compiled.package.manifest.description,
    accessibilityDescription:
      compiled.package.manifest.accessibilityDescription,
    controls: [],
    outputs: [],
    scenes: [],
    nativeRuntime: {
      engine: LEARN_VISUALIZER_ENGINE,
      version: "2.0.0" as const,
      sourceSkill: LEARN_VISUALIZER_SKILL,
      skillHash: candidate.skillHash,
      mode: plan.mode,
      html: bundle.html,
      controlIds: (opportunity?.requiredInputs ?? plan.controls).map(
        (control) => control.id,
      ),
    },
  };
  const compiledJavaScript = `globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(${JSON.stringify(definition)});\n`;
  return {
    definition,
    validation: {
      ...compiled.validation,
      sourceBytes: Buffer.byteLength(source),
    },
    sourceHash: hash(source),
    compiledHash: hash(compiledJavaScript),
    compiledJavaScript,
    cacheHit: false,
  };
}
