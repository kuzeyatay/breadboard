// The 3D file formats a chat attachment may be, shared by the browser and the
// server so both agree on one list.
//
// A 3D model is the one attachment kind whose *bytes* are the point: there is
// nothing to extract from a mesh and nothing useful to show as text, so unlike a
// document it is stored whole and read back by the viewer. Everything in this
// module is the contract around that: which extensions qualify, what they are
// served as, how large one may be, and what a stored blob's id looks like.
//
// Deliberately free of Node imports — the composer imports this too.

export type ModelAttachmentFormat =
  // Mesh and scene formats the browser opens directly.
  | "glb" | "gltf" | "obj" | "stl" | "ply" | "fbx" | "3mf"
  | "dae" | "3ds" | "amf" | "wrl" | "vtk" | "pcd" | "xyz"
  | "usdz" | "kmz" | "lwo" | "vox" | "gcode" | "pdb"
  // Boundary-representation CAD, tessellated by the local CAD kernel.
  | "step" | "stp" | "iges" | "igs" | "brep"
  // Proprietary native CAD, stored but not renderable by anything here.
  | "sldprt" | "sldasm" | "ipt" | "iam" | "catpart" | "catproduct" | "prt" | "f3d";

/**
 * How a format becomes something on screen. This is the axis that actually
 * matters: it decides whether an upload is instant, needs the CAD service, or
 * can only ever be kept.
 *
 *  `three`  — a three.js loader reads it in the browser, from the stored bytes.
 *  `kernel` — OpenCascade reads it, so the upload is tessellated to a GLB by
 *             the local CAD service and the viewer draws that instead.
 *  `none`   — a vendor's own format with no open reader. Kept and downloadable,
 *             never pretended to be viewable.
 */
export type ModelPreviewStrategy = "three" | "kernel" | "none";

export interface ModelFormatDescriptor {
  /** Served as this, and the type recorded with the stored blob. */
  mimeType: string;
  /** Shown on the attachment card. */
  label: string;
  /** False for the text-based formats (OBJ, ASCII glTF, VRML, G-code). */
  binary: boolean;
  preview: ModelPreviewStrategy;
  /**
   * Which axis the format treats as up, for formats that agree on one. The
   * viewer's world is Z-up. Omitted where the format genuinely does not say.
   */
  upAxis: "y" | "z";
  /** Named on the card when the format cannot be previewed. */
  exportHint?: string;
}

const OCTET = "application/octet-stream";

