// The CAD tool contracts.
//
// These are first-party local tools: Breadboard's own server executes them, so
// the model never touches the CAD service, the database, or the filesystem
// directly. Each one validates its arguments with Zod before doing anything,
// and each one returns a typed result the model can act on — never a string it
// has to interpret.
//
// The tools are deliberately independent of any one agent runtime. The
// Parametric CAD agent drives them through a ChatMock tool loop today; the
// Hardware Blueprint agent calls `runCadTool` directly to add an enclosure to a
// circuit. Neither knows anything about the other.

import { z } from "zod";
import db from "../db.ts";
import { cadDefaults, type CadDefaults } from "./defaults.ts";
import { DEFAULT_CAD_ENGINE, type CadEngineId } from "./engines.ts";
import { CadServiceError, describeCadFailure } from "./errors.ts";
import {
  cadServiceExecute,
  type CadExecuteResponse,
  type CadExpectations,
  type CadExportRequest,
} from "./service.ts";
import { buildWithSolidWorks } from "./solidworks/backend.ts";
import { SUPPORTED_OPERATIONS } from "./solidworks/operations.ts";
import {
  cadAssemblySchema,
  cadConstraintSchema,
  cadDesignSpecDraftSchema,
  parseWithSchema,
  type CADDesignSpecDraft,
} from "./schemas.ts";
import {
  createCadProject,
  getCadProject,
  getCadRevision,
  listRevisionFiles,
  nextRevisionNumber,
  readRevisionParameters,
  recordCadRevision,
  revisionHistory,
  type CadParameterValue,
  type CadProjectRow,
} from "./project-store.ts";
import { CAD_VALIDATION_DISCLAIMER, engineeringReviewNotice, type CadSafetyDecision } from "./safety.ts";
import {
  CAD_DESIGN_SCHEMA_VERSION,
  type CADAssembly,
  type CADConstraint,
  type CADDesignSpec,
  type CADExportFormat,
  type CADMeasurements,
  type CADParameter,
  type CADStatus,
  type CADValidationIssue,
} from "./types.ts";
import type Database from "better-sqlite3";

export const CAD_TOOL_NAMES = [
  "cad_create_project",
  "cad_generate_model",
  "cad_validate_model",
  "cad_export_model",
  "cad_get_project",
  "cad_update_parameters",
  "cad_render_views",
] as const;

export type CadToolName = (typeof CAD_TOOL_NAMES)[number];

/** The standard views a CAD viewer offers, in the order the panel shows them. */
export const CAD_STANDARD_VIEWS = [
  "isometric",
  "front",
  "rear",
  "left",
  "right",
  "top",
  "bottom",
] as const;

export type CadStandardView = (typeof CAD_STANDARD_VIEWS)[number];

/** Unit direction the camera looks *from*, in the model's own coordinates. */
export const CAD_VIEW_DIRECTIONS: Record<CadStandardView, [number, number, number]> = {
  isometric: [1, -1, 1],
  front: [0, -1, 0],
  rear: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
};

export interface CadToolContext {
  userId: number;
  conversationId: number;
  clusterId: number | null;
  /** The model driving this turn, recorded in every revision's provenance. */
  model: string;
  /** The user's instruction for this turn, recorded on each revision. */
  instruction: string;
  safety: CadSafetyDecision;
  defaults: CadDefaults;
  /**
   * The CAD backend this turn builds on. Absent means CadQuery, which is what
   * every caller that predates the setting means.
   */
  engine?: CadEngineId;
  signal?: AbortSignal;
  emit?: (type: string, payload: Record<string, unknown>) => void;
  database?: Database.Database;
  storageRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Remaining automatic generation attempts for this turn. */
  attemptsRemaining: number;
  /** Project the agent is working on, once one exists. */
  projectId?: string;
  /**
   * What the last build actually did. A turn that ends without a usable design
   * has to report *why*, and the last tool call is often an unrelated refusal
   * ("you already have a project") that says nothing about the geometry. This
   * is the record that does.
   */
  lastBuild?: {
    /** Project this build belongs to; revision numbers are only project-local. */
    projectId: string;
    revision: number;
    status: CADStatus;
    issues: CADValidationIssue[];
    failure?: { code: string; message: string; line?: number };
  };
}

export type CadToolResult = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Argument schemas
// ---------------------------------------------------------------------------

const parameterValueSchema = z.union([z.number().finite(), z.string().max(200), z.boolean()]);
const parametersSchema = z.record(z.string().max(80), parameterValueSchema).default({});

const createProjectArgs = z.object({
  name: z.string().trim().min(1).max(160),
  units: z.enum(["mm", "inch"]).default("mm"),
  design_spec: cadDesignSpecDraftSchema,
  parameters: parametersSchema,
});

const generateModelArgs = z.object({
  projectId: z.string().min(1),
  source: z.string().min(1).max(400_000),
  entrypoint: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .default("build_model"),
  parameters: parametersSchema,
  timeoutMs: z.number().int().min(1_000).max(120_000).default(45_000),
  /** What changed, for the revision log. */
  note: z.string().max(2_000).default(""),
  /**
   * Constraints this program implements, merged into the specification by id.
   *
   * The source-generation phase can only send geometry, so without this a
   * requirement the plan forgot to record could never be satisfied however
   * many times the program was rewritten. Claiming a constraint here proves
   * nothing on its own — the acceptance gate still looks for the feature in the
   * geometry — but it lets the design say what the program was written to do.
   */
  constraints: z.array(cadConstraintSchema).max(120).optional(),
  /** How the bodies this program returns go together, for the same reason. */
  assembly: cadAssemblySchema.optional(),
});

const validateModelArgs = z.object({
  projectId: z.string().min(1),
  revision: z.number().int().min(1).optional(),
});

const exportModelArgs = z.object({
  projectId: z.string().min(1),
  revision: z.number().int().min(1).optional(),
  formats: z
    .array(z.enum(["step", "stl", "glb", "3mf", "sldprt", "source", "operations", "spec", "report"]))
    .max(10)
    .default([]),
});

const getProjectArgs = z.object({
  projectId: z.string().min(1),
  includeSource: z.boolean().default(true),
});

const updateParametersArgs = z.object({
  projectId: z.string().min(1),
  parameters: z.record(z.string().max(80), parameterValueSchema),
  note: z.string().max(2_000).default(""),
});

