// Turning an attached STEP file into something a browser can draw.
//
// STEP, IGES and BREP describe a solid as trimmed surfaces — the exact geometry
// a CAD kernel works in, and nothing a WebGL context can render. There is no
// three.js loader for them and there cannot usefully be one: reading them means
// evaluating NURBS and tessellating boundary representations, which is what
// OpenCascade is.
//
// Breadboard already runs OpenCascade, for the parametric CAD agent. So an
// attached STEP takes the same road a generated part does — into the sandboxed
// CAD worker, out as a glTF mesh — and the chat viewer draws that. The original
// file is what the user downloads; the derived mesh only ever draws.
//
// The conversion is best-effort by design. The CAD service is optional and may
// not be running, and a file the kernel refuses is still a file worth keeping,
// so a failure here costs the preview and never the attachment.

import {
  MODEL_ATTACHMENT_FORMATS,
  modelPreviewStrategy,
  type ModelAttachmentFormat,
  type ModelAttachmentSummary,
} from "../model-attachments.ts";
import { cadServiceConvert, cadServiceListening } from "../cad/service.ts";
import { writeModelBlob, type StoredModelBlob } from "./model-blob-store.ts";

/** Beyond this the kernel is unlikely to finish, or to produce a drawable mesh. */
const CONVERT_TIMEOUT_MS = 120_000;
/**
 * Coarser than the CAD agent's build tolerance. This mesh is looked at, not
 * printed, and a screen-accurate part beats an exact one that takes a minute.
 */
const PREVIEW_LINEAR_TOLERANCE = 0.12;
const PREVIEW_ANGULAR_TOLERANCE = 0.35;

export interface KernelPreview {
  blob: StoredModelBlob;
  /** Measurements the kernel reported, folded into the attachment's summary. */
  summary: ModelAttachmentSummary;
}

export interface KernelPreviewFailure {
  /** Shown on the card, so a missing preview is never just an absence. */
  note: string;
}

export type KernelPreviewResult =
  | { ok: true; preview: KernelPreview }
  | { ok: false; failure: KernelPreviewFailure };

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Mesh an attached boundary-representation file, if the CAD service is up.
 *
 * Never throws: every outcome is a preview or a sentence explaining why there
 * isn't one.
 */
export async function buildKernelPreview(
  content: Buffer,
  format: ModelAttachmentFormat,
): Promise<KernelPreviewResult> {
  if (modelPreviewStrategy(format) !== "kernel") {
    return { ok: false, failure: { note: "" } };
  }

  // A TCP probe first: a conversion that cannot possibly happen should not cost
  // the user three minutes of upload spinner to find out.
  if (!(await cadServiceListening())) {
    return {
      ok: false,
      failure: {
        note:
          `${MODEL_ATTACHMENT_FORMATS[format].label} files are converted for viewing by Breadboard's ` +
          "local CAD service, which is not running. The file is stored and downloadable; start the " +
          "CAD service (`npm run dev:cad`, or the desktop app, which supervises it) and attach it " +
          "again to get a 3D preview.",
      },
    };
  }

  try {
    const result = await cadServiceConvert({
      format: format as "step" | "stp" | "iges" | "igs" | "brep",
      contentBase64: content.toString("base64"),
      timeoutMs: CONVERT_TIMEOUT_MS,
      exports: [{ format: "glb", filename: "preview.glb" }],
      linearTolerance: PREVIEW_LINEAR_TOLERANCE,
      angularTolerance: PREVIEW_ANGULAR_TOLERANCE,
    });

    if (!result.ok || !result.files.glb?.byteLength) {
      return {
        ok: false,
        failure: {
          note: `The CAD kernel could not read this file: ${
            result.failure?.message ?? "it produced no geometry"
          }`,
        },
      };
    }

    const blob = writeModelBlob({ format: "glb", content: result.files.glb });
    const box = result.boundingBox;
    const solid = result.solids[0];
    const summary: ModelAttachmentSummary = {
      ...(result.tessellation?.triangleCount
        ? { triangles: result.tessellation.triangleCount }
        : {}),
      ...(result.tessellation?.vertexCount ? { vertices: result.tessellation.vertexCount } : {}),
      ...(result.solidCount ? { meshes: result.solidCount } : {}),
      ...(box ? { extent: { x: round(box.x), y: round(box.y), z: round(box.z) } } : {}),
      notes: [
        // Say where the numbers came from: they are the kernel's, not a mesh
        // parser's, and they describe the solid rather than the preview.
        //
        // Written without locale grouping — this string is read by the language
        // model as well as by a person, and on a machine set to a European
        // locale "17.736" is a thousands-separated integer to one of them and
        // seventeen-point-something to the other.
        `Read by OpenCascade ${result.kernelVersion || ""}`.trim() +
          `. ${result.solidCount} solid${result.solidCount === 1 ? "" : "s"}` +
          (result.volume ? `, volume ${Math.round(result.volume)} mm³` : "") +
          (solid ? `, ${solid.watertight ? "watertight" : "not watertight"}` : "") +
          ". The 3D preview is a mesh generated from it; the download is the original file.",
      ],
    };
    return { ok: true, preview: { blob, summary } };
  } catch (error) {
    return {
      ok: false,
      failure: {
        note:
          "The file is stored and downloadable, but Breadboard's CAD service could not convert it " +
          `for viewing: ${error instanceof Error ? error.message : "the conversion failed"}`,
      },
    };
  }
}
