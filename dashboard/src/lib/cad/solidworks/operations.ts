// The SolidWorks operation program.
//
// The CadQuery backend takes a Python program because CadQuery *is* a Python
// library. SolidWorks is a feature-history application driven one COM call at a
// time, so sending it CadQuery source would be nonsense. It needs an ordered
// list of modelling operations instead.
//
// This is that list, and it is deliberately small: it is not a cross-CAD
// intermediate representation, and nothing else in Breadboard is expressed in
// it. Every operation below maps onto exactly one verified tool of the
// SolidworksMCP-python bridge, with the same units and the same argument names.
// An operation the bridge does not expose is refused here with a typed error
// rather than approximated — see UNSUPPORTED_OPERATIONS.
//
// Millimetres and degrees throughout, matching both the bridge's tool inputs
// and the rest of Breadboard's CAD vocabulary.

import { z } from "zod";

/**
 * Reference planes the bridge resolves by name.
 *
 * Restricted to the aliases its own plane table defines. A plane name it cannot
 * resolve makes it fall back through a list of locale variants and eventually
 * pick something, which is worse than refusing.
 */
export const SOLIDWORKS_PLANES = ["Front", "Top", "Right"] as const;

const millimetres = z.number().finite().gte(-10_000).lte(10_000);
const positiveMillimetres = z.number().finite().gt(0).lte(10_000);
const entityId = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_-]+$/, "Entity ids may contain letters, digits, hyphens and underscores.");

const lineEntity = z.object({
  kind: z.literal("line"),
  id: entityId.optional(),
  x1: millimetres,
  y1: millimetres,
  x2: millimetres,
  y2: millimetres,
  construction: z.boolean().default(false),
});

const rectangleEntity = z.object({
  kind: z.literal("rectangle"),
  id: entityId.optional(),
  x1: millimetres,
  y1: millimetres,
  x2: millimetres,
  y2: millimetres,
  construction: z.boolean().default(false),
});

const circleEntity = z.object({
  kind: z.literal("circle"),
  id: entityId.optional(),
  centerX: millimetres,
  centerY: millimetres,
  radius: positiveMillimetres,
  construction: z.boolean().default(false),
});

const arcEntity = z.object({
  kind: z.literal("arc"),
  id: entityId.optional(),
  centerX: millimetres,
  centerY: millimetres,
  startX: millimetres,
  startY: millimetres,
  endX: millimetres,
  endY: millimetres,
});

const polygonEntity = z.object({
  kind: z.literal("polygon"),
  id: entityId.optional(),
  centerX: millimetres,
  centerY: millimetres,
  radius: positiveMillimetres,
  sides: z.number().int().min(3).max(64),
});

const sketchEntity = z.discriminatedUnion("kind", [
  lineEntity,
  rectangleEntity,
  circleEntity,
  arcEntity,
  polygonEntity,
]);

const sketchDimension = z.object({
  entity: entityId,
  secondEntity: entityId.optional(),
  type: z.enum(["linear", "horizontal", "vertical", "radial", "diameter", "angular"]),
  value: z.number().finite(),
});

const sketchConstraint = z.object({
  entity: entityId,
  secondEntity: entityId.optional(),
  thirdEntity: entityId.optional(),
  type: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z_]+$/, "A relation type is a single word, e.g. horizontal or coincident."),
});

const sketchOperation = z.object({
  op: z.literal("sketch"),
  /** Name the rest of the program refers to this sketch by. */
  id: entityId.optional(),
  plane: z.enum(SOLIDWORKS_PLANES),
  entities: z.array(sketchEntity).min(1).max(200),
  dimensions: z.array(sketchDimension).max(200).default([]),
  constraints: z.array(sketchConstraint).max(200).default([]),
});

const extrudeOperation = z.object({
  op: z.literal("extrude"),
  /** The sketch this extrudes. Defaults to the one just closed. */
  sketch: entityId.optional(),
  depth: positiveMillimetres,
  reverse: z.boolean().default(false),
  bothDirections: z.boolean().default(false),
  draftAngle: z.number().finite().gte(-89).lte(89).default(0),
  merge: z.boolean().default(true),
});

const cutOperation = z.object({
  op: z.literal("cut"),
  sketch: entityId.optional(),
  depth: positiveMillimetres,
  reverse: z.boolean().default(false),
  draftAngle: z.number().finite().gte(-89).lte(89).default(0),
});

