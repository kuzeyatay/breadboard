import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scriptPath, scriptsAvailable } from "./scripts.ts";
import { scrubbed, scrubEnabled } from "./scrub-text.ts";

export { scrubEnabled };

// Strip provenance metadata from a file Breadboard is about to deliver.
//
// This is the file half of the automatic scrub; `scrub-text.ts` is the text
// half. Here the vendored Python does the work rather than a port: C2PA in a
// JPEG's APP11 segment, XMP in a PDF, `docProps/core.xml` in a DOCX — these are
// container formats where a short reimplementation would be a liability, and
// the cost is paid once per file rather than once per message.
//
// Synchronous on purpose. `createImportedArtifact` is synchronous and is called
// from ten different producers; making the scrub async would mean converting
// all of them, and any producer that forgot would ship an unscrubbed file while
// looking correct. A blocking call at the single chokepoint cannot be bypassed.
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

const SCRUB_TIMEOUT_MS = 60_000;

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

function pythonCandidates(): string[] {
  const configured = process.env.WATERMARKS_REMOVER_PYTHON?.trim();
  return [
    ...(configured ? [configured] : []),
    // `python3` is the Windows Store stub on a default install; see scripts.ts.
    ...(process.platform === "win32" ? ["python.exe", "python", "python3"] : ["python3", "python"]),
  ];
}

/**
 * Strip provenance metadata from `file`, in place, returning whether anything
 * ran. Never throws: every failure path returns a reason instead, because the
 * caller is mid-delivery of something the user is waiting for.
 *
 * The file is rewritten only when the scripts produce a non-empty result, so a
 * partial or failed clean can never replace a good file with a broken one.
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
    if (!scriptsAvailable()) return { scrubbed: false, reason: "scripts_unavailable" };

    // A separate output rather than `--in-place`, which leaves a `.bak` beside
    // the file — inside artifact storage that would become a permanent second
    // copy of the very metadata being removed.
    const target = `${file}.scrub`;
    let ran = false;
    for (const python of pythonCandidates()) {
      const result = spawnSync(
        python,
        [scriptPath("clean_file.py"), file, "-o", target, "--json"],
        {
          encoding: "utf8",
          shell: false,
          windowsHide: true,
          timeout: SCRUB_TIMEOUT_MS,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        },
      );
      // ENOENT for this candidate interpreter: try the next one.
      if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
      ran = !result.error && result.status === 0;
      break;
    }
    if (!ran) {
      fs.rmSync(target, { force: true });
      return { scrubbed: false, reason: "clean_failed" };
    }
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      fs.rmSync(target, { force: true });
      return { scrubbed: false, reason: "empty_output" };
    }
    fs.renameSync(target, file);
    return { scrubbed: true };
  } catch (error) {
    // Delivery must not fail because hygiene did.
    return { scrubbed: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}
