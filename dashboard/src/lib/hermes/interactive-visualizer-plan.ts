import {
  INTERACTIVE_VISUALIZER_SCHEMA_VERSION,
  type InteractiveVisualizerPlan,
} from "./interactive-visualizer-types.ts";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;
const MAX_CONTROLS = 16;
const MAX_OUTPUTS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown, max = 24): value is string[] {
  return Array.isArray(value) &&
    value.length <= max &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= 500,
    );
}

/**
 * Validate the bounded planning envelope without loading the TypeScript AST
 * compiler. This module is safe for the long-lived compatibility server; the
 * compiler-backed package validator remains worker-only.
 */
export function validateInteractiveVisualizerPlan(
  value: unknown,
): { plan: InteractiveVisualizerPlan | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { plan: null, errors: ["plan must be an object"] };
  if (value.schemaVersion !== INTERACTIVE_VISUALIZER_SCHEMA_VERSION) {
    errors.push("plan.schemaVersion must be 1");
  }
  if (!["2d", "3d", "hybrid"].includes(String(value.mode))) {
    errors.push("plan.mode must be 2d, 3d, or hybrid");
  }
  for (const field of ["title", "objective", "rationale"] as const) {
    if (
      typeof value[field] !== "string" ||
      !value[field].trim() ||
      value[field].length > 2_000
    ) {
      errors.push(`plan.${field} is required and must be at most 2,000 characters`);
    }
  }
  if (
    value.audience !== undefined &&
    (typeof value.audience !== "string" || value.audience.length > 500)
  ) {
    errors.push("plan.audience must be at most 500 characters");
  }
  for (const field of [
    "concepts",
    "assumptions",
    "interactions",
    "dataRequirements",
    "assetRequirements",
    "accessibilityRequirements",
    "sourceReferences",
  ] as const) {
    if (!stringArray(value[field])) {
      errors.push(`plan.${field} must be a bounded non-empty string array`);
    }
  }
  if (Array.isArray(value.concepts) && value.concepts.length === 0) {
    errors.push("plan.concepts must not be empty");
  }
  if (Array.isArray(value.interactions) && value.interactions.length === 0) {
    errors.push("plan.interactions must not be empty");
  }
  if (!Array.isArray(value.controls) || value.controls.length > MAX_CONTROLS) {
    errors.push(`plan.controls must contain at most ${MAX_CONTROLS} controls`);
  } else {
    value.controls.forEach((control, index) => {
      if (!isRecord(control)) {
        errors.push(`plan.controls[${index}] must be an object`);
        return;
      }
      if (!ID_PATTERN.test(String(control.id ?? ""))) {
        errors.push(`plan.controls[${index}].id is invalid`);
      }
      if (typeof control.label !== "string" || !control.label.trim()) {
        errors.push(`plan.controls[${index}].label is required`);
      }
      if (!["range", "number", "select", "toggle", "button"].includes(String(control.type))) {
        errors.push(`plan.controls[${index}].type is invalid`);
      }
      if (typeof control.purpose !== "string" || !control.purpose.trim()) {
        errors.push(`plan.controls[${index}].purpose is required`);
      }
      for (const numeric of ["minimum", "maximum", "step"] as const) {
        if (control[numeric] !== undefined && !finite(control[numeric])) {
          errors.push(`plan.controls[${index}].${numeric} must be finite`);
        }
      }
    });
  }
  if (!Array.isArray(value.outputs) || value.outputs.length > MAX_OUTPUTS) {
    errors.push(`plan.outputs must contain at most ${MAX_OUTPUTS} outputs`);
  } else {
    value.outputs.forEach((output, index) => {
      if (
        !isRecord(output) ||
        !ID_PATTERN.test(String(output.id ?? "")) ||
        typeof output.label !== "string" ||
        !output.label.trim() ||
        typeof output.purpose !== "string" ||
        !output.purpose.trim()
      ) {
        errors.push(`plan.outputs[${index}] is invalid`);
      }
    });
  }
  if (value.animation !== undefined) {
    if (
      !isRecord(value.animation) ||
      typeof value.animation.enabled !== "boolean" ||
      typeof value.animation.canPause !== "boolean" ||
      typeof value.animation.canReset !== "boolean"
    ) {
      errors.push("plan.animation must declare enabled, canPause, and canReset");
    }
  }
  return {
    plan: errors.length === 0 ? value as unknown as InteractiveVisualizerPlan : null,
    errors,
  };
}
