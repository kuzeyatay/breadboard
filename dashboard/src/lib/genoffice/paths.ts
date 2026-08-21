import fs from "node:fs";
import path from "node:path";

import { GenOfficeError } from "./types.ts";

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Resolve an agent-supplied file relative to its authorized workspace. Office
 * element addresses such as `/body/p[3]` never enter this function; callers
 * pass them as block anchors instead.
 */
export function resolveGenOfficeWorkspacePath(
  workspace: string,
  raw: string,
  label: string,
  options: { mustExist?: boolean } = {},
): string {
  if (!raw.trim() || raw.includes("\0")) {
    throw new GenOfficeError(400, "document_path_required", `${label} is required.`);
  }
  if (looksLikeUrl(raw)) {
    throw new GenOfficeError(
      400,
      "document_path_remote",
      `${label} must be a file inside the document workspace, not a URL.`,
    );
  }

  const root = path.resolve(workspace);
  const resolved = path.resolve(root, raw);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GenOfficeError(
      403,
      "document_path_outside_workspace",
      `${label} must be a path relative to the document workspace (got ${JSON.stringify(raw)}).`,
    );
  }

  let rootReal: string;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    throw new GenOfficeError(404, "document_workspace_not_found", "The document workspace was not found.");
  }

  // Resolve the nearest existing ancestor even for a new output path. This
  // closes the lexical-containment gap where a directory symlink inside the
  // workspace points outside it.
  let existingAncestor = resolved;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  let ancestorReal: string;
  try {
    ancestorReal = fs.realpathSync(existingAncestor);
  } catch {
    throw new GenOfficeError(404, "document_path_parent_not_found", `${label} has no accessible parent directory.`);
  }
  const ancestorRelative = path.relative(rootReal, ancestorReal);
  if (ancestorRelative.startsWith("..") || path.isAbsolute(ancestorRelative)) {
    throw new GenOfficeError(
      403,
      "document_path_outside_workspace",
      `${label} escapes the document workspace through a linked directory.`,
    );
  }

  if (options.mustExist) {
    let fileReal: string;
    try {
      if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error("symlink");
      fileReal = fs.realpathSync(resolved);
    } catch {
      throw new GenOfficeError(404, "document_file_not_found", `${label} was not found in the workspace.`);
    }
    const realRelative = path.relative(rootReal, fileReal);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new GenOfficeError(
        403,
        "document_path_outside_workspace",
        `${label} escapes the document workspace.`,
      );
    }
  }
  return resolved;
}