const renderViewsArgs = z.object({
  projectId: z.string().min(1),
  revision: z.number().int().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions handed to the model
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: CadToolName;
  description: string;
  parameters: Record<string, unknown>;
}

const DESIGN_SPEC_SCHEMA: Record<string, unknown> = {
  type: "object",
  description:
    "The structured design. Every number the part depends on belongs in `parameters`, and every " +
    "value you chose rather than the user belongs in `assumptions`.",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    units: { type: "string", enum: ["mm", "inch"] },
    manufacturingProcess: { type: "string", enum: ["fdm", "sla", "sls", "unknown"] },
    parameters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The exact key used in the CadQuery program's params dict.",
          },
          label: { type: "string" },
          value: { type: ["number", "string", "boolean"] },
          unit: { type: "string" },
          minimum: { type: "number" },
          maximum: { type: "number" },
          editable: { type: "boolean" },
          source: {
            type: "string",
            enum: ["user", "default", "derived"],
            description:
              "`user` when the person stated it, `default` when you took it from the process " +
              "defaults, `derived` when you computed it from other parameters.",
          },
          description: { type: "string" },
        },
        required: ["id", "label", "value", "editable", "source"],
      },
    },
    components: {
      type: "array",
      description:
        "One entry per printable body. The number of solids the program returns must equal the " +
        "sum of these quantities, ignoring `reference` bodies.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "integer", minimum: 1 },
          material: { type: "string" },
          bodyRole: {
            type: "string",
            enum: ["primary", "lid", "fastener", "reference", "other"],
          },
        },
        required: ["id", "name", "quantity", "bodyRole"],
      },
    },
    constraints: {
      type: "array",
      description:
        "Machine-checkable promises. A `hole` or `clearance` constraint with a numeric `expected` " +
        "is measured against the built solid.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "dimension",
              "clearance",
              "wall-thickness",
              "alignment",
              "symmetry",
              "hole",
              "fit",
              "printability",
              "custom",
            ],
          },
          description: { type: "string" },
          expected: {},
          tolerance: { type: "number" },
          unit: { type: "string" },
        },
        required: ["id", "type", "description"],
      },
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          reason: { type: "string" },
          userEditable: { type: "boolean" },
        },
        required: ["id", "description", "reason", "userEditable"],
      },
    },
    assembly: {
      type: "object",
      description:
        "How the finished bodies go together. Required whenever the design has more than one " +
        "printable body or needs any bought part — a person holding seven printed pieces cannot " +
        "tell from the geometry which one clamps what. Name real parts in `parts` using the " +
        "component ids above, and real hardware in `hardware`.",
      properties: {
        overview: {
          type: "string",
          description: "The assembled product in one or two sentences.",
        },
        hardware: {
          type: "array",
          description:
            "Bought items only — screws, inserts, pads, magnets, adhesive. Never a printed body.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: {
                type: "string",
                description: 'What to order, e.g. "M3 × 12 socket cap screw".',
              },
              quantity: { type: "integer", minimum: 1 },
              purpose: { type: "string", description: "Where it goes." },
            },
            required: ["id", "name", "quantity"],
          },
        },
        steps: {
          type: "array",
          description: "In build order. Each step says what attaches to what, and with which item.",
          items: {
            type: "object",
            properties: {
              order: { type: "integer", minimum: 1 },
              summary: { type: "string" },
              parts: {
                type: "array",
                description: "Component ids this step joins, including reference envelopes.",
                items: { type: "string" },
              },
              hardware: {
                type: "array",
                description: "Hardware ids used in this step.",
                items: { type: "string" },
              },
              detail: { type: "string" },
            },
            required: ["order", "summary", "parts"],
          },
        },
        notes: {
          type: "array",
          description: "Tools or preparation the steps assume.",
          items: { type: "string" },
        },
      },
      required: ["overview", "hardware", "steps"],
    },
    exportSettings: {
      type: "object",
      properties: {
        stlLinearTolerance: { type: "number" },
        stlAngularTolerance: { type: "number" },
        generateStep: { type: "boolean" },
        generateStl: { type: "boolean" },
        generateGlb: { type: "boolean" },
        generate3mf: { type: "boolean" },
      },
      required: [
        "stlLinearTolerance",
        "stlAngularTolerance",
        "generateStep",
        "generateStl",
        "generateGlb",
        "generate3mf",
      ],
    },
    declaredBoundingBox: {
      type: "object",
      description:
        "The overall size the finished part should have, in millimetres. Validation measures the " +
        "solid against this, so state it only when the design really fixes an outer envelope.",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
        tolerance: { type: "number" },
      },
    },
    printerBed: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
      required: ["x", "y", "z"],
    },
  },
  required: [
    "name",
    "description",
    "units",
    "manufacturingProcess",
    "parameters",
    "components",
    "constraints",
    "assumptions",
    "exportSettings",
  ],
};

export const CAD_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "cad_create_project",
    description:
      "Create the CAD project for this design and record its structured specification. Call this " +
      "once, before generating any source.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short slug-like name, e.g. raspberry-pi-enclosure." },
        units: { type: "string", enum: ["mm", "inch"] },
        design_spec: DESIGN_SPEC_SCHEMA,
        parameters: {
          type: "object",
          description: "Initial parameter values, keyed by parameter id.",
          additionalProperties: true,
        },
      },
      required: ["name", "units", "design_spec", "parameters"],
    },
  },
  {
    name: "cad_generate_model",
    description:
      "Execute a CadQuery program in the isolated local CAD runtime, measure the resulting solid, " +
      "validate it, and store the result as a new revision. Returns structured measurements and " +
      "validation issues — read them before saying anything about the part.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        source: {
          type: "string",
          description:
            "The complete CadQuery program. It must define build_model(params) and return a dict " +
            "of named solids.",
        },
        entrypoint: { type: "string" },
        parameters: { type: "object", additionalProperties: true },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
        note: { type: "string", description: "One sentence on what this build changes." },
        constraints: {
          type: "array",
          description:
            "Constraints this program implements, merged into the design specification by id. " +
            "Send one whenever a required feature has no constraint recording it — the geometry " +
            "still has to show the feature, but the specification should say what it is for.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "dimension",
                  "clearance",
                  "wall-thickness",
                  "alignment",
                  "symmetry",
                  "hole",
                  "fit",
                  "printability",
                  "custom",
                ],
              },
              description: { type: "string" },
              expected: {},
              tolerance: { type: "number" },
              unit: { type: "string" },
            },
            required: ["id", "type", "description"],
          },
        },
        assembly: {
          type: "object",
          description:
            "How the bodies this program returns go together: overview, bought hardware, and " +
            "ordered steps naming the component ids each one joins. Send it whenever the design " +
            "has more than one body or any bought part and the specification has none yet.",
          properties: {
            overview: { type: "string" },
            hardware: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  quantity: { type: "integer", minimum: 1 },
                  purpose: { type: "string" },
                },
                required: ["id", "name", "quantity"],
              },
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  order: { type: "integer", minimum: 1 },
                  summary: { type: "string" },
                  parts: { type: "array", items: { type: "string" } },
                  hardware: { type: "array", items: { type: "string" } },
                  detail: { type: "string" },
                },
                required: ["order", "summary", "parts"],
              },
            },
            notes: { type: "array", items: { type: "string" } },
          },
          required: ["overview", "hardware", "steps"],
        },
      },
      required: ["projectId", "source", "parameters"],
    },
  },
  {
    name: "cad_validate_model",
    description:
      "Re-check a stored revision against the project's current design specification and return " +
      "every issue. Use it after changing the specification without changing the geometry.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        revision: { type: "integer", minimum: 1 },
      },
      required: ["projectId"],
    },
  },
  {
    name: "cad_export_model",
    description:
      "List the files a revision produced, with their sizes, hashes and tessellation tolerances.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        revision: { type: "integer", minimum: 1 },
        formats: {
          type: "array",
          items: {
            type: "string",
            enum: ["step", "stl", "glb", "3mf", "sldprt", "source", "operations", "spec", "report"],
          },
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "cad_get_project",
    description:
      "Read the project back: its specification, current parameters, source, revision history and " +
      "last validation. Use this to modify an existing design instead of rewriting it from scratch.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        includeSource: { type: "boolean" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "cad_update_parameters",
    description:
      "Change named parameter values and rebuild, without rewriting the program. Prefer this over " +
      "cad_generate_model whenever the requested change is a number the design already exposes.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        parameters: {
          type: "object",
          description: "Only the parameters that change, keyed by parameter id.",
          additionalProperties: true,
        },
        note: { type: "string" },
      },
      required: ["projectId", "parameters"],
    },
  },
  {
    name: "cad_render_views",
    description:
      "Return the standard view set for a revision: camera direction, framing distance and the " +
      "preview file the viewer loads. Rendering itself happens in the browser from the GLB.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        revision: { type: "integer", minimum: 1 },
      },
      required: ["projectId"],
    },
  },
];

