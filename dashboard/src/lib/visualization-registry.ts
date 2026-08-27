import { externalRuntimeReadUtf8 } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { repositoryRoot } from "./runtime-paths.ts";

const registryJson = JSON.parse(
  externalRuntimeReadUtf8(
    path.join(repositoryRoot(), "shared", "visualization-renderers.json"),
  ),
) as unknown;

export type VisualizationInteractionGoal =
  | "manipulate_variables"
  | "observe_change_over_time"
  | "compare_cases"
  | "step_through_process"
  | "explore_structure"
  | "test_prediction"
  | "inspect_relationship"
  | "simulate_system";

export interface TrustedRendererDefinition {
  id: string;
  label: string;
  roles: string[];
  interactionGoals: VisualizationInteractionGoal[];
  keywords: string[];
}

export interface TrustedRendererRegistry {
  schemaVersion: number;
  compatibilityThreshold: number;
  renderers: TrustedRendererDefinition[];
}

function validatedRegistry(value: unknown): TrustedRendererRegistry {
  if (!value || typeof value !== "object") {
    throw new Error("Trusted visualization registry must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.renderers) || record.renderers.length === 0) {
    throw new Error("Trusted visualization registry has no renderers");
  }
  const ids = new Set<string>();
  const renderers = record.renderers.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Trusted visualization renderer entry must be an object");
    }
    const renderer = item as Record<string, unknown>;
    const id = typeof renderer.id === "string" ? renderer.id.trim() : "";
    if (!/^[a-z][a-z0-9_]{1,60}$/.test(id) || ids.has(id)) {
      throw new Error(`Invalid or duplicate trusted visualization renderer: ${id || "(missing)"}`);
    }
    ids.add(id);
    return {
      id,
      label: typeof renderer.label === "string" ? renderer.label.trim() : id,
      roles: Array.isArray(renderer.roles)
        ? renderer.roles.filter((role): role is string => typeof role === "string")
        : [],
      interactionGoals: Array.isArray(renderer.interactionGoals)
        ? renderer.interactionGoals.filter(
            (goal): goal is VisualizationInteractionGoal => typeof goal === "string",
          )
        : [],
      keywords: Array.isArray(renderer.keywords)
        ? renderer.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : [],
    };
  });
  const threshold = Number(record.compatibilityThreshold);
  return {
    schemaVersion: Number(record.schemaVersion) || 1,
    compatibilityThreshold:
      Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.72,
    renderers,
  };
}

export const TRUSTED_RENDERER_REGISTRY = validatedRegistry(registryJson);
export const TRUSTED_RENDERER_IDS = Object.freeze(
  TRUSTED_RENDERER_REGISTRY.renderers.map((renderer) => renderer.id),
);

export function trustedRenderer(rendererId: string): TrustedRendererDefinition | undefined {
  return TRUSTED_RENDERER_REGISTRY.renderers.find(
    (renderer) => renderer.id === rendererId.trim().toLowerCase(),
  );
}

export function isTrustedRendererId(rendererId: string): boolean {
  return Boolean(trustedRenderer(rendererId));
}
