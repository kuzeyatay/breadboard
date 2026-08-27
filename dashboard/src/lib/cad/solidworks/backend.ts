// Building one part in SolidWorks, and measuring what came out.
//
// The shape of this module is set by one decision: SolidWorks produces the
// geometry, and Breadboard's existing CadQuery service measures it. The part is
// modelled through the bridge, exported to STEP, and that STEP is read back
// through the same `/convert` endpoint an attached STEP from a user goes
// through — so the bounding box, volume, surface area, mesh and GLB preview
// come from the identical measurement code the CadQuery path uses, and every
// downstream consumer (validation, the artifact, the browser viewer, the
// download routes) works without knowing which engine built the part.
//
// The alternative was to trust SolidWorks' own mass properties. Those are used
// too, but only as a cross-check: they carry no bounding box, so accepting them
// alone would mean either an unmeasured envelope or an invented one.
//
// Nothing here is ever handed a path from outside. Every file written lives
// under a Breadboard-owned workspace, and any path the bridge reports back is
// re-checked against that workspace before it is read.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CadServiceError } from "../errors.ts";
import {
  cadServiceConvert,
  type CadExecuteRequest,
  type CadExecuteResponse,
  type CadExportRequest,
} from "../service.ts";
import { solidworksVersionHint, solidworksWorkspaceRoot } from "./config.ts";
import type { SolidWorksBridgeLike } from "./protocol.ts";
import {
  acquireSolidWorksRuntimeLease,
  releaseSolidWorksRuntimeLease,
  solidWorksRuntimeBridge,
} from "./runtime-service.ts";
import {
  parseSolidWorksProgram,
  type SolidWorksProgram,
  type SolidWorksSketchOperation,
} from "./operations.ts";

/** Build workspaces older than this are removed when the next build starts. */
const WORKSPACE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** How far SolidWorks' own volume may differ from the STEP's before it is reported. */
const VOLUME_AGREEMENT_TOLERANCE = 0.01;

export interface SolidWorksBuildInput {
  /** The operation program, as the model wrote it. */
  source: string;
  request: CadExecuteRequest;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  emit?: (type: string, payload: Record<string, unknown>) => void;
  bridge?: SolidWorksBridgeLike;
}

interface ToolFailure {
  tool: string;
  message: string;
}

function toolMessage(payload: Record<string, unknown>, text: string): string {
  const message = payload.message;
  return (typeof message === "string" && message) || text.slice(0, 400) || "no detail";
}

