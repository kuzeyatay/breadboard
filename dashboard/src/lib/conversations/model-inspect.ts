// Reads an uploaded 3D file well enough to trust it and to describe it.
//
// Two jobs, one pass, because they need the same bytes:
//
//   Trust — the extension is a claim the browser makes, so every format is
//   confirmed against what the file actually starts with before anything is
//   written. A .glb that is really a zip is rejected here rather than handed to
//   a loader.
//
//   Describe — a mesh has no text to extract, so without this step an attached
//   model reaches the language model as a filename and nothing more. Headers and
//   vertex tables are cheap to read, so the model gets told the triangle count
//   and the bounding box instead of being left to guess.
//
// Only headers and coordinate lists are parsed. Nothing here builds geometry,
// decodes a texture, or runs a loader.

import {
  isModelAttachmentFormat,
  modelPreviewStrategy,
  type ModelAttachmentFormat,
  type ModelAttachmentSummary,
} from "../model-attachments.ts";

export class ModelInspectionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelInspectionError";
    this.code = code;
    this.status = 400;
  }
}

/** glTF's container magic, `glTF` as a little-endian uint32. */
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const ZIP_MAGIC = "PK";
const FBX_BINARY_MAGIC = "Kaydara FBX Binary";
/** A glTF JSON chunk beyond this is not worth parsing to count triangles. */
const MAX_GLTF_JSON_BYTES = 32 * 1024 * 1024;

class Bounds {
  private min: [number, number, number] = [Infinity, Infinity, Infinity];
  private max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  add(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const point: [number, number, number] = [x, y, z];
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < this.min[axis]) this.min[axis] = point[axis];
      if (point[axis] > this.max[axis]) this.max[axis] = point[axis];
    }
  }

  extent(): { x: number; y: number; z: number } | undefined {
    if (!Number.isFinite(this.min[0]) || !Number.isFinite(this.max[0])) return undefined;
    return {
      x: this.max[0] - this.min[0],
      y: this.max[1] - this.min[1],
      z: this.max[2] - this.min[2],
    };
  }
}

function asciiHead(content: Buffer, length = 512): string {
  return content.subarray(0, Math.min(length, content.byteLength)).toString("latin1");
}

// --- glTF ---------------------------------------------------------------

interface GltfDocument {
  asset?: { generator?: unknown; version?: unknown };
  meshes?: Array<{ primitives?: Array<Record<string, unknown>> }>;
  materials?: unknown[];
  animations?: unknown[];
  accessors?: Array<{ count?: unknown; min?: unknown; max?: unknown }>;
  buffers?: Array<{ uri?: unknown }>;
  images?: Array<{ uri?: unknown }>;
}

