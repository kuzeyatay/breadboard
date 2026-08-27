// The per-run directory the harness works in, and how the chat's attachments
// become documents on its shelf.
//
// The harness expects a workspace with `documents/` (read-only inputs) and
// `output/` (deliverables). Breadboard has the inputs as chat attachments, so
// they are written out as real files before the run starts — the agent reads
// with its own `read`/`glob`/`grep` tools rather than being handed a wall of
// pasted text, which is what lets it work document by document and cite where
// something came from.
//
// **Originals, not descriptions.** A document attachment now carries a pointer
// to the file it came from, so the real .docx is copied in. That is the whole
// difference between an agent that can tell you what is wrong with an agreement
// and one that can hand you the marked-up agreement back: `redline.py`,
// `comments_add.py`, `accept_changes.py` and `template_fill.py` in the harness's
// docx skill all start from a source file, and until the bytes survived the
// attachment pipeline there was no source file to start from.
//
// Three things land per document:
//
//   contract.docx              the original — read it, and rewrite it
//   contract.extracted.md      the structured reading: tables as tables,
//                              equations as LaTeX, tracked changes marked,
//                              comments and footnotes gathered
//   contract.figures/          every picture and chart, as real image files
//
// The extraction is written alongside rather than instead, because the two
// answer different questions. Pandoc — which is what the harness's `read` tool
// uses on a .docx — gives faithful prose and loses the equations. The
// extraction keeps the equations and the figure references. Neither is a
// superset of the other, so the agent gets both and is told which is which.

import fs from "node:fs";
import path from "node:path";
import type { ChatAttachment } from "../chat-attachments.ts";
import { describeDocumentSummary } from "../document-attachments.ts";
import { normalizeDocumentSummary } from "../document-attachments.ts";
import { resolveDocumentAttachment } from "../document-attachments-server.ts";
import { documentContextText, readDocument } from "../document-structure/index.ts";
import { readDocumentFigure } from "../conversations/document-blob-store.ts";
import { stateRoot } from "./runtime.ts";
import {
  copyLegalBundleSegment,
  readLegalBundleText,
  readLegalRuntimeBundle,
  type LegalBundleSegment,
} from "./runtime-attachment-bundle.ts";
import type {
  LegalRuntimeAttachmentManifest,
  LegalRuntimeContentManifest,
} from "./runtime-inputs.ts";

export interface StagedDocument {
  /** The file the agent reads and may rewrite, relative to `documents/`. */
  filename: string;
  /** The structured reading beside it, when one was produced. */
  extractedFilename: string | null;
  /** Figure files written beside it, relative to `documents/`. */
  figureFilenames: string[];
  /** One line naming what is in it besides prose. */
  description: string;
  /** True when an agent can rewrite this file in place. */
  editable: boolean;
}

export interface LegalWorkspace {
  root: string;
  workspaceDir: string;
  documentsDir: string;
  outputDir: string;
  /** What was actually written, in the order it was given. */
  documents: string[];
  /** The originals, with what was staged beside each. */
  staged: StagedDocument[];
  /** Attachments that could not become documents, with the reason. */
  skipped: string[];
}

/** Extensions whose text is still meaningfully that file type once extracted. */
const TEXT_NATIVE = new Set([".md", ".markdown", ".txt", ".csv", ".json", ".xml", ".html", ".htm"]);

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/^[.\- ]+/, "");
  return base.slice(0, 120) || "document";
}

/**
 * The filename an *extracted* text attachment is written under.
 *
 * A plain text file keeps its name. Anything else — a .docx whose text was
 * pulled out in the browser before this pipeline existed, or a format with no
 * structural reader — must not keep the original extension: the harness's
 * `read` tool dispatches on it and would hand a markdown file to pandoc, which
 * fails with an error the agent cannot interpret.
 */
function extractedFilename(name: string): string {
  const safe = safeName(name);
  const extension = path.extname(safe).toLowerCase();
  if (TEXT_NATIVE.has(extension)) return safe;
  if (!extension) return `${safe}.md`;
  return `${safe.slice(0, safe.length - extension.length)}${extension.replace(".", "-")}.md`;
}

