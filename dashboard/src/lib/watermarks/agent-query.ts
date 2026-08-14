import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";
import type { ArtifactKind } from "../hermes/artifact-types.ts";
import {
  WatermarkError,
  containWorkspacePath,
  parseReport,
  runScript,
} from "./scripts.ts";
import { selectAttachment, type CleanableAttachment } from "./attachments.ts";

// The agent-facing layer behind the `watermark_*` Hermes tools. The route owns
// session identity and artifact registration; nothing here reads a user id from
// arguments.
//
// Three verbs, matching the upstream skill's own decomposition: inspect (report
// what marks are present), clean (strip them), audit (sweep a directory). Layer
// B — the statistical, token-sampling watermark that only a rewrite defeats —
// is deliberately *not* a tool: upstream's own `rewrite_text.py` defaults to
// printing a prompt, and the agent reading this is the model that would answer
// it. The skill tells it to do the rewrite itself.

export { WatermarkError };

/** Inline text over this many characters is a file, not a chat message. */
const MAX_INLINE_TEXT = 400_000;

/**
 * The directory these tools are confined to — the same one the Office and
 * workspace tools use, so a document authored in this conversation can be
 * cleaned in place. A Garden Chat turn works inside its server-authorized
 * workspace; a terminal chat gets a durable per-conversation directory.
 */