export const MODEL_ATTACHMENT_FORMATS: Record<ModelAttachmentFormat, ModelFormatDescriptor> = {
  // --- read in the browser ---------------------------------------------
  glb: { mimeType: "model/gltf-binary", label: "glTF (binary)", binary: true, preview: "three", upAxis: "y" },
  gltf: { mimeType: "model/gltf+json", label: "glTF (JSON)", binary: false, preview: "three", upAxis: "y" },
  obj: { mimeType: "model/obj", label: "Wavefront OBJ", binary: false, preview: "three", upAxis: "y" },
  stl: { mimeType: "model/stl", label: "STL", binary: true, preview: "three", upAxis: "z" },
  ply: { mimeType: "model/ply", label: "PLY", binary: true, preview: "three", upAxis: "z" },
  fbx: { mimeType: "model/fbx", label: "FBX", binary: true, preview: "three", upAxis: "y" },
  "3mf": { mimeType: "model/3mf", label: "3MF", binary: true, preview: "three", upAxis: "z" },
  dae: { mimeType: "model/vnd.collada+xml", label: "Collada", binary: false, preview: "three", upAxis: "y" },
  "3ds": { mimeType: "application/x-3ds", label: "3D Studio", binary: true, preview: "three", upAxis: "z" },
  amf: { mimeType: "application/x-amf", label: "AMF", binary: true, preview: "three", upAxis: "z" },
  wrl: { mimeType: "model/vrml", label: "VRML", binary: false, preview: "three", upAxis: "y" },
  vtk: { mimeType: "model/vtk", label: "VTK mesh", binary: true, preview: "three", upAxis: "z" },
  pcd: { mimeType: "application/octet-stream", label: "PCD point cloud", binary: true, preview: "three", upAxis: "z" },
  xyz: { mimeType: "text/plain", label: "XYZ point cloud", binary: false, preview: "three", upAxis: "z" },
  usdz: { mimeType: "model/vnd.usdz+zip", label: "USDZ", binary: true, preview: "three", upAxis: "y" },
  kmz: { mimeType: "application/vnd.google-earth.kmz", label: "KMZ", binary: true, preview: "three", upAxis: "y" },
  lwo: { mimeType: OCTET, label: "LightWave", binary: true, preview: "three", upAxis: "y" },
  vox: { mimeType: OCTET, label: "MagicaVoxel", binary: true, preview: "three", upAxis: "z" },
  gcode: { mimeType: "text/x.gcode", label: "G-code toolpath", binary: false, preview: "three", upAxis: "z" },
  pdb: { mimeType: "chemical/x-pdb", label: "PDB molecule", binary: false, preview: "three", upAxis: "z" },

  // --- tessellated by the local CAD kernel ------------------------------
  step: { mimeType: "model/step", label: "STEP", binary: false, preview: "kernel", upAxis: "z" },
  stp: { mimeType: "model/step", label: "STEP", binary: false, preview: "kernel", upAxis: "z" },
  iges: { mimeType: "model/iges", label: "IGES", binary: false, preview: "kernel", upAxis: "z" },
  igs: { mimeType: "model/iges", label: "IGES", binary: false, preview: "kernel", upAxis: "z" },
  brep: { mimeType: "model/brep", label: "OpenCascade BREP", binary: false, preview: "kernel", upAxis: "z" },

  // --- kept, never rendered ---------------------------------------------
  sldprt: {
    mimeType: OCTET, label: "SolidWorks part", binary: true, preview: "none", upAxis: "z",
    exportHint: "SolidWorks: File ▸ Save As ▸ STEP AP214 (.step)",
  },
  sldasm: {
    mimeType: OCTET, label: "SolidWorks assembly", binary: true, preview: "none", upAxis: "z",
    exportHint: "SolidWorks: File ▸ Save As ▸ STEP AP214 (.step)",
  },
  ipt: {
    mimeType: OCTET, label: "Inventor part", binary: true, preview: "none", upAxis: "z",
    exportHint: "Inventor: File ▸ Export ▸ CAD Format ▸ STEP",
  },
  iam: {
    mimeType: OCTET, label: "Inventor assembly", binary: true, preview: "none", upAxis: "z",
    exportHint: "Inventor: File ▸ Export ▸ CAD Format ▸ STEP",
  },
  catpart: {
    mimeType: OCTET, label: "CATIA part", binary: true, preview: "none", upAxis: "z",
    exportHint: "CATIA: File ▸ Save As ▸ STEP",
  },
  catproduct: {
    mimeType: OCTET, label: "CATIA assembly", binary: true, preview: "none", upAxis: "z",
    exportHint: "CATIA: File ▸ Save As ▸ STEP",
  },
  prt: {
    mimeType: OCTET, label: "Native CAD part", binary: true, preview: "none", upAxis: "z",
    exportHint: "Export it as STEP (.step) from the application that made it",
  },
  f3d: {
    mimeType: OCTET, label: "Fusion 360 archive", binary: true, preview: "none", upAxis: "z",
    exportHint: "Fusion: File ▸ Export ▸ STEP",
  },
};

export const MODEL_ATTACHMENT_EXTENSIONS = Object.keys(
  MODEL_ATTACHMENT_FORMATS,
) as ModelAttachmentFormat[];

export function modelPreviewStrategy(format: ModelAttachmentFormat): ModelPreviewStrategy {
  return MODEL_ATTACHMENT_FORMATS[format].preview;
}

export function modelExportHint(format: ModelAttachmentFormat): string | undefined {
  return MODEL_ATTACHMENT_FORMATS[format].exportHint;
}