/**
 * The `cad_generate_model` contract for the SolidWorks backend.
 *
 * The tool is the same tool — same project, same validation, same revision —
 * but its `source` argument cannot be. SolidWorks is a feature-history
 * application driven one operation at a time, so what it takes is the ordered
 * operation program described in `./solidworks/operations.ts`.
 */
const SOLIDWORKS_GENERATE_MODEL: ToolDefinition = {
  name: "cad_generate_model",
  description:
    "Build the part in SolidWorks from an ordered operation program, export it, measure the " +
    "result, validate it, and store the result as a new revision. Returns structured " +
    "measurements and validation issues — read them before saying anything about the part.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      source: {
        type: "string",
        description:
          "A JSON document: {\"name\": \"<part name>\", \"units\": \"mm\", \"operations\": [...]}. " +
          `Supported operations are ${SUPPORTED_OPERATIONS.join(", ")}. A sketch is ` +
          '{"op":"sketch","plane":"Front|Top|Right","entities":[...]} where an entity is a line, ' +
          "rectangle, circle, arc or polygon in millimetres; extrude and cut take a depth in " +
          "millimetres and act on the sketch just closed. There is no chamfer, Hole Wizard, " +
          "revolve, sweep, loft or pattern on this backend — a plain hole is a circle followed " +
          "by a cut deep enough to pass through.",
      },
      entrypoint: { type: "string" },
      parameters: { type: "object", additionalProperties: true },
      timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
      note: { type: "string", description: "One sentence on what this build changes." },
    },
    required: ["projectId", "source", "parameters"],
  },
};

/** The tool contracts for one backend. CadQuery's are the shipped defaults. */
export function cadToolDefinitions(engine: CadEngineId = DEFAULT_CAD_ENGINE): ToolDefinition[] {
  if (engine !== "solidworks") return CAD_TOOL_DEFINITIONS;
  return CAD_TOOL_DEFINITIONS.map((tool) =>
    tool.name === "cad_generate_model" ? SOLIDWORKS_GENERATE_MODEL : tool,
  );
}

// ---------------------------------------------------------------------------
// Deriving what validation should check from the design specification
// ---------------------------------------------------------------------------

function numericExpectation(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function expectedSolidCount(spec: CADDesignSpec): number | undefined {
  const bodies = spec.components
    .filter((component) => component.bodyRole !== "reference")
    .reduce((total, component) => total + component.quantity, 0);
  return bodies > 0 ? bodies : undefined;
}

export function expectationsFromSpec(
  spec: CADDesignSpec,
  defaults: CadDefaults,
): CadExpectations {
  const wallConstraint = spec.constraints.find((constraint) => constraint.type === "wall-thickness");
  const wallParameter = spec.parameters.find((parameter) =>
    /^(wall|wall_thickness|wallthickness)$/i.test(parameter.id),
  );
  const wall =
    numericExpectation(wallConstraint?.expected) ??
    (typeof wallParameter?.value === "number" ? wallParameter.value : null);

  const holes = spec.constraints
    .filter((constraint) => constraint.type === "hole")
    .map((constraint) => numericExpectation(constraint.expected))
    .filter((value): value is number => value !== null);

  const clearances = spec.constraints
    .filter((constraint) => constraint.type === "clearance" || constraint.type === "fit")
    .map((constraint) => numericExpectation(constraint.expected))
    .filter((value): value is number => value !== null);

  const declared = spec.declaredBoundingBox;
  const boundingBox =
    declared && (declared.x !== undefined || declared.y !== undefined || declared.z !== undefined)
      ? {
          ...(declared.x === undefined ? {} : { x: declared.x }),
          ...(declared.y === undefined ? {} : { y: declared.y }),
          ...(declared.z === undefined ? {} : { z: declared.z }),
        }
      : undefined;

  const count = expectedSolidCount(spec);
  return {
    ...(count === undefined ? {} : { expectedSolidCount: count }),
    ...(boundingBox ? { boundingBox } : {}),
    ...(declared?.tolerance === undefined ? {} : { boundingBoxTolerance: declared.tolerance }),
    ...(wall === null ? {} : { minimumWallThickness: wall }),
    minimumFeatureSize: defaults.minimumFeatureSize,
    ...(holes.length ? { holeDiameters: holes } : {}),
    ...(clearances.length ? { clearances } : {}),
    printerBed: spec.printerBed ?? defaults.printerBed,
    units: spec.units,
  };
}

function exportRequests(spec: CADDesignSpec): CadExportRequest[] {
  const settings = spec.exportSettings;
  const requests: CadExportRequest[] = [];
  const push = (format: CadExportRequest["format"], filename: string) =>
    requests.push({
      format,
      filename,
      linearTolerance: settings.stlLinearTolerance,
      angularTolerance: settings.stlAngularTolerance,
    });
  if (settings.generateStep) push("step", "model.step");
  if (settings.generateStl) push("stl", "model.stl");
  // The interactive preview is the point of the artifact, so the GLB is not
  // optional: turning it off would leave a design nobody can look at.
  push("glb", "model.glb");
  if (settings.generate3mf) push("3mf", "model.3mf");
  return requests;
}

export function statusFromIssues(issues: CADValidationIssue[]): CADStatus {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  return issues.some((issue) => issue.severity === "warning") ? "valid-with-warnings" : "valid";
}

function normalizeIssues(issues: CadExecuteResponse["issues"]): CADValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    ...(issue.feature ? { feature: issue.feature } : {}),
    ...(issue.expected === null || issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.actual === null || issue.actual === undefined ? {} : { actual: issue.actual }),
    ...(issue.repairHint ? { repairHint: issue.repairHint } : {}),
  }));
}