export function watermarkWorkspaceFor(session: {
  active_directory: string | null;
  conversation_id: number | null;
}): string {
  const active = session.active_directory?.trim();
  if (active) return active;
  if (session.conversation_id === null) {
    throw new WatermarkError(409, "watermarks_workspace_required", "These tools need a conversation workspace.");
  }
  const workspace = path.join(dashboardDataDir(), "office-workspaces", String(session.conversation_id));
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

/** Where staged attachments and inline-text scratch files go. */
function stagingDir(workspace: string): string {
  const directory = path.join(workspace, ".watermarks");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function readString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export interface ResolvedSource {
  /** Absolute path of the bytes to operate on. */
  filePath: string;
  /** How the caller named it, for the response and for error messages. */
  label: string;
  kind: "text" | "file" | "attachment";
  /** True when the file is scratch and must be removed afterwards. */
  ephemeral: boolean;
  /** Set only for `attachment`, so a clean can name the artifact sensibly. */
  attachment?: CleanableAttachment;
}

/**
 * Resolve the one thing a call operates on. Exactly one of `text`, `file` and
 * `attachment` may be given: a call with two sources is a call whose author
 * disagreed with itself about what to clean, and silently picking one is how a
 * user gets back a cleaned copy of the wrong document.
 */
export function resolveSource(
  workspace: string,
  args: Record<string, unknown>,
  attachments: readonly CleanableAttachment[],
): ResolvedSource {
  const text = typeof args.text === "string" && args.text.length > 0 ? args.text : null;
  const file = readString(args, "file");
  const attachmentName = readString(args, "attachment");
  const given = [text !== null && "text", file && "file", attachmentName && "attachment"].filter(Boolean);
  if (given.length === 0) {
    throw new WatermarkError(
      400,
      "watermarks_source_required",
      "Pass exactly one of `text` (prose to clean inline), `file` (a workspace-relative path) " +
        "or `attachment` (the name of a file attached to this conversation).",
    );
  }
  if (given.length > 1) {
    throw new WatermarkError(
      400,
      "watermarks_source_ambiguous",
      `Pass only one source; got ${given.join(" and ")}.`,
    );
  }

  if (text !== null) {
    if (text.length > MAX_INLINE_TEXT) {
      throw new WatermarkError(
        400,
        "watermarks_text_too_long",
        `Inline text is capped at ${MAX_INLINE_TEXT.toLocaleString()} characters; write it to the workspace and pass \`file\`.`,
      );
    }
    const scratch = path.join(stagingDir(workspace), `text-${crypto.randomUUID()}.md`);
    // Bytes, not `writeFile` with an encoding: the whole job is preserving the
    // exact codepoints so the scripts can report which ones they removed.
    fs.writeFileSync(scratch, Buffer.from(text, "utf8"));
    return { filePath: scratch, label: "inline text", kind: "text", ephemeral: true };
  }

  if (attachmentName) {
    const attachment = selectAttachment(attachments, attachmentName);
    const staged = path.join(stagingDir(workspace), `${crypto.randomUUID()}-${attachment.filename}`);
    attachment.stage(staged);
    return { filePath: staged, label: attachment.name, kind: "attachment", ephemeral: true, attachment };
  }

  const resolved = containWorkspacePath(workspace, file!, "The file path");
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new WatermarkError(404, "watermarks_file_not_found", `${file} does not exist in the workspace.`);
  }
  return {
    filePath: resolved,
    label: path.relative(workspace, resolved).replace(/\\/g, "/"),
    kind: "file",
    ephemeral: false,
  };
}

function discard(source: ResolvedSource): void {
  if (!source.ephemeral) return;
  fs.rmSync(source.filePath, { force: true });
  // A Garden workspace is the user's own directory; leave it the way it was
  // found rather than accumulating an empty dot-directory in it.
  try {
    fs.rmdirSync(path.dirname(source.filePath));
  } catch {
    // Not empty or already gone — either is fine.
  }
}

export interface InspectResult {
  source: string;
  sourceKind: ResolvedSource["kind"];
  report: Record<string, unknown>;
  /** The short answer, so the model does not have to infer it from the report. */
  marksFound: boolean;
}

/**
 * Whether a report describes anything worth removing. The two script families
 * answer in different shapes — the text scanner counts suspicious codepoints,
 * the file router sets provenance flags and a findings list — so both are read
 * rather than assuming the unified router's shape.
 */
function reportHasMarks(report: Record<string, unknown>): boolean {
  const suspicious = Number(report.suspicious_total ?? 0);
  if (Number.isFinite(suspicious) && suspicious > 0) return true;
  if (report.has_c2pa === true || report.has_ai_metadata === true) return true;
  const findings = report.findings;
  return Array.isArray(findings) && findings.length > 0;
}

/** Report the provenance marks a source carries, without changing anything. */
export async function inspectSource(
  workspace: string,
  args: Record<string, unknown>,
  attachments: readonly CleanableAttachment[],
): Promise<InspectResult> {
  const source = resolveSource(workspace, args, attachments);
  try {
    // Inline text is text by construction; the file router would otherwise
    // classify a `.md` scratch file as a container and skip the codepoint scan.
    const script = source.kind === "text" ? "inspect_text.py" : "inspect_file.py";
    const flags = args.aggressive === true ? ["--aggressive"] : [];
    const run = await runScript(script, [source.filePath, "--json", ...flags], workspace);
    const report = parseReport(run, `Inspecting ${source.label}`);
    return {
      source: source.label,
      sourceKind: source.kind,
      report,
      marksFound: reportHasMarks(report),
    };
  } finally {
    discard(source);
  }
}

const ARTIFACT_KINDS = new Map<string, ArtifactKind>([
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".webp", "image"],
  [".gif", "image"],
  [".svg", "image"],
  [".pdf", "pdf"],
  [".docx", "document"],
  [".odt", "document"],
]);

export interface CleanStaging {
  source: string;
  sourceKind: ResolvedSource["kind"];
  report: Record<string, unknown>;
  /** Present for inline text: the cleaned prose itself. */
  cleanedText?: string;
  /** Present for a file or attachment: where the cleaned copy landed. */
  outputFile?: string;
  /** Absolute path of that copy, for artifact registration. */
  outputPath?: string;
  artifactKind?: ArtifactKind;
  artifactTitle?: string;
  artifactFilename?: string;
  /** Whether anything was actually removed. */
  changed: boolean;
  cleanup: () => void;
}

/**
 * Strip Layer A and container marks from one source.
 *
 * Inline text comes back as text — the caller wanted prose, not a file. A file
 * or attachment is written as a *new* file beside the original: cleaning is
 * lossy for metadata, and `--in-place` on a document the user still needs is
 * not a mistake anyone should be one wrong argument away from.
 */