/** Formats OpenCascade reads, which the CAD service tessellates on upload. */
export const KERNEL_MODEL_FORMATS = MODEL_ATTACHMENT_EXTENSIONS.filter(
  (format) => MODEL_ATTACHMENT_FORMATS[format].preview === "kernel",
);

/** Appended to the composer's `accept`, so the picker offers 3D files too. */
export const MODEL_ATTACHMENT_ACCEPT = MODEL_ATTACHMENT_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");

/**
 * 64 MB. Large enough for a scanned part or a textured scene, small enough that
 * one attachment cannot fill the data directory by itself. Enforced on the
 * server; the client checks first only so the user hears about it before the
 * upload rather than after it.
 */
export const MAX_MODEL_ATTACHMENT_BYTES = 64 * 1024 * 1024;

const MODEL_BLOB_ID = /^mdl_[0-9a-f]{32}$/;

export function isModelBlobId(value: unknown): value is string {
  return typeof value === "string" && MODEL_BLOB_ID.test(value);
}

export function isModelAttachmentFormat(value: unknown): value is ModelAttachmentFormat {
  return typeof value === "string" && value in MODEL_ATTACHMENT_FORMATS;
}

/**
 * The format a filename claims, or null when it is not a 3D file at all.
 *
 * A real extension is required: a file named `stl`, or `.stl` with nothing in
 * front of it, claims nothing. The claim is checked against the bytes on the
 * server regardless — see conversations/model-inspect.ts.
 */
export function modelAttachmentFormat(name: string): ModelAttachmentFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return isModelAttachmentFormat(extension) ? extension : null;
}

export function modelFormatLabel(format: ModelAttachmentFormat): string {
  return MODEL_ATTACHMENT_FORMATS[format].label;
}

export function modelFormatMimeType(format: ModelAttachmentFormat): string {
  return MODEL_ATTACHMENT_FORMATS[format].mimeType;
}

/**
 * Which axis a format conventionally treats as up.
 *
 * The viewer's world is Z-up, so a Y-up file has to be turned to stand in it.
 * glTF fixes Y-up in its specification and FBX is Y-up in practice; STL, 3MF and
 * everything from the CAD kernel are Z-up. Several formats — OBJ, PLY, VRML —
 * specify nothing at all, and their two big producer communities disagree
 * (modelling tools export Y-up, scanners and slicers Z-up), so this is a
 * starting guess the viewer lets the user correct, not a fact about the file.
 */
export function defaultModelUpAxis(format: ModelAttachmentFormat): "y" | "z" {
  return MODEL_ATTACHMENT_FORMATS[format].upAxis;
}

/** Where the stored bytes are read from — the viewer's `source`. */
export function modelAttachmentHref(blobId: string, options?: { download?: boolean }): string {
  const base = `/api/chat-attachments/models/${encodeURIComponent(blobId)}`;
  return options?.download ? `${base}?download=1` : base;
}

/**
 * What was read out of the file at upload time.
 *
 * The viewer does not need this — it re-reads the file — but the chat card and,
 * more importantly, the language model do: without it an attached mesh is a
 * filename and nothing else. Every field is optional because the cheap header
 * parse is only possible for some formats.
 */
export interface ModelAttachmentSummary {
  /** Triangles, for the formats that state or imply a count. */
  triangles?: number;
  vertices?: number;
  meshes?: number;
  materials?: number;
  animations?: number;
  /** Axis-aligned size in the file's own units, x/y/z. */
  extent?: { x: number; y: number; z: number };
  /** Whatever produced the file, when it says so. */
  generator?: string;
  /** Free-text notes, e.g. that a glTF references external buffers. */
  notes?: string[];
}

function positiveCount(value: unknown): number | undefined {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 && count < Number.MAX_SAFE_INTEGER
    ? Math.round(count)
    : undefined;
}

function finiteAxis(value: unknown): number | undefined {
  const axis = Number(value);
  return Number.isFinite(axis) ? axis : undefined;
}

