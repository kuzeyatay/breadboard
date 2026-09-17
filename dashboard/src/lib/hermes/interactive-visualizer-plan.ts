import {
  INTERACTIVE_VISUALIZER_SCHEMA_VERSION,
  type InteractiveVisualizerPlan,
} from "./interactive-visualizer-types.ts";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;
const MAX_CONTROLS = 16;
const MAX_OUTPUTS = 20;

/** Stage a representation change for a revision without mutating the ready plan.
 * The package still goes through the normal compiler and browser gates. The
 * service persists this candidate plan only with a successful publication.
 */
export function interactiveVisualizerPlanForAttempt(input: {
  plan: InteractiveVisualizerPlan;
  operation: "create" | "revise";
  packageValue: unknown;
  revisionPrompt?: string;
}): InteractiveVisualizerPlan {
  const { plan, packageValue } = input;
  if (input.operation !== "revise" || !isRecord(packageValue) ||
      !isRecord(packageValue.manifest)) return plan;
  const mode = packageValue.manifest.mode;
  if (mode !== "2d" && mode !== "3d" && mode !== "hybrid") return plan;
  if (mode === plan.mode) return plan;
  return {
    ...plan,
    mode,
    rationale: input.revisionPrompt?.trim().slice(0, 2_000) ||
      `Revise the existing visualization to use ${mode} representation.`,
  };
}

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

const CUSTOM_PACKAGE_FILES = ["index.html", "styles.css", "main.js"] as const;

/**
 * Cheap structural precheck of a package before a job row, a repair attempt,
 * or a Runtime worker is spent on it. Models occasionally answer the nested
 * package schema with numeric stand-ins (`"files": 0`, `"manifest": 0`); the
 * worker's compiler would reject those too, but only after a job was opened
 * and an attempt consumed. The compiler remains the authority on everything
 * else, so this checks presence and JSON type only.
 */
export function precheckInteractiveVisualizerPackage(value: unknown): string[] {
  if (!isRecord(value)) return ["package must be an object"];
  const errors: string[] = [];
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    errors.push("package.schemaVersion must be 1 or 2");
  }
  const placeholder = (field: string, item: unknown) =>
    typeof item === "number"
      ? `package.${field} is a number placeholder; send the full object`
      : `package.${field} must be an object`;
  if (!isRecord(value.manifest)) errors.push(placeholder("manifest", value.manifest));
  for (const field of ["assumptions", "limitations", "sourceReferences", "semanticTests"] as const) {
    if (!Array.isArray(value[field])) {
      errors.push(`package.${field} must be an array`);
    } else if (field === "sourceReferences" || field === "semanticTests") {
      (value[field] as unknown[]).forEach((item, index) => {
        if (!isRecord(item)) errors.push(placeholder(`${field}[${index}]`, item));
      });
    }
  }
  if (schemaVersion === 2) {
    if (!isRecord(value.files)) {
      errors.push(placeholder("files", value.files));
    } else {
      for (const name of CUSTOM_PACKAGE_FILES) {
        if (typeof value.files[name] !== "string" || !value.files[name].trim()) {
          errors.push(`package.files["${name}"] must be a non-empty string`);
        }
      }
    }
  } else if (schemaVersion === 1 && !isRecord(value.definition)) {
    errors.push(placeholder("definition", value.definition));
  }
  return errors;
}