export async function cleanSource(
  workspace: string,
  args: Record<string, unknown>,
  attachments: readonly CleanableAttachment[],
): Promise<CleanStaging> {
  const source = resolveSource(workspace, args, attachments);
  const noop = () => {};
  try {
    const flags: string[] = [];
    if (args.nfkc === true) flags.push("--nfkc");
    if (args.aggressiveHomoglyphs === true) flags.push("--aggressive-homoglyphs");
    if (args.keepNonAiMetadata === true) flags.push("--keep-non-ai-metadata");

    if (source.kind === "text") {
      const output = path.join(stagingDir(workspace), `cleaned-${crypto.randomUUID()}.md`);
      // `clean_text.py` writes stats to stderr and the cleaned bytes to the
      // output file. Reading the file rather than stdout matters on Windows:
      // text-mode stdout rewrites every \n to \r\n, which would silently
      // change the line endings of prose the user is about to paste back.
      const run = await runScript("clean_text.py", [source.filePath, "-o", output, "--stats", ...flags], workspace);
      if (!fs.existsSync(output)) {
        parseReport(run, "Cleaning the text");
        throw new WatermarkError(502, "watermarks_clean_failed", "Cleaning the text produced no output.");
      }
      const cleanedText = fs.readFileSync(output, "utf8");
      fs.rmSync(output, { force: true });
      const report = parseReport({ ...run, stdout: run.stderr }, "Cleaning the text");
      const removed = Number(report.removed_count ?? 0) + Number(report.replaced_count ?? 0);
      return {
        source: source.label,
        sourceKind: source.kind,
        report,
        cleanedText,
        changed: removed > 0,
        cleanup: noop,
      };
    }

    const originalName = source.attachment?.filename ?? path.basename(source.filePath);
    const extension = path.extname(originalName).toLowerCase();
    const stem = originalName.slice(0, originalName.length - extension.length) || "cleaned";
    const requested = readString(args, "output");
    const outputPath = requested
      ? containWorkspacePath(workspace, requested, "The output path")
      : path.join(workspace, `${stem}.cleaned${extension}`);
    if (path.resolve(outputPath) === path.resolve(source.filePath)) {
      throw new WatermarkError(
        400,
        "watermarks_output_conflict",
        "The cleaned copy must be written to a different path than the original.",
      );
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const run = await runScript("clean_file.py", [source.filePath, "-o", outputPath, "--json", ...flags], workspace);
    const report = parseReport(run, `Cleaning ${source.label}`);
    if (!fs.existsSync(outputPath)) {
      throw new WatermarkError(502, "watermarks_clean_failed", `Cleaning ${source.label} produced no output file.`);
    }
    const actions = Array.isArray(report.actions) ? (report.actions as unknown[]) : [];
    return {
      source: source.label,
      sourceKind: source.kind,
      report,
      outputFile: path.relative(workspace, outputPath).replace(/\\/g, "/"),
      outputPath,
      artifactKind: ARTIFACT_KINDS.get(extension),
      artifactTitle: `${stem} (cleaned)`,
      artifactFilename: `${stem}.cleaned${extension}`,
      // The scripts report "removed=0 replaced=0" rather than staying silent,
      // so an action list alone does not mean anything changed.
      changed:
        Number(report.bytes_in ?? 0) !== Number(report.bytes_out ?? 0) ||
        actions.some((action) => typeof action === "string" && !/removed=0 replaced=0|^no /i.test(action)),
      cleanup: noop,
    };
  } finally {
    discard(source);
  }
}

/** Sweep a workspace subtree and report which files carry provenance marks. */
export async function auditWorkspace(
  workspace: string,
  args: Record<string, unknown>,
): Promise<{ directory: string; report: Record<string, unknown> }> {
  const requested = readString(args, "directory");
  const target = requested
    ? containWorkspacePath(workspace, requested, "The directory", { allowRoot: true })
    : workspace;
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new WatermarkError(404, "watermarks_directory_not_found", `${requested ?? "."} is not a directory in the workspace.`);
  }
  const run = await runScript("audit_dir.py", [target, "--json", "--skip", ".watermarks,.officecli,.breadboard"], workspace);
  return {
    directory: path.relative(workspace, target).replace(/\\/g, "/") || ".",
    report: parseReport(run, "Auditing the workspace"),
  };
}