function uniqueIn(directory: string, filename: string, taken: Set<string>): string {
  if (!taken.has(filename.toLowerCase()) && !fs.existsSync(path.join(directory, filename))) {
    taken.add(filename.toLowerCase());
    return filename;
  }
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!taken.has(candidate.toLowerCase()) && !fs.existsSync(path.join(directory, candidate))) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  throw new Error("Too many documents with the same name.");
}

/** Create the run's directory tree and stage every attachment it can use. */
export function prepareWorkspace(input: {
  runId: string;
  userId: number;
  attachments: readonly ChatAttachment[];
}): LegalWorkspace {
  const root = path.join(stateRoot(), "runs", input.runId);
  const workspaceDir = path.join(root, "workspace");
  const documentsDir = path.join(workspaceDir, "documents");
  const outputDir = path.join(workspaceDir, "output");
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const documents: string[] = [];
  const staged: StagedDocument[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();

  for (const attachment of input.attachments) {
    try {
      if (attachment.type === "document") {
        const resolved = resolveDocumentAttachment(input.userId, attachment);
        if (!resolved) {
          skipped.push(`${attachment.name} could not be read back from storage.`);
          continue;
        }
        // The original keeps its real name and extension: the agent is meant to
        // open it as a .docx and, for an editable format, to write it back.
        const filename = uniqueIn(documentsDir, safeName(attachment.name), taken);
        fs.copyFileSync(resolved.path, path.join(documentsDir, filename));
        documents.push(filename);

        const stem = filename.slice(0, filename.length - path.extname(filename).length);
        let extractedName: string | null = null;
        if (resolved.text.trim()) {
          extractedName = uniqueIn(documentsDir, `${stem}.extracted.md`, taken);
          fs.writeFileSync(path.join(documentsDir, extractedName), resolved.text, {
            encoding: "utf8",
            flag: "wx",
          });
          documents.push(extractedName);
        }

        // Figures are written under the document's own directory so a run with
        // several files does not end up with a single flat pile of figure-1s.
        const figureFilenames: string[] = [];
        if (resolved.figures.length) {
          const figuresDir = path.join(documentsDir, `${stem}.figures`);
          fs.mkdirSync(figuresDir, { recursive: true });
          for (const name of resolved.figures) {
            const figure = readDocumentFigure({
              userId: input.userId,
              blobId: resolved.blobId,
              name,
            });
            if (!figure) continue;
            fs.writeFileSync(path.join(figuresDir, figure.name), figure.buffer);
            figureFilenames.push(`${stem}.figures/${figure.name}`);
          }
        }

        staged.push({
          filename,
          extractedFilename: extractedName,
          figureFilenames,
          description: describeDocumentSummary(attachment.summary),
          editable: attachment.format !== "pdf",
        });
        continue;
      }

      if (attachment.type === "text") {
        const filename = uniqueIn(documentsDir, extractedFilename(attachment.name), taken);
        const text = attachment.text.slice(0, MAX_DOCUMENT_BYTES);
        fs.writeFileSync(path.join(documentsDir, filename), text, { encoding: "utf8", flag: "wx" });
        documents.push(filename);
        staged.push({
          filename,
          extractedFilename: null,
          figureFilenames: [],
          description: "",
          editable: false,
        });
        continue;
      }

      if (attachment.type === "image") {
        const comma = attachment.dataUrl.indexOf(",");
        const bytes = Buffer.from(attachment.dataUrl.slice(comma + 1), "base64");
        if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
          skipped.push(`${attachment.name} is too large to work on.`);
          continue;
        }
        const filename = uniqueIn(documentsDir, safeName(attachment.name), taken);
        fs.writeFileSync(path.join(documentsDir, filename), bytes, { flag: "wx" });
        documents.push(filename);
        continue;
      }

      // A video or a 3D model is not a legal document, and the agent has no
      // tool that could open one. Saying so beats a file it cannot read.
      skipped.push(`${attachment.name} is not a document the Legal Agent can read.`);
    } catch (error) {
      skipped.push(
        `${attachment.name} could not be prepared: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  return { root, workspaceDir, documentsDir, outputDir, documents, staged, skipped };
}

export interface PreparedRuntimeLegalWorkspace {
  readonly workspace: LegalWorkspace;
  readonly task: string;
  readonly memoryContext: string;
  readonly conversationContext: string;
}

function oneBundleSegment(
  segments: readonly LegalBundleSegment[],
  kind: LegalBundleSegment["kind"],
): LegalBundleSegment | undefined {
  const matches = segments.filter(
    (segment) => segment.kind === kind && segment.attachmentIndex === null,
  );
  if (matches.length > 1) throw new Error("The sealed Legal Agent bundle repeated content.");
  return matches[0];
}

/**
 * Worker-only staging from Runtime-verified input paths. The renderer controls
 * neither a path nor a filename on disk: request entries carry fixed ordinals,
 * and every target is rebuilt under the private job workspace.
 */
export function prepareRuntimeWorkspace(input: {
  readonly runtimeWorkspacePath: string;
  readonly inputPaths: readonly string[];
  readonly content: LegalRuntimeContentManifest;
  readonly attachments: readonly LegalRuntimeAttachmentManifest[];
}): PreparedRuntimeLegalWorkspace {
  const workspaceDir = fs.realpathSync.native(path.resolve(input.runtimeWorkspacePath));
  const workspaceMetadata = fs.lstatSync(workspaceDir);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    throw new Error("The Legal Agent private Runtime workspace is unavailable.");
  }
  const expectedInputs = 1 + input.attachments.filter((entry) => entry.kind !== "skipped").length;
  if (input.inputPaths.length !== expectedInputs || !input.inputPaths[0]) {
    throw new Error("The Legal Agent received the wrong sealed input set.");
  }
  const bundle = readLegalRuntimeBundle(input.inputPaths[0]);
  const taskSegment = oneBundleSegment(bundle.segments, "task");
  const memorySegment = oneBundleSegment(bundle.segments, "memory");
  const conversationSegment = oneBundleSegment(bundle.segments, "conversation");
  if (
    !taskSegment ||
    taskSegment.sizeBytes !== input.content.taskBytes ||
    (memorySegment?.sizeBytes ?? 0) !== input.content.memoryBytes ||
    (conversationSegment?.sizeBytes ?? 0) !== input.content.conversationBytes
  ) {
    throw new Error("The Legal Agent content manifest does not match its sealed bundle.");
  }

  const declaredDocumentSegments = new Set<string>();
  for (let index = 0; index < input.attachments.length; index += 1) {
    const attachment = input.attachments[index]!;
    if (attachment.kind !== "document") continue;
    if (attachment.hasExtractedText) declaredDocumentSegments.add(`${index}:text:`);
    for (const name of attachment.figures) declaredDocumentSegments.add(`${index}:figure:${name}`);
  }
  const actualDocumentSegments = new Set(
    bundle.segments
      .filter((segment) =>
        segment.kind === "document-text" || segment.kind === "document-figure")
      .map((segment) =>
        `${segment.attachmentIndex}:${segment.kind === "document-text" ? "text" : "figure"}:${segment.name ?? ""}`),
  );
  if (
    actualDocumentSegments.size !== declaredDocumentSegments.size ||
    [...actualDocumentSegments].some((key) => !declaredDocumentSegments.has(key))
  ) {
    throw new Error("The Legal Agent document sidecar manifest is inconsistent.");
  }

  const documentsDir = path.join(workspaceDir, "documents");
  const outputDir = path.join(workspaceDir, "output");
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const documents: string[] = [];
  const staged: StagedDocument[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();

  for (let attachmentIndex = 0; attachmentIndex < input.attachments.length; attachmentIndex += 1) {
    const attachment = input.attachments[attachmentIndex]!;
    if (attachment.kind === "skipped") {
      skipped.push(
        attachment.reason === "unreadable-document"
          ? `${attachment.name} could not be read back from storage.`
          : attachment.reason === "oversized-image"
            ? `${attachment.name} is too large to work on.`
            : `${attachment.name} is not a document the Legal Agent can read.`,
      );
      continue;
    }
    try {
      const source = input.inputPaths[attachment.inputIndex];
      if (!source) throw new Error("sealed input unavailable");
      if (attachment.kind === "document") {
        const filename = uniqueIn(documentsDir, safeName(attachment.name), taken);
        const target = path.join(documentsDir, filename);
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        documents.push(filename);
        const stem = filename.slice(0, filename.length - path.extname(filename).length);
        let extractedName: string | null = null;
        const extractedSegment = bundle.segments.find((segment) =>
          segment.kind === "document-text" && segment.attachmentIndex === attachmentIndex);
        if (extractedSegment) {
          extractedName = uniqueIn(documentsDir, `${stem}.extracted.md`, taken);
          copyLegalBundleSegment(bundle, extractedSegment, path.join(documentsDir, extractedName));
          documents.push(extractedName);
        } else {
          const structure = readDocument(attachment.format, fs.readFileSync(target));
          const extracted = documentContextText({
            filename: attachment.name,
            summary: normalizeDocumentSummary(structure.summary),
            markdown: structure.markdown,
            warnings: structure.warnings,
          });
          if (extracted.trim()) {
            extractedName = uniqueIn(documentsDir, `${stem}.extracted.md`, taken);
            fs.writeFileSync(path.join(documentsDir, extractedName), extracted, {
              encoding: "utf8",
              flag: "wx",
            });
            documents.push(extractedName);
          }
        }

        const figureFilenames: string[] = [];
        if (attachment.figures.length) {
          const figuresDir = path.join(documentsDir, `${stem}.figures`);
          fs.mkdirSync(figuresDir, { recursive: true });
          for (const name of attachment.figures) {
            const segment = bundle.segments.find((candidate) =>
              candidate.kind === "document-figure" &&
              candidate.attachmentIndex === attachmentIndex &&
              candidate.name === name);
            if (!segment) throw new Error("sealed figure unavailable");
            copyLegalBundleSegment(bundle, segment, path.join(figuresDir, name));
            figureFilenames.push(`${stem}.figures/${name}`);
          }
        }
        staged.push({
          filename,
          extractedFilename: extractedName,
          figureFilenames,
          description: attachment.description,
          editable: attachment.editable,
        });
        continue;
      }

      if (attachment.kind === "text") {
        const filename = uniqueIn(documentsDir, extractedFilename(attachment.name), taken);
        fs.copyFileSync(source, path.join(documentsDir, filename), fs.constants.COPYFILE_EXCL);
        documents.push(filename);
        staged.push({
          filename,
          extractedFilename: null,
          figureFilenames: [],
          description: "",
          editable: false,
        });
        continue;
      }

      const filename = uniqueIn(documentsDir, safeName(attachment.name), taken);
      fs.copyFileSync(source, path.join(documentsDir, filename), fs.constants.COPYFILE_EXCL);
      documents.push(filename);
    } catch (error) {
      skipped.push(
        `${attachment.name} could not be prepared: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  return {
    workspace: {
      root: workspaceDir,
      workspaceDir,
      documentsDir,
      outputDir,
      documents,
      staged,
      skipped,
    },
    task: readLegalBundleText(bundle, taskSegment, 4 * 1024 * 1024),
    memoryContext: readLegalBundleText(bundle, memorySegment, 16 * 1024 * 1024),
    conversationContext: readLegalBundleText(
      bundle,
      conversationSegment,
      16 * 1024 * 1024,
    ),
  };
}

/** Read one produced file, refusing anything that escapes the output directory. */
export function readOutputFile(outputDir: string, relativePath: string): Buffer | null {
  const resolvedRoot = path.resolve(outputDir);
  const candidate = path.resolve(resolvedRoot, relativePath);
  const contained =
    candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep);
  if (!contained) return null;
  try {
    return fs.readFileSync(candidate);
  } catch {
    return null;
  }
}

/** Remove a finished run's directory. The deliverables live on as artifacts. */
export function removeWorkspace(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // A file still open on Windows is not worth failing a cleanup timer over.
  }
}
