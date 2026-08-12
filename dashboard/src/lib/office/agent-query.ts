import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";
import type { ArtifactKind } from "../hermes/artifact-types.ts";
import {
  OfficeCliError,
  OFFICE_RUN_TIMEOUT_MS,
  containWorkspacePath,
  runOfficeCli,
  validateOfficeCommand,
} from "./officecli.ts";

// The agent-facing layer behind the `office_*` Hermes tools. Deliberately
// small: `runOfficeCommand` executes one validated OfficeCLI command inside
// the turn's workspace, and `prepareOfficeExport` stages a finished document
// for the artifact importer. The route owns session identity and artifact
// registration; nothing here reads a user id from arguments.

export { OfficeCliError };

/**
 * The directory OfficeCLI commands are confined to. A Garden Chat turn works
 * inside its server-authorized workspace — the same root `artifact_import`
 * trusts — so documents that already live with the user's material can be
 * edited in place. A terminal chat has no such directory, so each conversation
 * gets a durable workspace of its own under the dashboard data dir.
 */
export function officeWorkspaceFor(session: {
  active_directory: string | null;
  conversation_id: number | null;
}): string {
  const active = session.active_directory?.trim();
  if (active) return active;
  if (session.conversation_id === null) {
    throw new OfficeCliError(409, "office_workspace_required", "Office tools need a conversation workspace.");
  }
  const workspace = path.join(
    dashboardDataDir(),
    "office-workspaces",
    String(session.conversation_id),
  );
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

export interface OfficeRunResult {
  command: string;
  exitCode: number;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  /** Workspace-relative path of the document the command touched, if any. */
  file: string | null;
}

/** Execute one OfficeCLI command string inside the workspace. */
export async function runOfficeCommand(
  workspace: string,
  args: Record<string, unknown>,
): Promise<OfficeRunResult> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) {
    throw new OfficeCliError(
      400,
      "office_command_required",
      "Pass the OfficeCLI command to run, e.g. `create report.docx` or `help docx paragraph`.",
    );
  }
  if (command.length > 20_000) {
    throw new OfficeCliError(400, "office_command_too_long", "The command exceeds 20,000 characters.");
  }
  const validated = validateOfficeCommand(command, workspace);
  const result = await runOfficeCli(validated.argv, {
    cwd: workspace,
    timeoutMs: OFFICE_RUN_TIMEOUT_MS,
  });
  const output = [
    result.stdout.trim(),
    result.stderr.trim() ? `[stderr] ${result.stderr.trim()}` : "",
    result.truncated ? "[output truncated]" : "",
    result.timedOut ? "[the command timed out and was stopped]" : "",
  ].filter(Boolean).join("\n");
  return {
    command,
    exitCode: result.code,
    output: output || "(no output)",
    truncated: result.truncated,
    timedOut: result.timedOut,
    file: validated.file ? path.relative(workspace, validated.file).replace(/\\/g, "/") : null,
  };
}

const EXPORT_KINDS = new Map<string, ArtifactKind>([
  [".docx", "document"],
  [".pptx", "presentation"],
  [".xlsx", "spreadsheet"],
  [".csv", "spreadsheet"],
  [".tsv", "spreadsheet"],
  [".pdf", "pdf"],
]);

/** Formats OfficeCLI can snapshot to HTML for an inline artifact preview. */
const PREVIEWABLE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);

export interface OfficeExportStaging {
  /** Absolute path of the document inside the workspace. */
  filePath: string;
  /** Workspace-relative path, for the artifact importer. */
  relativeFile: string;
  kind: ArtifactKind;
  title: string;
  filename: string;
  /** Absolute path of a rendered HTML snapshot, when one could be produced. */
  previewFilePath: string | null;
  /** Remove the staged preview once the artifact import has copied it. */
  cleanup: () => void;
}

/**
 * Stage a finished document for artifact registration: flush any resident
 * state to disk, then render an HTML snapshot with OfficeCLI's own renderer so
 * the artifact opens as a page instead of a bare download. The snapshot is
 * best-effort — a document that cannot be rendered still exports.
 */
export async function prepareOfficeExport(
  workspace: string,
  args: Record<string, unknown>,
): Promise<OfficeExportStaging> {
  const file = typeof args.file === "string" ? args.file.trim() : "";
  if (!file) {
    throw new OfficeCliError(400, "office_file_required", "Pass the workspace-relative path of the document to export.");
  }
  const filePath = containWorkspacePath(workspace, file, "The document path");
  const extension = path.extname(filePath).toLowerCase();
  const kind = EXPORT_KINDS.get(extension);
  if (!kind) {
    throw new OfficeCliError(
      400,
      "office_export_unsupported",
      `Only ${[...EXPORT_KINDS.keys()].join(", ")} files can be exported as artifacts.`,
    );
  }
  // Release the resident so the bytes on disk are final before anything else
  // reads them. A file without a resident exits non-zero; that is fine.
  await runOfficeCli(["close", filePath], { cwd: workspace, timeoutMs: 30_000 }).catch(() => undefined);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new OfficeCliError(404, "office_file_not_found", `${file} does not exist in the workspace.`);
  }

  const filename = path.basename(filePath);
  const fallbackTitle = filename.replace(/\.[a-z0-9]+$/i, "");
  const title =
    typeof args.title === "string" && args.title.trim()
      ? args.title.trim().slice(0, 240)
      : fallbackTitle;

  let previewFilePath: string | null = null;
  if (PREVIEWABLE_EXTENSIONS.has(extension)) {
    const stagingDir = path.join(workspace, ".officecli");
    fs.mkdirSync(stagingDir, { recursive: true });
    const candidate = path.join(stagingDir, `preview-${crypto.randomUUID()}.html`);
    try {
      const rendered = await runOfficeCli(
        ["view", filePath, "html", "-o", candidate],
        { cwd: workspace, timeoutMs: 60_000 },
      );
      if (rendered.code === 0 && fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
        previewFilePath = candidate;
      } else {
        fs.rmSync(candidate, { force: true });
      }
    } catch {
      // The snapshot is an enhancement; the export itself must not fail on it.
    }
    if (!previewFilePath) {
      try {
        fs.rmdirSync(stagingDir);
      } catch {
        // Not empty or already gone — either is fine.
      }
    }
  }

  return {
    filePath,
    relativeFile: path.relative(workspace, filePath).replace(/\\/g, "/"),
    kind,
    title,
    filename,
    previewFilePath,
    cleanup: () => {
      if (!previewFilePath) return;
      fs.rmSync(previewFilePath, { force: true });
      // Leave a garden workspace the way it was found: drop the staging
      // directory too once nothing else is in it.
      try {
        fs.rmdirSync(path.dirname(previewFilePath));
      } catch {
        // Not empty or already gone — either is fine.
      }
    },
  };
}