function numberAt(values: unknown, index: number): number | undefined {
  if (!Array.isArray(values)) return undefined;
  const value = values[index];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeGltfDocument(document: GltfDocument): ModelAttachmentSummary {
  const accessors = Array.isArray(document.accessors) ? document.accessors : [];
  const accessorCount = (index: unknown): number | undefined => {
    if (typeof index !== "number") return undefined;
    const count = accessors[index]?.count;
    return typeof count === "number" && Number.isFinite(count) ? count : undefined;
  };

  const bounds = new Bounds();
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;

  for (const mesh of document.meshes ?? []) {
    meshes += 1;
    for (const primitive of mesh.primitives ?? []) {
      // glTF mode 4 is TRIANGLES and is also the default when mode is absent.
      const mode = primitive.mode;
      const attributes = primitive.attributes as Record<string, unknown> | undefined;
      const position = attributes?.POSITION;
      const positionCount = accessorCount(position);
      if (positionCount !== undefined) {
        vertices += positionCount;
        const accessor = accessors[position as number];
        const minX = numberAt(accessor?.min, 0);
        const maxX = numberAt(accessor?.max, 0);
        if (minX !== undefined && maxX !== undefined) {
          bounds.add(minX, numberAt(accessor?.min, 1) ?? 0, numberAt(accessor?.min, 2) ?? 0);
          bounds.add(maxX, numberAt(accessor?.max, 1) ?? 0, numberAt(accessor?.max, 2) ?? 0);
        }
      }
      if (mode !== undefined && mode !== 4) continue;
      const indexed = accessorCount(primitive.indices);
      const drawn = indexed ?? positionCount;
      if (drawn !== undefined) triangles += Math.floor(drawn / 3);
    }
  }

  const notes: string[] = [];
  const external = [...(document.buffers ?? []), ...(document.images ?? [])].filter(
    (entry) => typeof entry.uri === "string" && !entry.uri.startsWith("data:"),
  );
  if (external.length > 0) {
    notes.push(
      `References ${external.length} external file${external.length === 1 ? "" : "s"}, which are not uploaded with the model and will be missing from the preview.`,
    );
  }

  const generator = document.asset?.generator;
  return {
    ...(triangles > 0 ? { triangles } : {}),
    ...(vertices > 0 ? { vertices } : {}),
    ...(meshes > 0 ? { meshes } : {}),
    ...(Array.isArray(document.materials) && document.materials.length > 0
      ? { materials: document.materials.length }
      : {}),
    ...(Array.isArray(document.animations) && document.animations.length > 0
      ? { animations: document.animations.length }
      : {}),
    ...(bounds.extent() ? { extent: bounds.extent() } : {}),
    ...(typeof generator === "string" && generator.trim()
      ? { generator: generator.trim().slice(0, 120) }
      : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function inspectGlb(content: Buffer): ModelAttachmentSummary {
  if (content.byteLength < 20 || content.readUInt32LE(0) !== GLB_MAGIC) {
    throw new ModelInspectionError("invalid_glb", "That file is not a binary glTF (.glb).");
  }
  let offset = 12;
  while (offset + 8 <= content.byteLength) {
    const chunkLength = content.readUInt32LE(offset);
    const chunkType = content.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + chunkLength > content.byteLength) break;
    if (chunkType === GLB_JSON_CHUNK) {
      if (chunkLength > MAX_GLTF_JSON_BYTES) return {};
      try {
        const document = JSON.parse(
          content.subarray(start, start + chunkLength).toString("utf8"),
        ) as GltfDocument;
        return summarizeGltfDocument(document);
      } catch {
        throw new ModelInspectionError("invalid_glb", "That .glb file's scene description could not be read.");
      }
    }
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  return {};
}

function inspectGltfJson(content: Buffer): ModelAttachmentSummary {
  if (content.byteLength > MAX_GLTF_JSON_BYTES) {
    throw new ModelInspectionError("invalid_gltf", "That .gltf file is too large to read.");
  }
  let document: GltfDocument;
  try {
    document = JSON.parse(content.toString("utf8")) as GltfDocument;
  } catch {
    throw new ModelInspectionError("invalid_gltf", "That .gltf file is not valid JSON.");
  }
  if (!document || typeof document !== "object" || !document.asset) {
    throw new ModelInspectionError("invalid_gltf", "That file is not a glTF document.");
  }
  return summarizeGltfDocument(document);
}

// --- STL ----------------------------------------------------------------

/** Binary STL has no magic: it is identified by its length being exact. */
function binaryStlTriangleCount(content: Buffer): number | null {
  if (content.byteLength < 84) return null;
  const triangles = content.readUInt32LE(80);
  return 84 + triangles * 50 === content.byteLength ? triangles : null;
}

function inspectStl(content: Buffer): ModelAttachmentSummary {
  const triangles = binaryStlTriangleCount(content);
  if (triangles !== null) {
    const bounds = new Bounds();
    for (let index = 0; index < triangles; index += 1) {
      // 12 bytes of face normal, then three vertices of three floats each.
      const base = 84 + index * 50 + 12;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const offset = base + vertex * 12;
        bounds.add(
          content.readFloatLE(offset),
          content.readFloatLE(offset + 4),
          content.readFloatLE(offset + 8),
        );
      }
    }
    return {
      triangles,
      vertices: triangles * 3,
      meshes: 1,
      ...(bounds.extent() ? { extent: bounds.extent() } : {}),
    };
  }

  const text = content.toString("utf8");
  if (!/^\s*solid\b/.test(text) || !/facet\s+normal/i.test(text)) {
    throw new ModelInspectionError("invalid_stl", "That file is not an STL mesh.");
  }
  const bounds = new Bounds();
  let facets = 0;
  let solids = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("facet")) facets += 1;
    else if (trimmed.startsWith("solid")) solids += 1;
    else if (trimmed.startsWith("vertex")) {
      const [x, y, z] = trimmed.slice(6).trim().split(/\s+/).map(Number);
      bounds.add(x, y, z);
    }
  }
  return {
    triangles: facets,
    vertices: facets * 3,
    meshes: Math.max(1, solids),
    ...(bounds.extent() ? { extent: bounds.extent() } : {}),
  };
}

// --- OBJ ----------------------------------------------------------------

function inspectObj(content: Buffer): ModelAttachmentSummary {
  const text = content.toString("utf8");
  const bounds = new Bounds();
  let vertices = 0;
  let triangles = 0;
  let groups = 0;
  const materials = new Set<string>();
  let referencesMaterialLibrary = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      vertices += 1;
      const [x, y, z] = trimmed.slice(2).trim().split(/\s+/).map(Number);
      bounds.add(x, y, z);
    } else if (trimmed.startsWith("f ")) {
      // A face of n corners is drawn as n - 2 triangles.
      const corners = trimmed.slice(2).trim().split(/\s+/).length;
      if (corners >= 3) triangles += corners - 2;
    } else if (trimmed.startsWith("o ") || trimmed.startsWith("g ")) {
      groups += 1;
    } else if (trimmed.startsWith("usemtl ")) {
      materials.add(trimmed.slice(7).trim());
    } else if (trimmed.startsWith("mtllib ")) {
      referencesMaterialLibrary = true;
    }
  }

  if (vertices === 0) {
    throw new ModelInspectionError("invalid_obj", "That file contains no Wavefront OBJ geometry.");
  }
  return {
    vertices,
    ...(triangles > 0 ? { triangles } : {}),
    meshes: Math.max(1, groups),
    ...(materials.size > 0 ? { materials: materials.size } : {}),
    ...(bounds.extent() ? { extent: bounds.extent() } : {}),
    ...(referencesMaterialLibrary
      ? {
          notes: [
            "References a .mtl material library, which is not uploaded with the model, so the preview shows untextured geometry.",
          ],
        }
      : {}),
  };
}