/**
 * A slider that never reaches the geometry is worse than no slider: it claims
 * adjustability the exported part does not have. CadQuery programs read values
 * from a parameter mapping, so every editable parameter must be accessed by
 * the program rather than merely listed in DEFAULT_PARAMS or a comment.
 */
export function unusedCadParameterIssues(
  source: string,
  spec: Pick<CADDesignSpec, "parameters">,
): CADValidationIssue[] {
  const code = source.replace(/#.*$/gm, "");
  return spec.parameters.flatMap((parameter) => {
    if (!parameter.editable) return [];
    const escaped = parameter.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bracket = new RegExp(
      `\\b[A-Za-z_]\\w*\\s*\\[\\s*["']${escaped}["']\\s*\\]`,
    );
    const get = new RegExp(
      `\\b[A-Za-z_]\\w*\\s*\\.get\\(\\s*["']${escaped}["']`,
    );
    if (bracket.test(code) || get.test(code)) return [];
    return [{
      code: "unused_parameter",
      severity: "error" as const,
      message: `The editable parameter '${parameter.label}' is declared but the geometry program never reads it.`,
      feature: parameter.id,
      repairHint:
        "Use this parameter in the named geometric feature, or remove it instead of presenting a no-op control.",
    }];
  });
}

function measurementsFrom(response: CadExecuteResponse, units: string): CADMeasurements {
  const box = response.boundingBox ?? { x: 0, y: 0, z: 0 };
  return {
    boundingBox: { x: box.x, y: box.y, z: box.z, unit: units },
    volume: response.volume,
    surfaceArea: response.surfaceArea,
    solidCount: response.solidCount,
    ...(response.tessellation ? { triangleCount: response.tessellation.triangleCount } : {}),
    bodies: response.solids.map((solid) => ({
      name: solid.name,
      volume: solid.volume,
      surfaceArea: solid.surfaceArea,
      boundingBox: solid.boundingBox,
      valid: solid.valid,
      watertight: solid.watertight,
    })),
  };
}

/** The design spec, with parameter values reconciled to what actually ran. */
function specWithParameters(
  spec: CADDesignSpec,
  parameters: Record<string, CadParameterValue>,
): CADDesignSpec {
  const known = new Set(spec.parameters.map((parameter) => parameter.id));
  const updated: CADParameter[] = spec.parameters.map((parameter) =>
    parameter.id in parameters ? { ...parameter, value: parameters[parameter.id] } : parameter,
  );
  for (const [id, value] of Object.entries(parameters)) {
    if (known.has(id)) continue;
    // Only a measurable value earns a place in the specification. A model that
    // slips a free-text note into the parameter map — "reason: fixed the
    // non-manifold edges" — would otherwise put an editable text box in the
    // parameter panel and a meaningless entry in the revision diff. The value
    // still reaches the program, which ignores what it does not use.
    if (typeof value !== "number" && typeof value !== "boolean") continue;
    updated.push({
      id,
      label: id.replace(/_/g, " "),
      value,
      editable: true,
      source: "derived",
      description: "Supplied to the program without a specification entry.",
    });
  }
  return { ...spec, parameters: updated };
}

/**
 * The stored specification, updated with what this build says it implements.
 *
 * Constraints merge by id — a repaired program restates the requirement it now
 * satisfies rather than duplicating it — and an assembly replaces the previous
 * one outright, because the bodies it describes are the ones this program
 * returns.
 */
function specWithSubmittedIntent(
  spec: CADDesignSpec,
  submitted: { constraints?: CADConstraint[]; assembly?: CADAssembly },
): CADDesignSpec {
  if (!submitted.constraints?.length && !submitted.assembly) return spec;
  const constraints = [...spec.constraints];
  for (const constraint of submitted.constraints ?? []) {
    const existing = constraints.findIndex((candidate) => candidate.id === constraint.id);
    if (existing >= 0) constraints[existing] = constraint;
    else constraints.push(constraint);
  }
  return {
    ...spec,
    constraints: constraints.slice(0, 120),
    ...(submitted.assembly ? { assembly: submitted.assembly } : {}),
  };
}

function projectSpec(project: CadProjectRow): CADDesignSpec {
  const parsed = JSON.parse(project.design_spec_json) as CADDesignSpec;
  return parsed;
}

function currentParameters(spec: CADDesignSpec): Record<string, CadParameterValue> {
  return Object.fromEntries(spec.parameters.map((parameter) => [parameter.id, parameter.value]));
}

function disclaimers(safety: CadSafetyDecision): string[] {
  const notice = engineeringReviewNotice(safety);
  return [CAD_VALIDATION_DISCLAIMER, ...(notice ? [notice] : [])];
}

// ---------------------------------------------------------------------------
// Build + record, shared by cad_generate_model and cad_update_parameters
// ---------------------------------------------------------------------------

export interface BuildAndRecordInput {
  project: CadProjectRow;
  spec: CADDesignSpec;
  source: string;
  entrypoint: string;
  parameters: Record<string, CadParameterValue>;
  instruction: string;
  timeoutMs: number;
  context: CadToolContext;
}

export interface BuildAndRecordOutcome {
  ok: boolean;
  revision?: number;
  status?: CADStatus;
  measurements?: CADMeasurements;
  issues?: CADValidationIssue[];
  failure?: { code: string; message: string; repairHint?: string; retryable: boolean; line?: number };
  durationMs?: number;
}

export async function buildAndRecord(
  input: BuildAndRecordInput,
): Promise<BuildAndRecordOutcome> {
  const { context } = input;
  const database = context.database;
  // The specification is reconciled *after* the build, from the values the
  // program actually used — see `effectiveParameters` below. Until then it is
  // only needed for the expectations, which the requested overrides already
  // determine.
  const requestedSpec = specWithParameters(input.spec, input.parameters);
  const spec = requestedSpec;
  const expectations = expectationsFromSpec(spec, context.defaults);
  const revision = nextRevisionNumber(input.project.id, database);
  const parentRevision = input.project.latest_revision || null;
  const engine: CadEngineId = context.engine ?? DEFAULT_CAD_ENGINE;

  context.emit?.("cad.execution.started", {
    projectId: input.project.id,
    revision,
    engine,
    sourceBytes: Buffer.byteLength(input.source, "utf8"),
  });

  const executeRequest = {
    source: input.source,
    entrypoint: input.entrypoint,
    parameters: input.parameters,
    timeoutMs: input.timeoutMs,
    exports: exportRequests(spec),
    expectations,
    linearTolerance: spec.exportSettings.stlLinearTolerance,
    angularTolerance: spec.exportSettings.stlAngularTolerance,
  };

  let response: CadExecuteResponse;
  const startedAt = Date.now();
  try {
    // The two backends diverge here and nowhere else: from the response
    // onwards, a SolidWorks build is measured, validated, exported and recorded
    // by exactly the code a CadQuery build is.
    response =
      engine === "solidworks"
        ? await buildWithSolidWorks({
            source: input.source,
            request: executeRequest,
            ...(context.env ? { env: context.env } : {}),
            ...(context.signal ? { signal: context.signal } : {}),
            ...(context.emit ? { emit: context.emit } : {}),
          })
        : await cadServiceExecute(executeRequest, {
            ...(context.env ? { env: context.env } : {}),
            ...(context.signal ? { signal: context.signal } : {}),
          });
  } catch (error) {
    const serviceError =
      error instanceof CadServiceError
        ? error
        : new CadServiceError(
            "cad_service_error",
            error instanceof Error ? error.message : "The CAD service failed.",
            { retryable: true },
          );
    const failure = describeCadFailure(serviceError.code, serviceError.message);
    context.emit?.("cad.execution.failed", { projectId: input.project.id, revision, ...failure });
    context.lastBuild = {
      projectId: input.project.id,
      revision,
      status: "invalid",
      issues: [],
      failure: { code: failure.code, message: failure.message },
    };
    return { ok: false, failure };
  }

  if (!response.ok) {
    const raw = response.failure;
    const failure = describeCadFailure(
      raw?.code ?? "execution_error",
      raw?.message ?? "",
      raw?.violations ?? [],
    );
    context.emit?.("cad.execution.failed", {
      projectId: input.project.id,
      revision,
      ...failure,
      ...(raw?.line ? { line: raw.line } : {}),
    });
    context.lastBuild = {
      projectId: input.project.id,
      revision,
      status: "invalid",
      issues: [],
      failure: {
        code: failure.code,
        message: failure.message,
        ...(raw?.line ? { line: raw.line } : {}),
      },
    };
    return {
      ok: false,
      failure: { ...failure, ...(raw?.line ? { line: raw.line } : {}) },
      durationMs: Date.now() - startedAt,
    };
  }

  context.emit?.("cad.execution.completed", {
    projectId: input.project.id,
    revision,
    solidCount: response.solidCount,
    boundingBox: response.boundingBox,
    volume: response.volume,
    durationMs: response.durationMs,
  });

  context.emit?.("cad.validation.started", { projectId: input.project.id, revision });
  // A rewritten program carries its own DEFAULT_PARAMS, and those are the
  // design's values now. Reconciling from the effective set is what makes
  // "increase the wall thickness to 3 mm" actually stick when the model
  // regenerates the source rather than calling cad_update_parameters.
  const effectiveParameters =
    response.effectiveParameters && Object.keys(response.effectiveParameters).length
      ? response.effectiveParameters
      : input.parameters;
  const recordedSpec = specWithParameters(input.spec, effectiveParameters);

  const issues = [
    ...normalizeIssues(response.issues),
    ...(engine === "cadquery" ? unusedCadParameterIssues(input.source, recordedSpec) : []),
  ];
  const status = statusFromIssues(issues);
  const passed = status !== "invalid";
  const measurements = measurementsFrom(response, recordedSpec.units);
  const checkedAt = new Date().toISOString();

  context.emit?.(passed ? "cad.validation.completed" : "cad.validation.failed", {
    projectId: input.project.id,
    revision,
    passed,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    issues: issues.filter((issue) => issue.severity !== "info"),
  });

  context.emit?.("cad.export.started", { projectId: input.project.id, revision });
  // The expectations are stored with the result, not just used to produce it:
  // cad_validate_model compares them against the current specification to tell
  // a stale answer from a still-correct one, and without them every call would
  // rebuild.
  const validation = { passed, checkedAt, issues, expectations };
  const provenance = {
    engine: response.engine || engine,
    engineVersion: response.engineVersion,
    // Even a SolidWorks part is measured through OpenCascade, because its STEP
    // export is what produced the numbers recorded here.
    kernel: "opencascade",
    kernelVersion: response.kernelVersion,
    pythonVersion: response.pythonVersion,
    serviceVersion: "1.0.0",
    model: context.model,
    geometryAuthor: "model" as const,
    generatedAt: checkedAt,
    ...(parentRevision ? { parentRevision } : {}),
    buildDurationMs: response.durationMs,
  };

  const files: Array<{
    format: CADExportFormat;
    content: Buffer | string;
    linearTolerance?: number;
    angularTolerance?: number;
  }> = [];
  for (const exported of response.exports) {
    const payload = response.files[exported.format];
    if (!payload) continue;
    files.push({
      format: exported.format as CADExportFormat,
      content: payload,
      ...(exported.linearTolerance ? { linearTolerance: exported.linearTolerance } : {}),
      ...(exported.angularTolerance ? { angularTolerance: exported.angularTolerance } : {}),
    });
  }
  // The design's source, under the slot that matches what it actually is: a
  // CadQuery program, or a SolidWorks operation list.
  files.push({ format: engine === "solidworks" ? "operations" : "source", content: input.source });
  files.push({ format: "spec", content: `${JSON.stringify(spec, null, 2)}\n` });
  files.push({
    format: "report",
    content: `${JSON.stringify({ ...validation, measurements, provenance }, null, 2)}\n`,
  });

  const generationLog = [
    { at: checkedAt, stage: "execute", detail: `${response.solidCount} solid(s) in ${response.durationMs} ms` },
    {
      at: checkedAt,
      stage: "validate",
      detail: `${issues.filter((i) => i.severity === "error").length} error(s), ${issues.filter((i) => i.severity === "warning").length} warning(s)`,
    },
    { at: checkedAt, stage: "export", detail: files.map((file) => file.format).join(", ") },
  ];

  recordCadRevision({
    projectId: input.project.id,
    revision,
    parentRevision,
    status,
    instruction: input.instruction,
    source: input.source,
    entrypoint: input.entrypoint,
    parameters: effectiveParameters,
    designSpec: recordedSpec,
    measurements,
    validation,
    provenance,
    generationLog,
    model: context.model,
    files,
    ...(database ? { database } : {}),
    ...(context.storageRoot ? { storageRoot: context.storageRoot } : {}),
  });

  context.emit?.("cad.export.completed", {
    projectId: input.project.id,
    revision,
    formats: files.map((file) => file.format),
  });

  context.lastBuild = { projectId: input.project.id, revision, status, issues };

  return {
    ok: true,
    revision,
    status,
    measurements,
    issues,
    durationMs: response.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function requireProject(context: CadToolContext, projectId: string): CadProjectRow {
  const project = getCadProject(projectId, context.database);
  if (!project || project.user_id !== context.userId) {
    throw new CadServiceError("cad_project_not_found", "That CAD project was not found.");
  }
  return project;
}

function invalidArguments(subject: string, issues: string[]): CadToolResult {
  return {
    ok: false,
    error: "invalid_arguments",
    message: `${subject} did not validate.`,
    issues: issues.slice(0, 12),
  };
}

export async function runCadTool(
  name: string,
  rawArguments: unknown,
  context: CadToolContext,
): Promise<CadToolResult> {
  switch (name) {
    case "cad_create_project":
      return createProjectTool(rawArguments, context);
    case "cad_generate_model":
      return generateModelTool(rawArguments, context);
    case "cad_validate_model":
      return validateModelTool(rawArguments, context);
    case "cad_export_model":
      return exportModelTool(rawArguments, context);
    case "cad_get_project":
      return getProjectTool(rawArguments, context);
    case "cad_update_parameters":
      return updateParametersTool(rawArguments, context);
    case "cad_render_views":
      return renderViewsTool(rawArguments, context);
    default:
      return {
        ok: false,
        error: "unknown_tool",
        message: `There is no CAD tool called ${String(name)}.`,
        available: CAD_TOOL_NAMES,
      };
  }
}

function createProjectTool(rawArguments: unknown, context: CadToolContext): CadToolResult {
  const parsed = parseWithSchema(createProjectArgs, rawArguments, "The CAD project request");
  if (!parsed.ok) return invalidArguments("The CAD project request", parsed.issues);
  if (context.projectId) {
    return {
      ok: false,
      error: "project_already_exists",
      message:
        "This turn already has a CAD project. Use cad_get_project and cad_generate_model or " +
        "cad_update_parameters to change it.",
      projectId: context.projectId,
    };
  }

  const draft: CADDesignSpecDraft = parsed.value.design_spec;
  const project = createCadProject({
    userId: context.userId,
    conversationId: context.conversationId,
    clusterId: context.clusterId,
    name: parsed.value.name,
    units: parsed.value.units,
    process: draft.manufacturingProcess,
    ...(context.database ? { database: context.database } : {}),
  });

  const spec: CADDesignSpec = {
    ...draft,
    schemaVersion: CAD_DESIGN_SCHEMA_VERSION,
    projectId: project.id,
    printerBed: draft.printerBed ?? context.defaults.printerBed,
  };
  const merged = specWithParameters(spec, parsed.value.parameters);
  saveProjectSpec(project.id, merged, context);
  context.projectId = project.id;

  context.emit?.("cad.spec.created", {
    projectId: project.id,
    name: merged.name,
    units: merged.units,
    process: merged.manufacturingProcess,
    parameterCount: merged.parameters.length,
    componentCount: merged.components.length,
    assumptions: merged.assumptions.map((assumption) => assumption.description),
  });

  return {
    ok: true,
    projectId: project.id,
    revision: 0,
    units: merged.units,
    expectedSolidCount: expectedSolidCount(merged) ?? null,
    defaults: context.defaults,
    disclaimers: disclaimers(context.safety),
    next: "Call cad_generate_model with the CadQuery program for this specification.",
  };
}

function saveProjectSpec(
  projectId: string,
  spec: CADDesignSpec,
  context: CadToolContext,
): void {
  (context.database ?? db)
    .prepare(
      `UPDATE cad_projects
       SET design_spec_json = ?, name = ?, units = ?, process = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(spec),
      spec.name.slice(0, 200),
      spec.units,
      spec.manufacturingProcess,
      new Date().toISOString(),
      projectId,
    );
}

async function generateModelTool(
  rawArguments: unknown,
  context: CadToolContext,
): Promise<CadToolResult> {
  const parsed = parseWithSchema(generateModelArgs, rawArguments, "The CAD generation request");
  if (!parsed.ok) return invalidArguments("The CAD generation request", parsed.issues);
  if (context.attemptsRemaining <= 0) {
    return {
      ok: false,
      error: "attempt_budget_exhausted",
      message:
        "The automatic build budget for this turn is used up. Report what failed and what you " +
        "would change, and stop calling tools.",
    };
  }
  const project = requireProject(context, parsed.value.projectId);
  const spec = specWithSubmittedIntent(projectSpec(project), parsed.value);
  context.attemptsRemaining -= 1;
  // Kept on the project as well as on the revision: a follow-up turn reads the
  // project's specification, and a constraint or assembly recorded only against
  // one revision would vanish the next time the design is opened.
  if (parsed.value.constraints?.length || parsed.value.assembly) {
    saveProjectSpec(project.id, spec, context);
  }

  context.emit?.("cad.source.generated", {
    projectId: project.id,
    bytes: Buffer.byteLength(parsed.value.source, "utf8"),
    note: parsed.value.note,
    attemptsRemaining: context.attemptsRemaining,
  });

  // Deliberately *not* merged with the previous revision's values: the source
  // supplied here is a complete program, and its DEFAULT_PARAMS are the new
  // baseline. Re-applying the old values on top would make a rewritten default
  // impossible to change.
  const parameters = parsed.value.parameters;
  const outcome = await buildAndRecord({
    project,
    spec,
    source: parsed.value.source,
    entrypoint: parsed.value.entrypoint,
    parameters,
    instruction: parsed.value.note || context.instruction,
    timeoutMs: parsed.value.timeoutMs,
    context,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.failure?.code ?? "execution_failed",
      message: outcome.failure?.message ?? "The build failed.",
      ...(outcome.failure?.repairHint ? { repairHint: outcome.failure.repairHint } : {}),
      ...(outcome.failure?.line ? { line: outcome.failure.line } : {}),
      retryable: outcome.failure?.retryable ?? true,
      attemptsRemaining: context.attemptsRemaining,
    };
  }

  const errors = (outcome.issues ?? []).filter((issue) => issue.severity === "error");
  return {
    ok: true,
    projectId: project.id,
    revision: outcome.revision,
    status: outcome.status,
    validationPassed: errors.length === 0,
    measurements: outcome.measurements,
    issues: (outcome.issues ?? []).filter((issue) => issue.severity !== "info"),
    attemptsRemaining: context.attemptsRemaining,
    ...(errors.length
      ? {
          next:
            "Validation found errors. Fix the geometry or the specification and call " +
            "cad_generate_model again.",
        }
      : {
          next:
            "The solid validated. Summarise the part for the user; the artifact is published " +
            "automatically when the turn ends.",
        }),
  };
}

async function validateModelTool(
  rawArguments: unknown,
  context: CadToolContext,
): Promise<CadToolResult> {
  const parsed = parseWithSchema(validateModelArgs, rawArguments, "The CAD validation request");
  if (!parsed.ok) return invalidArguments("The CAD validation request", parsed.issues);
  const project = requireProject(context, parsed.value.projectId);
  const revisionNumber = parsed.value.revision ?? (project.current_revision || project.latest_revision);
  const revision = getCadRevision(project.id, revisionNumber, context.database);
  if (!revision) {
    return {
      ok: false,
      error: "revision_not_found",
      message: "That revision does not exist. Build the model before validating it.",
    };
  }

  const spec = projectSpec(project);
  const expectations = expectationsFromSpec(spec, context.defaults);
  const stored = JSON.parse(revision.validation_json) as {
    passed?: boolean;
    checkedAt?: string;
    issues?: CADValidationIssue[];
    expectations?: CadExpectations;
  };

  // Re-checking means re-executing: the deterministic rules live in the CAD
  // service, next to the geometry they measure, and there is exactly one
  // implementation of them. When the specification has not moved since the
  // build, the recorded result is that same answer and a rebuild would only
  // cost time.
  if (JSON.stringify(stored.expectations ?? {}) === JSON.stringify(expectations)) {
    const issues = stored.issues ?? [];
    return {
      ok: true,
      projectId: project.id,
      revision: revisionNumber,
      revalidated: false,
      passed: Boolean(stored.passed),
      status: statusFromIssues(issues),
      checkedAt: stored.checkedAt ?? revision.created_at,
      issues: issues.filter((issue) => issue.severity !== "info"),
      infoIssues: issues.filter((issue) => issue.severity === "info"),
      disclaimers: disclaimers(context.safety),
    };
  }

  if (context.attemptsRemaining <= 0) {
    return {
      ok: false,
      error: "attempt_budget_exhausted",
      message:
        "The specification changed since this revision was built, and the build budget for this " +
        "turn is used up. Report the mismatch instead of rebuilding.",
    };
  }
  context.attemptsRemaining -= 1;
  const outcome = await buildAndRecord({
    project,
    spec,
    source: revision.source,
    entrypoint: revision.entrypoint,
    parameters: readRevisionParameters(project.id, revisionNumber, context.database),
    instruction: `Re-validated against the updated specification.`,
    timeoutMs: 45_000,
    context,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.failure?.code ?? "execution_failed",
      message: outcome.failure?.message ?? "The re-validation build failed.",
      ...(outcome.failure?.repairHint ? { repairHint: outcome.failure.repairHint } : {}),
    };
  }
  return {
    ok: true,
    projectId: project.id,
    revision: outcome.revision,
    revalidated: true,
    passed: outcome.status !== "invalid",
    status: outcome.status,
    checkedAt: new Date().toISOString(),
    issues: (outcome.issues ?? []).filter((issue) => issue.severity !== "info"),
    infoIssues: (outcome.issues ?? []).filter((issue) => issue.severity === "info"),
    disclaimers: disclaimers(context.safety),
  };
}

function exportModelTool(rawArguments: unknown, context: CadToolContext): CadToolResult {
  const parsed = parseWithSchema(exportModelArgs, rawArguments, "The CAD export request");
  if (!parsed.ok) return invalidArguments("The CAD export request", parsed.issues);
  const project = requireProject(context, parsed.value.projectId);
  const revision = parsed.value.revision ?? (project.current_revision || project.latest_revision);
  const files = listRevisionFiles(project.id, revision, context.database);
  if (!files.length) {
    return {
      ok: false,
      error: "revision_not_found",
      message: "That revision produced no files. Build the model first.",
    };
  }
  const wanted = new Set(parsed.value.formats);
  const selected = wanted.size ? files.filter((file) => wanted.has(file.format)) : files;
  return {
    ok: true,
    projectId: project.id,
    revision,
    exports: selected.map((file) => ({
      format: file.format,
      filename: file.filename,
      byteSize: file.byteSize,
      sha256: file.sha256,
      ...(file.linearTolerance === undefined ? {} : { linearTolerance: file.linearTolerance }),
      ...(file.angularTolerance === undefined ? {} : { angularTolerance: file.angularTolerance }),
    })),
    note: "Files are stored in Breadboard and downloaded through its authenticated artifact routes.",
  };
}

function getProjectTool(rawArguments: unknown, context: CadToolContext): CadToolResult {
  const parsed = parseWithSchema(getProjectArgs, rawArguments, "The CAD project query");
  if (!parsed.ok) return invalidArguments("The CAD project query", parsed.issues);
  const project = requireProject(context, parsed.value.projectId);
  const spec = projectSpec(project);
  const current = project.current_revision || project.latest_revision;
  const revision = current ? getCadRevision(project.id, current, context.database) : null;
  const validation = revision
    ? (JSON.parse(revision.validation_json) as {
        passed?: boolean;
        issues?: CADValidationIssue[];
      })
    : null;

  return {
    ok: true,
    projectId: project.id,
    name: project.name,
    units: project.units,
    process: project.process,
    status: project.status,
    currentRevision: project.current_revision,
    latestRevision: project.latest_revision,
    designSpec: spec,
    parameters: revision
      ? readRevisionParameters(project.id, current, context.database)
      : currentParameters(spec),
    ...(parsed.value.includeSource && revision
      ? { source: revision.source, entrypoint: revision.entrypoint }
      : {}),
    measurements: revision ? JSON.parse(revision.measurements_json) : null,
    validation: validation
      ? {
          passed: Boolean(validation.passed),
          issues: (validation.issues ?? []).filter((issue) => issue.severity !== "info"),
        }
      : null,
    revisionHistory: revisionHistory(project.id, context.database),
    disclaimers: disclaimers(context.safety),
  };
}

async function updateParametersTool(
  rawArguments: unknown,
  context: CadToolContext,
): Promise<CadToolResult> {
  const parsed = parseWithSchema(updateParametersArgs, rawArguments, "The CAD parameter update");
  if (!parsed.ok) return invalidArguments("The CAD parameter update", parsed.issues);
  // A CadQuery program reads its dimensions from `params`, so replaying it with
  // new values really does change the geometry. A SolidWorks operation program
  // holds its dimensions as literal numbers, so the same replay would rebuild
  // the identical part while reporting the parameters as changed.
  if ((context.engine ?? DEFAULT_CAD_ENGINE) === "solidworks") {
    return {
      ok: false,
      error: "unsupported_on_engine",
      message:
        "cad_update_parameters is not available on the SolidWorks backend: an operation program " +
        "holds its dimensions as literal numbers, so there is nothing to override.",
      repairHint:
        "Call cad_generate_model with the whole operation program, with the new numbers written into it.",
    };
  }
  if (context.attemptsRemaining <= 0) {
    return {
      ok: false,
      error: "attempt_budget_exhausted",
      message: "The automatic build budget for this turn is used up.",
    };
  }
  const project = requireProject(context, parsed.value.projectId);
  const base = project.current_revision || project.latest_revision;
  const revision = base ? getCadRevision(project.id, base, context.database) : null;
  if (!revision) {
    return {
      ok: false,
      error: "revision_not_found",
      message: "This project has no built revision yet. Call cad_generate_model first.",
    };
  }

  const spec = projectSpec(project);
  const known = new Set(spec.parameters.map((parameter) => parameter.id));
  const unknown = Object.keys(parsed.value.parameters).filter((id) => !known.has(id));
  if (unknown.length) {
    return {
      ok: false,
      error: "unknown_parameters",
      message: `This design has no parameter named ${unknown.join(", ")}.`,
      available: [...known],
      repairHint:
        "Use cad_generate_model to change geometry the current program does not expose as a parameter.",
    };
  }

  const outOfRange = spec.parameters
    .filter((parameter) => parameter.id in parsed.value.parameters)
    .map((parameter) => {
      const value = parsed.value.parameters[parameter.id];
      if (typeof value !== "number") return null;
      if (parameter.minimum !== undefined && value < parameter.minimum) {
        return `${parameter.id} must be at least ${parameter.minimum}`;
      }
      if (parameter.maximum !== undefined && value > parameter.maximum) {
        return `${parameter.id} must be at most ${parameter.maximum}`;
      }
      return null;
    })
    .filter((message): message is string => message !== null);
  if (outOfRange.length) {
    return { ok: false, error: "parameter_out_of_range", message: outOfRange.join("; ") };
  }

  context.attemptsRemaining -= 1;
  const previous = readRevisionParameters(project.id, base, context.database);
  const parameters = { ...previous, ...parsed.value.parameters };

  const outcome = await buildAndRecord({
    project,
    spec,
    source: revision.source,
    entrypoint: revision.entrypoint,
    parameters,
    instruction: parsed.value.note || context.instruction,
    timeoutMs: 45_000,
    context,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.failure?.code ?? "execution_failed",
      message: outcome.failure?.message ?? "The parameter update failed to build.",
      ...(outcome.failure?.repairHint ? { repairHint: outcome.failure.repairHint } : {}),
      retryable: outcome.failure?.retryable ?? true,
    };
  }
  // `buildAndRecord` deliberately distinguishes execution from validation:
  // an executable solid is recorded even when it violates the specification,
  // so the model can inspect and repair it. A parameter action, however, is a
  // user-facing mutation of an already usable design. Reporting that mutation
  // as successful would make the invalid attempt look like the new design even
  // though the project store correctly kept the last good revision current.
  if (outcome.status !== "valid" && outcome.status !== "valid-with-warnings") {
    const blocking = (outcome.issues ?? []).filter((issue) => issue.severity === "error");
    return {
      ok: false,
      error: "cad_validation_failed",
      message:
        blocking.length > 0
          ? `The parameter update built revision ${outcome.revision}, but it failed CAD validation: ${blocking
              .slice(0, 3)
              .map((issue) => issue.message)
              .join("; ")}`
          : `The parameter update built revision ${outcome.revision}, but it did not produce a valid CAD result.`,
      repairHint:
        blocking[0]?.repairHint ??
        "Choose parameter values that satisfy the design constraints; the last valid revision remains current.",
      retryable: true,
      projectId: project.id,
      revision: outcome.revision,
      status: outcome.status ?? "invalid",
      validationPassed: false,
      measurements: outcome.measurements,
      issues: (outcome.issues ?? []).filter((issue) => issue.severity !== "info"),
    };
  }
  return {
    ok: true,
    projectId: project.id,
    revision: outcome.revision,
    status: outcome.status,
    validationPassed: true,
    changed: Object.entries(parsed.value.parameters).map(([id, value]) => ({
      id,
      from: previous[id] ?? null,
      to: value,
    })),
    measurements: outcome.measurements,
    issues: (outcome.issues ?? []).filter((issue) => issue.severity !== "info"),
  };
}

function renderViewsTool(rawArguments: unknown, context: CadToolContext): CadToolResult {
  const parsed = parseWithSchema(renderViewsArgs, rawArguments, "The CAD view request");
  if (!parsed.ok) return invalidArguments("The CAD view request", parsed.issues);
  const project = requireProject(context, parsed.value.projectId);
  const revisionNumber = parsed.value.revision ?? (project.current_revision || project.latest_revision);
  const revision = getCadRevision(project.id, revisionNumber, context.database);
  if (!revision) {
    return { ok: false, error: "revision_not_found", message: "That revision does not exist." };
  }
  const measurements = JSON.parse(revision.measurements_json) as CADMeasurements;
  const files = listRevisionFiles(project.id, revisionNumber, context.database);
  const preview = files.find((file) => file.format === "glb") ?? null;
  return {
    ok: true,
    projectId: project.id,
    revision: revisionNumber,
    previewFormat: preview?.format ?? null,
    ...standardViews(measurements),
    note:
      "Views are rendered in the browser from the GLB. Breadboard has no headless renderer, so no " +
      "server-side images are produced.",
  };
}

/** Camera framing for the standard views, derived from the measured envelope. */
export function standardViews(measurements: CADMeasurements): {
  views: Array<{
    name: CadStandardView;
    direction: [number, number, number];
    up: [number, number, number];
    distance: number;
  }>;
  target: [number, number, number];
  radius: number;
} {
  const box = measurements.boundingBox;
  const radius = Math.max(1, Math.hypot(box.x, box.y, box.z) / 2);
  return {
    target: [0, 0, 0],
    radius,
    views: CAD_STANDARD_VIEWS.map((name) => ({
      name,
      direction: CAD_VIEW_DIRECTIONS[name],
      // Z is up in CadQuery's default world, except when looking along it.
      up: name === "top" || name === "bottom" ? ([0, 1, 0] as [number, number, number]) : ([0, 0, 1] as [number, number, number]),
      distance: radius * 2.6,
    })),
  };
}

export { cadDefaults };
