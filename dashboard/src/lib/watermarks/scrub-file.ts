import fs from "node:fs";
import path from "node:path";
import { scrubbed, scrubEnabled } from "./scrub-text.ts";
import {
  cleanWatermarkViaRuntime,
  type WatermarkRuntimeControl,
  type WatermarkRuntimeScope,
} from "../runtime-v2/watermark-job.ts";

export { scrubEnabled };

// Strip provenance metadata from a file Breadboard is about to deliver.
//
// This is the file half of the automatic scrub; `scrub-text.ts` is the text
// half. Here the vendored Python does the work rather than a port: C2PA in a
// JPEG's APP11 segment, XMP in a PDF, `docProps/core.xml` in a DOCX — these are
// container formats where a short reimplementation would be a liability, and
// the cost is paid once per file rather than once per message.
//
// Binary work is asynchronous because it runs only in a fresh Rust-owned
// Runtime worker. The artifact import chokepoints await the Runtime seam, so a
// producer cannot accidentally bypass it.
//
// Fail-open, also on purpose. If Python is missing or the scripts error, the
// artifact is still delivered — carrying metadata. Losing somebody's finished
// document because a metadata strip failed is the worse outcome, and the one
// they cannot recover from.

/** Container formats whose metadata the Python scripts understand. */
const BINARY_FORMATS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".pdf", ".docx", ".odt"]);

/** Text formats, handled by the in-process port — no interpreter startup. */
const TEXT_FORMATS = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".csv", ".json"]);

/** Text files above this are left alone; the cost stops being worth it. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/** Whether this path is a format the scrub knows how to handle. */
export function scrubbableFile(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  return BINARY_FORMATS.has(extension) || TEXT_FORMATS.has(extension);
}

export interface FileScrubResult {
  scrubbed: boolean;
  /** Why it did nothing, when it did nothing. For logs, never for the user. */
  reason?: string;
}

/**
 * Strip provenance carriers from a text file in process. Binary formats return
 * `runtime_required`; callers that may receive them use the asynchronous
 * Runtime seam below.
 */
export function scrubFileInPlace(file: string): FileScrubResult {
  try {
    if (!scrubEnabled()) return { scrubbed: false, reason: "disabled" };
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return { scrubbed: false, reason: "not_a_file" };
    }
    const extension = path.extname(file).toLowerCase();

    if (TEXT_FORMATS.has(extension)) {
      const { size } = fs.statSync(file);
      if (size > MAX_TEXT_BYTES) return { scrubbed: false, reason: "too_large" };
      const original = fs.readFileSync(file, "utf8");
      const clean = scrubbed(original);
      if (clean === original) return { scrubbed: false, reason: "nothing_to_remove" };
      fs.writeFileSync(file, clean, "utf8");
      return { scrubbed: true };
    }

    if (!BINARY_FORMATS.has(extension)) return { scrubbed: false, reason: "unsupported_format" };
    return { scrubbed: false, reason: "runtime_required" };
  } catch (error) {
    // Delivery must not fail because hygiene did.
    return { scrubbed: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}

export interface FileScrubRuntimeExecution {
  scope: WatermarkRuntimeScope;
  signal?: AbortSignal;
  control?: WatermarkRuntimeControl;
}

/**
 * Strip binary provenance in a fresh Runtime worker. Never throws and never
 * mutates the source unless a non-empty, hash-verified output has materialized.
 */
export async function scrubFileInPlaceViaRuntime(
  file: string,
  execution: FileScrubRuntimeExecution,
): Promise<FileScrubResult> {
  const immediate = scrubFileInPlace(file);
  if (immediate.reason !== "runtime_required") return immediate;
  const target = `${file}.scrub`;
  try {
    const result = await cleanWatermarkViaRuntime({
      scope: execution.scope,
      sourcePath: file,
      outputPath: target,
      mode: "auto",
      strictExit: true,
      signal: execution.signal,
      control: execution.control,
    });
    if (!result.ok) {
      fs.rmSync(target, { force: true });
      return { scrubbed: false, reason: result.errorCode || "clean_failed" };
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile() || fs.statSync(target).size === 0) {
      fs.rmSync(target, { force: true });
      return { scrubbed: false, reason: "empty_output" };
    }
    fs.renameSync(target, file);
    return { scrubbed: true };
  } catch (error) {
    fs.rmSync(target, { force: true });
    return { scrubbed: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}