// --- PLY ----------------------------------------------------------------

function inspectPly(content: Buffer): ModelAttachmentSummary {
  const head = asciiHead(content, 4096);
  if (!/^ply\r?\n/.test(head)) {
    throw new ModelInspectionError("invalid_ply", "That file is not a PLY mesh.");
  }
  let vertices: number | undefined;
  let faces: number | undefined;
  for (const line of head.split(/\r?\n/)) {
    const vertexMatch = /^element\s+vertex\s+(\d+)/.exec(line);
    if (vertexMatch) vertices = Number(vertexMatch[1]);
    const faceMatch = /^element\s+face\s+(\d+)/.exec(line);
    if (faceMatch) faces = Number(faceMatch[1]);
    if (line.trim() === "end_header") break;
  }
  return {
    ...(vertices !== undefined ? { vertices } : {}),
    // A PLY face may have more than three corners; the count is a floor.
    ...(faces !== undefined ? { triangles: faces } : {}),
    meshes: 1,
  };
}

// --- FBX and 3MF --------------------------------------------------------

function inspectFbx(content: Buffer): ModelAttachmentSummary {
  const head = asciiHead(content, 64);
  if (head.startsWith(FBX_BINARY_MAGIC)) {
    const version = content.byteLength >= 27 ? content.readUInt32LE(23) : 0;
    return version > 0 ? { generator: `FBX ${version}` } : {};
  }
  if (/FBX\s/i.test(head) || /^\s*;/.test(head)) return {};
  throw new ModelInspectionError("invalid_fbx", "That file is not an FBX scene.");
}

function inspect3mf(content: Buffer): ModelAttachmentSummary {
  if (!asciiHead(content, 4).startsWith(ZIP_MAGIC)) {
    throw new ModelInspectionError("invalid_3mf", "That file is not a 3MF package.");
  }
  return {};
}

// --- text and container formats -----------------------------------------

/** STEP is a plain-text ISO 10303 exchange file with a fixed preamble. */
function inspectStep(content: Buffer): ModelAttachmentSummary {
  const head = asciiHead(content, 2048);
  if (!/ISO-10303-21\s*;/.test(head)) {
    throw new ModelInspectionError("invalid_step", "That file is not a STEP exchange file.");
  }
  // Everything worth knowing about a STEP file comes from the kernel that reads
  // it, so nothing is guessed from the text here.
  return {};
}

function inspectIges(content: Buffer): ModelAttachmentSummary {
  const head = asciiHead(content, 2048);
  // IGES is a fixed 80-column record format; column 73 of a line carries the
  // section letter, and a file always opens on S (start) or F (global).
  if (!/^.{72}[SF]\s*\d/m.test(head)) {
    throw new ModelInspectionError("invalid_iges", "That file is not an IGES exchange file.");
  }
  return {};
}

function inspectBrep(content: Buffer): ModelAttachmentSummary {
  if (!/^\s*DBRep_DrawableShape|^\s*CASCADE Topology/.test(asciiHead(content, 256))) {
    throw new ModelInspectionError("invalid_brep", "That file is not an OpenCascade BREP file.");
  }
  return {};
}

function inspectXml(content: Buffer, root: RegExp, code: string, label: string) {
  const head = asciiHead(content, 4096);
  if (!root.test(head)) {
    throw new ModelInspectionError(code, `That file is not ${label}.`);
  }
  return {};
}

function inspectZipContainer(content: Buffer, code: string, label: string) {
  if (!asciiHead(content, 4).startsWith(ZIP_MAGIC)) {
    throw new ModelInspectionError(code, `That file is not ${label}.`);
  }
  return {};
}

/** A count of matching lines, for the line-oriented text formats. */
function countLines(content: Buffer, pattern: RegExp, limit = 4 * 1024 * 1024): number {
  const text = content.subarray(0, limit).toString("utf8");
  let count = 0;
  for (const line of text.split(/\r?\n/)) if (pattern.test(line)) count += 1;
  return count;
}

