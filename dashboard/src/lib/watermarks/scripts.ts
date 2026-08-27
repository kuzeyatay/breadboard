import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

// watermarks-remover (github.com/guillaumemeyer/watermarks-remover) strips AI
// provenance marks from text and files: invisible Unicode carriers, C2PA
// manifests, EXIF/XMP blocks and document container properties. The vendored
// clone is pinned in `watermarks-remover/BREADBOARD_UPSTREAM_COMMIT`.
//
// Python execution belongs exclusively to the fresh Runtime V2 watermark
// worker. This module deliberately retains only source discovery and path
// containment; importing it in Next can never launch an interpreter.

export class WatermarkError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WatermarkError";
    this.status = status;
    this.code = code;
  }
}

/** Root of the vendored clone; `WATERMARKS_REMOVER_ROOT` overrides it. */
export function cloneRoot(): string {
  const configured = process.env.WATERMARKS_REMOVER_ROOT?.trim();
  return configured ? path.resolve(configured) : path.join(repositoryRoot(), "watermarks-remover");
}

/**
 * The skill's `scripts/` directory — what actually gets executed. The packaged
 * app stages only this subtree plus `references/`, so both layouts resolve to
 * the same place.
 */
export function scriptsDir(): string {
  return path.join(cloneRoot(), "skills", "remove-ai-marks", "scripts");
}

export function scriptPath(name: string): string {
  return path.join(scriptsDir(), name);
}

/** Whether the vendored scripts are present, checked on the unified router. */
export function scriptsAvailable(): boolean {
  return fs.existsSync(scriptPath("clean_file.py")) && fs.existsSync(scriptPath("inspect_file.py"));
}

/**
 * Resolve a caller-supplied path inside the workspace, refusing anything that
 * escapes it. Copied from the Office tools' containment for the same reason:
 * a tool that opens any path a model writes is a tool that reads the user's
 * disk. `.breadboard` is denied outright — the session's own capability token
 * lives there.
 */
export function containWorkspacePath(
  workspace: string,
  raw: string,
  label: string,
  { allowRoot = false }: { allowRoot?: boolean } = {},
): string {
  const value = raw.trim();
  if (!value) {
    throw new WatermarkError(400, "watermarks_path_required", `${label} is required.`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new WatermarkError(
      400,
      "watermarks_path_remote",
      `${label} must be a file in this conversation's workspace, not a URL. Ask the user to attach it instead.`,
    );
  }
  const resolved = path.resolve(workspace, value);
  const relative = path.relative(workspace, resolved);
  if ((!relative && !allowRoot) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WatermarkError(
      403,
      "watermarks_path_outside_workspace",
      `${label} must be inside this conversation's workspace (got ${JSON.stringify(raw)}).`,
    );
  }
  if (relative.split(/[\\/]/).includes(".breadboard")) {
    throw new WatermarkError(403, "watermarks_path_reserved", `${label} may not reach the .breadboard directory.`);
  }
  return resolved;
}
