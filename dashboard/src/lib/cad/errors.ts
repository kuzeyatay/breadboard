// Turning every way the CAD pipeline can fail into something the agent can act
// on and the user can read.
//
// The rule everywhere below: the agent receives a code plus a repair hint, and
// the user receives a sentence. Nothing anywhere parses a terminal string to
// decide what happened — the service returns structured failures and this
// module is the only place they are rendered.

export type CadFailureAudience = "agent" | "user";

export interface CadFailure {
  code: string;
  /** What a person reads in the run card. */
  message: string;
  /** What the model is told, so its next attempt is different from its last. */
  repairHint?: string;
  /** False when another generation attempt cannot possibly help. */
  retryable: boolean;
}

export class CadServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly detail: string;

  constructor(code: string, message: string, options: { retryable?: boolean; detail?: string } = {}) {
    super(message);
    this.name = "CadServiceError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail ?? "";
  }
}

interface FailureTemplate {
  message: (detail: string) => string;
  repairHint?: string;
  retryable: boolean;
}

const TEMPLATES: Record<string, FailureTemplate> = {
  forbidden_source: {
    message: () =>
      "The generated CAD program used something outside the allowed set and was refused before it ran.",
    repairHint:
      "Rewrite the program using only cadquery and math. It may not touch the filesystem, processes, the network, or dynamic evaluation.",
    retryable: true,
  },
  syntax_error: {
    message: (detail) => `The generated CAD program did not parse: ${detail}`,
    repairHint: "Fix the syntax error at the reported line and return the whole program again.",
    retryable: true,
  },
  missing_entrypoint: {
    message: () => "The generated program defines no build_model(params) function.",
    repairHint: "Define `def build_model(params):` at module level and return the named solids from it.",
    retryable: true,
  },
  empty_result: {
    message: () => "The program ran but produced no solid.",
    repairHint:
      "Return at least one closed solid. A cut that removes the whole body, or a dimension that resolves to zero, is the usual cause.",
    retryable: true,
  },
  unsupported_result: {
    message: (detail) => detail || "build_model returned something that is not a solid.",
    repairHint:
      'Return a dict of named solids, e.g. `return {"body": body, "lid": lid}`, where each value is a Workplane or a Shape.',
    retryable: true,
  },
  execution_error: {
    message: (detail) => `The CAD program raised an error: ${detail}`,
    repairHint:
      "Read the exception and the line number, then fix that operation. A fillet larger than the edge it sits on, or a shell thicker than its wall, is the usual cause.",
    retryable: true,
  },
  recursion_error: {
    message: () => "The CAD program recursed without terminating.",
    repairHint: "Replace the recursion with a bounded loop.",
    retryable: true,
  },
  out_of_memory: {
    message: () => "The CAD program exhausted memory before producing a solid.",
    repairHint:
      "Reduce the feature count — a pattern with thousands of instances, or a very fine tessellation, is the usual cause.",
    retryable: true,
  },
  execution_timeout: {
    message: (detail) => detail || "The model did not finish in time and was stopped.",
    repairHint:
      "Simplify the geometry: fewer boolean operations, fewer patterned features, and fillets applied to selected edges rather than to all of them.",
    retryable: true,
  },
  tessellation_failed: {
    message: (detail) => detail || "The solid could not be meshed for export.",
    repairHint:
      "The solid is valid but has geometry the mesher cannot handle. Remove the smallest fillets or split the operation that created them.",
    retryable: true,
  },
  export_failed: {
    message: (detail) => detail || "An export failed.",
    repairHint: "Simplify the geometry and try the build again.",
    retryable: true,
  },
  export_empty: {
    message: (detail) => detail || "An export produced an empty file.",
    repairHint: "The solid is degenerate. Check that every dimension resolves to a positive number.",
    retryable: true,
  },
  export_hash_mismatch: {
    message: () => "An export changed after it was written and was discarded.",
    retryable: true,
  },
  export_escaped_workspace: {
    message: () => "An export resolved outside its execution workspace and was discarded.",
    retryable: false,
  },
  worker_crashed: {
    message: (detail) => detail || "The CAD kernel crashed while building this model.",
    repairHint:
      "OpenCascade crashed rather than raising an error. Rebuild the shape a different way — the operation just before the crash is the one to change.",
    retryable: true,
  },
  engine_unavailable: {
    message: (detail) =>
      detail ||
      "The CAD engine could not be loaded. The Python environment is present but CadQuery is not usable.",
    retryable: false,
  },
  cad_service_unavailable: {
    message: (detail) =>
      detail ||
      "The local CAD service is not running. Start it with `npm run dev:cad`, or run the desktop app, which supervises it.",
    retryable: false,
  },
  cad_service_unconfigured: {
    message: () =>
      "The local CAD service has no address or shared secret configured, so Breadboard will not contact it.",
    retryable: false,
  },
  cad_service_busy: {
    message: () => "The CAD service is already building as many models as it will run at once.",
    retryable: true,
  },
  cad_service_error: {
    message: (detail) => detail || "The CAD service failed while handling this build.",
    retryable: true,
  },
  invalid_request: {
    message: (detail) => `The CAD service rejected the build request: ${detail}`,
    repairHint: "The generated program or its parameters did not match the service contract.",
    retryable: true,
  },
  result_too_large: {
    message: () => "The CAD worker produced an oversized result document.",
    repairHint: "Reduce the feature count or coarsen the export tolerance.",
    retryable: true,
  },
  export_too_large: {
    message: (detail) => detail || "An export exceeded the size limit.",
    repairHint: "Coarsen the STL tolerance in the export settings, or simplify the geometry.",
    retryable: true,
  },
};

const FALLBACK: FailureTemplate = {
  message: (detail) => detail || "The CAD build failed.",
  retryable: true,
};

export function describeCadFailure(
  code: string,
  detail = "",
  violations: Array<{ code?: string; message?: string; line?: number }> = [],
): CadFailure {
  const template = TEMPLATES[code] ?? FALLBACK;
  const violationText = violations
    .slice(0, 6)
    .map((violation) =>
      violation.line
        ? `line ${violation.line}: ${violation.message ?? violation.code ?? ""}`
        : (violation.message ?? violation.code ?? ""),
    )
    .filter(Boolean)
    .join(" ");
  const hint = [template.repairHint, violationText].filter(Boolean).join(" ");
  return {
    code,
    message: template.message(detail),
    ...(hint ? { repairHint: hint } : {}),
    retryable: template.retryable,
  };
}
