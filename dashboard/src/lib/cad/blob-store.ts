// Where a CAD revision's files live on disk.
//
// Under Breadboard-controlled application storage, never a user-chosen path and
// never a filename the model supplied: every path in this module is built from
// a validated project id, an integer revision, and a format drawn from a fixed
// list. Writes are atomic (temp file + rename) and every file is hashed on the
// way in, so a partially written export can never be served as a complete one.

import crypto from "node:crypto";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import type { CADExportFormat } from "./types.ts";

const PROJECT_ID = /^cadp_[0-9a-f]{32}$/;

export const CAD_FILE_DESCRIPTORS: Record<
  CADExportFormat,
  { filename: string; mimeType: string; label: string; binary: boolean }
> = {
  step: {
    filename: "model.step",
    mimeType: "model/step",
    label: "STEP (editable CAD)",
    binary: false,
  },
  stl: {
    filename: "model.stl",
    mimeType: "model/stl",
    label: "STL (for slicing)",
    binary: true,
  },
  glb: {
    filename: "model.glb",
    mimeType: "model/gltf-binary",
    label: "GLB (3D preview)",
    binary: true,
  },
  "3mf": {
    filename: "model.3mf",
    mimeType: "model/3mf",
    label: "3MF (for slicing)",
    binary: true,
  },
  sldprt: {
    filename: "model.SLDPRT",
    mimeType: "application/octet-stream",
    label: "SLDPRT (native SolidWorks part)",
    binary: true,
  },
  source: {
    filename: "model.py",
    mimeType: "text/x-python; charset=utf-8",
    label: "CadQuery source",
    binary: false,
  },
  // A SolidWorks build has no Python program; its design is the ordered
  // operation list, which belongs in its own slot rather than in a file called
  // model.py that contains JSON.
  operations: {
    filename: "operations.json",
    mimeType: "application/json; charset=utf-8",
    label: "SolidWorks operations",
    binary: false,
  },
  spec: {
    filename: "design-spec.json",
    mimeType: "application/json; charset=utf-8",
    label: "Design specification",
    binary: false,
  },
  report: {
    filename: "validation.json",
    mimeType: "application/json; charset=utf-8",
    label: "Validation report",
    binary: false,
  },
};

export class CadStorageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CadStorageError";
    this.code = code;
    this.status = status;
  }
}

export function cadStorageRoot(configured?: string): string {
  const root = path.resolve(configured ?? path.join(dashboardDataDir(), "cad-projects"));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function newProjectId(): string {
  return `cadp_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isProjectId(value: string): boolean {
  return PROJECT_ID.test(value);
}

function requireProjectId(projectId: string): string {
  if (!isProjectId(projectId)) {
    throw new CadStorageError(400, "invalid_project_id", "That CAD project id is not valid.");
  }
  return projectId;
}

function requireRevision(revision: number): number {
  if (!Number.isInteger(revision) || revision < 1 || revision > 100_000) {
    throw new CadStorageError(400, "invalid_revision", "That CAD revision number is not valid.");
  }
  return revision;
}

/** `<project>/revisions/0001` — zero-padded so a directory listing sorts. */
export function revisionRelativeDirectory(projectId: string, revision: number): string {
  return path.posix.join(
    requireProjectId(projectId),
    "revisions",
    String(requireRevision(revision)).padStart(4, "0"),
  );
}

export function revisionRelativePath(
  projectId: string,
  revision: number,
  format: CADExportFormat,
): string {
  const descriptor = CAD_FILE_DESCRIPTORS[format];
  if (!descriptor) {
    throw new CadStorageError(400, "invalid_export_format", "That export format is not supported.");
  }
  return path.posix.join(revisionRelativeDirectory(projectId, revision), descriptor.filename);
}

/** Resolve a stored relative path and refuse anything that leaves the root. */
export function resolveStoredCadPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes("\0")) {
    throw new CadStorageError(500, "invalid_cad_storage", "CAD storage metadata is invalid.");
  }
  const target = path.resolve(root, ...relative.split("/"));
  const rest = path.relative(root, target);
  if (rest.startsWith("..") || path.isAbsolute(rest)) {
    throw new CadStorageError(500, "invalid_cad_storage", "CAD storage escaped its controlled root.");
  }
  return target;
}

function atomicWrite(target: string, content: Buffer | string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
}

export interface WrittenCadFile {
  format: CADExportFormat;
  filename: string;
  mimeType: string;
  relativePath: string;
  byteSize: number;
  sha256: string;
}

export function writeRevisionFile(input: {
  projectId: string;
  revision: number;
  format: CADExportFormat;
  content: Buffer | string;
  storageRoot?: string;
}): WrittenCadFile {
  const descriptor = CAD_FILE_DESCRIPTORS[input.format];
  if (!descriptor) {
    throw new CadStorageError(400, "invalid_export_format", "That export format is not supported.");
  }
  const relativePath = revisionRelativePath(input.projectId, input.revision, input.format);
  const root = cadStorageRoot(input.storageRoot);
  const target = resolveStoredCadPath(root, relativePath);
  const payload =
    typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;
  atomicWrite(target, payload);
  return {
    format: input.format,
    filename: descriptor.filename,
    mimeType: descriptor.mimeType,
    relativePath,
    byteSize: payload.byteLength,
    sha256: crypto.createHash("sha256").update(payload).digest("hex"),
  };
}

export function readRevisionFile(input: {
  relativePath: string;
  expectedSha256?: string;
  storageRoot?: string;
}): Buffer {
  const root = cadStorageRoot(input.storageRoot);
  const target = resolveStoredCadPath(root, input.relativePath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new CadStorageError(404, "cad_file_unavailable", "That CAD file is not available.");
  }
  const payload = fs.readFileSync(target);
  if (input.expectedSha256) {
    const digest = crypto.createHash("sha256").update(payload).digest("hex");
    if (digest !== input.expectedSha256) {
      throw new CadStorageError(
        409,
        "cad_file_corrupt",
        "That CAD file no longer matches the hash recorded when it was written.",
      );
    }
  }
  return payload;
}

/** Remove every file a project owns. Used when its artifact is deleted. */
export function removeProjectFiles(projectId: string, storageRoot?: string): void {
  if (!isProjectId(projectId)) return;
  try {
    const root = cadStorageRoot(storageRoot);
    fs.rmSync(resolveStoredCadPath(root, projectId), { recursive: true, force: true });
  } catch {
    // Stored files may already be gone; the database rows are what the UI reads.
  }
}