/**
 * Rebuild a summary from transcript metadata, which is not trusted: a stored
 * message is only ever as good as whatever was written into it, and this value
 * ends up both on screen and in a prompt.
 */
export function normalizeModelAttachmentSummary(
  value: unknown,
): ModelAttachmentSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const summary: ModelAttachmentSummary = {};

  for (const key of ["triangles", "vertices", "meshes", "materials", "animations"] as const) {
    const count = positiveCount(record[key]);
    if (count !== undefined) summary[key] = count;
  }

  const extent = record.extent;
  if (extent && typeof extent === "object" && !Array.isArray(extent)) {
    const axes = extent as Record<string, unknown>;
    const x = finiteAxis(axes.x);
    const y = finiteAxis(axes.y);
    const z = finiteAxis(axes.z);
    if (x !== undefined && y !== undefined && z !== undefined) summary.extent = { x, y, z };
  }

  if (typeof record.generator === "string" && record.generator.trim()) {
    summary.generator = record.generator.trim().slice(0, 120);
  }

  if (Array.isArray(record.notes)) {
    const notes = record.notes
      .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      .slice(0, 4)
      .map((note) => note.trim().slice(0, 400));
    if (notes.length > 0) summary.notes = notes;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function rounded(value: number): string {
  return Number(value.toPrecision(4)).toString();
}

/**
 * What the language model is told about an attached mesh.
 *
 * Everything else the user attaches reaches the model as content: a document as
 * its text, a screenshot as an image it can look at. A 3D file reaches it as
 * neither — so it gets the measurements instead, and is told plainly that the
 * geometry itself is not in front of it, to stop it describing a shape it has
 * never seen.
 */
export function modelAttachmentPromptText(attachment: {
  name: string;
  format: ModelAttachmentFormat;
  sizeBytes?: number;
  summary?: ModelAttachmentSummary;
}): string {
  const { summary } = attachment;
  const lines = [
    "The user attached a 3D model file. They can see it rendered in the chat; you cannot see its geometry, only the measurements below.",
    `Format: ${modelFormatLabel(attachment.format)} (.${attachment.format})`,
  ];
  if (attachment.sizeBytes !== undefined) {
    lines.push(`File size: ${formatModelSize(attachment.sizeBytes)}`);
  }
  // Plain digits, no locale grouping: this text is read by a language model, and
  // on a machine set to a European locale `(12480).toLocaleString()` is "12.480"
  // — a number the reader has every reason to take for twelve and a half.
  if (summary?.triangles !== undefined) lines.push(`Triangles: ${summary.triangles}`);
  if (summary?.vertices !== undefined) lines.push(`Vertices: ${summary.vertices}`);
  if (summary?.meshes !== undefined) lines.push(`Meshes: ${summary.meshes}`);
  if (summary?.materials !== undefined) lines.push(`Materials: ${summary.materials}`);
  if (summary?.animations !== undefined) lines.push(`Animations: ${summary.animations}`);
  if (summary?.extent) {
    const { x, y, z } = summary.extent;
    lines.push(
      `Bounding box: ${rounded(x)} × ${rounded(y)} × ${rounded(z)} (in the file's own units, which it does not state)`,
    );
  }
  if (summary?.generator) lines.push(`Produced by: ${summary.generator}`);
  if (modelPreviewStrategy(attachment.format) === "none") {
    // Say it once, plainly, so the assistant does not offer to inspect a file
    // nothing here can open.
    lines.push(
      "This is a proprietary CAD format that Breadboard cannot open or render — it is stored and downloadable only. " +
        `Neither you nor the viewer can see its geometry. If the user wants it examined, ask them to re-attach it as STEP (${
          modelExportHint(attachment.format) ?? "export it as STEP from the application that made it"
        }).`,
    );
  }
  for (const note of summary?.notes ?? []) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

export function formatModelSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} bytes`;
  // No locale grouping: this string reaches the prompt as well as the card.
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
