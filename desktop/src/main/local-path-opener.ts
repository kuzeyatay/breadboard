// Opening a produced artifact where it lives on disk.
//
// A folder artifact's card asks for the directory the turn made; a file card
// asks for its file to be revealed. Two things are deliberately not offered:
// a relative or otherwise malformed path, and opening a *file* with its
// default application. Revealing a file selects it in the file explorer and
// lets the person decide what to do with it; opening it would run whatever
// it is, and a renderer must never be able to ask for that.

import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenLocalPathRequest, OpenLocalPathResult } from "../shared/ipc-contract";

export interface LocalPathShell {
  openPath(target: string): Promise<string>;
  showItemInFolder(target: string): void;
}

export function isOpenLocalPathRequest(value: unknown): value is OpenLocalPathRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request["path"] === "string" &&
    request["path"].trim().length > 0 &&
    (request["reveal"] === undefined || typeof request["reveal"] === "boolean")
  );
}

export async function openLocalPath(
  request: OpenLocalPathRequest,
  shell: LocalPathShell,
): Promise<OpenLocalPathResult> {
  const requested = request.path.trim();
  if (!path.isAbsolute(requested) || requested.includes("\0")) {
    return { ok: false, code: "invalid_path", error: "Only absolute paths can be opened." };
  }
  const target = path.resolve(requested);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(target);
  } catch {
    return { ok: false, code: "not_found", error: "That file or folder no longer exists." };
  }
  if (stats.isDirectory()) {
    const error = await shell.openPath(target);
    return error
      ? { ok: false, code: "open_failed", error }
      : { ok: true, opened: "folder" };
  }
  if (!stats.isFile()) {
    return { ok: false, code: "invalid_path", error: "Only files and folders can be opened." };
  }
  // A file is only ever revealed, never launched.
  shell.showItemInFolder(target);
  return { ok: true, opened: "revealed" };
}