/** A tool call that must succeed, with the bridge's own error text preserved. */
async function call(
  bridge: SolidWorksBridgeLike,
  input: SolidWorksBuildInput,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  const result = await bridge.callTool(tool, args, {
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  const status = result.data.status;
  if (result.isError || status === "error") {
    const failure: ToolFailure = { tool, message: toolMessage(result.data, result.text) };
    throw new CadServiceError(
      "solidworks_operation_failed",
      `SolidWorks refused ${failure.tool}: ${failure.message}`,
      { retryable: true, detail: failure.message },
    );
  }
  return result.data;
}

/** The entity id a sketch tool reported, wherever it put it. */
function entityIdFrom(payload: Record<string, unknown>): string | null {
  for (const key of ["line", "circle", "rectangle", "arc", "polygon", "entity", "sketch"]) {
    const nested = payload[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const id = (nested as Record<string, unknown>).id ?? (nested as Record<string, unknown>).name;
      if (typeof id === "string" && id) return id;
    }
  }
  const direct = payload.entity_id ?? payload.id;
  return typeof direct === "string" && direct ? direct : null;
}

function nested(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Remove build workspaces from previous weeks. Best effort, never fatal. */
function pruneWorkspaces(root: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - WORKSPACE_RETENTION_MS;
  for (const entry of entries) {
    const candidate = path.join(root, entry);
    try {
      if (fs.statSync(candidate).mtimeMs < cutoff) {
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    } catch {
      // A workspace SolidWorks still has open cannot be removed. Next time.
    }
  }
}

/**
 * Read a file the bridge was asked to write.
 *
 * The path is one Breadboard chose, but it is re-resolved and re-checked here
 * anyway: the bridge is a separate process driving a desktop application, and a
 * file that turned up outside the workspace is a reason to stop, not to read.
 */
function readProduced(workspace: string, filename: string, label: string): Buffer {
  const target = path.resolve(workspace, filename);
  const root = path.resolve(workspace);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new CadServiceError(
      "solidworks_export_escaped_workspace",
      `The SolidWorks ${label} export resolved outside its workspace and was discarded.`,
    );
  }
  let contents: Buffer;
  try {
    contents = fs.readFileSync(target);
  } catch {
    throw new CadServiceError(
      "solidworks_export_failed",
      `SolidWorks reported the ${label} export as written, but no file appeared.`,
      { retryable: true },
    );
  }
  if (!contents.byteLength) {
    throw new CadServiceError(
      "solidworks_export_failed",
      `The SolidWorks ${label} export is empty.`,
      { retryable: true },
    );
  }
  return contents;
}

async function runSketch(
  bridge: SolidWorksBridgeLike,
  input: SolidWorksBuildInput,
  operation: SolidWorksSketchOperation,
): Promise<string> {
  const created = await call(bridge, input, "create_sketch", { plane: operation.plane });
  const sketchName = String(nested(created, "sketch").name ?? "");

  const ids = new Map<string, string>();
  for (const entity of operation.entities) {
    let payload: Record<string, unknown>;
    switch (entity.kind) {
      case "line":
        payload = await call(bridge, input, "add_line", {
          x1: entity.x1,
          y1: entity.y1,
          x2: entity.x2,
          y2: entity.y2,
          construction: entity.construction,
        });
        break;
      case "rectangle":
        payload = await call(bridge, input, "add_rectangle", {
          x1: entity.x1,
          y1: entity.y1,
          x2: entity.x2,
          y2: entity.y2,
          construction: entity.construction,
        });
        break;
      case "circle":
        payload = await call(bridge, input, "add_circle", {
          center_x: entity.centerX,
          center_y: entity.centerY,
          radius: entity.radius,
          construction: entity.construction,
        });
        break;
      case "arc":
        payload = await call(bridge, input, "add_arc", {
          center_x: entity.centerX,
          center_y: entity.centerY,
          start_x: entity.startX,
          start_y: entity.startY,
          end_x: entity.endX,
          end_y: entity.endY,
        });
        break;
      case "polygon":
        payload = await call(bridge, input, "add_polygon", {
          center_x: entity.centerX,
          center_y: entity.centerY,
          radius: entity.radius,
          sides: entity.sides,
        });
        break;
    }
    const reported = entityIdFrom(payload);
    if (entity.id && reported) ids.set(entity.id, reported);
  }

  const resolve = (reference: string): string => {
    const resolved = ids.get(reference);
    if (!resolved) {
      throw new CadServiceError(
        "solidworks_operation_failed",
        `The sketch has no entity called ${reference} to dimension or constrain. Give the entity an id and use it here.`,
        { retryable: true },
      );
    }
    return resolved;
  };

  for (const dimension of operation.dimensions) {
    await call(bridge, input, "add_sketch_dimension", {
      entity1: resolve(dimension.entity),
      ...(dimension.secondEntity ? { entity2: resolve(dimension.secondEntity) } : {}),
      dimension_type: dimension.type,
      value: dimension.value,
    });
  }
  for (const constraint of operation.constraints) {
    await call(bridge, input, "add_sketch_constraint", {
      entity1: resolve(constraint.entity),
      ...(constraint.secondEntity ? { entity2: resolve(constraint.secondEntity) } : {}),
      ...(constraint.thirdEntity ? { entity3: resolve(constraint.thirdEntity) } : {}),
      relation_type: constraint.type,
    });
  }

  // The feature tools operate on the closed profile, so a sketch left in edit
  // mode is the most common way an extrude silently does nothing.
  await call(bridge, input, "exit_sketch", {});
  return sketchName;
}

async function runProgram(
  bridge: SolidWorksBridgeLike,
  input: SolidWorksBuildInput,
  program: SolidWorksProgram,
): Promise<{ features: string[] }> {
  const features: string[] = [];
  const sketchNames = new Map<string, string>();
  let lastSketch = "";

  await call(bridge, input, "create_part", { name: program.name, units: "mm" }, 180_000);

  for (const operation of program.operations) {
    switch (operation.op) {
      case "sketch": {
        const name = await runSketch(bridge, input, operation);
        lastSketch = name;
        if (operation.id) sketchNames.set(operation.id, name);
        features.push(`sketch ${name || operation.plane}`);
        break;
      }
      case "extrude": {
        const sketch =
          (operation.sketch ? sketchNames.get(operation.sketch) : undefined) ?? lastSketch;
        const payload = await call(bridge, input, "create_extrusion", {
          sketch_name: sketch || "Sketch1",
          depth: operation.depth,
          reverse_direction: operation.reverse,
          both_directions: operation.bothDirections,
          draft_angle: operation.draftAngle,
          merge_result: operation.merge,
        });
        features.push(String(nested(payload, "extrusion").name ?? "extrusion"));
        break;
      }
      case "cut": {
        const payload = await call(bridge, input, "create_cut_extrude", {
          depth: operation.depth,
          reverse_direction: operation.reverse,
          draft_angle: operation.draftAngle,
        });
        features.push(String(nested(payload, "cut").name ?? "cut"));
        break;
      }
      case "fillet": {
        const payload = await call(bridge, input, "add_fillet", {
          radius: operation.radius,
          edge_names: operation.edges,
        });
        features.push(String(nested(payload, "fillet").name ?? "fillet"));
        break;
      }
    }
  }

  return { features };
}

/**
 * A measurement out of the bridge's mass-properties payload.
 *
 * It reports each quantity as `{value, units}` rather than as a bare number, so
 * both shapes are read. Anything else is absent rather than coerced: a
 * measurement Breadboard could not obtain must not become a zero.
 */
function numberFrom(payload: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const inner = (value as Record<string, unknown>).value;
      if (typeof inner === "number" && Number.isFinite(inner)) return inner;
    }
  }
  return null;
}

export interface SolidWorksMassProperties {
  volume: number | null;
  surfaceArea: number | null;
}

/**
 * SolidWorks' own volume and surface area, out of whichever envelope the bridge
 * wrapped them in. Millimetres cubed and millimetres squared, as the bridge
 * reports them.
 */
export function massPropertiesFrom(payload: Record<string, unknown>): SolidWorksMassProperties {
  // The envelope first, then the nested payloads, so the measurements win over
  // the status fields they are wrapped in.
  const properties = {
    ...payload,
    ...nested(payload, "data"),
    ...nested(payload, "properties"),
    ...nested(payload, "mass_properties"),
  };
  return {
    volume: numberFrom(properties, "volume"),
    surfaceArea: numberFrom(properties, "surface_area", "surfaceArea"),
  };
}

async function measureInSolidWorks(
  bridge: SolidWorksBridgeLike,
  input: SolidWorksBuildInput,
): Promise<SolidWorksMassProperties> {
  try {
    const payload = await bridge.callTool(
      "get_mass_properties",
      {},
      {
        timeoutMs: 120_000,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.env ? { env: input.env } : {}),
      },
    );
    return massPropertiesFrom(payload.data);
  } catch {
    // A measurement Breadboard could not obtain is absent, not zero. The STEP
    // conversion still produces the numbers the design is validated against.
    return { volume: null, surfaceArea: null };
  }
}