const filletOperation = z.object({
  op: z.literal("fillet"),
  radius: positiveMillimetres,
  /**
   * SolidWorks edge names, as they appear in the feature tree. There is no way
   * to discover them from a freshly built body through the bridge, so a fillet
   * is only usable on a design that already knows its edge names.
   */
  edges: z.array(z.string().trim().min(1).max(80)).min(1).max(64),
});

const operation = z.discriminatedUnion("op", [
  sketchOperation,
  extrudeOperation,
  cutOperation,
  filletOperation,
]);

export const solidworksProgramSchema = z.object({
  /** The part document's name. Also the stem of the saved .SLDPRT. */
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, "A part name is letters, digits, spaces, - and _."),
  units: z.literal("mm").default("mm"),
  operations: z.array(operation).min(1).max(200),
});

export type SolidWorksProgram = z.infer<typeof solidworksProgramSchema>;
export type SolidWorksOperation = z.infer<typeof operation>;
export type SolidWorksSketchOperation = z.infer<typeof sketchOperation>;

/**
 * Modelling the bridge genuinely cannot do, named so the failure is specific.
 *
 * Each of these has an implementation somewhere — chamfer and rebuild exist on
 * the clone's COM adapter but are not registered as MCP tools; the Hole Wizard
 * is not implemented at all — and none of them is reachable from Breadboard.
 * Saying so is the honest answer; silently substituting an extruded cut for a
 * counterbored hole is not.
 */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  chamfer:
    "The SolidWorks bridge exposes no chamfer tool. Model the chamfer as a cut, or use the CadQuery backend.",
  hole:
    "The SolidWorks bridge exposes no Hole Wizard tool. A plain hole is a circle in a sketch followed by a cut.",
  "hole-wizard":
    "The SolidWorks bridge exposes no Hole Wizard tool. A plain hole is a circle in a sketch followed by a cut.",
  rebuild:
    "The SolidWorks bridge exposes no explicit rebuild tool. Features rebuild as they are created, and mass properties force a rebuild before measuring.",
  revolve:
    "Revolve is not part of the Phase 1 SolidWorks operation set: it needs an axis entity the bridge cannot address reliably. Use the CadQuery backend for revolved geometry.",
  sweep:
    "Sweep is not part of the Phase 1 SolidWorks operation set. Use the CadQuery backend for swept geometry.",
  loft: "Loft is not part of the Phase 1 SolidWorks operation set. Use the CadQuery backend for lofted geometry.",
  pattern:
    "Feature patterns are not part of the Phase 1 SolidWorks operation set. Repeat the sketch entities instead.",
};

/** The operations a design may actually use, for the model's instructions. */
export const SUPPORTED_OPERATIONS = ["sketch", "extrude", "cut", "fillet"] as const;

export interface SolidWorksProgramParseResult {
  ok: boolean;
  program?: SolidWorksProgram;
  /** Set when the program named an operation the bridge cannot perform. */
  unsupported?: { op: string; reason: string };
  issues: string[];
}

/**
 * Read a program out of what the model produced.
 *
 * Accepts the JSON document directly or wrapped in a fenced block, because a
 * model asked for JSON in a tool argument sometimes fences it anyway. Anything
 * else is a typed refusal with the validation issues attached, so the next
 * attempt is different from the last.
 */
export function parseSolidWorksProgram(source: string): SolidWorksProgramParseResult {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source);
  const text = (fenced ? fenced[1] : source).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        `The SolidWorks operation program is not valid JSON: ${
          error instanceof Error ? error.message : "unreadable"
        }`,
      ],
    };
  }

  // A named-but-unsupported operation deserves its own answer rather than
  // "expected one of sketch, extrude, cut, fillet".
  const operations = (parsed as { operations?: unknown }).operations;
  if (Array.isArray(operations)) {
    for (const entry of operations) {
      const named = (entry as { op?: unknown })?.op;
      if (typeof named !== "string") continue;
      const reason = UNSUPPORTED_OPERATIONS[named.toLowerCase()];
      if (reason) return { ok: false, unsupported: { op: named, reason }, issues: [reason] };
    }
  }

  const result = solidworksProgramSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".") || "program"}: ${issue.message}`),
    };
  }
  return { ok: true, program: result.data, issues: [] };
}