function inspectXyz(content: Buffer): ModelAttachmentSummary {
  const bounds = new Bounds();
  let points = 0;
  for (const line of content.toString("utf8").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [x, y, z] = parts.map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    points += 1;
    bounds.add(x, y, z);
  }
  if (points === 0) {
    throw new ModelInspectionError("invalid_xyz", "That file contains no XYZ point data.");
  }
  return { vertices: points, ...(bounds.extent() ? { extent: bounds.extent() } : {}) };
}

/**
 * Confirm the bytes really are the format the filename claims, and read what
 * can be read cheaply. Throws `ModelInspectionError` when they are not.
 *
 * Depth varies by what the format makes cheap. A mesh format states its counts
 * in a header; a boundary-representation file only yields them to a kernel, so
 * for those this confirms the format and leaves the measuring to the CAD
 * service (see model-kernel-preview.ts).
 */
export function inspectModelUpload(
  content: Buffer,
  format: ModelAttachmentFormat,
): ModelAttachmentSummary {
  if (!isModelAttachmentFormat(format)) {
    throw new ModelInspectionError("invalid_model_format", "That 3D format is not supported.");
  }
  // A vendor's native part file is stored, never parsed. Its layout is
  // undocumented, so there is no honest check beyond "not empty".
  if (modelPreviewStrategy(format) === "none") return {};

  switch (format) {
    case "glb":
      return inspectGlb(content);
    case "gltf":
      return inspectGltfJson(content);
    case "stl":
      return inspectStl(content);
    case "obj":
      return inspectObj(content);
    case "ply":
      return inspectPly(content);
    case "fbx":
      return inspectFbx(content);
    case "3mf":
      return inspect3mf(content);
    case "step":
    case "stp":
      return inspectStep(content);
    case "iges":
    case "igs":
      return inspectIges(content);
    case "brep":
      return inspectBrep(content);
    case "dae":
      return inspectXml(content, /<COLLADA[\s>]/i, "invalid_dae", "a Collada document");
    case "amf":
      // AMF is XML, optionally zipped.
      return asciiHead(content, 4).startsWith(ZIP_MAGIC)
        ? {}
        : inspectXml(content, /<amf[\s>]/i, "invalid_amf", "an AMF document");
    case "wrl":
      return inspectXml(content, /^#VRML\s+V[12]/i, "invalid_wrl", "a VRML world");
    case "usdz":
      return inspectZipContainer(content, "invalid_usdz", "a USDZ package");
    case "kmz":
      return inspectZipContainer(content, "invalid_kmz", "a KMZ archive");
    case "3ds":
      // A 3DS file opens with the primary chunk id 0x4D4D.
      if (content.byteLength < 6 || content.readUInt16LE(0) !== 0x4d4d) {
        throw new ModelInspectionError("invalid_3ds", "That file is not a 3D Studio scene.");
      }
      return {};
    case "vox":
      if (!asciiHead(content, 4).startsWith("VOX ")) {
        throw new ModelInspectionError("invalid_vox", "That file is not a MagicaVoxel model.");
      }
      return {};
    case "lwo":
      if (!asciiHead(content, 4).startsWith("FORM")) {
        throw new ModelInspectionError("invalid_lwo", "That file is not a LightWave object.");
      }
      return {};
    case "vtk":
      if (!/^#\s*vtk\s+DataFile|^<VTKFile/i.test(asciiHead(content, 256))) {
        throw new ModelInspectionError("invalid_vtk", "That file is not a VTK dataset.");
      }
      return {};
    case "pcd": {
      const head = asciiHead(content, 2048);
      if (!/^#\s*\.PCD|^VERSION\s/m.test(head)) {
        throw new ModelInspectionError("invalid_pcd", "That file is not a PCD point cloud.");
      }
      const points = /^POINTS\s+(\d+)/m.exec(head);
      return points ? { vertices: Number(points[1]) } : {};
    }
    case "xyz":
      return inspectXyz(content);
    case "gcode": {
      // G-code has no magic; a toolpath is identified by having moves in it.
      const moves = countLines(content, /^\s*(?:N\d+\s*)?G[0-3]\b/i);
      if (moves === 0) {
        throw new ModelInspectionError("invalid_gcode", "That file contains no G-code moves.");
      }
      return { notes: [`${moves.toLocaleString()} toolpath moves in the first few megabytes.`] };
    }
    case "pdb": {
      const atoms = countLines(content, /^(?:ATOM|HETATM)\s/);
      if (atoms === 0) {
        throw new ModelInspectionError("invalid_pdb", "That file contains no PDB atom records.");
      }
      return { vertices: atoms };
    }
    default:
      return {};
  }
}