/**
 * Build one part and return it in the same shape a CadQuery build returns.
 *
 * The caller — `buildAndRecord` — cannot tell the difference apart from the
 * `engine` field and the extra `sldprt` file, which is the point.
 */
export async function buildWithSolidWorks(
  input: SolidWorksBuildInput,
): Promise<CadExecuteResponse> {
  const parsed = parseSolidWorksProgram(input.source);
  if (!parsed.ok || !parsed.program) {
    return {
      ok: false,
      failure: {
        code: parsed.unsupported ? "solidworks_unsupported_operation" : "solidworks_invalid_program",
        message: parsed.issues.join(" "),
        violations: parsed.issues.map((message) => ({ message })),
      },
      solids: [],
      solidCount: 0,
      volume: 0,
      surfaceArea: 0,
      boundingBox: null,
      tessellation: null,
      exports: [],
      issues: [],
      effectiveParameters: {},
      stdout: "",
      stderr: "",
      durationMs: 0,
      engine: "solidworks",
      engineVersion: "",
      kernelVersion: "",
      pythonVersion: "",
      files: {},
    };
  }

  const program = parsed.program;
  const env = input.env ?? process.env;
  const root = solidworksWorkspaceRoot(env);
  fs.mkdirSync(root, { recursive: true });
  pruneWorkspaces(root);
  const workspace = path.join(root, `build_${crypto.randomUUID().replaceAll("-", "")}`);
  fs.mkdirSync(workspace, { recursive: true });

  const startedAt = Date.now();
  input.emit?.("cad.solidworks.started", {
    operations: program.operations.length,
    part: program.name,
  });

  const lease = input.bridge ? null : await acquireSolidWorksRuntimeLease(env);
  const bridge = input.bridge ?? solidWorksRuntimeBridge(env);
  try {
    await bridge.ensureStarted(env);
    input.emit?.("cad.solidworks.connected", {
      attached: bridge.attachedToExistingSession(),
    });

    const { features } = await runProgram(bridge, input, program);

    // Native first: the .SLDPRT is the deliverable a SolidWorks user actually
    // wants, and the neutral exports are derived from the saved document.
    const partFilename = `${program.name.replace(/[^A-Za-z0-9_-]+/g, "-")}.SLDPRT`;
    await call(
      bridge,
      input,
      "save_as",
      {
        file_path: path.join(workspace, partFilename),
        format_type: "solidworks",
        overwrite: true,
      },
      180_000,
    );
    await call(
      bridge,
      input,
      "export_step",
      { file_path: path.join(workspace, "model.step"), format_type: "step" },
      180_000,
    );

    const sldprt = readProduced(workspace, partFilename, "SLDPRT");
    const step = readProduced(workspace, "model.step", "STEP");
    const measured = await measureInSolidWorks(bridge, input);

    input.emit?.("cad.solidworks.exported", {
      features,
      sldprtBytes: sldprt.byteLength,
      stepBytes: step.byteLength,
    });

    // Measure the STEP with the same code that measures a CadQuery solid. The
    // GLB the browser previews and the STL a slicer reads are produced here
    // too, so the tolerances the design asked for are honoured exactly once.
    const wanted: CadExportRequest[] = input.request.exports.filter(
      (request) => request.format !== "step",
    );
    let converted: CadExecuteResponse;
    try {
      converted = await cadServiceConvert(
        {
          format: "step",
          contentBase64: step.toString("base64"),
          timeoutMs: Math.max(60_000, input.request.timeoutMs),
          exports: wanted,
          ...(input.request.linearTolerance
            ? { linearTolerance: input.request.linearTolerance }
            : {}),
          ...(input.request.angularTolerance
            ? { angularTolerance: input.request.angularTolerance }
            : {}),
        },
        { env, ...(input.signal ? { signal: input.signal } : {}) },
      );
    } catch (error) {
      throw new CadServiceError(
        "solidworks_measurement_unavailable",
        "SolidWorks built the part, but Breadboard could not measure it: the local CAD service, which reads the exported STEP, did not answer. Start it with `npm run dev:cad`.",
        {
          retryable: false,
          detail: error instanceof CadServiceError ? error.message : String(error),
        },
      );
    }

    if (!converted.ok) {
      return {
        ...converted,
        engine: "solidworks",
        failure: {
          code: "solidworks_measurement_failed",
          message:
            converted.failure?.message ||
            "The STEP SolidWorks exported could not be read back for measurement.",
        },
      };
    }

    // SolidWorks' own numbers are not the record — they carry no envelope — but
    // a disagreement between two independent measurements of the same body is
    // worth saying out loud rather than quietly preferring one.
    const issues = [...converted.issues];
    if (
      measured.volume !== null &&
      converted.volume > 0 &&
      Math.abs(measured.volume - converted.volume) / converted.volume > VOLUME_AGREEMENT_TOLERANCE
    ) {
      issues.push({
        code: "solidworks_volume_disagreement",
        severity: "info",
        message:
          `SolidWorks measured ${measured.volume.toFixed(1)} mm³ and the exported STEP measures ` +
          `${converted.volume.toFixed(1)} mm³. The STEP measurement is the one validation used.`,
        expected: measured.volume,
        actual: converted.volume,
      });
    }

    const files = { ...converted.files, sldprt: sldprt, step };
    const exports = [
      ...converted.exports,
      {
        format: "step",
        filename: "model.step",
        byteSize: step.byteLength,
        sha256: crypto.createHash("sha256").update(step).digest("hex"),
      },
      {
        format: "sldprt",
        filename: partFilename,
        byteSize: sldprt.byteLength,
        sha256: crypto.createHash("sha256").update(sldprt).digest("hex"),
      },
    ];

    const version = solidworksVersionHint(env);
    return {
      ...converted,
      issues,
      exports,
      files,
      durationMs: Date.now() - startedAt,
      engine: "solidworks",
      engineVersion: version ? `SolidWorks ${version}` : "SolidWorks",
      kernelVersion: converted.kernelVersion,
      stdout: features.join("\n"),
      // The operation program has no parameter dictionary of its own; the
      // values the caller supplied are what it ran with.
      effectiveParameters: input.request.parameters,
    };
  } finally {
    input.emit?.("cad.solidworks.finished", { durationMs: Date.now() - startedAt });
    await releaseSolidWorksRuntimeLease(lease, env);
  }
}
