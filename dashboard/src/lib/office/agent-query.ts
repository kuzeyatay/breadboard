import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renderImportedArtifactFallbackPreview } from "../hermes/artifact-renderers.ts";
import {
  describeOfficeExport,
  officeWorkspaceFor,
  type OfficeExportStaging,
  type OfficeRunResult,
} from "./contract.ts";
import {
  OfficeCliError,
  OFFICE_RUN_TIMEOUT_MS,
  runOfficeCli,
  validateOfficeCommand,
} from "./officecli.ts";

// The agent-facing layer behind the `office_*` Hermes tools. Deliberately
// small: `runOfficeCommand` executes one validated OfficeCLI command inside
// the turn's workspace, and `prepareOfficeExport` stages a finished document
// for the artifact importer. The route owns session identity and artifact
// registration; nothing here reads a user id from arguments.

export { OfficeCliError, describeOfficeExport, officeWorkspaceFor };
export type { OfficeExportStaging, OfficeRunResult };

/** Execute one OfficeCLI command string inside the workspace. */
export async function runOfficeCommand(
  workspace: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
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
    env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1" },
    signal: options.signal,
  });
  const breadboardExecutionNote =
    validated.subcommand === "load_skill"
      ? "[Breadboard execution note] office_run is a brokered agent call. For a new document, group planned paragraphs, table rows, and similar content into batch commands instead of issuing one office_run call per element. Reserve the final calls for view/validate and office_export; the task is incomplete until office_export returns the artifact."
      : "";
  const output = [
    result.stdout.trim(),
    result.stderr.trim() ? `[stderr] ${result.stderr.trim()}` : "",
    result.truncated ? "[output truncated]" : "",
    result.timedOut ? "[the command timed out and was stopped]" : "",
    breadboardExecutionNote,
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

/** Formats OfficeCLI can snapshot to HTML for an inline artifact preview. */
const PREVIEWABLE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);
// Export is a one-shot handoff to a non-OfficeCLI consumer. A background
// resident would retain a handle to the temporary editor workspace on Windows,
// so export deliberately uses the direct, flush-on-return path.
const OFFICE_EXPORT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  OFFICECLI_NO_AUTO_RESIDENT: "1",
};

/**
 * Stage a finished document for artifact registration: flush any resident
 * state to disk, then render an HTML snapshot with OfficeCLI's own renderer so
 * the artifact opens as a page instead of a bare download. The snapshot is
 * best-effort — a document that cannot be rendered still exports.
 */
export async function prepareOfficeExport(
  workspace: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<OfficeExportStaging> {
  const described = describeOfficeExport(workspace, args);
  const { filePath } = described;
  const extension = path.extname(filePath).toLowerCase();
  // Breadboard pins OFFICECLI_RESIDENT_FLUSH=each for every mutation, so the
  // on-disk file is current here. The export itself is deliberately
  // non-resident; closing a separately-owned resident from this one-shot
  // staging path would make concurrent editor work disappear underneath it.
  let previewFilePath: string | null = null;
  if (PREVIEWABLE_EXTENSIONS.has(extension)) {
    const stagingDir = path.join(workspace, ".officecli");
    fs.mkdirSync(stagingDir, { recursive: true });
    const candidate = path.join(stagingDir, `preview-${crypto.randomUUID()}.html`);
    try {
      const rendered = await runOfficeCli(
        ["view", filePath, "html", "-o", candidate],
        {
          cwd: workspace,
          timeoutMs: 60_000,
          env: OFFICE_EXPORT_ENV,
          signal: options.signal,
        },
      );
      if (rendered.code === 0 && fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
        previewFilePath = candidate;
      } else {
        fs.rmSync(candidate, { force: true });
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? error;
      }
      // The snapshot is an enhancement; the export itself must not fail on it.
    }
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (!previewFilePath && extension === ".pptx") {
      previewFilePath = await renderImportedArtifactFallbackPreview(filePath, candidate);
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
    ...described,
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
